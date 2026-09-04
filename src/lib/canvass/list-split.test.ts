import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  MIN_SPLIT_DOORS,
  clipPolygonToHalfPlane,
  convexHull,
  planListSplit,
  splitHalfNames,
  type SplitDoorInput,
} from "./list-split";
import { parseStreetAddress } from "./walk-order";

const BASE_LAT = 47.62;
const BASE_LNG = -122.31;

function door(
  id: string,
  addressLine: string,
  lat: number | null,
  lng: number | null,
  opts?: { unit?: string | null; completed?: boolean; city?: string },
): SplitDoorInput {
  return {
    householdId: id,
    addressLine,
    city: opts?.city ?? "SEATTLE",
    unit: opts?.unit ?? null,
    lat,
    lng,
    completed: opts?.completed,
  };
}

function streetOf(addressLine: string): string {
  return parseStreetAddress(addressLine).street;
}

/** Two parallel N–S streets. */
function northSouthGrid(count: number): SplitDoorInput[] {
  const doors: SplitDoorInput[] = [];
  const half = Math.floor(count / 2);
  for (let i = 0; i < half; i++) {
    doors.push(
      door(
        `w-${i}`,
        `${100 + i * 10} WEST AVE`,
        BASE_LAT + i * 0.0005,
        BASE_LNG,
      ),
    );
  }
  for (let i = 0; i < count - half; i++) {
    doors.push(
      door(
        `e-${i}`,
        `${100 + i * 10} EAST AVE`,
        BASE_LAT + i * 0.0005,
        BASE_LNG + 0.002,
      ),
    );
  }
  return doors;
}

/** East–west stretch on a single street name. */
function eastWestRow(count: number): SplitDoorInput[] {
  return Array.from({ length: count }, (_, i) =>
    door(
      `ew-${i}`,
      `${100 + i} MAIN ST`,
      BASE_LAT + (i % 2) * 0.00005,
      BASE_LNG + i * 0.0008,
    ),
  );
}

/**
 * Shoreline-style corridor: N–S avenues plus long E–W cross streets.
 * A good cut is a vertical line (east of Fremont / MID AVE).
 */
function fremontStyleTurf(): SplitDoorInput[] {
  const doors: SplitDoorInput[] = [];
  const avenues = [
    { name: "WEST AVE", lng: BASE_LNG, prefix: "w" },
    { name: "MID AVE", lng: BASE_LNG + 0.001, prefix: "m" }, // Fremont stand-in
    { name: "EAST AVE", lng: BASE_LNG + 0.002, prefix: "e" },
    { name: "FAR AVE", lng: BASE_LNG + 0.003, prefix: "f" },
  ];
  for (const ave of avenues) {
    for (let i = 0; i < 12; i++) {
      // Both sides of each N–S avenue
      doors.push(
        door(
          `${ave.prefix}w-${i}`,
          `${100 + i} ${ave.name}`,
          BASE_LAT + i * 0.00035,
          ave.lng - 0.00005,
        ),
      );
      doors.push(
        door(
          `${ave.prefix}e-${i}`,
          `${101 + i} ${ave.name}`,
          BASE_LAT + i * 0.00035,
          ave.lng + 0.00005,
        ),
      );
    }
  }
  // Long E–W cross streets spanning the whole turf
  for (let i = 0; i < 8; i++) {
    const lng = BASE_LNG - 0.0002 + i * 0.00045;
    doors.push(
      door(`s-${i}`, `${1400 + i * 10} SOUTH ST`, BASE_LAT - 0.0002, lng),
    );
    doors.push(
      door(`n-${i}`, `${1400 + i * 10} NORTH ST`, BASE_LAT + 0.0042, lng),
    );
  }
  return doors;
}

function maxLng(doors: SplitDoorInput[], ids: string[]): number {
  const set = new Set(ids);
  let max = -Infinity;
  for (const d of doors) {
    if (!set.has(d.householdId) || d.lng == null) continue;
    max = Math.max(max, d.lng);
  }
  return max;
}

