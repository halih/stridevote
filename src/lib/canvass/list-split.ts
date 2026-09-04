/**
 * Geographic bisection of a canvass list into two walkable halves.
 *
 * Goals, in order:
 * 1. Halves are linearly separable along the turf's long axis so map
 *    territories do not overlap.
 * 2. Compact streets (both sides of a local road) stay together.
 * 3. Long streets that run along the cut may be segmented — better than
 *    sending two volunteers down the same block, or overlapping areas.
 * 4. Door counts should be reasonable, not necessarily 50/50.
 */

import { haversineMiles } from "@/lib/geo";
import {
  orderForStreetWalk,
  parseStreetAddress,
  type Point,
} from "@/lib/canvass/walk-order";

/** Hard floor so volunteers cannot keep carving lists into tiny scraps. */
export const MIN_SPLIT_DOORS = 30;

/** Each half must keep at least this many doors (allows uneven splits). */
const MIN_HALF_DOORS = 10;

export type SplitAxis = "lat" | "lng";
export type SplitSuffix = "North" | "South" | "East" | "West";
export type SplitHalfKey = "a" | "b";

export interface SplitDoorInput {
  householdId: string;
  addressLine: string;
  city?: string | null;
  unit?: string | null;
  lat: number | null;
  lng: number | null;
  completed?: boolean;
}

export interface SplitHalfPlan {
  key: SplitHalfKey;
  suffix: SplitSuffix;
  name: string;
  householdIds: string[];
  doorsCount: number;
  completedCount: number;
  centroidLat: number | null;
  centroidLng: number | null;
  boundary: [number, number][] | null;
  orderedHouseholdIds: string[];
  doorPins: Array<{ householdId: string; lat: number; lng: number }>;
}

export interface SplitPlan {
  axis: SplitAxis;
  baseName: string;
  halfA: SplitHalfPlan;
  halfB: SplitHalfPlan;
}

export type SplitPlanResult =
  | { ok: true; plan: SplitPlan }
  | { ok: false; message: string };

interface StreetStats {
  key: string;
  doors: SplitDoorInput[];
  medianLat: number;
  medianLng: number;
  latSpanMi: number;
  lngSpanMi: number;
  /** True when the street runs mostly along lat (N–S road). */
  isNorthSouth: boolean;
}

interface Atom {
  key: string;
  doors: SplitDoorInput[];
  /** Position used only for ordering/cutting (may be street centerline). */
  axisPos: number;
  lat: number;
  lng: number;
}

function stripTrailingSuffix(name: string): string {
  return name
    .trim()
    .replace(/\s+(North|South|East|West)(\s+\d+)?$/i, "")
    .trim();
}

export function splitHalfNames(
  originalName: string,
  suffixA: SplitSuffix,
  suffixB: SplitSuffix,
): { nameA: string; nameB: string } {
  const base = stripTrailingSuffix(originalName) || originalName.trim() || "List";
  return {
    nameA: `${base} ${suffixA}`,
    nameB: `${base} ${suffixB}`,
  };
}

function coordKey(lat: number, lng: number): string {
  return `${lat.toFixed(5)},${lng.toFixed(5)}`;
}

