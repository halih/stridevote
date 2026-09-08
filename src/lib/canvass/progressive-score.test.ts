import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  displayProgressiveScore,
  progressiveScoreCaption,
  progressiveScoreFromLikelyParty,
  progressiveScoreLabel,
} from "@/lib/canvass/progressive-score";

describe("progressive score", () => {
  it("labels known values and unknown", () => {
    assert.equal(progressiveScoreLabel(5), "Very progressive");
    assert.equal(progressiveScoreLabel(0), "Republican");
    assert.equal(progressiveScoreLabel(null), "Unknown");
  });

  it("maps VAN likely party onto progressive scores", () => {
    assert.equal(progressiveScoreFromLikelyParty("SD"), 3);
    assert.equal(progressiveScoreFromLikelyParty("ld"), 3);
    assert.equal(progressiveScoreFromLikelyParty("SR"), 0);
    assert.equal(progressiveScoreFromLikelyParty("LR"), 0);
    assert.equal(progressiveScoreFromLikelyParty("ND"), null);
    assert.equal(progressiveScoreFromLikelyParty("ID"), null);
    assert.equal(progressiveScoreFromLikelyParty("U"), null);
    assert.equal(progressiveScoreFromLikelyParty(null), null);
  });

  it("attributes MiniVAN-seeded scores as import", () => {
    const now = new Date("2026-09-07T12:00:00.000Z");
    const result = displayProgressiveScore({
      talkScore: 0,
      scoreUpdatedAt: "2026-09-07T00:00:00.000Z",
      scoreSource: "import",
      observedScore: null,
      observedScoreAt: null,
      now,
    });
    assert.deepEqual(result, { score: 0, source: "import" });
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

  it("omits a caption when the score is stale or missing", () => {
    const now = new Date("2026-09-07T12:00:00.000Z");
    assert.equal(
      progressiveScoreCaption({
        talkScore: 0,
        scoreUpdatedAt: "2023-01-01T00:00:00.000Z",
        observedScore: null,
        observedScoreAt: null,
        now,
      }),
      null,
    );
    assert.equal(
      progressiveScoreCaption({
        talkScore: 3,
        scoreUpdatedAt: "2026-06-01T00:00:00.000Z",
        scoreSource: "import",
        observedScore: null,
        observedScoreAt: null,
        now,
      }),
      "Liberal",
    );
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
