import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, initialsFor } from "@/lib/session";
import { getAchievementsListView } from "@/lib/data";
import { TopBar } from "@/components/TopBar";
import { Icon } from "@/components/Icon";

export default async function AchievementsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const view = await getAchievementsListView(user);
  const initials = user.initials || initialsFor(user.name);
  const overall = view.items.filter((i) => i.scope === "overall");
  const byCampaign = new Map<string, typeof view.items>();
  for (const item of view.items) {
    if (item.scope !== "campaign" || !item.campaignId) continue;
    const list = byCampaign.get(item.campaignId) ?? [];
    list.push(item);
    byCampaign.set(item.campaignId, list);
  }

  return (
    <>
      <TopBar
        title="Achievements"
        subtitle={`${view.earnedCount} of ${view.totalCount} earned`}
        initials={initials}
      />
      <div className="content">
        <Link href="/stats" className="back-link">
          <Icon name="chevronLeft" size={15} /> Stats
        </Link>

        <section className="section">
          <div className="section-head">
            <span className="eyebrow">Overall</span>
          </div>
          <div className="card achievement-list">
            {overall.map((a) => (
              <div
                key={a.rowKey}
                className={`achievement-row${a.earned ? " earned" : " locked"}`}
              >
                <div className="badge-icon">
                  <Icon name={a.earned ? a.icon : "lock"} size={17} />
                </div>
                <div className="achievement-row-body">
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
                </div>
                <span className="badge-meta achievement-row-meta">{a.progressLabel}</span>
              </div>
            ))}
          </div>
        </section>

        {[...byCampaign.entries()].map(([campaignId, items]) => {
          const name = items[0]?.campaignName ?? "Campaign";
          const color =
            view.campaigns.find((c) => c.id === campaignId)?.color ?? "var(--accent)";
          return (
            <section key={campaignId} className="section">
              <div className="section-head">
                <span className="eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  <span className="stats-scope-dot" style={{ background: color }} />
                  {name}
                </span>
                <span className="section-sub">
                  {items.filter((i) => i.earned).length}/{items.length}
                </span>
              </div>
              <div className="card achievement-list">
                {items.map((a) => (
                  <div
                    key={a.rowKey}
                    className={`achievement-row${a.earned ? " earned" : " locked"}`}
                  >
                    <div className="badge-icon">
                      <Icon name={a.earned ? a.icon : "lock"} size={17} />
                    </div>
                    <div className="achievement-row-body">
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
                    </div>
                    <span className="badge-meta achievement-row-meta">
                      {a.progressLabel}
                    </span>
                  </div>
                ))}
              </div>
            </section>
          );
        })}

        {view.campaigns.length === 0 ? (
          <p className="stat-note" style={{ marginTop: 4 }}>
            Join a campaign to unlock campaign-specific achievements.
          </p>
        ) : null}
      </div>
    </>
  );
}
