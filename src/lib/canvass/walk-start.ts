/**
 * Where a walk opens: which door is selected first and how the map is framed.
 *
 * A packet is street-ordered, but its first door is often one that was already
 * knocked on an earlier session. Opening on that door, zoomed in, hides the
 * doors that still need work. Instead the walk starts on the first remaining
 * door of the route and the camera depends on where the volunteer is: inside
 * (or close to) the turf it frames them together with that door; elsewhere it
 * shows the whole turf so they can see where to head.
 */

import type { Point } from "@/lib/canvass/walk-order";

/** [lat, lng] south-west and north-east corners. */
export type LatLngBounds = [[number, number], [number, number]];

/** How far past the outermost doors still counts as "at the turf". */
export const TURF_MARGIN_MI = 0.1;
/** Degenerate (single-point) bounds are widened to this so fitting has area. */
const MIN_BOUNDS_DEG = 0.0004;
const MILES_PER_LAT_DEGREE = 69.0;

export interface StartDoor {
  householdId: string;
  lat: number | null;
  lng: number | null;
  current: unknown | null;
}

export interface WalkStartPlan<T extends StartDoor> {
  /** Door to select on open; null when every door is done or the list is empty. */
  door: T | null;
  /** True when the volunteer is inside or within `TURF_MARGIN_MI` of the turf. */
  nearTurf: boolean;
  /** Camera to open on; null when nothing is geocoded. */
  bounds: LatLngBounds | null;
}

function hasPin<T extends StartDoor>(door: T): door is T & { lat: number; lng: number } {
  return door.lat != null && door.lng != null;
}

/** Bounding box of every geocoded door, or null when none has a pin. */
export function doorBounds(doors: StartDoor[]): LatLngBounds | null {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const door of doors) {
    if (!hasPin(door)) continue;
    minLat = Math.min(minLat, door.lat);
    maxLat = Math.max(maxLat, door.lat);
    minLng = Math.min(minLng, door.lng);
    maxLng = Math.max(maxLng, door.lng);
  }
  if (minLat === Infinity) return null;
  return [
    [minLat, minLng],
    [maxLat, maxLng],
  ];
}

/** Grow bounds by `miles` on every side (in ground distance, not degrees). */
export function padBounds(bounds: LatLngBounds, miles: number): LatLngBounds {
  const [[minLat, minLng], [maxLat, maxLng]] = bounds;
  const midLat = (minLat + maxLat) / 2;
  const latPad = miles / MILES_PER_LAT_DEGREE;
  const lngPad =
    miles /
    (MILES_PER_LAT_DEGREE * Math.max(0.1, Math.cos((midLat * Math.PI) / 180)));
  return [
    [minLat - latPad, minLng - lngPad],
    [maxLat + latPad, maxLng + lngPad],
  ];
}

function withArea(bounds: LatLngBounds): LatLngBounds {
  const [[minLat, minLng], [maxLat, maxLng]] = bounds;
  const latGrow = Math.max(0, MIN_BOUNDS_DEG - (maxLat - minLat)) / 2;
  const lngGrow = Math.max(0, MIN_BOUNDS_DEG - (maxLng - minLng)) / 2;
  return [
    [minLat - latGrow, minLng - lngGrow],
    [maxLat + latGrow, maxLng + lngGrow],
  ];
}

function containsPoint(bounds: LatLngBounds, point: Point): boolean {
  const [[minLat, minLng], [maxLat, maxLng]] = bounds;
  return (
    point.lat >= minLat &&
    point.lat <= maxLat &&
    point.lng >= minLng &&
    point.lng <= maxLng
  );
}

/** True when `point` is inside the doors' bounding box grown by `marginMi`. */
export function isNearTurf(
  point: Point,
  doors: StartDoor[],
  marginMi: number = TURF_MARGIN_MI,
): boolean {
  const bounds = doorBounds(doors);
  if (!bounds) return false;
  return containsPoint(padBounds(bounds, marginMi), point);
}

/** First door in route order with no result logged yet. */
export function firstRemainingDoor<T extends StartDoor>(doors: T[]): T | null {
  return doors.find((door) => !door.current) ?? null;
}

/**
 * Pick the opening door and camera. `doors` must already be in walk order —
 * rebased on `you` when known — so the first remaining door is the next stop
 * on the street route, not merely the nearest pin as the crow flies.
 */
export function planWalkStart<T extends StartDoor>(
  doors: T[],
  you: Point | null,
): WalkStartPlan<T> {
  const door = firstRemainingDoor(doors);
  const turf = doorBounds(doors);
  const nearTurf = you != null && isNearTurf(you, doors);

  if (nearTurf && you && door && hasPin(door)) {
    // Frame the volunteer with their next door so they can see which way to go.
    return {
      door,
      nearTurf,
      bounds: withArea([
        [Math.min(you.lat, door.lat), Math.min(you.lng, door.lng)],
        [Math.max(you.lat, door.lat), Math.max(you.lng, door.lng)],
      ]),
    };
  }

  return {
    door,
    nearTurf,
    bounds: turf ? withArea(turf) : null,
  };
}
