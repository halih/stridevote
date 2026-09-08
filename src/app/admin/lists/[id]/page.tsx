import { notFound, redirect } from "next/navigation";
import { getListEditView } from "@/lib/admin-data";
import { getSessionUser } from "@/lib/session";

// Lists used to be edited outside the campaign tree, which dropped the sidebar
// campaign context. Keep the old URL working by sending it to the scoped one.
export default async function LegacyEditListPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const list = await getListEditView(id, user);
  if (!list?.returnCampaign) notFound();

  redirect(`/admin/${list.returnCampaign.slug}/lists/${id}`);
}
