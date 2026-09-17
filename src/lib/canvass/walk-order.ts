/**
 * Street-first walk order for door lists.
 *
 * A plain nearest-neighbor tour picks whatever door is closest, so a house
 * across the road beats the next house up the block and the walk ping-pongs
 * between streets. This orders doors by street and house number first, then
 * chains whole street blocks together, so a street is finished in one pass
 * before the walk moves on.
 */

import { haversineMiles } from "@/lib/geo";

export interface WalkAddress {
  /** Normalized street line, house number first (e.g. "123 NE 45TH ST"). */
  addressLine: string;
  city?: string | null;
  unit?: string | null;
}

export interface Point {
  lat: number;
  lng: number;
}

/** A jump this long between consecutive house numbers starts a new block. */
const BLOCK_GAP_MI = 0.12;
/** Block-sequence 2-opt is skipped above this many blocks to bound the cost. */
const REFINE_MAX_BLOCKS = 80;

interface Door<T> {
  item: T;
  index: number;
  point: Point | null;
  addressKey: string;
  streetKey: string;
  houseNumber: number | null;
  unitKey: string;
}

/**
 * Split a normalized address line into a street key and house number.
 * Lines that don't start with a number (PO boxes, unparsed junk) become their
 * own street so they still walk as a unit.
 */
export function parseStreetAddress(addressLine: string): {
  street: string;
  houseNumber: number | null;
} {
  const tokens = addressLine.trim().toUpperCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { street: "", houseNumber: null };
  const leading = /^(\d+)/.exec(tokens[0]);
  if (leading && tokens.length > 1) {
    return { street: tokens.slice(1).join(" "), houseNumber: Number(leading[1]) };
  }
  return { street: tokens.join(" "), houseNumber: null };
}

/** Zero-pad digit runs so unit "2" sorts before "10". */
function unitSortKey(unit: string | null | undefined): string {
  if (!unit) return "";
  return unit
    .trim()
    .toUpperCase()
    .replace(/\d+/g, (digits) => digits.padStart(6, "0"));
}

/**
 * Walk order for `items`: streets grouped, house numbers monotone inside each
 * street, and streets chained so each one starts near where the last ended.
 * Doors without coordinates ride along with their street; doors on a street
 * where nothing is geocoded go last.
 */
export function orderForStreetWalk<T>(
  items: T[],
  options: {
    pointOf: (item: T) => Point | null;
    addressOf: (item: T) => WalkAddress;
    /** Where the volunteer starts; defaults to the southwest-most door. */
    start?: Point | null;
  },
): T[] {
  if (items.length <= 1) return [...items];

  const doors: Door<T>[] = items.map((item, index) => {
    const address = options.addressOf(item);
    const { street, houseNumber } = parseStreetAddress(address.addressLine);
    const cityKey = (address.city ?? "").trim().toUpperCase();
    const addressKey = address.addressLine.trim().toUpperCase().replace(/\s+/g, " ");
    return {
      item,
      index,
      point: options.pointOf(item),
      addressKey: `${cityKey}|${addressKey}`,
      streetKey: `${cityKey}|${street}`,
      houseNumber,
      unitKey: unitSortKey(address.unit),
    };
  });

  // Geocoders sometimes place units in the same apartment building at
  // noticeably different coordinates. Give every unit one representative
  // building point so a bad unit pin cannot split the building into separate
  // route blocks.
  const buildingPoints = new Map<string, Point>();
  const pointsByAddress = new Map<string, Point[]>();
  for (const door of doors) {
    if (!door.point) continue;
    const points = pointsByAddress.get(door.addressKey);
    if (points) points.push(door.point);
    else pointsByAddress.set(door.addressKey, [door.point]);
  }
  for (const [key, points] of pointsByAddress) {
    buildingPoints.set(key, medianPoint(points));
  }
  for (const door of doors) {
    door.point = buildingPoints.get(door.addressKey) ?? door.point;
  }

  const streets = new Map<string, Door<T>[]>();
  for (const door of doors) {
    const group = streets.get(door.streetKey);
    if (group) group.push(door);
    else streets.set(door.streetKey, [door]);
  }

  const blocks: Door<T>[][] = [];
  const ungeocoded: Door<T>[] = [];
  for (const group of streets.values()) {
    const sorted = sortAlongStreet(group);
    if (sorted.every((door) => !door.point)) {
      ungeocoded.push(...sorted);
      continue;
    }
    blocks.push(...splitIntoBlocks(sorted));
  }

  const walked = chainBlocks(blocks, options.start ?? southWestMost(blocks));
  return [...walked, ...ungeocoded].map((door) => door.item);
}

