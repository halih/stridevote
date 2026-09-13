import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { votedInRelatedPrimary } from "@/lib/elections";

describe("votedInRelatedPrimary", () => {
  it("matches a primary ballot to a General wave in the same year", () => {
    assert.equal(
      votedInRelatedPrimary("general", "2026-11-03", [
        "2024-08-06",
        "2026-08-04",
      ]),
      true,
    );
  });

  it("does not show participation from another year or on a Primary wave", () => {
    assert.equal(
      votedInRelatedPrimary("general", "2026-11-03", ["2024-08-06"]),
      false,
    );
    assert.equal(
      votedInRelatedPrimary("primary", "2026-08-04", ["2026-08-04"]),
      false,
    );
  });
});