function streetKeyOf(door: SplitDoorInput): string {
  const { street } = parseStreetAddress(door.addressLine);
  const city = (door.city ?? "").trim().toUpperCase();
  return `${city}|${street || door.addressLine.trim().toUpperCase()}`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

function centroidOf(
  doors: SplitDoorInput[],
): { lat: number; lng: number } | null {
  const pts = doors.filter(
    (d) => d.lat != null && d.lng != null,
  ) as Array<SplitDoorInput & { lat: number; lng: number }>;
  if (!pts.length) return null;
  return {
    lat: pts.reduce((s, d) => s + d.lat, 0) / pts.length,
    lng: pts.reduce((s, d) => s + d.lng, 0) / pts.length,
  };
}

function chooseAxis(
  points: Array<{ lat: number; lng: number }>,
  streets?: Map<string, StreetStats>,
): SplitAxis {
  // Prefer cutting across the grain of the street grid: if most doors sit on
  // N–S avenues, split east/west (like “east of Fremont”); if most sit on
  // E–W roads, split north/south.
  if (streets && streets.size) {
    let nsDoors = 0;
    let ewDoors = 0;
    for (const street of streets.values()) {
      if (street.isNorthSouth) nsDoors += street.doors.length;
      else ewDoors += street.doors.length;
    }
    if (nsDoors !== ewDoors) {
      return nsDoors > ewDoors ? "lng" : "lat";
    }
  }

  if (points.length < 2) return "lat";
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const latSpan = haversineMiles(minLat, minLng, maxLat, minLng);
  const lngSpan = haversineMiles(minLat, minLng, minLat, maxLng);
  return lngSpan > latSpan ? "lng" : "lat";
}

function suffixesForAxis(axis: SplitAxis): {
  low: SplitSuffix;
  high: SplitSuffix;
} {
  return axis === "lat"
    ? { low: "South", high: "North" }
    : { low: "West", high: "East" };
}

function buildStreetStats(doors: SplitDoorInput[]): Map<string, StreetStats> {
  const byStreet = new Map<string, SplitDoorInput[]>();
  for (const door of doors) {
    if (door.lat == null || door.lng == null) continue;
    const key = streetKeyOf(door);
    const list = byStreet.get(key) ?? [];
    list.push(door);
    byStreet.set(key, list);
  }

  const stats = new Map<string, StreetStats>();
  for (const [key, list] of byStreet) {
    const lats = list.map((d) => d.lat!);
    const lngs = list.map((d) => d.lng!);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const latSpanMi = haversineMiles(minLat, minLng, maxLat, minLng);
    const lngSpanMi = haversineMiles(minLat, minLng, minLat, maxLng);
    stats.set(key, {
      key,
      doors: list,
      medianLat: median(lats),
      medianLng: median(lngs),
      latSpanMi,
      lngSpanMi,
      isNorthSouth: latSpanMi >= lngSpanMi,
    });
  }
  return stats;
}

/**
 * Axis position for cutting. Compact streets perpendicular to the cut use a
 * shared centerline so both sides of the road stay together. Streets that run
 * along the cut keep per-door positions so they can be segmented cleanly.
 */
function effectiveAxisPos(
  door: SplitDoorInput & { lat: number; lng: number },
  street: StreetStats | undefined,
  axis: SplitAxis,
): number {
  if (!street) return axis === "lat" ? door.lat : door.lng;
  if (axis === "lng") {
    // Cutting east/west: keep N–S roads whole via shared lng.
    if (street.isNorthSouth) return street.medianLng;
    return door.lng;
  }
  // Cutting north/south: keep E–W roads whole via shared lat.
  if (!street.isNorthSouth) return street.medianLat;
  return door.lat;
}

function buildingKey(door: SplitDoorInput): string {
  if (door.lat != null && door.lng != null) {
    return `geo:${coordKey(door.lat, door.lng)}`;
  }
  const { street, houseNumber } = parseStreetAddress(door.addressLine);
  const city = (door.city ?? "").trim().toUpperCase();
  return `addr:${city}|${street}|${houseNumber ?? door.addressLine}`;
}

/**
 * Atoms are the indivisible units for the cut. Co-located units merge.
 * Doors that share an effective axis position on the same street also merge
 * (both sides of a compact N–S road when cutting east/west).
 */
function buildAtoms(
  doors: SplitDoorInput[],
  axis: SplitAxis,
  streets: Map<string, StreetStats>,
): { atoms: Atom[]; ungeocoded: SplitDoorInput[] } {
  const ungeocoded: SplitDoorInput[] = [];
  const map = new Map<string, Atom>();

  for (const door of doors) {
    if (door.lat == null || door.lng == null) {
      ungeocoded.push(door);
      continue;
    }
    const streetKey = streetKeyOf(door);
    const street = streets.get(streetKey);
    const axisPos = effectiveAxisPos(
      door as SplitDoorInput & { lat: number; lng: number },
      street,
      axis,
    );
    // Quantize so tiny float noise doesn't split a centerline group.
    const posKey = axisPos.toFixed(6);
    const key = `${streetKey}@${posKey}|${buildingKey(door)}`;
    // Prefer merging everything that shares street+effective pos into one atom
    // when the street is using a centerline (perpendicular to cut).
    const mergeKey =
      street &&
      ((axis === "lng" && street.isNorthSouth) ||
        (axis === "lat" && !street.isNorthSouth))
        ? `${streetKey}@${posKey}`
        : key;

    const existing = map.get(mergeKey);
    if (existing) {
      existing.doors.push(door);
      continue;
    }
    map.set(mergeKey, {
      key: mergeKey,
      doors: [door],
      axisPos,
      lat: door.lat,
      lng: door.lng,
    });
  }

  for (const atom of map.values()) {
    const c = centroidOf(atom.doors)!;
    atom.lat = c.lat;
    atom.lng = c.lng;
  }

  return { atoms: [...map.values()], ungeocoded };
}

function cutScore(opts: {
  lowDoors: number;
  highDoors: number;
  gapMiles: number;
  totalDoors: number;
}): number {
  const { lowDoors, highDoors, gapMiles, totalDoors } = opts;
  if (lowDoors < MIN_HALF_DOORS || highDoors < MIN_HALF_DOORS) {
    return Infinity;
  }
  const imbalance = Math.abs(lowDoors - highDoors) / totalDoors;
  const gapReward = Math.min(gapMiles, 0.35) * 6;
  return imbalance - gapReward;
}

/**
 * Cut sorted atoms. Because atoms are ordered by axisPos and each door's
 * effective position matches its atom, the two halves are separable along
 * the cut axis — convex hulls will not overlap.
 */
function bestAtomCut(sorted: Atom[]): number | null {
  if (sorted.length < 2) return null;
  const totalDoors = sorted.reduce((s, a) => s + a.doors.length, 0);
  let bestIdx: number | null = null;
  let best = Infinity;
  let running = 0;

  for (let i = 0; i < sorted.length - 1; i++) {
    running += sorted[i].doors.length;
    // Skip cuts that don't advance geographic position (same centerline group
    // already merged; still guard against equal pos from different streets).
    if (sorted[i + 1].axisPos - sorted[i].axisPos < 1e-12) continue;

    const low = running;
    const high = totalDoors - running;
    const gap = haversineMiles(
      sorted[i].lat,
      sorted[i].lng,
      sorted[i + 1].lat,
      sorted[i + 1].lng,
    );
    const score = cutScore({
      lowDoors: low,
      highDoors: high,
      gapMiles: gap,
      totalDoors,
    });
    const midBias = Math.abs(i + 1 - sorted.length / 2) * 1e-4;
    if (score + midBias < best) {
      best = score + midBias;
      bestIdx = i + 1;
    }
  }
  return bestIdx;
}

/** Clip a polygon to one side of a half-plane along lat or lng. */
export function clipPolygonToHalfPlane(
  polygon: [number, number][],
  axis: SplitAxis,
  cutValue: number,
  keepHigh: boolean,
): [number, number][] | null {
  if (polygon.length < 3) return null;
  const inside = (lat: number, lng: number) => {
    const v = axis === "lat" ? lat : lng;
    return keepHigh ? v >= cutValue - 1e-12 : v <= cutValue + 1e-12;
  };
  const out: [number, number][] = [];
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const aIn = inside(a[0], a[1]);
    const bIn = inside(b[0], b[1]);
    if (aIn && bIn) {
      out.push(b);
    } else if (aIn && !bIn) {
      out.push(intersect(a, b, axis, cutValue));
    } else if (!aIn && bIn) {
      out.push(intersect(a, b, axis, cutValue));
      out.push(b);
    }
  }
  return out.length >= 3 ? out : null;
}