function minLng(doors: SplitDoorInput[], ids: string[]): number {
  const set = new Set(ids);
  let min = Infinity;
  for (const d of doors) {
    if (!set.has(d.householdId) || d.lng == null) continue;
    min = Math.min(min, d.lng);
  }
  return min;
}

describe("splitHalfNames", () => {
  it("appends geographic suffixes to the base name", () => {
    assert.deepEqual(splitHalfNames("Capitol Hill Weekend", "North", "South"), {
      nameA: "Capitol Hill Weekend North",
      nameB: "Capitol Hill Weekend South",
    });
  });

  it("strips a prior geographic suffix before appending", () => {
    assert.deepEqual(splitHalfNames("Capitol Hill North", "East", "West"), {
      nameA: "Capitol Hill East",
      nameB: "Capitol Hill West",
    });
  });
});

describe("convexHull / half-plane clip", () => {
  it("returns a ring for a simple rectangle of points", () => {
    const hull = convexHull([
      { lat: 0, lng: 0 },
      { lat: 0, lng: 1 },
      { lat: 1, lng: 1 },
      { lat: 1, lng: 0 },
      { lat: 0.5, lng: 0.5 },
    ]);
    assert.ok(hull);
    assert.ok(hull!.length >= 4);
  });

  it("clips a hull so halves do not cross the cut line", () => {
    const hull: [number, number][] = [
      [0, 0],
      [0, 2],
      [2, 2],
      [2, 0],
    ];
    const west = clipPolygonToHalfPlane(hull, "lng", 1, false);
    const east = clipPolygonToHalfPlane(hull, "lng", 1, true);
    assert.ok(west && east);
    for (const [, lng] of west!) assert.ok(lng <= 1 + 1e-9);
    for (const [, lng] of east!) assert.ok(lng >= 1 - 1e-9);
  });
});

