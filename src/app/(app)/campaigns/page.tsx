import { redirect } from "next/navigation";
import { getSessionUser, initialsFor } from "@/lib/session";
import { getCampaignBoard } from "@/lib/data";
import { TopBar } from "@/components/TopBar";
import { CampaignsView } from "@/components/campaigns/CampaignsView";

export default async function CampaignsPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const board = await getCampaignBoard(user);
  const initials = user.initials || initialsFor(user.name);
  const area = user.area ?? "Your area";

  return (
    <>
      <TopBar title="Campaigns" subtitle={area} initials={initials} />
      <div className="content">
        <CampaignsView board={board} />
      </div>
    </>
  );
}