function intersect(
  a: [number, number],
  b: [number, number],
  axis: SplitAxis,
  cut: number,
): [number, number] {
  const [aLat, aLng] = a;
  const [bLat, bLng] = b;
  if (axis === "lat") {
    const t = (cut - aLat) / (bLat - aLat || 1e-12);
    return [cut, aLng + t * (bLng - aLng)];
  }
  const t = (cut - aLng) / (bLng - aLng || 1e-12);
  return [aLat + t * (bLat - aLat), cut];
}

/** Monotone chain convex hull. Input/output are [lat, lng]. */
export function convexHull(
  points: Array<{ lat: number; lng: number }>,
): [number, number][] | null {
  const unique = new Map<string, { lat: number; lng: number }>();
  for (const p of points) {
    unique.set(coordKey(p.lat, p.lng), p);
  }
  const pts = [...unique.values()].sort((a, b) =>
    a.lng === b.lng ? a.lat - b.lat : a.lng - b.lng,
  );
  if (pts.length < 3) {
    if (pts.length === 0) return null;
    if (pts.length === 1) {
      const { lat, lng } = pts[0];
      const d = 0.0002;
      return [
        [lat - d, lng - d],
        [lat - d, lng + d],
        [lat + d, lng + d],
        [lat + d, lng - d],
      ];
    }
    const [a, b] = pts;
    const d = 0.00015;
    return [
      [a.lat - d, a.lng],
      [a.lat + d, a.lng],
      [b.lat + d, b.lng],
      [b.lat - d, b.lng],
    ];
  }

  const cross = (
    o: { lat: number; lng: number },
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
  ) => (a.lng - o.lng) * (b.lat - o.lat) - (a.lat - o.lat) * (b.lng - o.lng);

  const lower: Array<{ lat: number; lng: number }> = [];
  for (const p of pts) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0
    ) {
      lower.pop();
    }
    lower.push(p);
  }
  const upper: Array<{ lat: number; lng: number }> = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0
    ) {
      upper.pop();
    }
    upper.push(p);
  }
  lower.pop();
  upper.pop();
  return [...lower, ...upper].map((p) => [p.lat, p.lng] as [number, number]);
}

