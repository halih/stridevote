"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { signOut } from "@/lib/auth";
import { permissionsForRoles } from "@/lib/roles";
import { ensureActiveProgram } from "@/lib/canvass/programs";
import { countClosedDoors } from "@/lib/canvass/progress";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export async function doSignOut(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

export async function requestJoinCampaign(campaignId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in." };
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return { ok: false, message: "Campaign not found." };

  await prisma.campaignMembership.upsert({
    where: { userId_campaignId: { userId: user.id, campaignId } },
    update: { status: "pending", requestedAt: new Date() },
    create: { userId: user.id, campaignId, status: "pending", requestedAt: new Date() },
  });
  revalidatePath("/campaigns");
  return { ok: true, message: `Request sent to ${campaign.name}` };
}

async function canAccessListProgram(
  userId: string,
  listId: string,
  programId: string,
): Promise<{ campaignId: string } | null> {
  const memberships = await prisma.campaignMembership.findMany({
    where: { userId, status: "active" },
    select: { campaignId: true, roles: true },
  });
  const campaignIds = memberships
    .filter((membership) =>
      permissionsForRoles(membership.roles).has("canvass:checkout"),
    )
    .map((membership) => membership.campaignId);
  if (!campaignIds.length) return null;

  const link = await prisma.listCampaign.findFirst({
    where: {
      listId,
      programId,
      campaignId: { in: campaignIds },
      OR: [
        { visibility: "volunteers" },
        { visibility: "assigned", assignedUserId: userId },
      ],
    },
    select: { campaignId: true },
  });
  return link;
}

export async function checkoutList(
  listId: string,
  programId?: string,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in." };

  const list = await prisma.list.findUnique({
    where: { id: listId },
    include: {
      campaignLinks: {
        where: {
          OR: [
            { visibility: "volunteers" },
            { visibility: "assigned", assignedUserId: user.id },
          ],
        },
        include: { program: true },
      },
    },
  });
  if (!list) return { ok: false, message: "List not found." };

  let resolvedProgramId = programId;
  if (!resolvedProgramId) {
    const activeLink = list.campaignLinks.find(
      (l) => l.program.status === "active",
    );
    resolvedProgramId = activeLink?.programId;
  }
  if (!resolvedProgramId) {
    return { ok: false, message: "No active canvass program for this list." };
  }

  const access = await canAccessListProgram(user.id, listId, resolvedProgramId);
  if (!access) {
    return { ok: false, message: "This turf is not available to you." };
  }

  const activeCheckouts = await prisma.listCheckout.findMany({
    where: { listId, programId: resolvedProgramId, status: "active" },
  });
  const activeByOther = activeCheckouts.find((c) => c.userId !== user.id);
  if (activeByOther) {
    return { ok: false, message: "That list is already checked out." };
  }

  const completed = await prisma.listCheckout.findFirst({
    where: { listId, programId: resolvedProgramId, status: "completed" },
    select: { id: true },
  });
  if (completed) {
    return { ok: false, message: "This list is already completed for this wave." };
  }

  const mine = activeCheckouts.find((c) => c.userId === user.id);
  if (!mine) {
    const closed = await countClosedDoors(resolvedProgramId, listId);
    await prisma.listCheckout.create({
      data: {
        listId,
        programId: resolvedProgramId,
        userId: user.id,
        status: "active",
        progressTotal: list.doorsCount,
        progressDone: closed,
      },
    });
  }
  await prisma.listWatch.deleteMany({ where: { userId: user.id, listId } });
  revalidatePath("/canvass");
  return { ok: true, message: `Checked out ${list.name}` };
}

export async function releaseList(
  listId: string,
  programId?: string,
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in." };

  const list = await prisma.list.findUnique({ where: { id: listId } });
  if (!list) return { ok: false, message: "List not found." };

  const active = await prisma.listCheckout.findFirst({
    where: programId
      ? { listId, userId: user.id, status: "active", programId }
      : { listId, userId: user.id, status: "active" },
    orderBy: { checkedOutAt: "desc" },
  });
  if (!active) {
    return { ok: false, message: "You do not have this list checked out." };
  }

  const done = await countClosedDoors(active.programId, listId);
  const fullyDone = list.doorsCount > 0 && done >= list.doorsCount;
  const nextStatus = fullyDone ? "completed" : "released";

  await prisma.listCheckout.update({
    where: { id: active.id },
    data: {
      status: nextStatus,
      releasedAt: new Date(),
      progressDone: done,
      progressTotal: list.doorsCount,
    },
  });
  revalidatePath("/canvass");
  return {
    ok: true,
    message: fullyDone
      ? `Completed ${list.name}`
      : `Released ${list.name}`,
  };
}

export async function toggleWatch(listId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in." };

  // Any visible program link is enough to watch.
  const memberships = await prisma.campaignMembership.findMany({
    where: { userId: user.id, status: "active" },
    select: { campaignId: true, roles: true },
  });
  const campaignIds = memberships
    .filter((m) => permissionsForRoles(m.roles).has("canvass:checkout"))
    .map((m) => m.campaignId);
  const link = await prisma.listCampaign.findFirst({
    where: {
      listId,
      campaignId: { in: campaignIds },
      OR: [
        { visibility: "volunteers" },
        { visibility: "assigned", assignedUserId: user.id },
      ],
    },
  });
  if (!link) return { ok: false, message: "This turf is not available to you." };

  const list = await prisma.list.findUnique({ where: { id: listId } });
  if (!list) return { ok: false, message: "List not found." };

  const existing = await prisma.listWatch.findUnique({
    where: { userId_listId: { userId: user.id, listId } },
  });
  if (existing) {
    await prisma.listWatch.delete({ where: { id: existing.id } });
    revalidatePath("/canvass");
    return { ok: true, message: `Stopped watching ${list.name}` };
  }
  await prisma.listWatch.create({ data: { userId: user.id, listId } });
  revalidatePath("/canvass");
  return { ok: true, message: `Watching ${list.name}` };
}

/** Ensure programs exist when campaigns are created elsewhere. */
export async function ensureCampaignProgram(campaignId: string): Promise<void> {
  await ensureActiveProgram(campaignId);
}
