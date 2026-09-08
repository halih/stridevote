"use client";

import {
  PROGRESSIVE_SCORES,
  PROGRESSIVE_SCORE_LABELS,
  progressiveScoreLabel,
  type ProgressiveScore,
} from "@/lib/canvass/progressive-score";

export function ProgressiveScoreControl({
  label,
  value,
  onChange,
}: {
  label: string;
  value: ProgressiveScore | null;
  onChange: (value: ProgressiveScore | null) => void;
}) {
  return (
    <div className="progressive-score-control">
      <span className="field-label">{label}</span>
      <div
        className="progressive-score-buttons"
        role="group"
        aria-label={label}
      >
        <button
          type="button"
          className={`progressive-score-btn ${value == null ? "active" : ""}`}
          title="Unknown"
          aria-label="Unknown"
          aria-pressed={value == null}
          onClick={() => onChange(null)}
        >
          ?
        </button>
        {PROGRESSIVE_SCORES.map((n) => (
          <button
            key={n}
            type="button"
            className={`progressive-score-btn ${value === n ? "active" : ""}`}
            title={PROGRESSIVE_SCORE_LABELS[n]}
            aria-label={`${n}: ${PROGRESSIVE_SCORE_LABELS[n]}`}
            aria-pressed={value === n}
            onClick={() => onChange(n)}
          >
            {n}
          </button>
        ))}
      </div>
      <p className="progressive-score-caption">
        {progressiveScoreLabel(value)}
      </p>
    </div>
  );
}
