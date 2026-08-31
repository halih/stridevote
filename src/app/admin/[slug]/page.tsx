import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Icon } from "@/components/Icon";
import { ManageCampaignView } from "@/components/manage/ManageCampaignView";
import { getCampaignAdminView } from "@/lib/admin-data";
import { getSessionUser } from "@/lib/session";

export default async function AdminCampaignPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const view = await getCampaignAdminView(slug, user);
  if (!view) notFound();

  return (
    <>
      <AdminPageHeader
        title={view.name}
        subtitle={`${view.office} · ${view.district}`}
      />
      <div className="admin-content">
        <Link href="/admin" className="back-link">
          <Icon name="chevronLeft" size={15} /> Campaigns
        </Link>
        <ManageCampaignView view={view} />
      </div>
    </>
  );
}
