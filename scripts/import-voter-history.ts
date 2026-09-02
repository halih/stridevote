/**
 * Load Washington SOS voting-history files (2007–present) into VoterHistory.
 *
 * Accepts zip files, loose .txt files, or a folder (recurses for
 * *Voting_History.zip / *Voting_History.txt, and history files inside VRDB zips).
 *
 * Usage:
 *   npm run voters:import-history -- "/path/to/WA SOS Elections Drop"
 *   npm run voters:import-history -- "/path/to/2007-2008_Voting_History.zip"
 *
 * Default: only rows whose StateVoterID matches a Voter already in the DB.
 * Pass --all to store statewide history even when the voter is not imported yet.
 */
import { createReadStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { PrismaClient } from "../src/generated/prisma";
import { electionTypeForDate } from "../src/lib/elections";
import { rebuildVoterPropensity } from "./lib/rebuild-voter-propensity";

const prisma = new PrismaClient();
const BATCH = 2500;

export type HistoryRow = {
  sosHistoryId: string | null;
  stateVoterId: string;
  countyCode: string | null;
  countyCodeVoting: string | null;
  electionDate: string;
  electionType: string;
  source: string;
};

function zipList(zipPath: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const child = spawn("unzip", ["-Z1", zipPath]);
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk: Buffer) => {
      out += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      err += chunk.toString();
    });
    child.on("close", (code) => {
      if (code !== 0) reject(new Error(err || `unzip -Z1 failed (${code})`));
      else resolve(out.split("\n").map((l) => l.trim()).filter(Boolean));
    });
  });
}

function streamZipFile(zipPath: string, entry: string) {
  const child = spawn("unzip", ["-p", zipPath, entry], {
    stdio: ["ignore", "pipe", "inherit"],
  });
  return createInterface({ input: child.stdout, crlfDelay: Infinity });
}

function streamFile(filePath: string) {
  return createInterface({
    input: createReadStream(filePath),
    crlfDelay: Infinity,
  });
}

