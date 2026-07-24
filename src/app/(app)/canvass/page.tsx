import { redirect } from "next/navigation";
import { getSessionUser, initialsFor } from "@/lib/session";
import { getCanvassBoard } from "@/lib/data";
import { TopBar } from "@/components/TopBar";
import { CanvassView } from "@/components/canvass/CanvassView";

export default async function CanvassPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const lists = await getCanvassBoard(user);
  const initials = user.initials || initialsFor(user.name);
  const home =
    user.homeLat != null && user.homeLng != null
      ? { lat: user.homeLat, lng: user.homeLng }
      : null;

  return (
    <>
      <TopBar
        title="Canvass"
        subtitle="Lists from your active campaigns"
        initials={initials}
      />
      <div className="content">
        <CanvassView lists={lists} home={home} />
      </div>
    </>
  );
}