function medianPoint(points: Point[]): Point {
  const lats = points.map((point) => point.lat).sort((a, b) => a - b);
  const lngs = points.map((point) => point.lng).sort((a, b) => a - b);
  const middle = Math.floor(points.length / 2);
  if (points.length % 2) return { lat: lats[middle], lng: lngs[middle] };
  return {
    lat: (lats[middle - 1] + lats[middle]) / 2,
    lng: (lngs[middle - 1] + lngs[middle]) / 2,
  };
}

/**
 * Order one street name. House numbers win when most doors have one; otherwise
 * doors are projected onto the street's long axis so the walk stays monotone.
 */
function sortAlongStreet<T>(group: Door<T>[]): Door<T>[] {
  const numbered = group.filter((door) => door.houseNumber != null).length;
  const byNumber = numbered * 2 >= group.length;
  const axis = longAxis(group);
  const primary = (door: Door<T>): number => {
    if (byNumber) return door.houseNumber ?? Number.POSITIVE_INFINITY;
    if (!door.point) return Number.POSITIVE_INFINITY;
    return axis === "lng" ? door.point.lng : door.point.lat;
  };
  return [...group].sort((a, b) => {
    const delta = primary(a) - primary(b);
    if (delta !== 0) return delta;
    if (a.unitKey !== b.unitKey) return a.unitKey < b.unitKey ? -1 : 1;
    return a.index - b.index;
  });
}

function longAxis<T>(group: Door<T>[]): "lat" | "lng" {
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const door of group) {
    if (!door.point) continue;
    minLat = Math.min(minLat, door.point.lat);
    maxLat = Math.max(maxLat, door.point.lat);
    minLng = Math.min(minLng, door.point.lng);
    maxLng = Math.max(maxLng, door.point.lng);
  }
  if (minLat === Infinity) return "lat";
  // Compare ground distance, not degrees: a degree of longitude is shorter.
  const latSpan = haversineMiles(minLat, minLng, maxLat, minLng);
  const lngSpan = haversineMiles(minLat, minLng, minLat, maxLng);
  return lngSpan > latSpan ? "lng" : "lat";
}

/**
 * One street name can appear in places a volunteer can't walk between (it
 * leaves the turf and returns, or the name repeats across town), so break it
 * where consecutive doors are far apart.
 */
function splitIntoBlocks<T>(sorted: Door<T>[]): Door<T>[][] {
  const threshold = blockGapThreshold(sorted);
  const blocks: Door<T>[][] = [[]];
  let previous: Point | null = null;
  for (const door of sorted) {
    if (
      door.point &&
      previous &&
      haversineMiles(previous.lat, previous.lng, door.point.lat, door.point.lng) >
        threshold
    ) {
      blocks.push([]);
    }
    blocks[blocks.length - 1].push(door);
    if (door.point) previous = door.point;
  }
  return blocks.filter((block) => block.length > 0);
}

/**
 * How far apart two houses must be to count as different blocks. Scaled off
 * the street's own spacing so a rural road, where neighbors are a quarter mile
 * apart, doesn't shatter into one block per door.
 */
function blockGapThreshold<T>(sorted: Door<T>[]): number {
  const gaps: number[] = [];
  let previous: Point | null = null;
  for (const door of sorted) {
    if (!door.point) continue;
    if (previous) {
      gaps.push(haversineMiles(previous.lat, previous.lng, door.point.lat, door.point.lng));
    }
    previous = door.point;
  }
  if (gaps.length < 3) return BLOCK_GAP_MI;
  gaps.sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  return Math.max(BLOCK_GAP_MI, median * 4);
}

/**
 * The two ways to walk a block: house numbers up, or house numbers down. One
 * pass covers both sides of the road, so the block is walked once rather than
 * once per side. Offering both directions lets the block be entered at
 * whichever end the volunteer arrives from.
 */
function blockRoutes<T>(block: Door<T>[]): Door<T>[][] {
  return [block, [...block].reverse()];
}

