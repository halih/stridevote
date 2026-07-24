// Distance helpers for campaign discovery (radius filter around the user's home).

const EARTH_RADIUS_MI = 3958.8;

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
