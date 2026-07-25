import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, initialsFor } from "@/lib/session";
import { getManageableCampaigns } from "@/lib/admin-data";
import { isPlatformAdmin } from "@/lib/authz";
import { TopBar } from "@/components/TopBar";
import { Icon } from "@/components/Icon";

export default async function ManagePage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const campaigns = await getManageableCampaigns(user);
  const canCreate = isPlatformAdmin(user);
  const initials = user.initials || initialsFor(user.name);

  return (
    <>
      <TopBar title="Manage" subtitle="Campaigns you administer" initials={initials} />
      <div className="content">
        {canCreate ? (
          <section className="section">
            <Link href="/manage/new" className="btn btn-primary btn-block">
              <Icon name="plus" size={16} /> New campaign
            </Link>
          </section>
        ) : null}

        <section className="section">
          <div className="section-head">
            <span className="eyebrow">Your campaigns</span>
            <span className="section-sub">{campaigns.length}</span>
          </div>
          <div className="stack">
            {campaigns.length ? (
              campaigns.map((c) => (
                <Link
                  key={c.id}
                  href={`/manage/${c.slug}`}
                  className="card camp-card"
                  style={{ ["--stripe" as string]: c.color, textDecoration: "none", color: "inherit" }}
                >
                  <div className="camp-top">
                    <div>
                      <p className="camp-name">
                        {c.name}
                        {c.pending > 0 ? <span className="count-badge">{c.pending}</span> : null}
                      </p>
                      <p className="camp-office">
                        {c.office} · {c.district}
                      </p>
                    </div>
                    <Icon name="chevronRight" size={18} style={{ color: "var(--ink-faint)" }} />
                  </div>
                  <div className="camp-meta">
                    <span className="meta-stat">
                      <b>{c.activeMembers}</b> members
                    </span>
                    <span className="meta-stat">
                      <b>{c.lists}</b> lists
                    </span>
                    {c.pending > 0 ? (
                      <span className="meta-stat">
                        <b>{c.pending}</b> pending
                      </span>
                    ) : null}
                  </div>
                </Link>
              ))
            ) : (
              <div className="empty-state">
                You don&apos;t administer any campaigns yet.
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
