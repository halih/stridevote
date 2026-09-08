import "server-only";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import type { User } from "@/generated/prisma";
import { permissionsForRoles, rolesGrantManage, type Permission } from "@/lib/roles";

/** Platform super-admins hold every permission on every campaign. */
export function isPlatformAdmin(user: User): boolean {
  return (
    user.isPlatformAdmin ||
    (!!user.email && env.platformAdminEmails.includes(user.email.toLowerCase()))
  );
}

/** Does this user have `perm` on `campaignId`? */
export async function can(
  user: User,
  campaignId: string,
  perm: Permission,
): Promise<boolean> {
  if (isPlatformAdmin(user)) return true;
  if (perm === "campaign:create") return false; // platform-only
  const membership = await prisma.campaignMembership.findUnique({
    where: { userId_campaignId: { userId: user.id, campaignId } },
    include: { campaign: { select: { archivedAt: true } } },
  });
  if (
    !membership ||
    membership.status !== "active" ||
    membership.campaign.archivedAt
  ) {
    return false;
  }
  return permissionsForRoles(membership.roles).has(perm);
}

/** Campaign ids the user can administer, or "all" for platform admins. */
export async function getManageableCampaignIds(
  user: User,
): Promise<string[] | "all"> {
  if (isPlatformAdmin(user)) return "all";
  const memberships = await prisma.campaignMembership.findMany({
    where: {
      userId: user.id,
      status: "active",
      campaign: { archivedAt: null },
    },
    select: { campaignId: true, roles: true },
  });
  return memberships.filter((m) => rolesGrantManage(m.roles)).map((m) => m.campaignId);
}

export async function canManageAnything(user: User): Promise<boolean> {
  const ids = await getManageableCampaignIds(user);
  return ids === "all" || ids.length > 0;
}
