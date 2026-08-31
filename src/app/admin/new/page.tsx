import Link from "next/link";
import { redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Icon } from "@/components/Icon";
import { CampaignForm } from "@/components/manage/CampaignForm";
import { isPlatformAdmin } from "@/lib/authz";
import { getSessionUser } from "@/lib/session";

export default async function NewCampaignPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isPlatformAdmin(user)) redirect("/admin");

  return (
    <>
      <AdminPageHeader
        title="New campaign"
        subtitle="Create a campaign and configure its operating region"
      />
      <div className="admin-content admin-content-narrow">
        <Link href="/admin" className="back-link">
          <Icon name="chevronLeft" size={15} /> Campaigns
        </Link>
        <div className="card admin-form-card">
          <CampaignForm mode="create" />
        </div>
      </div>
    </>
  );
}
