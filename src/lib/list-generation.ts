import { prisma } from "@/lib/db";
import { ensureActiveProgram } from "@/lib/canvass/programs";
import { pointInPolygon, polygonCentroid } from "@/lib/geo";
import { orderForStreetWalk } from "@/lib/canvass/walk-order";
import { buildVoterWhere, sanitizeVoterFilters, type VoterFilters } from "@/lib/voter-filters";
import { resolveCanvassAudience } from "@/lib/voter-data";

export type ListSourceMode = "all" | "filters" | "saved";

export interface GeneratedListResult {
  listId: string;
  slug: string;
  doorsCount: number;
  voterCount: number;
  excludedUnresolved: number;
}

// Postgres allows 32,767 bind variables per statement; large id lists must be
// split so campaign-wide queries and inserts stay under it.
const QUERY_CHUNK = 10000;

function chunked<T>(items: T[], size = QUERY_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function bboxOfPolygon(polygon: [number, number][], bufferDeg = 0.002) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of polygon) {
    minLat = Math.min(minLat, lat);
    maxLat = Math.max(maxLat, lat);
    minLng = Math.min(minLng, lng);
    maxLng = Math.max(maxLng, lng);
  }
  return {
    minLat: minLat - bufferDeg,
    maxLat: maxLat + bufferDeg,
    minLng: minLng - bufferDeg,
    maxLng: maxLng + bufferDeg,
  };
}

export async function resolveSeedFilters(
  campaignId: string,
  mode: ListSourceMode,
  filters?: VoterFilters | null,
  savedFilterId?: string | null,
): Promise<VoterFilters> {
  if (mode === "all") return {};
  if (mode === "saved") {
    if (!savedFilterId) throw new Error("Choose a saved filter.");
    const saved = await prisma.savedVoterFilter.findFirst({
      where: { id: savedFilterId, campaignId },
    });
    if (!saved) throw new Error("Saved filter not found.");
    return sanitizeVoterFilters(saved.filters);
  }
  return sanitizeVoterFilters(filters ?? {});
}

async function loadSeedVoters(campaignId: string, filters: VoterFilters) {
  const canvass = await resolveCanvassAudience(campaignId, filters);
  const { where } = buildVoterWhere(campaignId, filters, new Date(), canvass);
  return prisma.voter.findMany({
    where,
    select: {
      id: true,
      householdLinks: { select: { householdId: true } },
    },
  });
}

type HouseholdExpansion = {
  households: Awaited<ReturnType<typeof prisma.household.findMany>>;
  votersByHousehold: Map<string, Array<{ voterId: string; matchedSeed: boolean }>>;
  missingHouseholds: number;
};

/** `"all"` marks every campaign member as a seed, matching an unfiltered source. */
type SeedMatch = Set<string> | "all";

async function expandHouseholdsFromIds(
  campaignId: string,
  householdIds: string[],
  seedMatch: SeedMatch,
  missingHouseholds = 0,
): Promise<HouseholdExpansion> {
  if (!householdIds.length) {
    return {
      households: [],
      votersByHousehold: new Map(),
      missingHouseholds,
    };
  }

  const households: HouseholdExpansion["households"] = [];
  const members: Array<{ householdId: string; voterId: string }> = [];
  for (const ids of chunked(householdIds)) {
    households.push(
      ...(await prisma.household.findMany({ where: { id: { in: ids } } })),
    );
    members.push(
      ...(await prisma.householdVoter.findMany({
        where: {
          householdId: { in: ids },
          voter: { campaignLinks: { some: { campaignId } } },
        },
        select: { householdId: true, voterId: true },
      })),
    );
  }

  const votersByHousehold = new Map<
    string,
    Array<{ voterId: string; matchedSeed: boolean }>
  >();
  for (const member of members) {
    const list = votersByHousehold.get(member.householdId) ?? [];
    list.push({
      voterId: member.voterId,
      matchedSeed: seedMatch === "all" || seedMatch.has(member.voterId),
    });
    votersByHousehold.set(member.householdId, list);
  }

  return { households, votersByHousehold, missingHouseholds };
}

