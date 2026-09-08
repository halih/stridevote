"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { signOut } from "@/lib/auth";
import { permissionsForRoles } from "@/lib/roles";
import { ensureActiveProgram } from "@/lib/canvass/programs";
import { countClosedDoors } from "@/lib/canvass/progress";
import { claimActiveCheckout } from "@/lib/canvass/checkout";
import {
  applyListSplit,
  buildSplitPreview,
} from "@/lib/canvass/list-split-apply";
import {
  MIN_SPLIT_DOORS,
  type SplitHalfKey,
  type SplitPreview,
} from "@/lib/canvass/list-split";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export type SplitPreviewResult =
  | { ok: true; message: string; preview: SplitPreview }
  | { ok: false; message: string; preview?: undefined };

export type SplitListResult = ActionResult & {
  keptListId?: string;
  releasedListId?: string;
  keptName?: string;
  releasedName?: string;
};

export async function doSignOut(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}

export async function markAchievementsSeen(
  unlockIds: string[],
): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in." };
  const ids = unlockIds.filter((id) => typeof id === "string" && id.length > 0);
  if (!ids.length) return { ok: true, message: "Nothing to mark." };

  const { markAchievementUnlocksSeen } = await import("@/lib/achievements/evaluate");
  await markAchievementUnlocksSeen(user.id, ids);
  // Do not revalidatePath here — the unlock sheet advances locally. Revalidating
  // /stats on every "next" remounts the heavy stats RSC mid-queue and can abort
  // the response (e.g. ngrok ERR_NGROK_3004).
  return { ok: true, message: "Marked seen." };
}

export async function requestJoinCampaign(campaignId: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in." };
  const campaign = await prisma.campaign.findFirst({
    where: { id: campaignId, archivedAt: null },
  });
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
    where: {
      userId,
      status: "active",
      campaign: { archivedAt: null },
    },
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
      list: { deletedAt: null },
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

  const list = await prisma.list.findFirst({
    where: { id: listId, deletedAt: null },
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
    const claimed = await claimActiveCheckout({
      listId,
      programId: resolvedProgramId,
      userId: user.id,
      progressTotal: list.doorsCount,
      progressDone: closed,
    });
    if (!claimed.ok) return claimed;
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

  const list = await prisma.list.findFirst({
    where: { id: listId, deletedAt: null },
  });
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
    where: {
      userId: user.id,
      status: "active",
      campaign: { archivedAt: null },
    },
    select: { campaignId: true, roles: true },
  });
  const campaignIds = memberships
    .filter((m) => permissionsForRoles(m.roles).has("canvass:checkout"))
    .map((m) => m.campaignId);
  const link = await prisma.listCampaign.findFirst({
    where: {
      listId,
      list: { deletedAt: null },
      campaignId: { in: campaignIds },
      OR: [
        { visibility: "volunteers" },
        { visibility: "assigned", assignedUserId: user.id },
      ],
    },
  });
  if (!link) return { ok: false, message: "This turf is not available to you." };

  const list = await prisma.list.findFirst({
    where: { id: listId, deletedAt: null },
  });
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

async function requireOwnedCheckout(
  userId: string,
  listId: string,
  programId?: string,
) {
  const list = await prisma.list.findFirst({
    where: { id: listId, deletedAt: null },
    select: {
      id: true,
      name: true,
      source: true,
      doorsCount: true,
      campaignLinks: {
        where: programId ? { programId } : undefined,
        select: {
          programId: true,
          campaignId: true,
          visibility: true,
          assignedUserId: true,
          program: { select: { status: true } },
        },
      },
    },
  });
  if (!list) return { ok: false as const, message: "List not found." };
  if (list.source !== "stridevote") {
    return {
      ok: false as const,
      message: "Only StrideVote lists can be split.",
    };
  }

  let resolvedProgramId = programId;
  if (!resolvedProgramId) {
    const active = list.campaignLinks.find((l) => l.program.status === "active");
    resolvedProgramId = active?.programId;
  }
  if (!resolvedProgramId) {
    return {
      ok: false as const,
      message: "No active canvass program for this list.",
    };
  }

  const access = await canAccessListProgram(userId, listId, resolvedProgramId);
  if (!access) {
    return {
      ok: false as const,
      message: "This turf is not available to you.",
    };
  }

  const checkout = await prisma.listCheckout.findFirst({
    where: {
      listId,
      programId: resolvedProgramId,
      userId,
      status: "active",
    },
    select: { id: true },
  });
  if (!checkout) {
    return {
      ok: false as const,
      message: "Check out this list before splitting it.",
    };
  }

  if (list.doorsCount < MIN_SPLIT_DOORS) {
    return {
      ok: false as const,
      message: `Lists need at least ${MIN_SPLIT_DOORS} doors to split.`,
    };
  }

  return {
    ok: true as const,
    list,
    programId: resolvedProgramId,
    checkoutId: checkout.id,
  };
}

/** Preview a geographic split without committing. */
export async function previewListSplit(
  listId: string,
  programId?: string,
): Promise<SplitPreviewResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in." };

  const gate = await requireOwnedCheckout(user.id, listId, programId);
  if (!gate.ok) return { ok: false, message: gate.message };

  const built = await buildSplitPreview(
    listId,
    gate.programId,
    gate.list.name,
  );
  if (!built.ok) return { ok: false, message: built.message };

  return {
    ok: true,
    message: "Preview ready",
    preview: built.preview,
  };
}

/** Commit a geographic split; volunteer keeps `keepHalf` and releases the other. */
export async function splitList(
  listId: string,
  keepHalf: SplitHalfKey,
  programId?: string,
): Promise<SplitListResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in." };
  if (keepHalf !== "a" && keepHalf !== "b") {
    return { ok: false, message: "Choose which half to keep." };
  }

  const gate = await requireOwnedCheckout(user.id, listId, programId);
  if (!gate.ok) return { ok: false, message: gate.message };

  try {
    const result = await applyListSplit({
      listId,
      programId: gate.programId,
      userId: user.id,
      keepHalf,
      checkoutId: gate.checkoutId,
    });
    if (!result.ok) return { ok: false, message: result.message };

    revalidatePath("/canvass");
    revalidatePath(`/canvass/${listId}`);
    if (result.releasedListId) {
      revalidatePath(`/canvass/${result.releasedListId}`);
    }
    return {
      ok: true,
      message: result.message,
      keptListId: result.keptListId,
      releasedListId: result.releasedListId,
      keptName: result.keptName,
      releasedName: result.releasedName,
    };
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : "Split failed.",
    };
  }
}
