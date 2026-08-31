"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { signOut } from "@/lib/auth";
import { permissionsForRoles } from "@/lib/roles";

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

async function canAccessList(userId: string, listId: string): Promise<boolean> {
  const memberships = await prisma.campaignMembership.findMany({
    where: { userId, status: "active" },
    select: { campaignId: true, roles: true },
  });
  const campaignIds = memberships
    .filter((membership) =>
      permissionsForRoles(membership.roles).has("canvass:checkout"),
    )
    .map((membership) => membership.campaignId);
  if (!campaignIds.length) return false;

  const link = await prisma.listCampaign.findFirst({
    where: {
      listId,
      campaignId: { in: campaignIds },
      OR: [
        { visibility: "volunteers" },
        { visibility: "assigned", assignedUserId: userId },
      ],
    },
    select: { id: true },
  });
  return Boolean(link);
}

export async function checkoutList(listId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in." };
  if (!(await canAccessList(user.id, listId))) {
    return { ok: false, message: "This turf is not available to you." };
  }

  const list = await prisma.list.findUnique({
    where: { id: listId },
    include: { checkouts: { where: { status: "active" } } },
  });
  if (!list) return { ok: false, message: "List not found." };

  const activeByOther = list.checkouts.find((c) => c.userId !== user.id);
  if (activeByOther) return { ok: false, message: "That list is already checked out." };

  const mine = list.checkouts.find((c) => c.userId === user.id);
  if (!mine) {
    await prisma.listCheckout.create({
      data: {
        listId,
        userId: user.id,
        status: "active",
        progressTotal: list.doorsCount,
      },
    });
  }
  await prisma.listWatch.deleteMany({ where: { userId: user.id, listId } });
  revalidatePath("/canvass");
  return { ok: true, message: `Checked out ${list.name}` };
}

export async function releaseList(listId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in." };

  const list = await prisma.list.findUnique({ where: { id: listId } });
  if (!list) return { ok: false, message: "List not found." };

  await prisma.listCheckout.updateMany({
    where: { listId, userId: user.id, status: "active" },
    data: { status: "released", releasedAt: new Date() },
  });
  revalidatePath("/canvass");
  return { ok: true, message: `Released ${list.name}` };
}

export async function toggleWatch(listId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in." };
  if (!(await canAccessList(user.id, listId))) {
    return { ok: false, message: "This turf is not available to you." };
  }

  const list = await prisma.list.findUnique({ where: { id: listId } });
  if (!list) return { ok: false, message: "List not found." };

  const existing = await prisma.listWatch.findUnique({
    where: { userId_listId: { userId: user.id, listId } },
  });
  if (existing) {
    await prisma.listWatch.delete({ where: { id: existing.id } });
    revalidatePath("/canvass");
    return { ok: true, message: `Removed ${list.name} from your notify list` };
  }
  await prisma.listWatch.create({ data: { userId: user.id, listId } });
  revalidatePath("/canvass");
  return { ok: true, message: `We'll notify you if ${list.name} is released` };
}