async function expandHouseholds(
  campaignId: string,
  seedVoterIds: string[],
): Promise<HouseholdExpansion> {
  const seedHouseholds: Array<{ householdId: string; voterId: string }> = [];
  for (const ids of chunked(seedVoterIds)) {
    seedHouseholds.push(
      ...(await prisma.householdVoter.findMany({
        where: { voterId: { in: ids } },
        select: { householdId: true, voterId: true },
      })),
    );
  }
  const householdIds = Array.from(new Set(seedHouseholds.map((row) => row.householdId)));
  const linkedSeedCount = new Set(seedHouseholds.map((row) => row.voterId)).size;
  return expandHouseholdsFromIds(
    campaignId,
    householdIds,
    new Set(seedVoterIds),
    seedVoterIds.length - linkedSeedCount,
  );
}

export interface TurfBoundaryPreview {
  doors: number;
  voters: number;
  /** Campaign doors with no coordinates yet, so they can't be placed in any turf. */
  ungeocodedDoors: number;
}

interface BboxHousehold {
  id: string;
  lat: number;
  lng: number;
  voters: number;
}

/**
 * Households inside a lat/lng box that belong to the campaign, with the number
 * of campaign voters at each. Aggregating in Postgres keeps a turf estimate
 * proportional to the polygon rather than to the whole campaign.
 */
async function campaignHouseholdsInBbox(
  campaignId: string,
  bbox: ReturnType<typeof bboxOfPolygon>,
): Promise<BboxHousehold[]> {
  return prisma.$queryRaw<BboxHousehold[]>`
    SELECT h."id",
           h."lat" AS lat,
           h."lng" AS lng,
           COUNT(cv."voterId")::int AS voters
    FROM "Household" h
    JOIN "HouseholdVoter" hv ON hv."householdId" = h."id"
    JOIN "CampaignVoter" cv
      ON cv."voterId" = hv."voterId" AND cv."campaignId" = ${campaignId}
    WHERE h."lat" BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
      AND h."lng" BETWEEN ${bbox.minLng} AND ${bbox.maxLng}
    GROUP BY h."id"
  `;
}

async function ungeocodedCampaignDoors(campaignId: string): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ n: number }>>`
    SELECT COUNT(DISTINCT h."id")::int AS n
    FROM "Household" h
    JOIN "HouseholdVoter" hv ON hv."householdId" = h."id"
    JOIN "CampaignVoter" cv
      ON cv."voterId" = hv."voterId" AND cv."campaignId" = ${campaignId}
    WHERE h."lat" IS NULL
  `;
  return rows[0]?.n ?? 0;
}

/** A precinct as identified in the voter file. */
export interface PrecinctRef {
  countyCode: string;
  code: string;
}

/**
 * Campaign households in a precinct, taken from each voter's registered
 * precinct. This needs no coordinates, so precinct turfs are exact even where
 * geocoding failed.
 */
async function precinctHouseholdIds(
  campaignId: string,
  precinct: PrecinctRef,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ householdId: string }>>`
    SELECT DISTINCT hv."householdId"
    FROM "CampaignVoter" cv
    JOIN "Voter" v ON v."id" = cv."voterId"
    JOIN "HouseholdVoter" hv ON hv."voterId" = cv."voterId"
    WHERE cv."campaignId" = ${campaignId}
      AND v."countyCode" = ${precinct.countyCode}
      AND v."precinctCode" = ${precinct.code}
  `;
  return rows.map((row) => row.householdId);
}

/**
 * Precinct households for a turf source. Filtered sources keep a door if any
 * campaign member matches the seed; `"all"` keeps every precinct door.
 */
async function precinctHouseholdsForTurf(options: {
  campaignId: string;
  precinct: PrecinctRef;
  mode: ListSourceMode;
  filters?: VoterFilters | null;
  savedFilterId?: string | null;
}): Promise<{ householdIds: string[]; seedMatch: SeedMatch }> {
  const householdIds = await precinctHouseholdIds(options.campaignId, options.precinct);
  if (options.mode === "all") return { householdIds, seedMatch: "all" };

  const filters = await resolveSeedFilters(
    options.campaignId,
    options.mode,
    options.filters,
    options.savedFilterId,
  );
  const canvass = await resolveCanvassAudience(options.campaignId, filters);
  const { where } = buildVoterWhere(options.campaignId, filters, new Date(), canvass);
  const matched = new Set<string>();
  const seedMatch = new Set<string>();
  for (const ids of chunked(householdIds)) {
    const links = await prisma.householdVoter.findMany({
      where: { householdId: { in: ids }, voter: where },
      select: { householdId: true, voterId: true },
    });
    for (const link of links) {
      matched.add(link.householdId);
      seedMatch.add(link.voterId);
    }
  }
  return {
    householdIds: householdIds.filter((id) => matched.has(id)),
    seedMatch,
  };
}

