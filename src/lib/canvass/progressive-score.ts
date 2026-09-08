/** Volunteer-only progressive / ideology thermometer (not race support). */

export const PROGRESSIVE_SCORES = [0, 1, 2, 3, 4, 5] as const;

export type ProgressiveScore = (typeof PROGRESSIVE_SCORES)[number];

export const PROGRESSIVE_SCORE_LABELS: Record<ProgressiveScore, string> = {
  5: "Very progressive",
  4: "Progressive",
  3: "Liberal",
  2: "Moderate",
  1: "Conservative Democrat",
  0: "Republican",
};

export const TALK_SCORE_MAX_AGE_MS = 24 * 30 * 24 * 60 * 60 * 1000; // ~24 months
export const OBSERVED_SCORE_MAX_AGE_MS = 12 * 30 * 24 * 60 * 60 * 1000; // ~12 months

export function isProgressiveScore(value: unknown): value is ProgressiveScore {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= 5
  );
}

export function progressiveScoreLabel(
  value: number | null | undefined,
): string {
  if (value == null || !isProgressiveScore(value)) return "Unknown";
  return PROGRESSIVE_SCORE_LABELS[value];
}

/** Prefer recent talk score, else recent observed, else unknown. Never average. */
export function displayProgressiveScore(opts: {
  talkScore: number | null | undefined;
  scoreUpdatedAt: Date | string | null | undefined;
  observedScore: number | null | undefined;
  observedScoreAt: Date | string | null | undefined;
  now?: Date;
}): {
  score: ProgressiveScore | null;
  source: "talk" | "observed" | null;
} {
  const now = opts.now ?? new Date();
  const talkAt = opts.scoreUpdatedAt ? new Date(opts.scoreUpdatedAt) : null;
  if (
    isProgressiveScore(opts.talkScore) &&
    talkAt &&
    now.getTime() - talkAt.getTime() <= TALK_SCORE_MAX_AGE_MS
  ) {
    return { score: opts.talkScore, source: "talk" };
  }
  const observedAt = opts.observedScoreAt
    ? new Date(opts.observedScoreAt)
    : null;
  if (
    isProgressiveScore(opts.observedScore) &&
    observedAt &&
    now.getTime() - observedAt.getTime() <= OBSERVED_SCORE_MAX_AGE_MS
  ) {
    return { score: opts.observedScore, source: "observed" };
  }
  return { score: null, source: null };
}
