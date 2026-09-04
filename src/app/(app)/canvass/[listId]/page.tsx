import { redirect, notFound } from "next/navigation";
import { getSessionUser } from "@/lib/session";
import { prisma } from "@/lib/db";
import { WalkView } from "@/components/canvass/WalkView";
import { countClosedDoors } from "@/lib/canvass/progress";

export default async function WalkListPage({
  params,
  searchParams,
}: {
  params: Promise<{ listId: string }>;
  searchParams: Promise<{ programId?: string }>;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const { listId } = await params;
  const { programId: programIdParam } = await searchParams;

  let checkout = await prisma.listCheckout.findFirst({
    where: {
      listId,
      userId: user.id,
      status: "active",
      ...(programIdParam ? { programId: programIdParam } : {}),
    },
    include: {
      list: true,
      program: true,
    },
    orderBy: { checkedOutAt: "desc" },
  });

  // Assigned lists belong to the volunteer without a manual checkout step.
  if (!checkout) {
    const assignment = await prisma.listCampaign.findFirst({
      where: {
        listId,
        assignedUserId: user.id,
        visibility: "assigned",
        program: { status: "active" },
        ...(programIdParam ? { programId: programIdParam } : {}),
      },
      include: {
        list: true,
        program: true,
      },
    });
    if (assignment) {
      const alreadyCompleted = await prisma.listCheckout.findFirst({
        where: {
          listId,
          programId: assignment.programId,
          status: "completed",
        },
        select: { id: true },
      });
      if (!alreadyCompleted) {
        const closed = await countClosedDoors(assignment.programId, listId);
        checkout = await prisma.listCheckout.create({
          data: {
            listId,
            programId: assignment.programId,
            userId: user.id,
            status: "active",
            progressTotal: assignment.list.doorsCount,
            progressDone: closed,
          },
          include: {
            list: true,
            program: true,
          },
        });
      }
    }
  }

  if (!checkout) {
    redirect("/canvass");
  }

  if (checkout.list.source !== "stridevote") {
    notFound();
  }

  const home =
    user.homeLat != null && user.homeLng != null
      ? { lat: user.homeLat, lng: user.homeLng }
      : null;

  return (
    <div className="content content-walk">
      <WalkView
        listId={checkout.listId}
        programId={checkout.programId}
        listName={checkout.list.name}
        home={home}
      />
    </div>
  );
}