// HouseholdVoter is unique per voter, so counting links counts distinct voters.
async function campaignVotersAtHouseholds(
  campaignId: string,
  householdIds: string[],
): Promise<number> {
  let total = 0;
  for (const ids of chunked(householdIds)) {
    total += await prisma.householdVoter.count({
      where: {
        householdId: { in: ids },
        voter: { campaignLinks: { some: { campaignId } } },
      },
    });
  }
  return total;
}

/**
 * Door and voter counts for a precinct turf, derived from registration data
 * rather than geometry, so nothing depends on geocoding.
 */
export async function previewTurfPrecinct(options: {
  campaignId: string;
  precinct: PrecinctRef;
  mode: ListSourceMode;
  filters?: VoterFilters | null;
  savedFilterId?: string | null;
}): Promise<TurfBoundaryPreview> {
  const { householdIds } = await precinctHouseholdsForTurf(options);
  return {
    doors: householdIds.length,
    voters: await campaignVotersAtHouseholds(options.campaignId, householdIds),
    ungeocodedDoors: 0,
  };
}

/** Door and voter counts for one turf polygon. */
export async function previewTurfBoundary(options: {
  campaignId: string;
  boundary: [number, number][];
  mode: ListSourceMode;
  filters?: VoterFilters | null;
  savedFilterId?: string | null;
}): Promise<TurfBoundaryPreview> {
  const [nearby, ungeocodedDoors] = await Promise.all([
    campaignHouseholdsInBbox(options.campaignId, bboxOfPolygon(options.boundary)),
    ungeocodedCampaignDoors(options.campaignId),
  ]);
  const inside = nearby.filter((row) =>
    pointInPolygon([row.lat, row.lng], options.boundary),
  );

  if (options.mode === "all") {
    return {
      doors: inside.length,
      voters: inside.reduce((sum, row) => sum + row.voters, 0),
      ungeocodedDoors,
    };
  }

  // Filtered sources keep every campaign member of a household that holds at
  // least one matching voter, so only the seed match is filtered here.
  const filters = await resolveSeedFilters(
    options.campaignId,
    options.mode,
    options.filters,
    options.savedFilterId,
  );
  const canvass = await resolveCanvassAudience(options.campaignId, filters);
  const { where } = buildVoterWhere(options.campaignId, filters, new Date(), canvass);
  const seedHouseholdIds = new Set<string>();
  for (const ids of chunked(inside.map((row) => row.id))) {
    const links = await prisma.householdVoter.findMany({
      where: { householdId: { in: ids }, voter: where },
      select: { householdId: true },
      distinct: ["householdId"],
    });
    for (const link of links) seedHouseholdIds.add(link.householdId);
  }

  const matched = inside.filter((row) => seedHouseholdIds.has(row.id));
  return {
    doors: matched.length,
    voters: matched.reduce((sum, row) => sum + row.voters, 0),
    ungeocodedDoors,
  };
}

