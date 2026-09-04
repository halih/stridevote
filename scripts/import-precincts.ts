/**
 * Import official precinct boundaries from a state shapefile.
 *
 * Washington's Secretary of State publishes a statewide precinct shapefile
 * whose CountyCode + PrecCode match the VRDB extract, so precinct turfs can be
 * cut and counted straight from registration data.
 *
 * The shapefile holds PrecCode as a number while the voter file zero-pads it to
 * a fixed width per county (King uses 4 digits, Snohomish 8). Codes are padded
 * to the width each county's voters already use, so import voters first.
 *
 * Usage:
 *   npm run precincts:import                     # downloads the default WA dataset
 *   npm run precincts:import -- --zip ./wa.zip   # use an already downloaded archive
 *   npm run precincts:import -- --shp ./wa.shp
 *   npm run precincts:import -- --county KI,SN   # restrict to some counties
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { open } from "shapefile";
import { PrismaClient } from "../src/generated/prisma";
import { simplifyGeoJsonGeometry } from "../src/lib/precinct-geometry";

const prisma = new PrismaClient();

const DEFAULT_URL =
  "https://www.sos.wa.gov/sites/default/files/2025-11/Statewide_Precincts_2025General.zip";
const DEFAULT_SOURCE = "wa-sos-2025general";

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function download(url: string, into: string): Promise<string> {
  console.log(`Downloading ${url}…`);
  const res = await fetch(url, { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`Download failed: HTTP ${res.status}`);
  const zipPath = path.join(into, "precincts.zip");
  writeFileSync(zipPath, Buffer.from(await res.arrayBuffer()));
  return zipPath;
}

function unzipToShp(zipPath: string, into: string): string {
  execFileSync("unzip", ["-o", "-q", zipPath, "-d", into]);
  const shp = readdirSync(into).find((f) => f.toLowerCase().endsWith(".shp"));
  if (!shp) throw new Error("No .shp file found in the archive");
  return path.join(into, shp);
}

async function resolveShapefile(): Promise<string> {
  const shp = arg("shp");
  if (shp) return shp;
  const workDir = mkdtempSync(path.join(tmpdir(), "precincts-"));
  const zip = arg("zip") ?? (await download(arg("url") ?? DEFAULT_URL, workDir));
  return unzipToShp(zip, workDir);
}

/** The precinct code width each county's voter records use, so codes join exactly. */
async function voterCodeWidths(): Promise<Map<string, number>> {
  const rows = await prisma.$queryRaw<
    Array<{ countyCode: string; len: number; n: number }>
  >`
    SELECT "countyCode", LENGTH("precinctCode") AS len, COUNT(*)::int AS n
    FROM "Voter"
    WHERE "precinctCode" IS NOT NULL AND "countyCode" IS NOT NULL
    GROUP BY "countyCode", LENGTH("precinctCode")
  `;
  const best = new Map<string, { len: number; n: number }>();
  for (const row of rows) {
    const county = row.countyCode.toUpperCase();
    const current = best.get(county);
    if (!current || row.n > current.n) best.set(county, { len: row.len, n: row.n });
  }
  return new Map([...best].map(([county, { len }]) => [county, len]));
}

async function main() {
  const source = arg("source") ?? DEFAULT_SOURCE;
  const state = (arg("state") ?? "WA").toUpperCase();
  const counties = arg("county")
    ?.split(",")
    .map((c) => c.trim().toUpperCase())
    .filter(Boolean);

  const widths = await voterCodeWidths();
  console.log(
    widths.size
      ? `Padding codes to voter-file widths: ${[...widths]
          .map(([county, len]) => `${county}=${len}`)
          .join(", ")}`
      : "No voter records found; storing precinct codes unpadded.",
  );

  const shpPath = await resolveShapefile();
  const dbfPath = shpPath.replace(/\.shp$/i, ".dbf");
  console.log(`Reading ${shpPath}`);

  // The dataset is authoritative for the whole state, so replace what's there;
  // otherwise a code change would leave the old polygon behind.
  const removed = await prisma.precinct.deleteMany({
    where: { state, ...(counties ? { countyCode: { in: counties } } : {}) },
  });
  if (removed.count) console.log(`Cleared ${removed.count.toLocaleString()} existing precincts`);

  const src = await open(shpPath, dbfPath);
  let read = 0;
  let written = 0;
  let skipped = 0;
  const unpaddedCounties = new Set<string>();

  for (;;) {
    const record = await src.read();
    if (record.done) break;
    read += 1;

    const feature = record.value as {
      properties: Record<string, unknown>;
      geometry: { type: string; coordinates: unknown } | null;
    };
    const props = feature.properties;
    const countyCode = String(props.CountyCode ?? "").trim().toUpperCase();
    const rawCode = String(props.PrecCode ?? "").trim();
    if (!countyCode || !rawCode || !feature.geometry) {
      skipped += 1;
      continue;
    }
    const width = widths.get(countyCode);
    if (!width) unpaddedCounties.add(countyCode);
    const code = width ? rawCode.padStart(width, "0") : rawCode;
    if (counties && !counties.includes(countyCode)) continue;

    const simplified = simplifyGeoJsonGeometry(feature.geometry);
    if (!simplified) {
      skipped += 1;
      continue;
    }

    await prisma.precinct.upsert({
      where: { state_countyCode_code: { state, countyCode, code } },
      create: {
        state,
        countyCode,
        countyName: String(props.CountyName ?? "").trim(),
        code,
        name: String(props.PrecName ?? "").trim() || `Precinct ${code}`,
        stateCode: props.St_Code ? String(props.St_Code).trim() : null,
        boundary: simplified.boundary,
        geometry: simplified.geometry,
        centroidLat: simplified.centroid?.[0] ?? null,
        centroidLng: simplified.centroid?.[1] ?? null,
        ...simplified.bbox,
        source,
      },
      update: {
        countyName: String(props.CountyName ?? "").trim(),
        name: String(props.PrecName ?? "").trim() || `Precinct ${code}`,
        stateCode: props.St_Code ? String(props.St_Code).trim() : null,
        boundary: simplified.boundary,
        geometry: simplified.geometry,
        centroidLat: simplified.centroid?.[0] ?? null,
        centroidLng: simplified.centroid?.[1] ?? null,
        ...simplified.bbox,
        source,
      },
    });
    written += 1;
    if (written % 500 === 0) {
      console.log(`  … ${written.toLocaleString()} precincts`);
    }
  }

  const total = await prisma.precinct.count({ where: { state } });
  console.log(
    `Done. Read ${read.toLocaleString()}, wrote ${written.toLocaleString()}, skipped ${skipped}. ${state} precincts stored: ${total.toLocaleString()}.`,
  );
  if (unpaddedCounties.size) {
    console.log(
      `Stored unpadded (no voters loaded for these counties): ${[...unpaddedCounties]
        .sort()
        .join(", ")}`,
    );
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
