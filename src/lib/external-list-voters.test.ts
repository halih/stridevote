import assert from "node:assert/strict";
import { test } from "node:test";
import { expandExternalListVoters } from "./external-list-voters";

test("external imports include every campaign voter at an imported door", () => {
  assert.deepEqual(
    expandExternalListVoters(
      [
        { voterId: "target", vanId: 42 },
        { voterId: "target", vanId: 43 },
      ],
      ["target", "roommate", "roommate"],
    ),
    [
      { voterId: "target", matchedSeed: true, vanId: 42 },
      { voterId: "roommate", matchedSeed: false },
    ],
  );
});
