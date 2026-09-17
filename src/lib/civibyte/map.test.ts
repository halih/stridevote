import { test } from "node:test";
import assert from "node:assert/strict";
import {
  civibyteClientAttemptId,
  civibyteDoorOutcome,
  civibyteDoorResult,
  matchCivibyteSessionDoor,
  parseCivibyteAddress,
} from "./map";

test("maps Civibyte door results to StrideVote outcomes", () => {
  assert.equal(civibyteDoorOutcome("CONTACT"), "contact");
  assert.equal(civibyteDoorOutcome("NO_ANSWER"), "no_answer");
  assert.equal(civibyteDoorOutcome("LIT_DROPPED"), "lit");
  assert.equal(civibyteDoorOutcome("OTHER"), null);
  assert.equal(civibyteDoorOutcome(null), null);
});

test("maps StrideVote outcomes to Civibyte door results", () => {
  assert.equal(civibyteDoorResult("contact"), "CONTACT");
  assert.equal(civibyteDoorResult("no_answer"), "NO_ANSWER");
  assert.equal(civibyteDoorResult("lit"), "LIT_DROPPED");
  assert.equal(civibyteDoorResult("moved"), null);
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

test("matches rebuilt session doors by addressPk when ids change", () => {
  const imported = { id: "old-session-door", addressPk: "stable-address" };
  const rebuilt = { id: "new-session-door", addressPk: "stable-address" };
  const byId = new Map([[rebuilt.id, rebuilt]]);
  const byAddressPk = new Map([[rebuilt.addressPk, rebuilt]]);

  assert.equal(
    matchCivibyteSessionDoor(imported.id, imported.addressPk, byId, byAddressPk),
    rebuilt,
  );
  assert.equal(
    matchCivibyteSessionDoor(rebuilt.id, imported.addressPk, byId, byAddressPk),
    rebuilt,
  );
  assert.equal(
    matchCivibyteSessionDoor("missing", "other-address", byId, byAddressPk),
    undefined,
  );
});

test("builds stable Civibyte attempt ids", () => {
  assert.equal(
    civibyteClientAttemptId("list-1", "door-1", "2026-09-17T04:00:00Z"),
    "civibyte:list-1:door-1:2026-09-17T04:00:00.000Z",
  );
});
