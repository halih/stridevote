import assert from "node:assert/strict";
import { test } from "node:test";
import { headingBetween } from "./use-volunteer-location";

test("derives compass heading from consecutive GPS points", () => {
  const origin = { lat: 47.7, lng: -122.3 };
  assert.ok(headingBetween(origin, { lat: 47.701, lng: -122.3 }) < 1);
  assert.ok(
    Math.abs(headingBetween(origin, { lat: 47.7, lng: -122.299 }) - 90) <
      1,
  );
});
