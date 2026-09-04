import {
  clipPolygonToDistrict,
  downsamplePolyline,
  pointInPolygon,
  polygonCentroid,
} from "@/lib/geo";

export const MAX_PRECINCTS = 400;
const MAX_RING_POINTS = 400;

export interface PrecinctOverlay {
  id: string;
  name: string;
  boundary: [number, number][];
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
  selectable: boolean;
  /** Set when the precinct came from an official dataset, so turfs can be cut by code. */
  countyCode?: string;
  code?: string;
}

export interface PrecinctFeature {
  type: string;
  properties: Record<string, string | number | null>;
  geometry: { type: string; coordinates: unknown };
}

function ringToLatLng(ring: number[][]): [number, number][] {
  return ring.map(([lng, lat]) => [lat, lng] as [number, number]);
}

function latLngToLngLat(ring: [number, number][]): number[][] {
  const coords = ring.map(([lat, lng]) => [lng, lat]);
  const first = coords[0];
  const last = coords[coords.length - 1];
  if (first && last && (first[0] !== last[0] || first[1] !== last[1])) {
    coords.push([...first]);
  }
  return coords;
}

function simplifyLngLatRing(ring: number[][]): number[][] {
  if (!Array.isArray(ring) || ring.length < 3) return ring;
  return latLngToLngLat(downsamplePolyline(ringToLatLng(ring), MAX_RING_POINTS));
}

function outerRingsFromGeometry(geometry: {
  type: string;
  coordinates: unknown;
}): number[][][] {
  if (geometry.type === "Polygon") {
    const rings = geometry.coordinates as number[][][];
    return rings[0] ? [rings[0]] : [];
  }
  if (geometry.type === "MultiPolygon") {
    return (geometry.coordinates as number[][][][])
      .map((polygon) => polygon[0])
      .filter((ring): ring is number[][] => Array.isArray(ring) && ring.length >= 3);
  }
  return [];
}

export type PrecinctGeometry =
  | { type: "Polygon"; coordinates: number[][][] }
  | { type: "MultiPolygon"; coordinates: number[][][][] };

function simplifyGeometry(geometry: {
  type: string;
  coordinates: unknown;
}): PrecinctGeometry | null {
  if (geometry.type === "Polygon") {
    const rings = (geometry.coordinates as number[][][])
      .map((ring) => simplifyLngLatRing(ring))
      .filter((ring) => ring.length >= 4);
    if (!rings.length) return null;
    return { type: "Polygon", coordinates: rings };
  }
  if (geometry.type === "MultiPolygon") {
    const polygons = (geometry.coordinates as number[][][][])
      .map((polygon) =>
        polygon
          .map((ring) => simplifyLngLatRing(ring))
          .filter((ring) => ring.length >= 4),
      )
      .filter((polygon) => polygon.length > 0);
    if (!polygons.length) return null;
    return polygons.length === 1
      ? { type: "Polygon", coordinates: polygons[0] }
      : { type: "MultiPolygon", coordinates: polygons };
  }
  return null;
}

export interface SimplifiedPrecinct {
  boundary: [number, number][];
  geometry: PrecinctGeometry;
  centroid: [number, number] | null;
  bbox: { minLat: number; maxLat: number; minLng: number; maxLng: number };
}

/** Prepare a raw shapefile geometry for storage: simplified, with a bbox for lookups. */
export function simplifyGeoJsonGeometry(geometry: {
  type: string;
  coordinates: unknown;
}): SimplifiedPrecinct | null {
  const simplified = simplifyGeometry(geometry);
  if (!simplified) return null;

  const outers = outerRingsFromGeometry(simplified)
    .map((ring) => ringToLatLng(ring))
    .filter((ring) => ring.length >= 3)
    .sort((a, b) => b.length - a.length);
  const largest = outers[0];
  if (!largest) return null;

  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const ring of outers) {
    for (const [lat, lng] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  if (!Number.isFinite(minLat) || !Number.isFinite(minLng)) return null;

  return {
    boundary: largest,
    geometry: simplified,
    centroid: polygonCentroid(largest),
    bbox: { minLat, maxLat, minLng, maxLng },
  };
}

export interface StoredPrecinct {
  countyCode: string;
  code: string;
  name: string;
  boundary: [number, number][];
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: unknown };
}

/**
 * Turn stored precincts into map overlays, dropping any that miss the district
 * and clipping those that straddle its edge.
 */
export function precinctsFromStored(
  precincts: StoredPrecinct[],
  district: [number, number][],
): PrecinctOverlay[] {
  const overlays: PrecinctOverlay[] = [];
  for (const precinct of precincts) {
    const outers = outerRingsFromGeometry(precinct.geometry)
      .map((ring) => downsamplePolyline(ringToLatLng(ring), MAX_RING_POINTS))
      .filter((ring) => ring.length >= 3)
      .sort((a, b) => b.length - a.length);
    const largest = outers[0] ?? precinct.boundary;
    if (!largest?.length) continue;

    const touchesDistrict =
      outers.some((ring) => ring.some((point) => pointInPolygon(point, district))) ||
      outers.some((ring) => {
        const center = polygonCentroid(ring);
        return center ? pointInPolygon(center, district) : false;
      });
    if (!touchesDistrict) continue;

    const fullyInside = largest.every((point) => pointInPolygon(point, district));
    const boundary = fullyInside ? largest : clipPolygonToDistrict(largest, district);

    overlays.push({
      id: `${precinct.countyCode}-${precinct.code}`,
      name: precinct.name,
      boundary: boundary ?? largest,
      geometry: precinct.geometry,
      selectable: Boolean(boundary),
      countyCode: precinct.countyCode,
      code: precinct.code,
    });
  }

  overlays.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return overlays.slice(0, MAX_PRECINCTS);
}

export function precinctsFromFeatures(
  features: PrecinctFeature[],
  district: [number, number][],
): PrecinctOverlay[] {
  const overlays: PrecinctOverlay[] = [];
  for (const feature of features) {
    const geometry = simplifyGeometry(feature.geometry);
    if (!geometry) continue;
    const outers = outerRingsFromGeometry(geometry)
      .map((ring) => downsamplePolyline(ringToLatLng(ring), MAX_RING_POINTS))
      .filter((ring) => ring.length >= 3)
      .sort((a, b) => b.length - a.length);
    const largest = outers[0];
    if (!largest) continue;

    const touchesDistrict =
      outers.some((ring) =>
        ring.some((point) => pointInPolygon(point, district)),
      ) ||
      outers.some((ring) => {
        const center = polygonCentroid(ring);
        return center ? pointInPolygon(center, district) : false;
      });
    if (!touchesDistrict) continue;

    const fullyInside = largest.every((point) => pointInPolygon(point, district));
    const boundary = fullyInside
      ? largest
      : clipPolygonToDistrict(largest, district);
    const id =
      String(feature.properties.GEOID ?? "") ||
      String(feature.properties.VTD ?? "") ||
      String(feature.properties.NAME ?? overlays.length);
    const name =
      String(feature.properties.BASENAME ?? "").trim() ||
      String(feature.properties.NAME ?? "")
        .replace(/ Voting District$/i, "")
        .trim() ||
      `Precinct ${id}`;

    overlays.push({
      id,
      name,
      boundary: boundary ?? largest,
      geometry,
      selectable: Boolean(boundary),
    });
  }

  overlays.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  return overlays.slice(0, MAX_PRECINCTS);
}
