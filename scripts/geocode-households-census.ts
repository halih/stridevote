/**
 * Resumable US Census batch geocoding for Household rows.
 *
 * Usage:
 *   npm run households:geocode-census
 *   npm run households:geocode-census -- --limit 1000
 *   npm run households:geocode-census -- --status pending,unmatched
 */
import { PrismaClient } from "../src/generated/prisma";
import {
  censusStatusFromMatch,
  geocodeCensusBatch,
  type CensusAddressInput,
} from "../src/lib/geocode-census";

const prisma = new PrismaClient();
const BATCH_SIZE = 1000;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 ? Number(args[limitIdx + 1]) : Infinity;
  const statusIdx = args.indexOf("--status");
  const statuses = (statusIdx >= 0 ? args[statusIdx + 1] : "pending")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  let processed = 0;
  let matched = 0;
  let unmatched = 0;
  let ambiguous = 0;
  // Rows that come back No_Match keep their queried status, so the scan has to
  // advance by id or it re-reads the same batch forever. Every cuid sorts after
  // the empty string, so the first pass starts from the beginning.
  let cursorId: string = "";

  while (processed < limit) {
    const take = Math.min(BATCH_SIZE, limit - processed);
    const households = await prisma.household.findMany({
      where: {
        geocodeStatus: { in: statuses },
        id: { gt: cursorId },
      },
      orderBy: { id: "asc" },
      take,
      select: {
        id: true,
        addressLine: true,
        city: true,
        state: true,
        postalCode: true,
      },
    });
    if (!households.length) break;

    const inputs: CensusAddressInput[] = households.map((h) => ({
      id: h.id,
      street: h.addressLine,
      city: h.city,
      state: h.state,
      zip: h.postalCode,
    }));

    let results;
    let attempt = 0;
    for (;;) {
      try {
        results = await geocodeCensusBatch(inputs);
        break;
      } catch (err) {
        attempt += 1;
        if (attempt >= 5) throw err;
        console.warn(`Census batch failed (attempt ${attempt}), retrying…`, err);
        await sleep(2000 * attempt);
      }
    }

    const byId = new Map(results.map((r) => [r.id, r]));
    for (const household of households) {
      const result = byId.get(household.id);
      const match = result?.match ?? "No_Match";
      const status = censusStatusFromMatch(match);
      await prisma.household.update({
        where: { id: household.id },
        data: {
          censusLat: result?.lat ?? null,
          censusLng: result?.lng ?? null,
          geocodeStatus: status,
        },
      });
      if (status === "matched") matched += 1;
      else if (status === "ambiguous") ambiguous += 1;
      else unmatched += 1;
    }

    cursorId = households[households.length - 1].id;
    processed += households.length;
    console.log(
      `Processed ${processed.toLocaleString()} (matched=${matched}, unmatched=${unmatched}, ambiguous=${ambiguous})`,
    );
    await sleep(250);
  }

  const coverage = await prisma.household.groupBy({
    by: ["geocodeStatus"],
    _count: true,
  });
  console.log(
    "Coverage:",
    coverage.map((row) => `${row.geocodeStatus}=${row._count}`).join(", "),
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
