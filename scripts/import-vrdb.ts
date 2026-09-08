/**
 * Import a Washington SOS VRDB zip into Voter (+ optional CampaignVoter links).
 *
 * Usage:
 *   npm run voters:import -- "/path/to/09.2026.WA.zip" --campaign people-for-imraan
 *   npm run voters:import -- "/path/to/extract.zip" --district 32
 *   npm run voters:import -- "/path/to/extract.zip" --all
 *
 * Imports Active voters only unless --status all. Scope is never implicit: pass
 * --campaign to use its legislative district and link the voters to it,
 * --district for a district without linking, or --all for the statewide file
 * (millions of rows).
 */
import { createInterface } from "node:readline";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { Prisma, PrismaClient } from "../src/generated/prisma";
import { legislativeDistrictKey } from "../src/lib/districts";
import { rebuildVoterPropensity } from "./lib/rebuild-voter-propensity";

const prisma = new PrismaClient();

const BATCH = 1500;

type Flags = {
  zipPath: string;
  campaignSlug: string | null;
  district: string | null;
  statewide: boolean;
  status: "Active" | "all";
};

function parseFlags(argv: string[]): Flags {
  const positional: string[] = [];
  const flags: Flags = {
    zipPath: "",
    campaignSlug: null,
    district: null,
    statewide: false,
    status: "Active",
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--all") flags.statewide = true;
    else if (arg === "--campaign") flags.campaignSlug = argv[++i] ?? null;
    else if (arg === "--no-campaign") flags.campaignSlug = null;
    else if (arg === "--district") flags.district = argv[++i] ?? null;
    else if (arg === "--status") {
      const value = argv[++i] ?? "Active";
      flags.status = value.toLowerCase() === "all" ? "all" : "Active";
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown flag: ${arg}`);
    } else positional.push(arg);
  }
  flags.zipPath = positional[0] ?? "";
  if (!flags.zipPath) {
    throw new Error("Pass the path to the WA SOS VRDB zip file.");
  }
  return flags;
}

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

function splitRow(line: string): string[] {
  return line.replace(/\r$/, "").split("|");
}

function blankToNull(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function joinParts(...parts: Array<string | null | undefined>): string {
  return parts.map((p) => p?.trim()).filter(Boolean).join(" ");
}

function registrationAddress(get: (name: string) => string): string {
  const number = joinParts(get("RegStNum"), get("RegStFrac"));
  const street = joinParts(
    number,
    get("RegStPreDirection"),
    get("RegStName"),
    get("RegStType"),
    get("RegStPostDirection"),
  );
  const unit = joinParts(get("RegUnitType"), get("RegStUnitNum"));
  return joinParts(street, unit) || "(no street address)";
}

function parseYear(value: string | undefined): number | null {
  const year = Number(value?.trim());
  return Number.isInteger(year) && year >= 1900 && year <= 2026 ? year : null;
}

function parseDate(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? `${trimmed}T00:00:00.000Z` : null;
}

type VoterRow = {
  id: string;
  stateVoterId: string;
  firstName: string;
  middleName: string | null;
  lastName: string;
  suffix: string | null;
  yearOfBirth: number | null;
  gender: string | null;
  registrationAddress: string;
  city: string;
  state: string;
  postalCode: string;
  countyCode: string | null;
  precinctCode: string | null;
  precinctPart: string | null;
  legislativeDistrict: string | null;
  congressionalDistrict: string | null;
  registrationDate: string | null;
  lastVoted: string | null;
};

async function upsertVoters(rows: VoterRow[]): Promise<void> {
  if (!rows.length) return;
  await prisma.$executeRaw`
    INSERT INTO "Voter" (
      id, "stateVoterId", "firstName", "middleName", "lastName", suffix,
      "yearOfBirth", gender, "registrationAddress", city, state, "postalCode",
      "countyCode", "precinctCode", "precinctPart", "legislativeDistrict",
      "congressionalDistrict", "registrationDate", "lastVoted", "electionsVoted",
      "createdAt", "updatedAt"
    )
    SELECT
      x.id, x."stateVoterId", x."firstName", x."middleName", x."lastName", x.suffix,
      x."yearOfBirth", x.gender, x."registrationAddress", x.city, x.state, x."postalCode",
      x."countyCode", x."precinctCode", x."precinctPart", x."legislativeDistrict",
      x."congressionalDistrict", x."registrationDate"::timestamptz, x."lastVoted"::date,
      ARRAY[]::text[], CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
      id text,
      "stateVoterId" text,
      "firstName" text,
      "middleName" text,
      "lastName" text,
      suffix text,
      "yearOfBirth" int,
      gender text,
      "registrationAddress" text,
      city text,
      state text,
      "postalCode" text,
      "countyCode" text,
      "precinctCode" text,
      "precinctPart" text,
      "legislativeDistrict" text,
      "congressionalDistrict" text,
      "registrationDate" text,
      "lastVoted" text
    )
    ON CONFLICT ("stateVoterId") DO UPDATE SET
      "firstName" = EXCLUDED."firstName",
      "middleName" = EXCLUDED."middleName",
      "lastName" = EXCLUDED."lastName",
      suffix = EXCLUDED.suffix,
      "yearOfBirth" = EXCLUDED."yearOfBirth",
      gender = EXCLUDED.gender,
      "registrationAddress" = EXCLUDED."registrationAddress",
      city = EXCLUDED.city,
      state = EXCLUDED.state,
      "postalCode" = EXCLUDED."postalCode",
      "countyCode" = EXCLUDED."countyCode",
      "precinctCode" = EXCLUDED."precinctCode",
      "precinctPart" = EXCLUDED."precinctPart",
      "legislativeDistrict" = EXCLUDED."legislativeDistrict",
      "congressionalDistrict" = EXCLUDED."congressionalDistrict",
      "registrationDate" = EXCLUDED."registrationDate",
      "lastVoted" = EXCLUDED."lastVoted",
      "residenceStatus" = CASE
        WHEN "Voter"."registrationAddress" IS DISTINCT FROM EXCLUDED."registrationAddress"
          OR "Voter".city IS DISTINCT FROM EXCLUDED.city
          OR "Voter".state IS DISTINCT FROM EXCLUDED.state
          OR "Voter"."postalCode" IS DISTINCT FROM EXCLUDED."postalCode"
        THEN 'ok'
        ELSE "Voter"."residenceStatus"
      END,
      "updatedAt" = CURRENT_TIMESTAMP
  `;
}

async function linkCampaign(campaignId: string, stateVoterIds: string[]): Promise<number> {
  if (!stateVoterIds.length) return 0;
  const inserted = await prisma.$executeRaw`
    INSERT INTO "CampaignVoter" (id, "campaignId", "voterId", "createdAt")
    SELECT gen_random_uuid()::text, ${campaignId}, v.id, CURRENT_TIMESTAMP
    FROM "Voter" v
    WHERE v."stateVoterId" IN (${Prisma.join(stateVoterIds)})
    ON CONFLICT ("campaignId", "voterId") DO NOTHING
  `;
  return Number(inserted);
}

async function importExtract(
  zipPath: string,
  extractName: string,
  district: string | null,
  status: "Active" | "all",
): Promise<Set<string>> {
  const rl = streamZipFile(zipPath, extractName);
  let header: string[] | null = null;
  const idx: Record<string, number> = {};
  const imported = new Set<string>();
  let batch: VoterRow[] = [];
  let scanned = 0;
  let kept = 0;

  for await (const line of rl) {
    if (!header) {
      header = splitRow(line);
      header.forEach((name, i) => {
        idx[name] = i;
      });
      continue;
    }
    scanned++;
    const cols = splitRow(line);
    const get = (name: string) => cols[idx[name]] ?? "";
    if (status !== "all" && get("StatusCode").trim() !== status) continue;
    if (district && legislativeDistrictKey(get("LegislativeDistrict")) !== district) continue;

    const stateVoterId = get("StateVoterID").trim();
    if (!stateVoterId) continue;

    batch.push({
      id: randomUUID(),
      stateVoterId,
      firstName: get("FName").trim() || "UNKNOWN",
      middleName: blankToNull(get("MName")),
      lastName: get("LName").trim() || "UNKNOWN",
      suffix: blankToNull(get("NameSuffix")),
      yearOfBirth: parseYear(get("Birthyear")),
      gender: blankToNull(get("Gender")),
      registrationAddress: registrationAddress(get),
      city: get("RegCity").trim() || "UNKNOWN",
      state: get("RegState").trim() || "WA",
      postalCode: get("RegZipCode").trim() || "00000",
      countyCode: blankToNull(get("CountyCode")),
      precinctCode: blankToNull(get("PrecinctCode")),
      precinctPart: blankToNull(get("PrecinctPart")),
      legislativeDistrict: blankToNull(get("LegislativeDistrict")),
      congressionalDistrict: blankToNull(get("CongressionalDistrict")),
      registrationDate: parseDate(get("Registrationdate")),
      lastVoted: parseDate(get("LastVoted")),
    });
    imported.add(stateVoterId);
    kept++;

    if (batch.length >= BATCH) {
      await upsertVoters(batch);
      batch = [];
      if (kept % 15000 === 0) {
        console.log(`  upserted ${kept.toLocaleString()} voters (scanned ${scanned.toLocaleString()})`);
      }
    }
  }
  if (batch.length) await upsertVoters(batch);
  console.log(
    `VRDB extract: scanned ${scanned.toLocaleString()}, imported ${kept.toLocaleString()}`,
  );
  return imported;
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  const names = await zipList(flags.zipPath);
  const extractName = names.find((n) => /VRDB_Extract\.txt$/i.test(n));
  const historyName = names.find((n) => /Voting_History[^/]*\.txt$/i.test(n));
  if (!extractName) throw new Error("Zip does not contain a *_VRDB_Extract.txt file.");

  let district = flags.district;
  let campaignId: string | null = null;
  if (flags.campaignSlug) {
    const campaign = await prisma.campaign.findUnique({
      where: { slug: flags.campaignSlug },
      select: { id: true, slug: true, name: true, regionName: true, regionType: true },
    });
    if (!campaign) throw new Error(`Campaign not found: ${flags.campaignSlug}`);
    campaignId = campaign.id;
    if (!flags.statewide && !district && campaign.regionType === "legislative") {
      district = legislativeDistrictKey(campaign.regionName);
      if (!district) {
        throw new Error(
          `Campaign ${campaign.slug} has no legislative district set. Pass --district or --all.`,
        );
      }
    }
    console.log(`Linking to ${campaign.name} (${campaign.slug})`);
  }

  if (flags.statewide) district = null;
  else if (!district) {
    throw new Error(
      "Refusing to import statewide by accident. Pass --campaign <slug>, --district <n>, or --all.",
    );
  }
  console.log(
    `Importing ${flags.status === "all" ? "all statuses" : "Active"} voters` +
      (district ? ` in legislative district ${district}` : " statewide"),
  );

  const imported = await importExtract(flags.zipPath, extractName, district, flags.status);

  const lastVotedHistory = await prisma.$executeRaw`
    INSERT INTO "VoterHistory" (
      id, "stateVoterId", "voterId", "electionDate", "electionType", source
    )
    SELECT
      gen_random_uuid()::text,
      v."stateVoterId",
      v.id,
      v."lastVoted",
      CASE
        WHEN v."lastVoted" IN (
          DATE '1996-04-23', DATE '2008-02-19', DATE '2016-05-24',
          DATE '2020-03-10', DATE '2024-03-12'
        ) THEN 'presidential_primary'
        WHEN EXTRACT(MONTH FROM v."lastVoted") = 11 THEN 'general'
        WHEN (
          (v."lastVoted" >= DATE '2007-01-01' AND EXTRACT(MONTH FROM v."lastVoted") = 8)
          OR
          (v."lastVoted" < DATE '2007-01-01' AND EXTRACT(MONTH FROM v."lastVoted") = 9)
        ) THEN 'primary'
        ELSE 'special'
      END,
      'VRDB LastVoted'
    FROM "Voter" v
    WHERE v."lastVoted" IS NOT NULL
    ON CONFLICT ("stateVoterId", "electionDate") DO NOTHING
  `;
  console.log(
    `Filled ${Number(lastVotedHistory).toLocaleString()} VoterHistory rows from VRDB LastVoted.`,
  );

  if (historyName) {
    console.log(
      `History file ${historyName} is stored with: npm run voters:import-history -- "${flags.zipPath}"`,
    );
  }

  if (campaignId) {
    const ids = Array.from(imported);
    let linked = 0;
    for (let i = 0; i < ids.length; i += BATCH) {
      linked += await linkCampaign(campaignId, ids.slice(i, i + BATCH));
    }
    console.log(`Linked ${linked.toLocaleString()} voters to the campaign.`);
  }

  const total = await prisma.voter.count();
  console.log(`Voter table now has ${total.toLocaleString()} records.`);
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
