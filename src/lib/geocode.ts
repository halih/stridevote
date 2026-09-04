import "server-only";
import { env } from "@/lib/env";
import waSldu from "@/data/wa-sldu.json";
import waCd from "@/data/wa-cd.json";
import { downsamplePolyline } from "@/lib/geo";
import {
  CENSUS_USER_AGENT,
  TIGER_LEGISLATIVE,
  stateFips,
  stateName,
} from "@/lib/us-census";

// Geocoding: Nominatim for address/city/county/state. Legislative and
// congressional districts use high-precision Census TIGER geometry. Bundled
// Washington geometry is retained as an offline fallback.

const MAX_BOUNDARY_POINTS = 2000;
const TIGER_MAX_OFFSET_DEGREES = "0.00003"; // roughly 2–3 meters in Washington

interface LocalFeatureCollection {
  type: string;
  features: Array<{
    type: string;
    properties: Record<string, string | number | null>;
    geometry: { type: string; coordinates: unknown };
  }>;
}

export interface GeocodeResult {
  lat: number;
  lng: number;
  label: string;
}

export interface RegionType {
  type: "state" | "county" | "city" | "legislative" | "congressional";
}

export interface RegionResult {
  centroidLat: number;
  centroidLng: number;
  boundary: [number, number][] | null;
  label: string;
  hasBoundary: boolean;
}

/** Pull a district number from "32", "LD32", "LD 32", "District 32", etc. */
function districtNumber(raw: string): string | null {
  const m = raw.trim().match(/(\d{1,3})/);
  if (!m) return null;
  // Census SLDU / CD119 codes are zero-padded to 2–3 chars (e.g. "032", "07").
  return m[1].padStart(2, "0");
}

function districtCodesMatch(stored: string | number | null | undefined, want: string): boolean {
  if (stored == null) return false;
  const a = String(stored).replace(/^0+/, "") || "0";
  const b = want.replace(/^0+/, "") || "0";
  return a === b;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name: string;
  type?: string;
  class?: string;
  addresstype?: string;
  geojson?: { type: string; coordinates: unknown };
  address?: { state?: string; city?: string; town?: string; county?: string };
}

