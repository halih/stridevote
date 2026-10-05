import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  doorBounds,
  firstRemainingDoor,
  isNearTurf,
  planWalkStart,
} from "./walk-start";

type Door = {
  householdId: string;
  lat: number | null;
  lng: number | null;
  current: { outcome: string } | null;
};

function door(
  id: string,
  lat: number | null,
  lng: number | null,
  done = false,
): Door {
  return { householdId: id, lat, lng, current: done ? { outcome: "lit" } : null };
}

// A short block in north Seattle, roughly 60 m between neighbours.
const turf: Door[] = [
  door("a", 47.7200, -122.3400, true),
  door("b", 47.7205, -122.3400, true),
  door("c", 47.7210, -122.3400),
  door("d", 47.7215, -122.3400),
  door("e", 47.7220, -122.3395, true),
];

describe("walk start", () => {
  it("skips doors that already have a result", () => {
    assert.equal(firstRemainingDoor(turf)?.householdId, "c");
    assert.equal(firstRemainingDoor(turf.map((d) => ({ ...d, current: { outcome: "lit" } }))), null);
    assert.equal(firstRemainingDoor([]), null);
  });

  it("builds bounds from geocoded doors only", () => {
    assert.deepEqual(doorBounds([...turf, door("x", null, null)]), [
      [47.72, -122.34],
      [47.722, -122.3395],
    ]);
    assert.equal(doorBounds([door("x", null, null)]), null);
  });

  it("counts standing across the street from the edge as near the turf", () => {
    // ~50 m west of the block.
    assert.equal(isNearTurf({ lat: 47.721, lng: -122.3407 }, turf), true);
    // A mile away is not.
    assert.equal(isNearTurf({ lat: 47.7355, lng: -122.34 }, turf), false);
    assert.equal(isNearTurf({ lat: 47.721, lng: -122.34 }, []), false);
  });

  it("frames the volunteer with the next remaining door when they are at the turf", () => {
    const you = { lat: 47.7212, lng: -122.3405 };
    const plan = planWalkStart(turf, you);
    assert.equal(plan.nearTurf, true);
    assert.equal(plan.door?.householdId, "c");
    assert.ok(plan.bounds);
    const [[minLat, minLng], [maxLat, maxLng]] = plan.bounds;
    // Both the volunteer and door c lie inside the framing.
    assert.ok(minLat <= you.lat && you.lat <= maxLat);
    assert.ok(minLng <= you.lng && you.lng <= maxLng);
    assert.ok(minLat <= 47.721 && 47.721 <= maxLat);
    assert.ok(minLng <= -122.34 && -122.34 <= maxLng);
    // The framing stays tight — nowhere near the whole turf.
    assert.ok(maxLat < 47.722);
  });

  it("shows the whole turf when the volunteer is far away", () => {
    const plan = planWalkStart(turf, { lat: 47.6062, lng: -122.3321 });
    assert.equal(plan.nearTurf, false);
    assert.equal(plan.door?.householdId, "c");
    const [[minLat, minLng], [maxLat, maxLng]] = plan.bounds!;
    assert.ok(minLat <= 47.72 && maxLat >= 47.722);
    assert.ok(minLng <= -122.34 && maxLng >= -122.3395);
  });

  it("shows the whole turf and still picks a remaining door without GPS", () => {
    const plan = planWalkStart(turf, null);
    assert.equal(plan.nearTurf, false);
    assert.equal(plan.door?.householdId, "c");
    assert.ok(plan.bounds);
  });

  it("gives a single pin enough area to fit to", () => {
    const plan = planWalkStart([door("solo", 47.72, -122.34)], null);
    const [[minLat, minLng], [maxLat, maxLng]] = plan.bounds!;
    assert.ok(maxLat > minLat && maxLng > minLng);
  });

  it("falls back to the turf when every door is done", () => {
    const allDone = turf.map((d) => ({ ...d, current: { outcome: "lit" } }));
    const plan = planWalkStart(allDone, { lat: 47.721, lng: -122.34 });
    assert.equal(plan.door, null);
    assert.ok(plan.bounds);
  });
});
