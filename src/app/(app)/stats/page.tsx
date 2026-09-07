import { redirect } from "next/navigation";
import { getSessionUser, initialsFor } from "@/lib/session";
import { getStatsView } from "@/lib/data";
import { TopBar } from "@/components/TopBar";
import { StatsContent } from "@/components/stats/StatsContent";

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ campaign?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const params = await searchParams;
  const campaignId = params.campaign?.trim() || null;
  const s = await getStatsView(user, campaignId);
  const initials = user.initials || initialsFor(user.name);
  const scoped = s.campaigns.find((c) => c.id === s.campaignId);

  return (
    <>
      <TopBar
        title="Your impact"
        subtitle={
          scoped
            ? scoped.name
            : s.campaigns.length
              ? "Progress across your campaigns"
              : "Join a campaign to get started"
        }
        initials={initials}
      />
      <div className="content">
        <StatsContent data={s} />
      </div>
    </>
  );
}