async function nominatim(
  path: string,
  params: Record<string, string>,
): Promise<NominatimResult[]> {
  const url = new URL(`${env.geocoderUrl}${path}`);
  url.searchParams.set("format", "jsonv2");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  const res = await fetch(url, {
    headers: { "User-Agent": CENSUS_USER_AGENT, "Accept-Language": "en" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Geocoder responded ${res.status}`);
  const data = (await res.json()) as NominatimResult | NominatimResult[];
  return Array.isArray(data) ? data : [data];
}

/** Free-text geocode of an address, "city, state", or ZIP. Biased to the US. */
export async function geocodeAddress(
  query: string,
  opts: { kind?: "address" | "city" | "zip" } = {},
): Promise<GeocodeResult | null> {
  const q = query.trim();
  if (!q) return null;

  // Structured postal-code search — bare "98133" matches Lithuania in Nominatim.
  if (opts.kind === "zip" || /^\d{5}(-\d{4})?$/.test(q)) {
    const postal = q.slice(0, 5);
    const hits = await nominatim("/search", {
      postalcode: postal,
      country: "USA",
      limit: "3",
      addressdetails: "1",
    });
    const hit = hits[0];
    if (hit) {
      return { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name };
    }
    // Fallback: "98133, USA"
    const [fallback] = await nominatim("/search", {
      q: `${postal}, USA`,
      countrycodes: "us",
      limit: "1",
      addressdetails: "1",
    });
    if (!fallback) return null;
    return { lat: Number(fallback.lat), lng: Number(fallback.lon), label: fallback.display_name };
  }

  const searchQ =
    opts.kind === "city" && !/,/.test(q) ? `${q}, USA` : /usa|united states|\bus\b/i.test(q) ? q : `${q}, USA`;

  const [hit] = await nominatim("/search", {
    q: searchQ,
    countrycodes: "us",
    limit: "1",
    addressdetails: "1",
  });
  if (!hit) return null;
  return { lat: Number(hit.lat), lng: Number(hit.lon), label: hit.display_name };
}

/** Reverse-geocode a coordinate pair to a human-readable label. */
export async function reverseGeocode(lat: number, lng: number): Promise<string | null> {
  const [hit] = await nominatim("/reverse", {
    lat: String(lat),
    lon: String(lng),
    zoom: "12",
  });
  return hit?.display_name ?? null;
}

function buildRegionQuery(type: RegionType["type"], name: string, state: string): string {
  const st = stateName(state);
  const n = name.trim();
  switch (type) {
    case "state":
      return `${st} state, United States`;
    case "county": {
      const county = /county$/i.test(n) ? n : `${n} County`;
      return `${county}, ${st}, United States`;
    }
    case "city":
      return `${n}, ${st}, United States`;
    default:
      return `${n}, ${st}, United States`;
  }
}

function hitToRegion(hit: NominatimResult): RegionResult {
  const boundary = hit.geojson ? geojsonToBoundary(hit.geojson) : null;
  return {
    centroidLat: Number(hit.lat),
    centroidLng: Number(hit.lon),
    boundary,
    label: hit.display_name,
    hasBoundary: Boolean(boundary && boundary.length >= 3),
  };
}

async function geocodePlace(
  type: "state" | "county" | "city",
  name: string,
  state: string,
): Promise<RegionResult | null> {
  const st = stateName(state);

  // Structured search for states — free-text "Washington, USA" matches DC.
  if (type === "state") {
    const hits = await nominatim("/search", {
      state: st,
      country: "USA",
      limit: "5",
      addressdetails: "1",
      polygon_geojson: "1",
    });
    const hit =
      hits.find(
        (h) =>
          (h.addresstype === "state" || h.type === "administrative") &&
          !/columbia|d\.?c\.?/i.test(h.display_name),
      ) ??
      hits.find((h) => h.addresstype === "state") ??
      hits[0];
    return hit ? hitToRegion(hit) : null;
  }

  const q = buildRegionQuery(type, name, state);
  const hits = await nominatim("/search", {
    q,
    countrycodes: "us",
    limit: "5",
    addressdetails: "1",
    polygon_geojson: "1",
  });
  const hit =
    hits.find((h) => {
      const addrState = h.address?.state ?? "";
      return addrState.toLowerCase() === st.toLowerCase();
    }) ?? hits[0];
  return hit ? hitToRegion(hit) : null;
}

// GeoJSON rings are [lng, lat]; the app boundary format is [lat, lng].
function ringToBoundary(ring: number[][]): [number, number][] {
  return ring.map(([lng, lat]) => [lat, lng] as [number, number]);
}

function geojsonToBoundary(geojson: { type: string; coordinates: unknown }): [number, number][] | null {
  let rings: number[][][] = [];
  if (geojson.type === "Polygon") {
    rings = geojson.coordinates as number[][][];
  } else if (geojson.type === "MultiPolygon") {
    rings = (geojson.coordinates as number[][][][]).map((poly) => poly[0]);
  } else {
    return null;
  }
  const outer = rings
    .filter((r) => Array.isArray(r) && r.length >= 3)
    .sort((a, b) => b.length - a.length)[0];
  if (!outer) return null;
  return downsamplePolyline(ringToBoundary(outer), MAX_BOUNDARY_POINTS);
}

function centroidOf(boundary: [number, number][]): { lat: number; lng: number } {
  const n = boundary.length || 1;
  const sum = boundary.reduce(
    (a, p) => [a[0] + p[0], a[1] + p[1]] as [number, number],
    [0, 0] as [number, number],
  );
  return { lat: sum[0] / n, lng: sum[1] / n };
}

interface TigerFeature {
  type: string;
  properties: Record<string, string | number | null>;
  geometry: { type: string; coordinates: unknown };
}

function regionFromFeature(
  feature: {
    properties: Record<string, string | number | null>;
    geometry: { type: string; coordinates: unknown };
  },
  fallbackLabel: string,
): RegionResult | null {
  const boundary = geojsonToBoundary(feature.geometry);
  const lat = Number(feature.properties.INTPTLAT);
  const lng = Number(feature.properties.INTPTLON);
  const center =
    Number.isFinite(lat) && Number.isFinite(lng)
      ? { lat, lng }
      : boundary
        ? centroidOf(boundary)
        : null;
  if (!center) return null;

  return {
    centroidLat: center.lat,
    centroidLng: center.lng,
    boundary,
    label: String(feature.properties.NAME ?? "") || fallbackLabel,
    hasBoundary: Boolean(boundary && boundary.length >= 3),
  };
}

function lookupLocalDistrict(
  collection: LocalFeatureCollection,
  field: string,
  num: string,
  fallbackLabel: string,
): RegionResult | null {
  const feature = collection.features.find((f) =>
    districtCodesMatch(f.properties[field], num),
  );
  return feature ? regionFromFeature(feature, fallbackLabel) : null;
}

async function tigerQuery(layer: number, where: string, outFields: string): Promise<TigerFeature | null> {
  const url = new URL(`${TIGER_LEGISLATIVE}/${layer}/query`);
  url.searchParams.set("where", where);
  url.searchParams.set("outFields", outFields);
  url.searchParams.set("returnGeometry", "true");
  url.searchParams.set("outSR", "4326");
  url.searchParams.set("maxAllowableOffset", TIGER_MAX_OFFSET_DEGREES);
  url.searchParams.set("geometryPrecision", "6");
  url.searchParams.set("f", "geojson");

  const res = await fetch(url, {
    headers: { "User-Agent": CENSUS_USER_AGENT },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Census TIGER responded ${res.status}`);
  const data = (await res.json()) as { features?: TigerFeature[]; error?: { message: string } };
  if (data.error) throw new Error(data.error.message);
  return data.features?.[0] ?? null;
}

/**
 * Resolve a state legislative district. WA uses bundled Census data; other
 * states hit live TIGER (upper chamber layer — same numbering as WA LDs).
 */
async function geocodeLegislative(name: string, state: string): Promise<RegionResult | null> {
  const num = districtNumber(name);
  if (!num) return null;
  const st = state.trim().toUpperCase();
  const label = `${stateName(state)} Legislative District ${Number(num)}`;
  const sldu = num.padStart(3, "0");

  const fips = stateFips(state);
  if (!fips) return null;
  try {
    const feature = await tigerQuery(
      1,
      `STATE='${fips}' AND SLDU='${sldu}'`,
      "NAME,STATE,SLDU,BASENAME,INTPTLAT,INTPTLON",
    );
    if (feature) return regionFromFeature(feature, label);
  } catch {
    // The live service occasionally times out; WA has an offline fallback.
  }
  return st === "WA" || st === "WASHINGTON"
    ? lookupLocalDistrict(waSldu as LocalFeatureCollection, "SLDU", sldu, label)
    : null;
}

/** Resolve a US House district. WA uses bundled data; others use live TIGER. */
async function geocodeCongressional(name: string, state: string): Promise<RegionResult | null> {
  const num = districtNumber(name);
  if (!num) return null;
  const st = state.trim().toUpperCase();
  const label = `${stateName(state)} Congressional District ${Number(num)}`;
  const cd = num.padStart(2, "0");

  const fips = stateFips(state);
  if (!fips) return null;
  try {
    const feature = await tigerQuery(
      0,
      `STATE='${fips}' AND CD119='${cd}'`,
      "NAME,STATE,CD119,BASENAME,INTPTLAT,INTPTLON",
    );
    if (feature) return regionFromFeature(feature, label);
  } catch {
    // The live service occasionally times out; WA has an offline fallback.
  }
  return st === "WA" || st === "WASHINGTON"
    ? lookupLocalDistrict(waCd as LocalFeatureCollection, "CD119", cd, label)
    : null;
}

/**
 * Resolve a geographic region to a boundary polygon + centroid.
 * City / county / state use Nominatim; legislative / congressional use Census TIGER.
 */
export async function geocodeRegion(
  type: RegionType["type"],
  name: string,
  state = "WA",
): Promise<RegionResult | null> {
  if (type === "legislative") return geocodeLegislative(name, state);
  if (type === "congressional") return geocodeCongressional(name, state);
  return geocodePlace(type, name, state);
}
