import "server-only";
import { prisma } from "@/lib/db";
import {
  MAX_PRECINCTS,
  precinctsFromFeatures,
  precinctsFromStored,
  type PrecinctFeature,
  type PrecinctOverlay,
  type StoredPrecinct,
} from "@/lib/precinct-geometry";
import {
  CENSUS_USER_AGENT,
  TIGER_LEGISLATIVE,
  stateAbbrev,
  stateFips,
} from "@/lib/us-census";

export type { PrecinctOverlay };

const TIGER_VTD = `${TIGER_LEGISLATIVE}/15/query`;
const PAGE_SIZE = 200;

function envelope(points: [number, number][]) {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const [lat, lng] of points) {
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
  }
  return { minLat, maxLat, minLng, maxLng };
}

async function tigerVtdPage(
  where: string,
  bbox: ReturnType<typeof envelope>,
  offset: number,
): Promise<{ features: PrecinctFeature[]; exceeded: boolean }> {
  const url = new URL(TIGER_VTD);
  url.searchParams.set("where", where);
  url.searchParams.set(
    "geometry",
    JSON.stringify({
      xmin: bbox.minLng,
      ymin: bbox.minLat,
      xmax: bbox.maxLng,
      ymax: bbox.maxLat,
      spatialReference: { wkid: 4326 },
    }),
  );
  url.searchParams.set("geometryType", "esriGeometryEnvelope");
  url.searchParams.set("inSR", "4326");
  url.searchParams.set("spatialRel", "esriSpatialRelIntersects");
  url.searchParams.set("outFields", "NAME,BASENAME,VTD,COUNTY,GEOID,STATE");
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("maxAllowableOffset", "0.00012");
  url.searchParams.set("geometryPrecision", "5");
  url.searchParams.set("resultOffset", String(offset));
  url.searchParams.set("resultRecordCount", String(PAGE_SIZE));
  url.searchParams.set("f", "geojson");

  const res = await fetch(url, {
    headers: { "User-Agent": CENSUS_USER_AGENT },
    cache: "no-store",
    signal: AbortSignal.timeout(25000),
  });
  if (!res.ok) throw new Error(`Census TIGER responded ${res.status}`);
  const data = (await res.json()) as {
    features?: PrecinctFeature[];
    exceededTransferLimit?: boolean;
    error?: { message: string };
  };
  if (data.error) throw new Error(data.error.message);
  return {
    features: data.features ?? [],
    exceeded: Boolean(data.exceededTransferLimit),
  };
}

/**
 * Official precinct polygons that intersect a campaign district.
 *
 * Prefers imported state precincts (see `npm run precincts:import`), whose codes
 * match the voter file so turfs can be cut and counted without geocoding. Falls
 * back to Census voting districts for states with no imported dataset.
 */
export async function loadPrecinctsForDistrict(
  district: [number, number][],
  regionState?: string | null,
  campaignId?: string,
): Promise<PrecinctOverlay[]> {
  if (district.length < 3) return [];
  const bounds = envelope(district);
  const abbrev = stateAbbrev(regionState);

  // Precincts the campaign actually has voters in. Anything else would offer a
  // turf with no doors, since membership comes from each voter's precinct.
  const stored = campaignId
    ? await storedPrecinctsWithCampaignVoters(campaignId, abbrev, bounds)
    : [];
  if (stored.length) return precinctsFromStored(stored, district);

  const anyStored = await prisma.precinct.findMany({
    where: {
      ...(abbrev ? { state: abbrev } : {}),
      minLat: { lte: bounds.maxLat },
      maxLat: { gte: bounds.minLat },
      minLng: { lte: bounds.maxLng },
      maxLng: { gte: bounds.minLng },
    },
    select: { countyCode: true, code: true, name: true, boundary: true, geometry: true },
    take: MAX_PRECINCTS * 6,
  });
  if (anyStored.length) {
    return precinctsFromStored(anyStored as unknown as StoredPrecinct[], district);
  }

  return loadCensusPrecincts(district, regionState);
}

async function storedPrecinctsWithCampaignVoters(
  campaignId: string,
  state: string | null,
  bounds: ReturnType<typeof envelope>,
): Promise<StoredPrecinct[]> {
  return prisma.$queryRaw<StoredPrecinct[]>`
    SELECT p."countyCode", p."code", p."name", p."boundary", p."geometry"
    FROM "Precinct" p
    WHERE (${state}::text IS NULL OR p."state" = ${state})
      AND p."minLat" <= ${bounds.maxLat}
      AND p."maxLat" >= ${bounds.minLat}
      AND p."minLng" <= ${bounds.maxLng}
      AND p."maxLng" >= ${bounds.minLng}
      AND EXISTS (
        SELECT 1
        FROM "CampaignVoter" cv
        JOIN "Voter" v ON v."id" = cv."voterId"
        WHERE cv."campaignId" = ${campaignId}
          AND v."countyCode" = p."countyCode"
          AND v."precinctCode" = p."code"
      )
    LIMIT ${MAX_PRECINCTS * 6}
  `;
}

async function loadCensusPrecincts(
  district: [number, number][],
  regionState?: string | null,
): Promise<PrecinctOverlay[]> {
  const fips = stateFips(regionState);
  const where = fips ? `STATE='${fips}'` : "1=1";
  const bbox = envelope(district);
  const collected: PrecinctFeature[] = [];
  let offset = 0;
  for (let page = 0; page < 4; page++) {
    const { features, exceeded } = await tigerVtdPage(where, bbox, offset);
    collected.push(...features);
    if (!exceeded || features.length < PAGE_SIZE || collected.length >= MAX_PRECINCTS * 2) {
      break;
    }
    offset += features.length;
  }
  return precinctsFromFeatures(collected, district);
}
