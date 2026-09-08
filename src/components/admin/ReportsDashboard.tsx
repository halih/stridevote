"use client";

import { useMemo, useState } from "react";
import type { CampaignReportsView } from "@/lib/canvass/admin-reports";
import { DOOR_OUTCOMES, DOOR_OUTCOME_LABELS } from "@/lib/canvass/outcomes";

const OUTCOME_COLORS: Record<string, string> = {
  contact: "#2e9e5b",
  no_answer: "#8a8f98",
  refused: "#c44c4c",
  lit: "#c97a2e",
  unsafe: "#8b5a2b",
  inaccessible: "#5a6472",
  moved: "#6b5b95",
};

function formatDay(isoDay: string): string {
  const [y, m, d] = isoDay.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

export function ReportsDashboard({ view }: { view: CampaignReportsView }) {
  return (
    <div className="stack reports-dashboard">
      <section className="section">
        <div className="section-head">
          <span className="eyebrow">{view.programName}</span>
        </div>
        <div className="results-grid">
          <div className="results-stat">
            <b>{view.headlines.doorsDone}</b>
            <span>Doors done</span>
          </div>
          <div className="results-stat">
            <b>{view.headlines.doorsRemaining}</b>
            <span>Remaining</span>
          </div>
          <div className="results-stat">
            <b>{view.headlines.pctComplete}%</b>
            <span>Complete</span>
          </div>
          <div className="results-stat">
            <b>{view.headlines.doorsToday}</b>
            <span>Today</span>
          </div>
          <div className="results-stat">
            <b>{view.headlines.doorsLast7}</b>
            <span>Last 7 days</span>
          </div>
          <div className="results-stat">
            <b>
              {view.headlines.canvassersThisWeek}/{view.headlines.membersActive}
            </b>
            <span>Walked this week / members</span>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Doors over time</span>
        </div>
        <div className="card">
          <PaceChart rows={view.pace} />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Outcome mix</span>
        </div>
        <div className="results-grid" style={{ marginBottom: 12 }}>
          <div className="results-stat">
            <b>{view.headlines.contactRate}%</b>
            <span>Contact rate</span>
          </div>
          <div className="results-stat">
            <b>{view.headlines.noAnswerRate}%</b>
            <span>Not home</span>
          </div>
          <div className="results-stat">
            <b>{view.headlines.refuseRate}%</b>
            <span>Refuse rate</span>
          </div>
        </div>
        <div className="card" style={{ marginBottom: 12 }}>
          <StackedOutcomesChart rows={view.outcomesByDay} />
        </div>
        <div className="card">
          <DonutChart
            slices={view.outcomeTotals.map((o) => ({
              key: o.key,
              label: o.label,
              count: o.count,
              color: OUTCOME_COLORS[o.key] ?? "#8a8f98",
            }))}
            empty="No outcomes in this range."
          />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Survey</span>
          <span className="pill pill-neutral">
            {view.headlines.movedVoters} moved
          </span>
        </div>
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 className="report-chart-title">Race support (1–5)</h3>
          <HorizontalBars
            rows={view.supportIds.map((s) => ({
              label: String(s.score),
              count: s.count,
            }))}
            empty="No support IDs yet."
          />
        </div>
        {view.questionCharts.map((q) => (
          <div key={q.id} className="card" style={{ marginBottom: 12 }}>
            <h3 className="report-chart-title">{q.label}</h3>
            {q.type === "text" ? (
              q.textResponses.length ? (
                <ul className="report-text-list">
                  {q.textResponses.map((row) => (
                    <li key={row.text}>
                      <span>{row.text}</span>
                      <b>{row.count}</b>
                    </li>
                  ))}
                </ul>
              ) : (
                <div className="empty-state">No text responses yet.</div>
              )
            ) : (
              <HorizontalBars rows={q.bars} empty="No answers yet." />
            )}
          </div>
        ))}
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Progressive score (this wave)</span>
        </div>
        <div className="results-grid" style={{ marginBottom: 12 }}>
          <div className="results-stat">
            <b>{view.progressiveHeadlines.observedScored}</b>
            <span>Observed scored</span>
          </div>
          <div className="results-stat">
            <b>{view.progressiveHeadlines.talkScored}</b>
            <span>Talk scored</span>
          </div>
          <div className="results-stat">
            <b>{view.progressiveHeadlines.talkPct0}%</b>
            <span>Talk Republican (0)</span>
          </div>
          <div className="results-stat">
            <b>{view.progressiveHeadlines.talkPct45}%</b>
            <span>Talk 4–5</span>
          </div>
        </div>
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 className="report-chart-title">Observed (doors)</h3>
          <DonutChart
            slices={view.progressiveObserved.map((r, i) => ({
              key: r.key,
              label: r.label,
              count: r.count,
              color: SCORE_COLORS[i % SCORE_COLORS.length],
            }))}
            empty="No observed scores yet."
          />
        </div>
        <div className="card">
          <h3 className="report-chart-title">From talk (people)</h3>
          <DonutChart
            slices={view.progressiveTalk.map((r, i) => ({
              key: r.key,
              label: r.label,
              count: r.count,
              color: SCORE_COLORS[i % SCORE_COLORS.length],
            }))}
            empty="No talk scores yet."
          />
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Coverage by list</span>
        </div>
        <div className="card" style={{ marginBottom: 12 }}>
          <HorizontalBars
            rows={view.coverage.slice(0, 15).map((c) => ({
              label: `${c.name} (${c.remaining} left)`,
              count: c.remaining,
            }))}
            empty="No lists in this wave."
          />
        </div>
        <div className="card">
          {view.coverage.length ? (
            view.coverage.map((c) => (
              <div key={c.listId} className="member-row">
                <div>
                  <p className="member-name">{c.name}</p>
                  <p className="member-contact">
                    {c.closed}/{c.doors} done ({c.pct}%)
                    {c.checkedOutBy ? ` · with ${c.checkedOutBy}` : ""}
                  </p>
                </div>
                <b>{c.remaining} left</b>
              </div>
            ))
          ) : (
            <div className="empty-state">No lists yet.</div>
          )}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Volunteers</span>
        </div>
        <div className="card" style={{ marginBottom: 12 }}>
          <h3 className="report-chart-title">This range · top 10</h3>
          <HorizontalBars
            rows={view.volunteers.slice(0, 10).map((v) => ({
              label: `${v.name} (${v.contacts} contacts)`,
              count: v.doors,
            }))}
            empty="No volunteer activity in this range."
          />
        </div>
        <div className="card">
          {view.volunteers.length ? (
            view.volunteers.map((v) => (
              <div key={v.userId} className="member-row">
                <div>
                  <p className="member-name">{v.name}</p>
                  <p className="member-contact">
                    {v.contacts} contacts
                    {v.lastActivity
                      ? ` · last ${new Date(v.lastActivity).toLocaleString()}`
                      : ""}
                  </p>
                </div>
                <b>{v.doors}</b>
              </div>
            ))
          ) : (
            <div className="empty-state">No volunteer activity yet.</div>
          )}
        </div>
      </section>
    </div>
  );
}

const SCORE_COLORS = [
  "#c44c4c",
  "#d97845",
  "#c9a227",
  "#6aa84f",
  "#3d85c6",
  "#674ea7",
  "#8a8f98",
];

function PaceChart({
  rows,
}: {
  rows: Array<{ day: string; doors: number; contacts: number }>;
}) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...rows.map((r) => r.doors), 1);
  const { doorPts, contactPts, w, h } = useMemo(() => {
    const width = 320;
    const height = 100;
    const padX = 10;
    const padY = 12;
    const n = rows.length || 1;
    const step = n === 1 ? 0 : (width - padX * 2) / (n - 1);
    const map = (values: number[]) =>
      values.map((v, i) => ({
        x: padX + i * step,
        y: height - padY - (v / max) * (height - padY * 2),
        v,
        i,
      }));
    return {
      doorPts: map(rows.map((r) => r.doors)),
      contactPts: map(rows.map((r) => r.contacts)),
      w: width,
      h: height,
    };
  }, [rows, max]);

  if (!rows.length) {
    return <div className="empty-state">No door results in this range.</div>;
  }

  const tip = active != null ? rows[active] : null;

  return (
    <div className="week-chart">
      <svg
        className="week-chart-svg"
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Doors and contacts over time"
      >
        <path
          d={doorPts
            .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
            .join(" ")}
          fill="none"
          stroke="var(--accent)"
          strokeWidth="2.5"
        />
        <path
          d={contactPts
            .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
            .join(" ")}
          fill="none"
          stroke="#2e9e5b"
          strokeWidth="2"
          strokeDasharray="4 3"
        />
        {doorPts.map((c) => (
          <circle
            key={c.i}
            cx={c.x}
            cy={c.y}
            r={active === c.i ? 5 : 3}
            fill="var(--accent)"
            className="week-chart-dot"
            onClick={() => setActive((prev) => (prev === c.i ? null : c.i))}
          />
        ))}
      </svg>
      <div className="spark-labels">
        <span>{formatDay(rows[0].day)}</span>
        <span>{formatDay(rows[rows.length - 1].day)}</span>
      </div>
      <div className="row" style={{ gap: 12, marginTop: 6, fontSize: 12 }}>
        <span>
          <span style={{ color: "var(--accent)" }}>●</span> Doors
        </span>
        <span>
          <span style={{ color: "#2e9e5b" }}>●</span> Contacts
        </span>
      </div>
      {tip ? (
        <div className="week-chart-tip" role="status">
          <strong>{tip.doors}</strong> doors · <strong>{tip.contacts}</strong>{" "}
          contacts · {formatDay(tip.day)}
        </div>
      ) : (
        <div className="week-chart-tip muted">Tap a point for details</div>
      )}
    </div>
  );
}

