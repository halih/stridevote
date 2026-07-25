import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser, initialsFor } from "@/lib/session";
import { getCampaignAdminView } from "@/lib/admin-data";
import { TopBar } from "@/components/TopBar";
import { Icon } from "@/components/Icon";
import { ManageCampaignView } from "@/components/manage/ManageCampaignView";

export default async function ManageCampaignPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const view = await getCampaignAdminView(slug, user);
  if (!view) notFound();

  const initials = user.initials || initialsFor(user.name);

  return (
    <>
      <TopBar title={view.name} subtitle={`${view.office} · ${view.district}`} initials={initials} />
      <div className="content">
        <Link href="/manage" className="back-link">
          <Icon name="chevronLeft" size={15} /> Manage
        </Link>
        <ManageCampaignView view={view} />
      </div>
    </>
  );
}
