import { prisma } from "@/lib/db";
import { permissionsForRoles } from "@/lib/roles";

/** Volunteer can see this published list in a wave (checkout / walk). */
export async function canAccessListProgram(
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
      campaign: { archivedAt: null },
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

export type CanvassWriteAuth =
  | { ok: false; error: string }
  | { ok: true; checkoutId: string; staleCheckout: boolean };

/**
 * Sync / field writes: refuse archived campaigns and deleted lists.
 * Require a checkout this user actually held (active now, or a prior hold for
 * late outbox). Cached IDs alone are not enough.
 */
export async function authorizeCanvassWrite(
  userId: string,
  opts: {
    listId: string;
    originalListId?: string;
    programId: string;
    campaignId: string;
  },
): Promise<CanvassWriteAuth> {
  const listIds = [...new Set([opts.listId, opts.originalListId].filter(Boolean))] as string[];

  const link = await prisma.listCampaign.findFirst({
    where: {
      listId: opts.listId,
      programId: opts.programId,
      campaignId: opts.campaignId,
      list: { deletedAt: null },
      campaign: { archivedAt: null },
    },
    select: { id: true },
  });
  if (!link) {
    return {
      ok: false,
      error: "List is not available in this program",
    };
  }

  const activeMine = await prisma.listCheckout.findFirst({
    where: {
      listId: { in: listIds },
      programId: opts.programId,
      userId,
      status: "active",
    },
    select: { id: true },
  });
  if (activeMine) {
    return { ok: true, checkoutId: activeMine.id, staleCheckout: false };
  }

  const priorMine = await prisma.listCheckout.findFirst({
    where: {
      listId: { in: listIds },
      programId: opts.programId,
      userId,
    },
    orderBy: { checkedOutAt: "desc" },
    select: { id: true },
  });
  if (priorMine) {
    return { ok: true, checkoutId: priorMine.id, staleCheckout: true };
  }

  return {
    ok: false,
    error: "Check out this list before logging results.",
  };
}
