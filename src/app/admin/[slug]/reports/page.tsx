import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { ReportsDashboard } from "@/components/admin/ReportsDashboard";
import {
  getCampaignReportsView,
  type ReportRange,
} from "@/lib/canvass/admin-reports";
import { getSessionUser } from "@/lib/session";

export default async function CampaignReportsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ program?: string; range?: string }>;
}) {
  const { slug } = await params;
  const raw = await searchParams;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const range: ReportRange =
    raw.range === "30d" || raw.range === "wave" || raw.range === "7d"
      ? raw.range
      : "7d";

  const view = await getCampaignReportsView(slug, user, {
    programId: raw.program,
    range,
  });
  if (!view) notFound();

  function href(next: { program?: string; range?: string }) {
    const q = new URLSearchParams();
    const program = next.program ?? view!.programId;
    const r = next.range ?? view!.range;
    if (program) q.set("program", program);
    if (r) q.set("range", r);
    const s = q.toString();
    return `/admin/${slug}/reports${s ? `?${s}` : ""}`;
  }

  return (
    <>
      <AdminPageHeader
        title="Reports"
        subtitle={`${view.campaign.name} · canvass dashboard`}
      />
      <div className="admin-content">
        <div className="card" style={{ marginBottom: 18, padding: 14 }}>
          <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
            <div className="form-field" style={{ margin: 0, minWidth: 180 }}>
              <span className="field-label">Wave</span>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {view.programs.length ? (
                  view.programs.map((p) => (
                    <Link
                      key={p.id}
                      href={href({ program: p.id })}
                      className={`btn btn-sm ${
                        p.id === view.programId ? "btn-primary" : "btn-outline"
                      }`}
                    >
                      {p.name}
                      {p.status === "active" ? " · active" : ""}
                    </Link>
                  ))
                ) : (
                  <span className="sheet-sub">Create a wave to see reports.</span>
                )}
              </div>
            </div>
            <div className="form-field" style={{ margin: 0 }}>
              <span className="field-label">Date range</span>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {(
                  [
                    ["7d", "Last 7 days"],
                    ["30d", "Last 30 days"],
                    ["wave", "Whole wave"],
                  ] as const
                ).map(([key, label]) => (
                  <Link
                    key={key}
                    href={href({ range: key })}
                    className={`btn btn-sm ${
                      view.range === key ? "btn-primary" : "btn-outline"
                    }`}
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </div>

        {view.programId ? (
          <ReportsDashboard view={view} />
        ) : (
          <div className="empty-state">No canvass waves yet.</div>
        )}
      </div>
    </>
  );
}