function partitionAlongAxis(
  doors: SplitDoorInput[],
  axis: SplitAxis,
  streets: Map<string, StreetStats>,
): {
  low: SplitDoorInput[];
  high: SplitDoorInput[];
  cutValue: number;
  score: number;
} | null {
  const { atoms, ungeocoded } = buildAtoms(doors, axis, streets);
  if (atoms.length < 2) return null;

  const sorted = [...atoms].sort((a, b) => {
    if (a.axisPos !== b.axisPos) return a.axisPos - b.axisPos;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  if (new Set(sorted.map((a) => a.axisPos)).size < 2) return null;

  const cut = bestAtomCut(sorted);
  if (cut == null) return null;

  const lowAtoms = sorted.slice(0, cut);
  const highAtoms = sorted.slice(cut);
  const low = lowAtoms.flatMap((a) => a.doors);
  const high = highAtoms.flatMap((a) => a.doors);
  assignUngeocoded([...ungeocoded], low, high);

  if (low.length < MIN_HALF_DOORS || high.length < MIN_HALF_DOORS) return null;

  const total = low.length + high.length;
  const gap = haversineMiles(
    lowAtoms[lowAtoms.length - 1].lat,
    lowAtoms[lowAtoms.length - 1].lng,
    highAtoms[0].lat,
    highAtoms[0].lng,
  );
  const score = cutScore({
    lowDoors: low.length,
    highDoors: high.length,
    gapMiles: gap,
    totalDoors: total,
  });
  if (!Number.isFinite(score)) return null;

  const cutValue =
    (lowAtoms[lowAtoms.length - 1].axisPos + highAtoms[0].axisPos) / 2;

  return { low, high, cutValue, score };
}

function assignUngeocoded(
  ungeocoded: SplitDoorInput[],
  low: SplitDoorInput[],
  high: SplitDoorInput[],
): void {
  if (!ungeocoded.length) return;
  const streetCount = (doors: SplitDoorInput[]) => {
    const counts = new Map<string, number>();
    for (const d of doors) {
      const key = streetKeyOf(d);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  };
  const lowStreets = streetCount(low);
  const highStreets = streetCount(high);
  for (const door of ungeocoded) {
    const key = streetKeyOf(door);
    const lowHits = lowStreets.get(key) ?? 0;
    const highHits = highStreets.get(key) ?? 0;
    if (lowHits > highHits || (lowHits === highHits && low.length <= high.length)) {
      low.push(door);
      lowStreets.set(key, lowHits + 1);
    } else {
      high.push(door);
      highStreets.set(key, highHits + 1);
    }
  }
}

function buildHalf(
  key: SplitHalfKey,
  suffix: SplitSuffix,
  name: string,
  doors: SplitDoorInput[],
  axis: SplitAxis,
  cutValue: number,
  keepHigh: boolean,
): SplitHalfPlan {
  const ordered = orderForStreetWalk(doors, {
    pointOf: (d): Point | null =>
      d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null,
    addressOf: (d) => ({
      addressLine: d.addressLine,
      city: d.city,
      unit: d.unit,
    }),
  });
  const centroid = centroidOf(doors);
  const geocoded = doors.filter(
    (d) => d.lat != null && d.lng != null,
  ) as Array<SplitDoorInput & { lat: number; lng: number }>;
  const hull = convexHull(geocoded);
  const clipped = hull
    ? clipPolygonToHalfPlane(hull, axis, cutValue, keepHigh)
    : null;
  const boundary = clipped ?? hull;

  return {
    key,
    suffix,
    name,
    householdIds: ordered.map((d) => d.householdId),
    doorsCount: doors.length,
    completedCount: doors.filter((d) => d.completed).length,
    centroidLat: centroid?.lat ?? null,
    centroidLng: centroid?.lng ?? null,
    boundary,
    orderedHouseholdIds: ordered.map((d) => d.householdId),
    doorPins: geocoded.map((d) => ({
      householdId: d.householdId,
      lat: d.lat,
      lng: d.lng,
    })),
  };
}

/**
 * Deterministically partition doors into two non-overlapping geographic halves.
 */
export function planListSplit(
  doors: SplitDoorInput[],
  originalName: string,
): SplitPlanResult {
  if (doors.length < MIN_SPLIT_DOORS) {
    return {
      ok: false,
      message: `Lists need at least ${MIN_SPLIT_DOORS} doors to split.`,
    };
  }

  const ids = new Set(doors.map((d) => d.householdId));
  if (ids.size !== doors.length) {
    return { ok: false, message: "List has duplicate household entries." };
  }

  const geocodedDoors = doors.filter(
    (d) => d.lat != null && d.lng != null,
  ) as Array<SplitDoorInput & { lat: number; lng: number }>;
  if (geocodedDoors.length < 2) {
    return {
      ok: false,
      message: "Not enough mapped doors to split geographically.",
    };
  }

  const streets = buildStreetStats(doors);
  const preferred = chooseAxis(geocodedDoors, streets);
  const other: SplitAxis = preferred === "lng" ? "lat" : "lng";

  const preferredPart = partitionAlongAxis(doors, preferred, streets);
  const otherPart = partitionAlongAxis(doors, other, streets);

  // Prefer the street-grid cut; only take the other axis if it's meaningfully
  // cleaner (bigger gap / better balance).
  let axis = preferred;
  let partitioned = preferredPart;
  if (
    (!preferredPart && otherPart) ||
    (preferredPart &&
      otherPart &&
      otherPart.score < preferredPart.score - 0.15)
  ) {
    axis = other;
    partitioned = otherPart;
  }

  if (!partitioned) {
    return {
      ok: false,
      message: "Could not find a walkable geographic cut.",
    };
  }

  const { low, high, cutValue } = partitioned;
  const { low: lowSuffix, high: highSuffix } = suffixesForAxis(axis);
  const { nameA, nameB } = splitHalfNames(originalName, highSuffix, lowSuffix);

  const halfA = buildHalf("a", highSuffix, nameA, high, axis, cutValue, true);
  const halfB = buildHalf("b", lowSuffix, nameB, low, axis, cutValue, false);

  const allIds = new Set([...halfA.householdIds, ...halfB.householdIds]);
  if (allIds.size !== doors.length) {
    return { ok: false, message: "Split lost or duplicated doors." };
  }

  return {
    ok: true,
    plan: {
      axis,
      baseName: stripTrailingSuffix(originalName) || originalName.trim(),
      halfA,
      halfB,
    },
  };
}

export function halfByKey(plan: SplitPlan, key: SplitHalfKey): SplitHalfPlan {
  return key === "a" ? plan.halfA : plan.halfB;
}

export function otherHalfKey(key: SplitHalfKey): SplitHalfKey {
  return key === "a" ? "b" : "a";
}

export type SplitPreviewHalf = {
  key: SplitHalfKey;
  suffix: string;
  name: string;
  doorsCount: number;
  completedCount: number;
  centroidLat: number | null;
  centroidLng: number | null;
  boundary: [number, number][] | null;
  doorPins: Array<{
    householdId: string;
    lat: number;
    lng: number;
    completed: boolean;
  }>;
};

export type SplitPreview = {
  listId: string;
  programId: string;
  axis: string;
  baseName: string;
  halfA: SplitPreviewHalf;
  halfB: SplitPreviewHalf;
};
