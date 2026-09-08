import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  displayProgressiveScore,
  progressiveScoreLabel,
} from "@/lib/canvass/progressive-score";

describe("progressive score", () => {
  it("labels known values and unknown", () => {
    assert.equal(progressiveScoreLabel(5), "Very progressive");
    assert.equal(progressiveScoreLabel(0), "Republican");
    assert.equal(progressiveScoreLabel(null), "Unknown");
  });

  it("prefers recent talk over observed", () => {
    const now = new Date("2026-09-07T12:00:00.000Z");
    const result = displayProgressiveScore({
      talkScore: 4,
      scoreUpdatedAt: "2026-06-01T00:00:00.000Z",
      observedScore: 0,
      observedScoreAt: "2026-08-01T00:00:00.000Z",
      now,
    });
    assert.deepEqual(result, { score: 4, source: "talk" });
  });

  it("falls back to observed when talk is missing", () => {
    const now = new Date("2026-09-07T12:00:00.000Z");
    const result = displayProgressiveScore({
      talkScore: null,
      scoreUpdatedAt: null,
      observedScore: 2,
      observedScoreAt: "2026-08-01T00:00:00.000Z",
      now,
    });
    assert.deepEqual(result, { score: 2, source: "observed" });
  });
});