function entryPoint<T>(route: Door<T>[]): Point | null {
  for (const door of route) if (door.point) return door.point;
  return null;
}

function exitPoint<T>(route: Door<T>[]): Point | null {
  for (let i = route.length - 1; i >= 0; i--) {
    if (route[i].point) return route[i].point;
  }
  return null;
}

function southWestMost<T>(blocks: Door<T>[][]): Point | null {
  let best: Point | null = null;
  for (const block of blocks) {
    for (const door of block) {
      if (!door.point) continue;
      if (!best || door.point.lat + door.point.lng < best.lat + best.lng) {
        best = door.point;
      }
    }
  }
  return best;
}

/**
 * Greedy nearest-block chaining, refined by 2-opt over the block sequence so a
 * street isn't left stranded for the end of the walk. Only the travel between
 * blocks is scored — order inside a block is already fixed.
 */
function chainBlocks<T>(blocks: Door<T>[][], start: Point | null): Door<T>[] {
  if (!blocks.length) return [];
  const routes = blocks.map((block) => blockRoutes(block));
  const origin = start ?? entryPoint(blocks[0]);
  if (!origin) return blocks.flat();

  let sequence = greedySequence(routes, origin);
  let best = evaluateSequence(sequence, routes, origin);

  if (blocks.length <= REFINE_MAX_BLOCKS) {
    let improved = true;
    let guard = 0;
    while (improved && guard < 8) {
      improved = false;
      guard += 1;
      for (let i = 0; i < sequence.length - 1; i++) {
        for (let k = i + 1; k < sequence.length; k++) {
          const candidate = [
            ...sequence.slice(0, i),
            ...sequence.slice(i, k + 1).reverse(),
            ...sequence.slice(k + 1),
          ];
          const scored = evaluateSequence(candidate, routes, origin);
          if (scored.miles + 1e-9 < best.miles) {
            sequence = candidate;
            best = scored;
            improved = true;
          }
        }
      }
    }
  }

  return sequence.flatMap((block, position) => routes[block][best.routes[position]]);
}

function greedySequence<T>(routes: Door<T>[][][], origin: Point): number[] {
  const remaining = new Set(routes.keys());
  const sequence: number[] = [];
  let current = origin;
  while (remaining.size) {
    let bestBlock = -1;
    let bestRoute = 0;
    let bestMiles = Infinity;
    for (const block of remaining) {
      routes[block].forEach((route, index) => {
        const miles = entryMiles(current, route);
        if (miles < bestMiles) {
          bestMiles = miles;
          bestBlock = block;
          bestRoute = index;
        }
      });
    }
    if (bestBlock < 0) break;
    remaining.delete(bestBlock);
    sequence.push(bestBlock);
    current = exitPoint(routes[bestBlock][bestRoute]) ?? current;
  }
  return [...sequence, ...remaining];
}

/**
 * Total between-block walking for a block order. Which end of a block to enter
 * is scored against the walk to the following block too, so the tour doesn't
 * enter at the near end only to finish far from where it's headed next.
 */
function evaluateSequence<T>(
  sequence: number[],
  routes: Door<T>[][][],
  origin: Point,
): { miles: number; routes: number[] } {
  let current = origin;
  let miles = 0;
  const chosen: number[] = [];
  sequence.forEach((block, position) => {
    const upcoming = routes[sequence[position + 1]] ?? null;
    let bestRoute = 0;
    let bestScore = Infinity;
    let bestEntry = 0;
    routes[block].forEach((route, index) => {
      const entry = entryMiles(current, route);
      if (!Number.isFinite(entry)) return;
      const exit = exitPoint(route);
      const onward =
        upcoming && exit
          ? Math.min(...upcoming.map((next) => entryMiles(exit, next)))
          : 0;
      const score = entry + (Number.isFinite(onward) ? onward : 0);
      if (score < bestScore) {
        bestScore = score;
        bestEntry = entry;
        bestRoute = index;
      }
    });
    miles += Number.isFinite(bestScore) ? bestEntry : 0;
    chosen.push(bestRoute);
    current = exitPoint(routes[block][bestRoute]) ?? current;
  });
  return { miles, routes: chosen };
}

function entryMiles<T>(from: Point, route: Door<T>[]): number {
  const entry = entryPoint(route);
  if (!entry) return Infinity;
  return haversineMiles(from.lat, from.lng, entry.lat, entry.lng);
}