export function normalizeStateVoterId(raw: string): string {
  let value = raw.trim();
  if (/^WA/i.test(value)) value = value.slice(2);
  value = value.replace(/^0+/, "");
  return value;
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function detectDelim(headerLine: string): "|" | "\t" {
  return headerLine.includes("|") ? "|" : "\t";
}

function parseHeader(line: string): { delim: "|" | "\t"; names: string[] } {
  const cleaned = line.replace(/^\uFEFF/, "").replace(/\r$/, "");
  const delim = detectDelim(cleaned);
  const names = cleaned.split(delim).map((n) => n.trim());
  return { delim, names };
}

function rowFromCols(
  names: string[],
  cols: string[],
  source: string,
): HistoryRow | null {
  const get = (name: string) => {
    const i = names.indexOf(name);
    return i >= 0 ? cols[i] ?? "" : "";
  };
  const stateVoterId = normalizeStateVoterId(get("StateVoterID"));
  const electionDate = get("ElectionDate").trim();
  if (!stateVoterId || !/^\d{4}-\d{2}-\d{2}$/.test(electionDate)) return null;
  return {
    sosHistoryId: blankToNull(get("VoterHistoryID")),
    stateVoterId,
    countyCode: blankToNull(get("CountyCode")),
    countyCodeVoting: blankToNull(get("CountyCode_Voting")),
    electionDate,
    electionType: electionTypeForDate(electionDate),
    source,
  };
}

async function insertBatch(rows: HistoryRow[]): Promise<number> {
  if (!rows.length) return 0;
  const inserted = await prisma.$executeRaw`
    INSERT INTO "VoterHistory" (
      id, "sosHistoryId", "stateVoterId", "voterId",
      "countyCode", "countyCodeVoting", "electionDate", "electionType", source
    )
    SELECT
      gen_random_uuid()::text,
      x."sosHistoryId",
      x."stateVoterId",
      v.id,
      x."countyCode",
      x."countyCodeVoting",
      x."electionDate"::date,
      x."electionType",
      x.source
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
      "sosHistoryId" text,
      "stateVoterId" text,
      "countyCode" text,
      "countyCodeVoting" text,
      "electionDate" text,
      "electionType" text,
      source text
    )
    LEFT JOIN "Voter" v ON v."stateVoterId" = x."stateVoterId"
    ON CONFLICT ("stateVoterId", "electionDate") DO NOTHING
  `;
  return Number(inserted);
}

export async function ingestHistoryLines(
  lines: AsyncIterable<string>,
  source: string,
  knownIds: Set<string> | null,
): Promise<{ scanned: number; kept: number; inserted: number }> {
  let delim: "|" | "\t" | null = null;
  let names: string[] | null = null;
  let scanned = 0;
  let kept = 0;
  let inserted = 0;
  let batch: HistoryRow[] = [];

  for await (const line of lines) {
    if (!names) {
      const parsed = parseHeader(line);
      delim = parsed.delim;
      names = parsed.names;
      continue;
    }
    scanned++;
    const cols = line.replace(/\r$/, "").split(delim!);
    const row = rowFromCols(names, cols, source);
    if (!row) continue;
    if (knownIds && !knownIds.has(row.stateVoterId)) continue;
    batch.push(row);
    kept++;
    if (batch.length >= BATCH) {
      inserted += await insertBatch(batch);
      batch = [];
    }
  }
  if (batch.length) inserted += await insertBatch(batch);
  return { scanned, kept, inserted };
}

export async function ingestHistoryZipEntry(
  zipPath: string,
  entry: string,
  knownIds: Set<string> | null,
) {
  return ingestHistoryLines(streamZipFile(zipPath, entry), basename(entry), knownIds);
}

async function collectSources(path: string): Promise<Array<{ zip: string; entry: string } | { file: string }>> {
  const st = await stat(path);
  if (st.isDirectory()) {
    const out: Array<{ zip: string; entry: string } | { file: string }> = [];
    const entries = await readdir(path);
    for (const name of entries) {
      if (name.startsWith(".")) continue;
      out.push(...(await collectSources(join(path, name))));
    }
    return out;
  }

  const lower = path.toLowerCase();
  if (lower.endsWith(".txt") && /voting_history/i.test(basename(path))) {
    return [{ file: path }];
  }
  if (!lower.endsWith(".zip")) return [];

  const names = await zipList(path);
  const historyEntries = names.filter((n) => /voting_history[^/]*\.txt$/i.test(n));
  return historyEntries.map((entry) => ({ zip: path, entry }));
}

async function loadKnownVoterIds(): Promise<Set<string>> {
  const rows = await prisma.voter.findMany({ select: { stateVoterId: true } });
  return new Set(rows.map((r) => r.stateVoterId));
}

async function main() {
  const argv = process.argv.slice(2);
  const statewide = argv.includes("--all");
  const paths = argv.filter((a) => a !== "--all");
  if (!paths.length) {
    throw new Error("Pass a voting-history zip, txt, or folder of SOS extracts.");
  }

  const knownIds = statewide ? null : await loadKnownVoterIds();
  if (knownIds) {
    console.log(`Matching history to ${knownIds.size.toLocaleString()} imported voters.`);
  } else {
    console.log("Storing statewide history (including voters not yet in Voter).");
  }

  const sources = (await Promise.all(paths.map(collectSources))).flat();
  if (!sources.length) {
    throw new Error("No *Voting_History.txt files found in the given paths.");
  }
  console.log(`Found ${sources.length} history file(s).`);

  let totalInserted = 0;
  for (const source of sources) {
    const label = "file" in source ? source.file : `${basename(source.zip)}:${source.entry}`;
    process.stdout.write(`  ${label} … `);
    const stats =
      "file" in source
        ? await ingestHistoryLines(streamFile(source.file), basename(source.file), knownIds)
        : await ingestHistoryZipEntry(source.zip, source.entry, knownIds);
    totalInserted += stats.inserted;
    console.log(
      `scanned ${stats.scanned.toLocaleString()}, matched ${stats.kept.toLocaleString()}, inserted ${stats.inserted.toLocaleString()}`,
    );
  }

  const total = await prisma.voterHistory.count();
  const withVoter = await prisma.voterHistory.count({ where: { voterId: { not: null } } });
  console.log(
    `Done. Inserted ${totalInserted.toLocaleString()} new rows. VoterHistory now has ${total.toLocaleString()} rows (${withVoter.toLocaleString()} linked to Voter).`,
  );
  console.log("Rebuilding primary/general participation rates…");
  await rebuildVoterPropensity(prisma);
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
