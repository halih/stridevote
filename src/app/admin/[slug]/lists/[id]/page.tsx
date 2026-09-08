import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import { Icon } from "@/components/Icon";
import { ListEditView } from "@/components/manage/ListEditView";
import { getListEditView } from "@/lib/admin-data";
import { getSessionUser } from "@/lib/session";

export default async function EditListPage({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { slug, id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const list = await getListEditView(id, user, slug);
  if (!list) notFound();
  // The list must actually belong to the campaign named in the URL, or the
  // sidebar and back link would describe a campaign this list is not part of.
  if (list.returnCampaign?.slug !== slug) notFound();

  return (
    <>
      <AdminPageHeader title="Edit list" subtitle={list.name} />
      <div className="admin-content admin-content-narrow">
        <Link href={`/admin/${slug}?section=lists`} className="back-link">
          <Icon name="chevronLeft" size={15} /> Lists
        </Link>
        <ListEditView list={list} />
      </div>
    </>
  );
}
