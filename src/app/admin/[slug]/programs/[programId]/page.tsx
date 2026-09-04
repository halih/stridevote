import { notFound, redirect } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { getProgramResults } from "@/lib/canvass/admin-results";
import { ProgramResultsPanel } from "@/components/manage/ProgramResultsPanel";
import { AdminPageHeader } from "@/components/admin/AdminPageHeader";
import Link from "next/link";
import { Icon } from "@/components/Icon";
import { prisma } from "@/lib/db";

export default async function ProgramResultsPage({
  params,
}: {
  params: Promise<{ slug: string; programId: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { slug, programId } = await params;

  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    select: { id: true, name: true },
  });
  if (!campaign) notFound();

  const view = await getProgramResults(programId, user);
  if (!view || view.program.id !== programId) notFound();

  // Ensure program belongs to this campaign
  const program = await prisma.canvassProgram.findFirst({
    where: { id: programId, campaignId: campaign.id },
  });
  if (!program) notFound();

  return (
    <>
      <AdminPageHeader title="Wave results" subtitle={view.program.name} />
      <div className="admin-content">
        <Link href={`/admin/${slug}?section=waves`} className="back-link">
          <Icon name="chevronLeft" size={15} /> Waves
        </Link>
        <ProgramResultsPanel view={view} />
      </div>
    </>
  );
}
