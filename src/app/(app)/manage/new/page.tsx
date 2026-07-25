import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionUser, initialsFor } from "@/lib/session";
import { isPlatformAdmin } from "@/lib/authz";
import { TopBar } from "@/components/TopBar";
import { Icon } from "@/components/Icon";
import { CampaignForm } from "@/components/manage/CampaignForm";

export default async function NewCampaignPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!isPlatformAdmin(user)) redirect("/manage");

  const initials = user.initials || initialsFor(user.name);

  return (
    <>
      <TopBar title="New campaign" subtitle="Create and start administering" initials={initials} />
      <div className="content">
        <Link href="/manage" className="back-link">
          <Icon name="chevronLeft" size={15} /> Manage
        </Link>
        <div className="card">
          <CampaignForm mode="create" />
        </div>
      </div>
    </>
  );
}