describe("planListSplit", () => {
  it("rejects lists under the minimum door count", () => {
    const doors = northSouthGrid(MIN_SPLIT_DOORS - 1);
    const result = planListSplit(doors, "Small List");
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /at least 30/i);
  });

  it("splits parallel avenues east/west with no lng overlap", () => {
    const doors = northSouthGrid(40);
    const result = planListSplit(doors, "Weekend Turf");
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.plan.axis, "lng");
    assert.equal(result.plan.halfA.suffix, "East");
    assert.equal(result.plan.halfB.suffix, "West");

    const westMax = maxLng(doors, result.plan.halfB.householdIds);
    const eastMin = minLng(doors, result.plan.halfA.householdIds);
    assert.ok(westMax <= eastMin + 1e-9);
  });

  it("cuts like east-of-Fremont: separable halves, compact N–S streets whole", () => {
    const doors = fremontStyleTurf();
    const result = planListSplit(doors, "SHL");
    assert.equal(result.ok, true);
    if (!result.ok) return;

    assert.equal(result.plan.axis, "lng");

    // Mapped doors are linearly separable by longitude.
    const westMax = maxLng(doors, result.plan.halfB.householdIds);
    const eastMin = minLng(doors, result.plan.halfA.householdIds);
    assert.ok(
      westMax <= eastMin + 1e-9,
      `expected westMax (${westMax}) <= eastMin (${eastMin})`,
    );

    // Both sides of MID AVE stay together.
    const midIds = doors
      .filter((d) => streetOf(d.addressLine) === "MID AVE")
      .map((d) => d.householdId);
    const midA = midIds.filter((id) =>
      result.plan.halfA.householdIds.includes(id),
    );
    const midB = midIds.filter((id) =>
      result.plan.halfB.householdIds.includes(id),
    );
    assert.ok(
      (midA.length === midIds.length && midB.length === 0) ||
        (midB.length === midIds.length && midA.length === 0),
    );

    // Boundaries do not cross the cut.
    if (result.plan.halfA.boundary && result.plan.halfB.boundary) {
      const cut = (westMax + eastMin) / 2;
      for (const [, lng] of result.plan.halfB.boundary) {
        assert.ok(lng <= cut + 1e-6);
      }
      for (const [, lng] of result.plan.halfA.boundary) {
        assert.ok(lng >= cut - 1e-6);
      }
    }
  });

  it("is deterministic for the same input", () => {
    const doors = northSouthGrid(36);
    const first = planListSplit(doors, "Same");
    const second = planListSplit(doors, "Same");
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (!first.ok || !second.ok) return;
    assert.deepEqual(first.plan.halfA.householdIds, second.plan.halfA.householdIds);
    assert.deepEqual(first.plan.halfB.householdIds, second.plan.halfB.householdIds);
  });

  it("keeps co-located units in the same half", () => {
    const doors: SplitDoorInput[] = [];
    for (let i = 0; i < 16; i++) {
      doors.push(
        door(`s-${i}`, `${100 + i} S ST`, BASE_LAT, BASE_LNG + i * 0.0003),
      );
    }
    const buildingLat = BASE_LAT + 0.01;
    const buildingLng = BASE_LNG + 0.001;
    for (let u = 1; u <= 4; u++) {
      doors.push(
        door(`apt-${u}`, "500 N AVE", buildingLat, buildingLng, {
          unit: String(u),
        }),
      );
    }
    for (let i = 0; i < 12; i++) {
      doors.push(
        door(
          `n-${i}`,
          `${200 + i} N AVE`,
          buildingLat + 0.0004 * (i + 1),
          BASE_LNG + i * 0.0002,
        ),
      );
    }
    const result = planListSplit(doors, "Apartments");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const aHas = result.plan.halfA.householdIds.filter((id) =>
      id.startsWith("apt-"),
    );
    const bHas = result.plan.halfB.householdIds.filter((id) =>
      id.startsWith("apt-"),
    );
    assert.ok(
      (aHas.length === 4 && bHas.length === 0) ||
        (bHas.length === 4 && aHas.length === 0),
    );
  });

  it("splits a single long street into contiguous east/west segments", () => {
    const result = planListSplit(eastWestRow(40), "Main Street");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.plan.axis, "lng");
    assert.ok(result.plan.halfA.centroidLng! > result.plan.halfB.centroidLng!);
  });

  it("counts completed doors per half", () => {
    const doors = northSouthGrid(30).map((d, i) => ({
      ...d,
      completed: i < 5,
    }));
    const result = planListSplit(doors, "Progress");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(
      result.plan.halfA.completedCount + result.plan.halfB.completedCount,
      5,
    );
  });

  it("rejects when almost nothing is geocoded", () => {
    const doors = Array.from({ length: 30 }, (_, i) =>
      door(`u-${i}`, `${100 + i} NOWHERE RD`, null, null),
    );
    assert.equal(planListSplit(doors, "Unmapped").ok, false);
  });

  it("rejects a single-point pile that cannot be cut geographically", () => {
    const doors = Array.from({ length: 30 }, (_, i) =>
      door(`p-${i}`, `${100 + i} SAME ST`, BASE_LAT, BASE_LNG, {
        unit: String(i),
      }),
    );
    assert.equal(planListSplit(doors, "Pile").ok, false);
  });

  it("places ungeocoded doors without dropping them", () => {
    const doors = [
      ...northSouthGrid(30),
      door("missing-1", "999 WEST AVE", null, null),
      door("missing-2", "998 EAST AVE", null, null),
    ];
    const result = planListSplit(doors, "With Gaps");
    assert.equal(result.ok, true);
    if (!result.ok) return;
    const all = new Set([
      ...result.plan.halfA.householdIds,
      ...result.plan.halfB.householdIds,
    ]);
    assert.equal(all.size, 32);
    assert.ok(all.has("missing-1"));
    assert.ok(all.has("missing-2"));
  });
});
