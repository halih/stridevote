"use client";

import { useMemo, useState } from "react";
import { fmt } from "@/lib/format";

export function WeeklyDoorsChart({ values }: { values: number[] }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...values, 1);

  const { points, area } = useMemo(() => {
    const w = 280;
    const h = 88;
    const padX = 8;
    const padY = 10;
    const n = values.length || 1;
    const step = n === 1 ? 0 : (w - padX * 2) / (n - 1);
    const coords = values.map((v, i) => {
      const x = padX + i * step;
      const y = h - padY - (v / max) * (h - padY * 2);
      return { x, y, v, i };
    });
    const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(" ");
    const areaPath =
      coords.length > 0
        ? `${line} L${coords[coords.length - 1].x.toFixed(1)},${(h - padY).toFixed(1)} L${coords[0].x.toFixed(1)},${(h - padY).toFixed(1)} Z`
        : "";
    return { points: coords, area: areaPath, line, w, h };
  }, [values, max]);

  const tip = active != null ? points[active] : null;
  const weeksAgo = tip != null ? values.length - 1 - tip.i : 0;
  const tipLabel =
    tip == null
      ? null
      : tip.i === values.length - 1
        ? "This week"
        : weeksAgo === 1
          ? "1 week ago"
          : `${weeksAgo} weeks ago`;

  return (
    <div className="week-chart">
      <svg
        className="week-chart-svg"
        viewBox="0 0 280 88"
        role="img"
        aria-label="Doors knocked over the last 8 weeks"
      >
        <defs>
          <linearGradient id="weekFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {area ? <path d={area} fill="url(#weekFill)" /> : null}
        {points.length > 1 ? (
          <path
            d={points
              .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
              .join(" ")}
            fill="none"
            stroke="var(--accent)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : null}
        {points.map((c) => (
          <circle
            key={c.i}
            cx={c.x}
            cy={c.y}
            r={active === c.i ? 5 : 3.5}
            fill={active === c.i ? "var(--accent-ink)" : "var(--accent)"}
            stroke="var(--surface)"
            strokeWidth="1.5"
            className="week-chart-dot"
            onClick={() => setActive((prev) => (prev === c.i ? null : c.i))}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setActive((prev) => (prev === c.i ? null : c.i));
              }
            }}
            tabIndex={0}
            role="button"
            aria-label={`Week ${c.i + 1}: ${c.v} doors`}
          />
        ))}
      </svg>
      <div className="spark-labels">
        <span>8 wks ago</span>
        <span>This week</span>
      </div>
      {tip ? (
        <div className="week-chart-tip" role="status">
          <strong>{fmt(tip.v)}</strong> door{tip.v === 1 ? "" : "s"} · {tipLabel}
        </div>
      ) : (
        <div className="week-chart-tip muted">Tap a point for details</div>
      )}
    </div>
  );
}
