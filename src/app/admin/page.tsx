import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Icon } from "@/components/Icon";
import { getManageableCampaigns } from "@/lib/admin-data";
import { isPlatformAdmin } from "@/lib/authz";
import { getSessionUser } from "@/lib/session";

export default async function AdminPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const campaigns = await getManageableCampaigns(user);
  const canCreate = isPlatformAdmin(user);

  return (
    <>
      <AdminPageHeader
        title="Campaign administration"
        subtitle={`${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} you can manage`}
        actions={
          canCreate ? (
            <Link href="/admin/new" className="btn btn-primary">
              <Icon name="plus" size={16} /> New campaign
            </Link>
          ) : null
        }
      />

      <div className="admin-content">
        <section className="section">
          <div className="section-head">
            <span className="eyebrow">Your campaigns</span>
          </div>
          {campaigns.length ? (
            <div className="admin-campaign-grid">
              {campaigns.map((campaign) => (
                <Link
                  key={campaign.id}
                  href={`/admin/${campaign.slug}`}
                  className="card camp-card admin-campaign-card"
                  style={{
                    ["--stripe" as string]: campaign.color,
                    textDecoration: "none",
                    color: "inherit",
                  }}
                >
                  <div className="camp-top">
                    <div>
                      <p className="camp-name">
                        {campaign.name}
                        {campaign.pending > 0 ? (
                          <span className="count-badge">{campaign.pending}</span>
                        ) : null}
                      </p>
                      <p className="camp-office">
                        {campaign.office} · {campaign.district}
                      </p>
                    </div>
                    <Icon
                      name="chevronRight"
                      size={18}
                      style={{ color: "var(--ink-faint)" }}
                    />
                  </div>
                  <div className="camp-meta">
                    <span className="meta-stat">
                      <b>{campaign.activeMembers}</b> members
                    </span>
                    <span className="meta-stat">
                      <b>{campaign.lists}</b> lists
                    </span>
                    {campaign.pending > 0 ? (
                      <span className="meta-stat">
                        <b>{campaign.pending}</b> pending
                      </span>
                    ) : null}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="card empty-state">
              You don&apos;t administer any campaigns yet.
            </div>
          )}
        </section>
      </div>
    </>
  );
}
