import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getSessionUser, initialsFor } from "@/lib/session";
import { getListEditView } from "@/lib/admin-data";
import { TopBar } from "@/components/TopBar";
import { Icon } from "@/components/Icon";
import { ListEditView } from "@/components/manage/ListEditView";

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

  const initials = user.initials || initialsFor(user.name);

  return (
    <>
      <TopBar title="Edit list" subtitle={list.name} initials={initials} />
      <div className="content">
        <Link href="/manage" className="back-link">
          <Icon name="chevronLeft" size={15} /> Manage
        </Link>
        <ListEditView list={list} />
      </div>
    </>
  );
}
