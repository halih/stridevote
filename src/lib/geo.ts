// Distance helpers for campaign discovery (radius filter around the user's home).

const EARTH_RADIUS_MI = 3958.8;

/** Fallback when GPS and profile location are unavailable. */
export const DEFAULT_ORIGIN = {
  lat: 47.6062,
  lng: -122.3321,
  label: "Seattle, WA",
} as const;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in miles between two [lat, lng] points. */
export function haversineMiles(
  aLat: number,
  aLng: number,
  bLat: number,
  bLng: number,
): number {
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Round to one decimal for display (e.g. "2.1 mi"). */
export function roundMiles(mi: number): number {
  return Math.round(mi * 10) / 10;
}

/** Shortest great-circle distance from origin to any point. */
export function nearestMiles(
  origin: { lat: number; lng: number },
  points: Array<{ lat: number; lng: number }>,
): number | null {
  if (!points.length) return null;
  let best = Infinity;
  for (const point of points) {
    const miles = haversineMiles(origin.lat, origin.lng, point.lat, point.lng);
    if (miles < best) best = miles;
  }
  return best === Infinity ? null : best;
}

/**
 * Distance used for list cards: prefer nearest geocoded door, then polygon
 * centroid, then stored list centroid. Avoids inflated distances when a stored
 * centroid was polluted by missing coordinates treated as (0, 0).
 */
export function listDistanceMiles(
  origin: { lat: number; lng: number },
  list: {
    doorPins?: Array<{ lat: number; lng: number }> | null;
    boundary?: [number, number][] | null;
    centroidLat?: number | null;
    centroidLng?: number | null;
  },
): number | null {
  const fromDoors = nearestMiles(origin, list.doorPins ?? []);
  if (fromDoors != null) return fromDoors;

  if (list.boundary?.length) {
    const centroid = polygonCentroid(list.boundary);
    if (centroid) {
      return haversineMiles(origin.lat, origin.lng, centroid[0], centroid[1]);
    }
  }

  if (list.centroidLat != null && list.centroidLng != null) {
    // Centroids near (0,0) are almost always a missing-coord averaging bug.
    if (Math.abs(list.centroidLat) < 1 && Math.abs(list.centroidLng) < 1) {
      return null;
    }
    return haversineMiles(
      origin.lat,
      origin.lng,
      list.centroidLat,
      list.centroidLng,
    );
  }

  return null;
}

/** Ray-casting point-in-polygon. Point and polygon vertices are [lat, lng]. */
export function pointInPolygon(
  point: [number, number],
  polygon: [number, number][],
): boolean {
  let inside = false;
  const y = point[0];
  const x = point[1];
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const yi = polygon[i][0];
    const xi = polygon[i][1];
    const yj = polygon[j][0];
    const xj = polygon[j][1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Area-weighted centroid for a [lat, lng] polygon, with an average fallback. */
export function polygonCentroid(
  polygon: [number, number][],
): [number, number] | null {
  if (polygon.length < 3) return null;

  let twiceArea = 0;
  let xSum = 0;
  let ySum = 0;
  for (let i = 0; i < polygon.length; i++) {
    const [y1, x1] = polygon[i];
    const [y2, x2] = polygon[(i + 1) % polygon.length];
    const cross = x1 * y2 - x2 * y1;
    twiceArea += cross;
    xSum += (x1 + x2) * cross;
    ySum += (y1 + y2) * cross;
  }

  if (Math.abs(twiceArea) < 1e-12) {
    const [lat, lng] = polygon.reduce(
      ([latSum, lngSum], [lat, lng]) => [latSum + lat, lngSum + lng],
      [0, 0],
    );
    return [lat / polygon.length, lng / polygon.length];
  }

  return [ySum / (3 * twiceArea), xSum / (3 * twiceArea)];
}

/** Keep vertices that fall inside `district`. Returns null if fewer than 3 remain. */
export function clipPolygonToDistrict(
  ring: [number, number][],
  district: [number, number][],
): [number, number][] | null {
  const clipped = ring.filter((point) => pointInPolygon(point, district));
  return clipped.length >= 3 ? clipped : null;
}
