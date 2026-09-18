import { test } from "node:test";
import assert from "node:assert/strict";
import { civibyteClientAttemptId } from "@/lib/civibyte/map";
import { minivanClientAttemptId } from "@/lib/minivan/map-canvass";

test("MiniVAN pull ids key off the printed list number", () => {
  assert.equal(
    minivanClientAttemptId("57429198-80406", 99, "2026-09-17 12:00:00"),
    "minivan:57429198-80406:99:2026-09-17T12:00:00",
  );
});

test("Civibyte pull ids key off the guest link (sourceRef)", () => {
  assert.equal(
    civibyteClientAttemptId(
      "https://civibyte.com/c/tok",
      "door-1",
      "2026-09-17T04:00:00Z",
    ),
    "civibyte:https://civibyte.com/c/tok:door-1:2026-09-17T04:00:00.000Z",
  );
});

test("Civibyte door membership filter keeps only this list's households", () => {
  const doors = {
    "door-a": { addressPk: "a", householdId: "hh-north", voterIdsByPk: {} },
    "door-b": { addressPk: "b", householdId: "hh-south", voterIdsByPk: {} },
  };
  const northHouseholds = new Set(["hh-north"]);
  const owned = Object.entries(doors).filter(([, link]) =>
    northHouseholds.has(link.householdId),
  );
  assert.equal(owned.length, 1);
  assert.equal(owned[0]?.[0], "door-a");
});
