import "server-only";
import { prisma } from "@/lib/db";
import { can, getManageableCampaignIds, isPlatformAdmin } from "@/lib/authz";
import { initialsFor } from "@/lib/session";
import type { User } from "@/generated/prisma";

export interface ManageCampaignCard {
  id: string;
  slug: string;
  name: string;
  office: string;
  district: string;
  color: string;
  activeMembers: number;
  pending: number;
  lists: number;
}

export async function getManageableCampaigns(user: User): Promise<ManageCampaignCard[]> {
  const ids = await getManageableCampaignIds(user);
  const where = ids === "all" ? {} : { id: { in: ids } };
  const campaigns = await prisma.campaign.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      memberships: { select: { status: true } },
      _count: { select: { listLinks: true } },
    },
  });
  return campaigns.map((c) => ({
    id: c.id,
    slug: c.slug,
    name: c.name,
    office: c.office,
    district: c.district,
    color: c.color,
    activeMembers: c.memberships.filter((m) => m.status === "active").length,
    pending: c.memberships.filter((m) => m.status === "pending").length,
    lists: c._count.listLinks,
  }));
}

export interface AdminPerms {
  isPlatformAdmin: boolean;
  editProfile: boolean;
  approve: boolean;
  add: boolean;
  assignRoles: boolean;
  manageLists: boolean;
  deleteCampaign: boolean;
}

export interface MemberRow {
  userId: string;
  name: string;
  contact: string;
  initials: string;
  roles: string[];
  requestedAt: string | null;
}

export interface AdminListRow {
  id: string;
  name: string;
  neighborhood: string;
  source: string;
  sourceRef: string | null;
  doorsCount: number;
  boundary: [number, number][] | null;
  centroidLat: number | null;
  centroidLng: number | null;
  visibility: TurfVisibility;
  assignedUserId: string | null;
  assignedUserName: string | null;
  activeCheckouts: number;
}

export type TurfVisibility = "volunteers" | "assigned" | "draft";

export interface CampaignAdminView {
  id: string;
  slug: string;
  name: string;
  office: string;
  district: string;
  color: string;
  tags: string[];
  volunteers: number;
  centroidLat: number | null;
  centroidLng: number | null;
  regionType: string | null;
  regionName: string | null;
  regionState: string | null;
  boundary: [number, number][] | null;
  pickupType: string | null;
  pickupLabel: string | null;
  pickupDetail: string | null;
  contact: { name: string; role: string; phone: string | null; email: string | null } | null;
  perms: AdminPerms;
  members: MemberRow[];
  pending: MemberRow[];
  lists: AdminListRow[];
}

function contactLabel(u: { name: string | null; email: string | null; phone: string | null }): string {
  return u.email ?? u.phone ?? u.name ?? "Unknown";
}

export async function getCampaignAdminView(
  slug: string,
  user: User,
): Promise<CampaignAdminView | null> {
  const campaign = await prisma.campaign.findUnique({
    where: { slug },
    include: {
      contacts: { take: 1 },
      memberships: { include: { user: true } },
      listLinks: {
        include: {
          assignedUser: true,
          list: { include: { checkouts: { where: { status: "active" }, select: { id: true } } } },
        },
      },
    },
  });
  if (!campaign) return null;

  const perms: AdminPerms = {
    isPlatformAdmin: isPlatformAdmin(user),
    editProfile: await can(user, campaign.id, "campaign:edit"),
    approve: await can(user, campaign.id, "members:approve"),
    add: await can(user, campaign.id, "members:add"),
    assignRoles: await can(user, campaign.id, "members:assign_roles"),
    manageLists: await can(user, campaign.id, "lists:manage"),
    deleteCampaign: await can(user, campaign.id, "campaign:delete"),
  };
  const hasAny =
    perms.editProfile ||
    perms.approve ||
    perms.add ||
    perms.assignRoles ||
    perms.manageLists ||
    perms.deleteCampaign;
  if (!hasAny) return null;

  const toRow = (m: (typeof campaign.memberships)[number]): MemberRow => ({
    userId: m.userId,
    name: m.user.name ?? contactLabel(m.user),
    contact: contactLabel(m.user),
    initials: m.user.initials || initialsFor(m.user.name),
    roles: m.roles,
    requestedAt: m.requestedAt ? m.requestedAt.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null,
  });

  return {
    id: campaign.id,
    slug: campaign.slug,
    name: campaign.name,
    office: campaign.office,
    district: campaign.district,
    color: campaign.color,
    tags: campaign.tags,
    volunteers: campaign.volunteers,
    centroidLat: campaign.centroidLat,
    centroidLng: campaign.centroidLng,
    regionType: campaign.regionType,
    regionName: campaign.regionName,
    regionState: campaign.regionState,
    boundary: Array.isArray(campaign.boundary)
      ? (campaign.boundary as [number, number][])
      : null,
    pickupType: campaign.pickupType,
    pickupLabel: campaign.pickupLabel,
    pickupDetail: campaign.pickupDetail,
    contact: campaign.contacts[0]
      ? {
          name: campaign.contacts[0].name,
          role: campaign.contacts[0].role,
          phone: campaign.contacts[0].phone,
          email: campaign.contacts[0].email,
        }
      : null,
    perms,
    members: campaign.memberships.filter((m) => m.status === "active").map(toRow),
    pending: campaign.memberships.filter((m) => m.status === "pending").map(toRow),
    lists: campaign.listLinks.map((ll) => ({
      id: ll.list.id,
      name: ll.list.name,
      neighborhood: ll.list.neighborhood,
      source: ll.list.source,
      sourceRef: ll.list.sourceRef,
      doorsCount: ll.list.doorsCount,
      boundary: Array.isArray(ll.list.boundary)
        ? (ll.list.boundary as [number, number][])
        : null,
      centroidLat: ll.list.centroidLat,
      centroidLng: ll.list.centroidLng,
      visibility: ll.visibility as TurfVisibility,
      assignedUserId: ll.assignedUserId,
      assignedUserName: ll.assignedUser
        ? ll.assignedUser.name ?? contactLabel(ll.assignedUser)
        : null,
      activeCheckouts: ll.list.checkouts.length,
    })),
  };
}

export interface ListEditView {
  id: string;
  name: string;
  neighborhood: string;
  source: string;
  sourceRef: string | null;
  doorsCount: number;
  distanceMi: number | null;
  centroidLat: number | null;
  centroidLng: number | null;
  linkedCampaignIds: string[];
  campaignOptions: { id: string; name: string }[];
}

export async function getListEditView(
  listId: string,
  user: User,
): Promise<ListEditView | null> {
  const list = await prisma.list.findUnique({
    where: { id: listId },
    include: { campaignLinks: true },
  });
  if (!list) return null;

  const linkedIds = list.campaignLinks.map((l) => l.campaignId);
  let canManage = false;
  for (const id of linkedIds) {
    if (await can(user, id, "lists:manage")) {
      canManage = true;
      break;
    }
  }
  if (!canManage) return null;

  const manageable = await getManageableCampaignIds(user);
  const where =
    manageable === "all"
      ? {}
      : { id: { in: Array.from(new Set([...manageable, ...linkedIds])) } };
  const campaignOptions = await prisma.campaign.findMany({
    where,
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  return {
    id: list.id,
    name: list.name,
    neighborhood: list.neighborhood,
    source: list.source,
    sourceRef: list.sourceRef,
    doorsCount: list.doorsCount,
    distanceMi: list.distanceMi,
    centroidLat: list.centroidLat,
    centroidLng: list.centroidLng,
    linkedCampaignIds: linkedIds,
    campaignOptions,
  };
}
