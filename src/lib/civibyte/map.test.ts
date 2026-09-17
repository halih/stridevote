import { test } from "node:test";
import assert from "node:assert/strict";
import {
  civibyteClientAttemptId,
  civibyteDoorOutcome,
  parseCivibyteAddress,
} from "./map";

test("maps Civibyte door results to StrideVote outcomes", () => {
  assert.equal(civibyteDoorOutcome("CONTACT"), "contact");
  assert.equal(civibyteDoorOutcome("NO_ANSWER"), "no_answer");
  assert.equal(civibyteDoorOutcome("LIT_DROPPED"), "lit");
  assert.equal(civibyteDoorOutcome("OTHER"), null);
  assert.equal(civibyteDoorOutcome(null), null);
});

test("parses Civibyte complete addresses with units", () => {
  assert.deepEqual(
    parseCivibyteAddress("1115 N 183RD ST, # 204, SHORELINE, WA 98133"),
    {
      registrationAddress: "1115 N 183RD ST, # 204",
      city: "SHORELINE",
      state: "WA",
      postalCode: "98133",
    },
  );
});

test("builds stable Civibyte attempt ids", () => {
  assert.equal(
    civibyteClientAttemptId("list-1", "door-1", "2026-09-17T04:00:00Z"),
    "civibyte:list-1:door-1:2026-09-17T04:00:00.000Z",
  );
});