export async function generateHouseholdList(options: {
  campaignId: string;
  name: string;
  mode: ListSourceMode;
  filters?: VoterFilters | null;
  savedFilterId?: string | null;
  boundary?: [number, number][] | null;
  /** When set, households are chosen by registered precinct instead of geometry. */
  precinct?: PrecinctRef | null;
  /** Wave (CanvassProgram) this list is published into. Defaults to the active wave. */
  programId?: string | null;
}): Promise<GeneratedListResult> {
  const filters = await resolveSeedFilters(
    options.campaignId,
    options.mode,
    options.filters,
    options.savedFilterId,
  );

  // Precinct turfs start from registered precinct households instead of the
  // whole campaign, so a few hundred doors are expanded rather than tens of thousands.
  let expansion: HouseholdExpansion;
  if (options.precinct) {
    const scoped = await precinctHouseholdsForTurf({
      campaignId: options.campaignId,
      precinct: options.precinct,
      mode: options.mode,
      filters: options.filters,
      savedFilterId: options.savedFilterId,
    });
    expansion = await expandHouseholdsFromIds(
      options.campaignId,
      scoped.householdIds,
      scoped.seedMatch,
    );
  } else {
    const seeds = await loadSeedVoters(options.campaignId, filters);
    expansion = await expandHouseholds(
      options.campaignId,
      seeds.map((s) => s.id),
    );
  }

  let candidates = expansion.households;
  let excludedUnresolved = 0;

  if (!options.precinct && options.boundary?.length) {
    const bbox = bboxOfPolygon(options.boundary);
    const near: typeof candidates = [];
    for (const h of candidates) {
      const lat = h.lat;
      const lng = h.lng;
      if (lat == null || lng == null) {
        excludedUnresolved += 1;
        continue;
      }
      if (
        lat >= bbox.minLat &&
        lat <= bbox.maxLat &&
        lng >= bbox.minLng &&
        lng <= bbox.maxLng
      ) {
        near.push(h);
      }
    }
    candidates = near;
  }

  // Drawn turfs use the single persistent Household pin. Walk packets may
  // overlay temporary Mapbox at download; we never geocode here.
  const includedRaw = options.precinct ? candidates : candidates.filter((h) => {
    const lat = h.lat;
    const lng = h.lng;
    if (lat == null || lng == null) {
      if (options.boundary?.length) excludedUnresolved += 1;
      return !options.boundary?.length;
    }
    if (!options.boundary?.length) return true;
    return pointInPolygon([lat, lng], options.boundary);
  });

  // Persist a walkable door order: one street at a time, house numbers in
  // sequence, streets chained by proximity.
  const included = orderForStreetWalk(includedRaw, {
    pointOf: (h) => {
      if (h.lat == null || h.lng == null) return null;
      return { lat: h.lat, lng: h.lng };
    },
    addressOf: (h) => ({
      addressLine: h.addressLine,
      city: h.city,
      unit: h.unit,
    }),
  });

  const slugBase = options.name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "list";
  let slug = slugBase;
  let n = 1;
  while (await prisma.list.findUnique({ where: { slug } })) {
    slug = `${slugBase}-${++n}`;
  }

  const voterRows: Array<{ voterId: string; matchedSeed: boolean }> = [];
  const seenVoters = new Set<string>();
  for (const household of included) {
    for (const member of expansion.votersByHousehold.get(household.id) ?? []) {
      if (seenVoters.has(member.voterId)) continue;
      seenVoters.add(member.voterId);
      voterRows.push(member);
    }
  }

  const geocodedPoints: Array<{ lat: number; lng: number }> = [];
  for (const household of included) {
    if (household.lat == null || household.lng == null) continue;
    geocodedPoints.push({ lat: household.lat, lng: household.lng });
  }

  let centroidLat: number | null = null;
  let centroidLng: number | null = null;
  if (geocodedPoints.length) {
    centroidLat =
      geocodedPoints.reduce((sum, point) => sum + point.lat, 0) /
      geocodedPoints.length;
    centroidLng =
      geocodedPoints.reduce((sum, point) => sum + point.lng, 0) /
      geocodedPoints.length;
  } else if (options.boundary?.length) {
    const centroid = polygonCentroid(options.boundary);
    if (centroid) {
      centroidLat = centroid[0];
      centroidLng = centroid[1];
    }
  }

  const program = options.programId
    ? await prisma.canvassProgram.findFirst({
        where: { id: options.programId, campaignId: options.campaignId },
        select: { id: true },
      })
    : null;
  const programId =
    program?.id ?? (await ensureActiveProgram(options.campaignId)).id;

  const list = await prisma.$transaction(async (tx) => {
    const created = await tx.list.create({
      data: {
        slug,
        name: options.name,
        source: "stridevote",
        doorsCount: included.length,
        boundary: options.boundary ?? undefined,
        centroidLat,
        centroidLng,
        campaignLinks: {
          create: [
            {
              campaignId: options.campaignId,
              programId,
              visibility: "draft",
            },
          ],
        },
      },
    });

    for (const rows of chunked(
      included.map((h, index) => ({
        listId: created.id,
        householdId: h.id,
        sortOrder: index,
      })),
    )) {
      await tx.listHousehold.createMany({ data: rows });
    }
    for (const rows of chunked(
      voterRows.map((row) => ({
        listId: created.id,
        voterId: row.voterId,
        matchedSeed: row.matchedSeed,
      })),
    )) {
      await tx.listVoter.createMany({ data: rows });
    }
    return created;
  });

  return {
    listId: list.id,
    slug: list.slug,
    doorsCount: included.length,
    voterCount: voterRows.length,
    excludedUnresolved,
  };
}
