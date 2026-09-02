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

async function expandHouseholds(
  campaignId: string,
  seedVoterIds: string[],
) {
  const seedHouseholds = await prisma.householdVoter.findMany({
    where: { voterId: { in: seedVoterIds } },
    select: { householdId: true, voterId: true },
  });
  const householdIds = Array.from(new Set(seedHouseholds.map((row) => row.householdId)));
  const seedSet = new Set(seedVoterIds);

  if (!householdIds.length) {
    return {
      households: [] as Awaited<ReturnType<typeof prisma.household.findMany>>,
      votersByHousehold: new Map<string, Array<{ voterId: string; matchedSeed: boolean }>>(),
      missingHouseholds: seedVoterIds.length,
    };
  }

  const households = await prisma.household.findMany({
    where: { id: { in: householdIds } },
  });

  const members = await prisma.householdVoter.findMany({
    where: {
      householdId: { in: householdIds },
      voter: { campaignLinks: { some: { campaignId } } },
    },
    select: { householdId: true, voterId: true },
  });

  const votersByHousehold = new Map<
    string,
    Array<{ voterId: string; matchedSeed: boolean }>
  >();
  for (const member of members) {
    const list = votersByHousehold.get(member.householdId) ?? [];
    list.push({
      voterId: member.voterId,
      matchedSeed: seedSet.has(member.voterId),
    });
    votersByHousehold.set(member.householdId, list);
  }

  const linkedSeedCount = new Set(seedHouseholds.map((row) => row.voterId)).size;
  return {
    households,
    votersByHousehold,
    missingHouseholds: seedVoterIds.length - linkedSeedCount,
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
  neighborhood: string;
  mode: ListSourceMode;
  filters?: VoterFilters | null;
  savedFilterId?: string | null;
  boundary?: [number, number][] | null;
  confirmMapbox?: boolean;
  allowTemporaryMapbox?: boolean;
}): Promise<GeneratedListResult> {
  const filters = await resolveSeedFilters(
    options.campaignId,
    options.mode,
    options.filters,
    options.savedFilterId,
  );
  const seeds = await loadSeedVoters(options.campaignId, filters);
  const expansion = await expandHouseholds(
    options.campaignId,
    seeds.map((s) => s.id),
  );

  let candidates = expansion.households;
  let excludedUnresolved = 0;

  if (options.boundary?.length) {
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

  const needingMapbox = candidates.filter(
    (h) => h.mapboxLat == null || h.mapboxLng == null,
  );
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

  const included = candidates.filter((h) => {
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
        neighborhood: options.neighborhood,
        source: "manual",
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

    if (included.length) {
      await tx.listHousehold.createMany({
        data: included.map((h, index) => ({
          listId: created.id,
          householdId: h.id,
          sortOrder: index,
        })),
      });
    }
    if (voterRows.length) {
      await tx.listVoter.createMany({
        data: voterRows.map((row) => ({
          listId: created.id,
          voterId: row.voterId,
          matchedSeed: row.matchedSeed,
        })),
      });
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
