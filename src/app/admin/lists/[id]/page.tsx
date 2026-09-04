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
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const list = await getListEditView(id, user);
  if (!list) notFound();
  const listsHref = list.returnCampaign
    ? `/admin/${list.returnCampaign.slug}?section=lists`
    : "/admin";

  return (
    <>
      <AdminPageHeader title="Edit list" subtitle={list.name} />
      <div className="admin-content admin-content-narrow">
        <Link href={listsHref} className="back-link">
          <Icon name="chevronLeft" size={15} /> Lists
        </Link>
        <ListEditView list={list} />
      </div>
    </>
  );
}
