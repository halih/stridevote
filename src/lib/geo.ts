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
