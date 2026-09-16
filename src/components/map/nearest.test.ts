import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nearestIndexWithin } from "./nearest";

describe("nearest door pin for a tap", () => {
  it("picks the closest pin within the slop radius", () => {
    const pins = [
      { x: 0, y: 0 },
      { x: 30, y: 0 },
      { x: 60, y: 0 },
    ];
    assert.equal(nearestIndexWithin({ x: 34, y: 3 }, pins, 22), 1);
  });

  it("ignores taps on empty map with no pin nearby", () => {
    const pins = [{ x: 0, y: 0 }];
    assert.equal(nearestIndexWithin({ x: 100, y: 100 }, pins, 22), null);
    assert.equal(nearestIndexWithin({ x: 0, y: 0 }, [], 22), null);
  });

  it("resolves a dense block to one door instead of shadowing neighbours", () => {
    // Houses ~12px apart at walking zoom: overlapping hit areas would make the
    // earlier pins unreachable, but nearest-wins reaches every one of them.
    const pins = [
      { x: 0, y: 0 },
      { x: 12, y: 0 },
      { x: 24, y: 0 },
      { x: 36, y: 0 },
    ];
    assert.equal(nearestIndexWithin({ x: 1, y: 2 }, pins, 22), 0);
    assert.equal(nearestIndexWithin({ x: 13, y: -2 }, pins, 22), 1);
    assert.equal(nearestIndexWithin({ x: 23, y: 4 }, pins, 22), 2);
    assert.equal(nearestIndexWithin({ x: 38, y: 0 }, pins, 22), 3);
  });

  it("treats the slop radius as inclusive", () => {
    const pins = [{ x: 22, y: 0 }];
    assert.equal(nearestIndexWithin({ x: 0, y: 0 }, pins, 22), 0);
    assert.equal(nearestIndexWithin({ x: -1, y: 0 }, pins, 22), null);
  });
});
