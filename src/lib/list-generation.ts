import { prisma } from "@/lib/db";
import { pointInPolygon } from "@/lib/geo";
import {
  canPersistMapboxCoords,
  geocodeMapboxForward,
  mapboxToken,
} from "@/lib/geocode-mapbox";
import { buildVoterWhere, sanitizeVoterFilters, type VoterFilters } from "@/lib/voter-filters";

export type ListSourceMode = "all" | "filters" | "saved";

export interface ListGenerationPreview {
  seedVoters: number;
  households: number;
  expandedVoters: number;
  missingHouseholds: number;
  censusUnmatched: number;
  mapboxNeeded: number;
  mapboxReusable: number;
  unresolvedForTurf: number;
}

export interface GeneratedListResult {
  listId: string;
  slug: string;
  doorsCount: number;
  voterCount: number;
  excludedUnresolved: number;
  mapboxCalls: number;
  mapboxStored: number;
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
  const { where } = buildVoterWhere(campaignId, filters);
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
           COALESCE(h."censusLat", h."mapboxLat") AS lat,
           COALESCE(h."censusLng", h."mapboxLng") AS lng,
           COUNT(cv."voterId")::int AS voters
    FROM "Household" h
    JOIN "HouseholdVoter" hv ON hv."householdId" = h."id"
    JOIN "CampaignVoter" cv
      ON cv."voterId" = hv."voterId" AND cv."campaignId" = ${campaignId}
    WHERE COALESCE(h."censusLat", h."mapboxLat") BETWEEN ${bbox.minLat} AND ${bbox.maxLat}
      AND COALESCE(h."censusLng", h."mapboxLng") BETWEEN ${bbox.minLng} AND ${bbox.maxLng}
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
    WHERE h."censusLat" IS NULL AND h."mapboxLat" IS NULL
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
  const { where } = buildVoterWhere(options.campaignId, filters);
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
  const { where } = buildVoterWhere(options.campaignId, filters);
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

export async function previewListGeneration(options: {
  campaignId: string;
  mode: ListSourceMode;
  filters?: VoterFilters | null;
  savedFilterId?: string | null;
  boundary?: [number, number][] | null;
}): Promise<ListGenerationPreview> {
  const filters = await resolveSeedFilters(
    options.campaignId,
    options.mode,
    options.filters,
    options.savedFilterId,
  );
  const seeds = await loadSeedVoters(options.campaignId, filters);
  let expansion = await expandHouseholds(
    options.campaignId,
    seeds.map((s) => s.id),
  );

  let unresolvedForTurf = 0;
  if (options.boundary?.length) {
    const bbox = bboxOfPolygon(options.boundary);
    const near = expansion.households.filter((h) => {
      const lat = h.mapboxLat ?? h.censusLat;
      const lng = h.mapboxLng ?? h.censusLng;
      if (lat == null || lng == null) {
        unresolvedForTurf += 1;
        return false;
      }
      return (
        lat >= bbox.minLat &&
        lat <= bbox.maxLat &&
        lng >= bbox.minLng &&
        lng <= bbox.maxLng
      );
    });
    const inside = near.filter((h) => {
      const lat = h.mapboxLat ?? h.censusLat;
      const lng = h.mapboxLng ?? h.censusLng;
      if (lat == null || lng == null) return false;
      return pointInPolygon([lat, lng], options.boundary!);
    });
    const insideIds = new Set(inside.map((h) => h.id));
    expansion = {
      ...expansion,
      households: inside,
      votersByHousehold: new Map(
        [...expansion.votersByHousehold.entries()].filter(([id]) =>
          insideIds.has(id),
        ),
      ),
    };
  }

  const mapboxReusable = expansion.households.filter(
    (h) => h.mapboxLat != null && h.mapboxLng != null,
  ).length;
  const mapboxNeeded = expansion.households.length - mapboxReusable;
  const censusUnmatched = expansion.households.filter(
    (h) => h.geocodeStatus !== "matched" || h.censusLat == null,
  ).length;
  const expandedVoters = [...expansion.votersByHousehold.values()].reduce(
    (sum, rows) => sum + rows.length,
    0,
  );

  return {
    seedVoters: seeds.length,
    households: expansion.households.length,
    expandedVoters,
    missingHouseholds: expansion.missingHouseholds,
    censusUnmatched,
    mapboxNeeded,
    mapboxReusable,
    unresolvedForTurf,
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
  confirmMapbox?: boolean;
  allowTemporaryMapbox?: boolean;
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
      const lat = h.censusLat ?? h.mapboxLat;
      const lng = h.censusLng ?? h.mapboxLng;
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

  // Precinct turfs decide membership from the voter file, so no household needs
  // coordinates to be included and there is nothing to refine.
  const needingMapbox = options.precinct
    ? []
    : candidates.filter((h) => h.mapboxLat == null || h.mapboxLng == null);
  if (needingMapbox.length && !options.confirmMapbox && mapboxToken()) {
    throw new Error(
      `This run would call Mapbox for ${needingMapbox.length} household(s). Confirm to continue.`,
    );
  }

  let mapboxCalls = 0;
  let mapboxStored = 0;
  const permanent = !options.allowTemporaryMapbox;
  const refined = new Map<string, { lat: number; lng: number }>();

  for (const household of needingMapbox) {
    if (!mapboxToken()) break;
    mapboxCalls += 1;
    const result = await geocodeMapboxForward(
      {
        addressLine: household.addressLine,
        city: household.city,
        state: household.state,
        postalCode: household.postalCode,
      },
      { permanent },
    );
    if (!result) continue;
    refined.set(household.id, { lat: result.lat, lng: result.lng });
    if (canPersistMapboxCoords(result.permanent)) {
      await prisma.household.update({
        where: { id: household.id },
        data: { mapboxLat: result.lat, mapboxLng: result.lng },
      });
      mapboxStored += 1;
    }
  }

  const included = options.precinct ? candidates : candidates.filter((h) => {
    const refinedPoint = refined.get(h.id);
    const lat = refinedPoint?.lat ?? h.mapboxLat ?? h.censusLat;
    const lng = refinedPoint?.lng ?? h.mapboxLng ?? h.censusLng;
    if (lat == null || lng == null) {
      if (options.boundary?.length) excludedUnresolved += 1;
      return !options.boundary?.length;
    }
    if (!options.boundary?.length) return true;
    return pointInPolygon([lat, lng], options.boundary);
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

  const centroidLat =
    included.reduce((sum, h) => sum + (h.mapboxLat ?? h.censusLat ?? 0), 0) /
      (included.length || 1) || null;
  const centroidLng =
    included.reduce((sum, h) => sum + (h.mapboxLng ?? h.censusLng ?? 0), 0) /
      (included.length || 1) || null;

  const list = await prisma.$transaction(async (tx) => {
    const created = await tx.list.create({
      data: {
        slug,
        name: options.name,
        source: "stridevote",
        doorsCount: included.length,
        boundary: options.boundary ?? undefined,
        centroidLat: included.length ? centroidLat : null,
        centroidLng: included.length ? centroidLng : null,
        data: {
          generated: true,
          mode: options.mode,
          savedFilterId: options.savedFilterId ?? null,
          filters,
          mapboxCalls,
          mapboxStored,
          excludedUnresolved,
        },
        campaignLinks: {
          create: [{ campaignId: options.campaignId, visibility: "draft" }],
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
    mapboxCalls,
    mapboxStored,
  };
}