function StackedOutcomesChart({
  rows,
}: {
  rows: Array<{ day: string; counts: Record<string, number> }>;
}) {
  if (!rows.length) {
    return <div className="empty-state">No outcomes in this range.</div>;
  }
  const max = Math.max(
    ...rows.map((r) => Object.values(r.counts).reduce((s, n) => s + n, 0)),
    1,
  );
  const keys = DOOR_OUTCOMES.filter((k) =>
    rows.some((r) => (r.counts[k] ?? 0) > 0),
  );

  return (
    <div>
      <div className="report-stack-chart" role="img" aria-label="Outcomes by day">
        {rows.map((row) => {
          const total = Object.values(row.counts).reduce((s, n) => s + n, 0);
          const heightPct = (total / max) * 100;
          return (
            <div key={row.day} className="report-stack-col" title={formatDay(row.day)}>
              <div className="report-stack-bar" style={{ height: `${heightPct}%` }}>
                {keys.map((key) => {
                  const count = row.counts[key] ?? 0;
                  if (!count || !total) return null;
                  return (
                    <div
                      key={key}
                      style={{
                        flex: count,
                        background: OUTCOME_COLORS[key] ?? "#8a8f98",
                      }}
                      title={`${DOOR_OUTCOME_LABELS[key]}: ${count}`}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="spark-labels">
        <span>{formatDay(rows[0].day)}</span>
        <span>{formatDay(rows[rows.length - 1].day)}</span>
      </div>
    </div>
  );
}

function DonutChart({
  slices,
  empty,
}: {
  slices: Array<{ key: string; label: string; count: number; color: string }>;
  empty: string;
}) {
  const total = slices.reduce((s, x) => s + x.count, 0);
  if (!total) return <div className="empty-state">{empty}</div>;

  const r = 42;
  const c = 2 * Math.PI * r;
  let offset = 0;
  const arcs = slices
    .filter((s) => s.count > 0)
    .map((s) => {
      const len = (s.count / total) * c;
      const arc = { ...s, dash: len, offset };
      offset += len;
      return arc;
    });

  return (
    <div className="report-donut">
      <svg viewBox="0 0 120 120" width={140} height={140} aria-hidden>
        <g transform="translate(60,60) rotate(-90)">
          {arcs.map((a) => (
            <circle
              key={a.key}
              r={r}
              fill="none"
              stroke={a.color}
              strokeWidth="16"
              strokeDasharray={`${a.dash} ${c - a.dash}`}
              strokeDashoffset={-a.offset}
            />
          ))}
        </g>
        <text
          x="60"
          y="58"
          textAnchor="middle"
          fontSize="18"
          fontWeight="700"
          fill="currentColor"
        >
          {total}
        </text>
        <text x="60" y="74" textAnchor="middle" fontSize="10" fill="currentColor">
          total
        </text>
      </svg>
      <div className="report-donut-legend">
        {slices
          .filter((s) => s.count > 0)
          .map((s) => (
            <div key={s.key} className="member-row">
              <span>
                <span
                  className="report-swatch"
                  style={{ background: s.color }}
                />{" "}
                {s.label}
              </span>
              <b>{s.count}</b>
            </div>
          ))}
      </div>
    </div>
  );
}

function HorizontalBars({
  rows,
  empty,
}: {
  rows: Array<{ label: string; count: number }>;
  empty: string;
}) {
  const max = Math.max(...rows.map((r) => r.count), 0);
  if (!max) return <div className="empty-state">{empty}</div>;
  return (
    <div className="report-bars">
      {rows.map((row) => (
        <div key={row.label} className="report-bar-row">
          <div className="report-bar-label">{row.label}</div>
          <div className="report-bar-track">
            <div
              className="report-bar-fill"
              style={{ width: `${(row.count / max) * 100}%` }}
            />
          </div>
          <b>{row.count}</b>
        </div>
      ))}
    </div>
  );
}
