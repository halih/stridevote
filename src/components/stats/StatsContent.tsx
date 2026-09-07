"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { fmt } from "@/lib/format";
import type { StatsViewData } from "@/lib/achievements/types";
import { WeeklyDoorsChart } from "@/components/stats/WeeklyDoorsChart";
import { AchievementUnlockSheet } from "@/components/stats/AchievementUnlockSheet";

export function StatsContent({ data }: { data: StatsViewData }) {
  const router = useRouter();
  const maxOutcome = Math.max(...data.outcomes.map((o) => o.count), 1);
  const maxBreak = Math.max(...data.breakdown.map((b) => b.doors), 1);
  const scoped = data.campaigns.find((c) => c.id === data.campaignId);
  const heroLabel = scoped
    ? `Doors knocked · ${scoped.name}`
    : "Doors knocked, all time";

  function selectScope(next: string | null) {
    if (!next) {
      router.push("/stats");
      return;
    }
    router.push(`/stats?campaign=${encodeURIComponent(next)}`);
  }

  return (
    <>
      {data.campaigns.length > 0 ? (
        <section className="section">
          <div className="stats-scope-scroll" role="tablist" aria-label="Stats scope">
            <button
              type="button"
              role="tab"
              aria-selected={!data.campaignId}
              className={`stats-scope-pill${!data.campaignId ? " active" : ""}`}
              onClick={() => selectScope(null)}
            >
              Overall
            </button>
            {data.campaigns.map((c) => (
              <button
                key={c.id}
                type="button"
                role="tab"
                aria-selected={data.campaignId === c.id}
                className={`stats-scope-pill${data.campaignId === c.id ? " active" : ""}`}
                style={
                  data.campaignId === c.id
                    ? { ["--scope-color" as string]: c.color }
                    : undefined
                }
                onClick={() => selectScope(c.id)}
              >
                <span className="stats-scope-dot" style={{ background: c.color }} />
                {c.name}
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {data.empty ? (
        <section className="section">
          <div className="card empty-state">
            <Icon name="bars" size={28} style={{ color: "var(--ink-faint)", marginBottom: 8 }} />
            <p style={{ margin: 0, fontWeight: 600, color: "var(--ink)" }}>No results yet</p>
            <p style={{ margin: "6px 0 0", fontSize: 13 }}>
              Check out a list to start tracking your impact.
            </p>
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="card hero-stat">
          <span className="stat-label">{heroLabel}</span>
          <div className="hero-num">{fmt(data.doorsKnocked)}</div>
          <WeeklyDoorsChart values={data.weeklyHistory} />
        </div>
      </section>

      <section className="section">
        <div className="stat-grid">
          <div className="card stat-tile">
            <span className="stat-label">Voters reached</span>
            <div className="stat-value">{fmt(data.votersReached)}</div>
          </div>
          <div className="card stat-tile">
            <span className="stat-label">Response rate</span>
            <div className="stat-value">{data.responseRate}%</div>
          </div>
          <div className="card stat-tile">
            <span className="stat-label">Lists checked out</span>
            <div className="stat-value">{fmt(data.listsCheckedOut)}</div>
          </div>
          <div className="card stat-tile">
            {data.campaignId ? (
              <>
                <span className="stat-label">Lists completed</span>
                <div className="stat-value">{fmt(data.listsCompleted)}</div>
              </>
            ) : (
              <>
                <span className="stat-label">Campaigns joined</span>
                <div className="stat-value">{fmt(data.campaignsJoined)}</div>
              </>
            )}
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Door outcomes</span>
        </div>
        <div className="card">
          {data.outcomes.every((o) => o.count === 0) ? (
            <p className="empty-state" style={{ padding: "18px 8px" }}>
              No door results in this scope yet.
            </p>
          ) : (
            data.outcomes.map((o) => (
              <div key={o.key} className="bar-row">
                <span className="bar-dot" style={{ background: o.color }} />
                <span className="bar-label">{o.label}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${(o.count / maxOutcome) * 100}%`,
                      background: o.color,
                    }}
                  />
                </div>
                <span className="bar-value">{fmt(o.count)}</span>
              </div>
            ))
          )}
        </div>
      </section>

      {!data.campaignId && data.breakdown.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <span className="eyebrow">By campaign</span>
          </div>
          <div className="card">
            {data.breakdown.map((b) => (
              <button
                key={b.id}
                type="button"
                className="bar-row stats-break-row"
                onClick={() => selectScope(b.id)}
              >
                <span className="bar-dot" style={{ background: b.color }} />
                <span className="bar-label">{b.name}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{
                      width: `${(b.doors / maxBreak) * 100}%`,
                      background: b.color,
                    }}
                  />
                </div>
                <span className="bar-value">{fmt(b.doors)}</span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="section">
        <div className="section-head">
          <span className="eyebrow">Achievements</span>
          <Link href="/stats/achievements" className="section-sub section-link">
            See all
          </Link>
        </div>
        <div className="badge-grid">
          {data.achievements.map((a) => (
            <div
              key={a.id}
              className={`card badge-tile ${a.earned ? "earned" : "locked"}`}
            >
              <div className="badge-icon">
                <Icon name={a.earned ? a.icon : "lock"} size={17} />
              </div>
              <p className="badge-title">{a.title}</p>
              <p className="badge-desc">{a.desc}</p>
              {!a.earned ? (
                <div className="badge-progress">
                  <div
                    className="badge-progress-fill"
                    style={{ width: `${a.progress * 100}%` }}
                  />
                </div>
              ) : null}
              <span className="badge-meta">{a.progressLabel}</span>
            </div>
          ))}
        </div>
      </section>

      {data.doorsKnocked > 0 && data.leaderboard.length > 0 ? (
        <section className="section">
          <div className="section-head">
            <span className="eyebrow">Leaderboard</span>
            {data.rank > 0 ? (
              <span className="section-sub">You&apos;re #{data.rank}</span>
            ) : null}
          </div>
          <div className="card">
            {data.leaderboard.slice(0, 8).map((e, i) => (
              <div key={e.userId} className="leaderboard-row">
                <span className="leaderboard-rank">{i + 1}</span>
                <span className={`leaderboard-name${e.you ? " you" : ""}`}>
                  {e.name}
                </span>
                <span className="leaderboard-doors">{fmt(e.doors)} doors</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <AchievementUnlockSheet
        key={data.unseenUnlocks.map((u) => u.unlockId).join(",") || "none"}
        unlocks={data.unseenUnlocks}
      />
    </>
  );
}
