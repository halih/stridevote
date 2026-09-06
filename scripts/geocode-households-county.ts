/**
 * Fill / upgrade Household pins from King and Snohomish County address points.
 * Writes unified lat/lng with geocodeSource=county when rank allows
 * (empty or census only — never replaces mapbox).
 *
 * Usage:
 *   npm run households:geocode-county
 *   npm run households:geocode-county -- --dry-run
 *   npm run households:geocode-county -- --limit 500
 *   npm run households:geocode-county -- --county KI
 */
import { PrismaClient } from "../src/generated/prisma";
import {
  geocodeCountyBatch,
  isCountyCode,
  type CountyCode,
  type CountyHouseholdInput,
} from "../src/lib/county-geocode";
import {
  canReplaceGeocode,
  geocodeWriteData,
} from "../src/lib/household-coords";

const prisma = new PrismaClient();
const BATCH_SIZE = 200;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
  const countyIdx = args.indexOf("--county");
  const countyFilter =
    countyIdx >= 0 ? args[countyIdx + 1]?.toUpperCase() : undefined;
  if (countyFilter && !isCountyCode(countyFilter)) {
    throw new Error(`--county must be KI or SN (got ${countyFilter})`);
  }

  let processed = 0;
  let matched = 0;
  let unmatched = 0;
  let ambiguous = 0;
  let skipped = 0;
  let cursorId = "";

  while (processed < limit) {
    const take = Math.min(BATCH_SIZE, limit - processed);
    const households = await prisma.household.findMany({
      where: {
        id: { gt: cursorId },
        OR: [{ lat: null }, { geocodeSource: "census" }],
      },
      orderBy: { id: "asc" },
      take,
      select: {
        id: true,
        addressLine: true,
        city: true,
        state: true,
        postalCode: true,
        unit: true,
        lat: true,
        geocodeSource: true,
        voters: {
          select: { voter: { select: { countyCode: true } } },
          take: 5,
        },
      },
    });
    if (!households.length) break;

    const inputs: CountyHouseholdInput[] = [];
    const metaById = new Map<
      string,
      { geocodeSource: string | null; countyCode: CountyCode }
    >();

    for (const h of households) {
      const codes = [
        ...new Set(
          h.voters
            .map((v) => v.voter.countyCode)
            .filter((c): c is string => Boolean(c)),
        ),
      ];
      const countyCode = codes.find(isCountyCode);
      if (!countyCode) {
        skipped += 1;
        continue;
      }
      if (countyFilter && countyCode !== countyFilter) {
        skipped += 1;
        continue;
      }
      if (!canReplaceGeocode(h.geocodeSource, "county")) {
        skipped += 1;
        continue;
      }
      inputs.push({
        id: h.id,
        addressLine: h.addressLine,
        city: h.city,
        state: h.state,
        postalCode: h.postalCode,
        unit: h.unit,
        countyCode,
      });
      metaById.set(h.id, { geocodeSource: h.geocodeSource, countyCode });
    }

    if (inputs.length) {
      const results = await geocodeCountyBatch(inputs);
      for (const result of results) {
        if (result.status === "matched") matched += 1;
        else if (result.status === "ambiguous") ambiguous += 1;
        else unmatched += 1;

        if (
          dryRun ||
          result.status !== "matched" ||
          result.lat == null ||
          result.lng == null
        ) {
          continue;
        }
        const meta = metaById.get(result.id);
        if (!meta || !canReplaceGeocode(meta.geocodeSource, "county")) continue;

        await prisma.household.update({
          where: { id: result.id },
          data: geocodeWriteData({
            lat: result.lat,
            lng: result.lng,
            source: "county",
            ref: result.ref,
          }),
        });
      }
      await sleep(200);
    }

    cursorId = households[households.length - 1].id;
    processed += households.length;
    console.log(
      `${dryRun ? "[dry-run] " : ""}Scanned ${processed.toLocaleString()} (matched=${matched}, unmatched=${unmatched}, ambiguous=${ambiguous}, skipped=${skipped})`,
    );
  }

  const nullLat = await prisma.household.count({ where: { lat: null } });
  const sources = await prisma.household.groupBy({
    by: ["geocodeSource"],
    _count: true,
  });
  console.log(`Remaining null lat: ${nullLat.toLocaleString()}`);
  console.log(
    "Sources:",
    sources
      .map((row) => `${row.geocodeSource ?? "null"}=${row._count}`)
      .join(", "),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
