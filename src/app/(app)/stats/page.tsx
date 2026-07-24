import { redirect } from "next/navigation";
import { getSessionUser, initialsFor } from "@/lib/session";
import { getStatsView } from "@/lib/data";
import { TopBar } from "@/components/TopBar";
import { Icon } from "@/components/Icon";
import { fmt } from "@/lib/format";

export default async function StatsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const s = await getStatsView(user);
  const initials = user.initials || initialsFor(user.name);
  const maxWeek = Math.max(...s.weeklyHistory, 1);
  const maxOutcome = Math.max(...s.outcomes.map((o) => o.count), 1);
  const maxBreak = Math.max(...s.breakdown.map((b) => b.doors), 1);

  return (
    <>
      <TopBar title="Your impact" subtitle="Progress across your campaigns" initials={initials} />
      <div className="content">
        <section className="section">
          <div className="card hero-stat">
            <span className="stat-label">Doors knocked, all time</span>
            <div className="hero-num">{fmt(s.doorsKnocked)}</div>
            <div className="spark-row">
              {s.weeklyHistory.map((v, i) => (
                <div
                  key={i}
                  className={`spark-bar${i === s.weeklyHistory.length - 1 ? " now" : ""}`}
                  style={{ height: `${Math.max(6, (v / maxWeek) * 100)}%` }}
                />
              ))}
            </div>
            <div className="spark-labels">
              <span>8 wks ago</span>
              <span>This week</span>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="stat-grid">
            <div className="card stat-tile">
              <span className="stat-label">Voters reached</span>
              <div className="stat-value">{fmt(s.votersReached)}</div>
            </div>
            <div className="card stat-tile">
              <span className="stat-label">Response rate</span>
              <div className="stat-value">{s.responseRate}%</div>
            </div>
            <div className="card stat-tile">
              <span className="stat-label">Lists checked out</span>
              <div className="stat-value">{s.listsCheckedOut}</div>
            </div>
            <div className="card stat-tile">
              <span className="stat-label">Campaigns joined</span>
              <div className="stat-value">{s.campaignsJoined}</div>
            </div>
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <span className="eyebrow">Door outcomes</span>
          </div>
          <div className="card">
            {s.outcomes.map((o) => (
              <div key={o.key} className="bar-row">
                <span className="bar-dot" style={{ background: o.color }} />
                <span className="bar-label">{o.label}</span>
                <div className="bar-track">
                  <div
                    className="bar-fill"
                    style={{ width: `${(o.count / maxOutcome) * 100}%`, background: o.color }}
                  />
                </div>
                <span className="bar-value">{fmt(o.count)}</span>
              </div>
            ))}
          </div>
        </section>

        {s.breakdown.length ? (
          <section className="section">
            <div className="section-head">
              <span className="eyebrow">By campaign</span>
            </div>
            <div className="card">
              {s.breakdown.map((b) => (
                <div key={b.name} className="bar-row">
                  <span className="bar-dot" style={{ background: b.color }} />
                  <span className="bar-label">{b.name}</span>
                  <div className="bar-track">
                    <div
                      className="bar-fill"
                      style={{ width: `${(b.doors / maxBreak) * 100}%`, background: b.color }}
                    />
                  </div>
                  <span className="bar-value">{fmt(b.doors)}</span>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="section">
          <div className="section-head">
            <span className="eyebrow">Achievements</span>
          </div>
          <div className="badge-grid">
            {s.achievements.map((a) => (
              <div key={a.id} className={`card badge-tile ${a.earned ? "earned" : "locked"}`}>
                <div className="badge-icon">
                  <Icon name={a.earned ? "trophy" : "lock"} size={17} />
                </div>
                <p className="badge-title">{a.title}</p>
                <p className="badge-desc">{a.desc}</p>
                {!a.earned ? (
                  <div className="badge-progress">
                    <div className="badge-progress-fill" style={{ width: `${a.progress * 100}%` }} />
                  </div>
                ) : null}
                <span className="badge-meta">{a.progressLabel}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="section">
          <div className="section-head">
            <span className="eyebrow">Leaderboard</span>
            <span className="section-sub">You&apos;re #{s.rank}</span>
          </div>
          <div className="card">
            {s.leaderboard.slice(0, 8).map((e, i) => (
              <div key={`${e.name}-${i}`} className="leaderboard-row">
                <span className="leaderboard-rank">{i + 1}</span>
                <span className={`leaderboard-name${e.you ? " you" : ""}`}>{e.name}</span>
                <span className="leaderboard-doors">{fmt(e.doors)} doors</span>
              </div>
            ))}
          </div>
          {s.isSample ? (
            <p className="stat-note">
              <Icon name="clock" size={13} /> Outcome metrics include sample data pending stats
              import from your canvassing platform.
            </p>
          ) : null}
        </section>
      </div>
    </>
  );
}
