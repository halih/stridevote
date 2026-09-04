/**
 * Mapbox coordinate refinement for households already on a list.
 *
 * Precinct turfs choose households by voter-file precinct code rather than by
 * testing coordinates against a polygon, so generation never refines them (see
 * generateHouseholdList). Census coordinates are often interpolated along a
 * street rather than placed on the rooftop, which this backfills.
 *
 * Only permanent results are stored, per Mapbox terms.
 *
 * Usage:
 *   npm run households:refine-mapbox -- --list "SHL 32-1106"
 *   npm run households:refine-mapbox -- --list <listId> --dry-run
 *   npm run households:refine-mapbox -- --all-lists --limit 500
 */
import { PrismaClient } from "../src/generated/prisma";
import {
  canPersistMapboxCoords,
  geocodeMapboxForward,
  mapboxToken,
} from "../src/lib/geocode-mapbox";

const prisma = new PrismaClient();

// Mapbox's default rate limit is well above this, but a small gap keeps a long
// backfill from looking like a burst.
const REQUEST_GAP_MS = 60;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function arg(args: string[], name: string): string | null {
  const index = args.indexOf(name);
  return index >= 0 ? (args[index + 1] ?? null) : null;
}

async function resolveListIds(
  listArg: string | null,
  allLists: boolean,
): Promise<string[]> {
  if (allLists) {
    const lists = await prisma.list.findMany({ select: { id: true } });
    return lists.map((list) => list.id);
  }
  if (!listArg) {
    throw new Error("Pass --list <id|name> or --all-lists.");
  }
  const byId = await prisma.list.findUnique({
    where: { id: listArg },
    select: { id: true },
  });
  if (byId) return [byId.id];

  const byName = await prisma.list.findMany({
    where: { name: { contains: listArg, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  if (!byName.length) throw new Error(`No list matches "${listArg}".`);
  if (byName.length > 1) {
    throw new Error(
      `"${listArg}" matches ${byName.length} lists: ${byName
        .map((l) => l.name)
        .join(", ")}. Pass a list id instead.`,
    );
  }
  return [byName[0].id];
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const allLists = args.includes("--all-lists");
  const limitArg = arg(args, "--limit");
  const limit = limitArg ? Number(limitArg) : Infinity;

  if (!mapboxToken()) {
    throw new Error("MAPBOX_ACCESS_TOKEN is not set.");
  }

  const listIds = await resolveListIds(arg(args, "--list"), allLists);
  const households = await prisma.household.findMany({
    where: {
      lists: { some: { listId: { in: listIds } } },
      mapboxLat: null,
    },
    select: {
      id: true,
      displayAddress: true,
      addressLine: true,
      city: true,
      state: true,
      postalCode: true,
    },
  });

  const targets = Number.isFinite(limit)
    ? households.slice(0, limit)
    : households;
  console.log(
    `${targets.length} household(s) need refinement across ${listIds.length} list(s).` +
      (dryRun ? " Dry run: no requests will be made." : ""),
  );
  if (dryRun || !targets.length) return;

  let refined = 0;
  let stored = 0;
  let missed = 0;
  const failures: string[] = [];

  for (const household of targets) {
    try {
      const result = await geocodeMapboxForward({
        addressLine: household.addressLine,
        city: household.city,
        state: household.state,
        postalCode: household.postalCode,
      });
      if (!result) {
        missed += 1;
      } else {
        refined += 1;
        if (canPersistMapboxCoords(result.permanent)) {
          await prisma.household.update({
            where: { id: household.id },
            data: { mapboxLat: result.lat, mapboxLng: result.lng },
          });
          stored += 1;
        }
      }
    } catch (err) {
      failures.push(
        `${household.displayAddress}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if ((refined + missed + failures.length) % 25 === 0) {
      console.log(`  …${refined + missed + failures.length}/${targets.length}`);
    }
    await sleep(REQUEST_GAP_MS);
  }

  console.log(
    `Done. refined=${refined} stored=${stored} noMatch=${missed} failed=${failures.length}`,
  );
  for (const failure of failures.slice(0, 10)) console.log(`  ${failure}`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
