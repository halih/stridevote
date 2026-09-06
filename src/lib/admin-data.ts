import "server-only";
import { prisma } from "@/lib/db";
import { can, getManageableCampaignIds, isPlatformAdmin } from "@/lib/authz";
import { initialsFor } from "@/lib/session";
import type { User } from "@/generated/prisma";
import { parseProgramQuestions } from "@/lib/canvass/programs";
import { countClosedDoors } from "@/lib/canvass/progress";

export interface ManageCampaignCard {
  id: string;
  slug: string;
  name: string;
  office: string;
  district: string;
  iconUrl: string | null;
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
    iconUrl: c.iconUrl,
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
  source: string;
  sourceRef: string | null;
  doorsCount: number;
  boundary: [number, number][] | null;
  centroidLat: number | null;
  centroidLng: number | null;
  visibility: TurfVisibility;
  assignedUserId: string | null;
  assignedUserName: string | null;
  doorsCanvassed: number;
  checkedOutBy: string | null;
  activeCheckouts: number;
  /** Fully canvassed and released as completed for this program. */
  completed: boolean;
  programId: string;
  programName: string;
}

export type TurfVisibility = "volunteers" | "assigned" | "draft";

export interface CampaignAdminView {
  id: string;
  slug: string;
  name: string;
  office: string;
  district: string;
  website: string | null;
  iconUrl: string | null;
  color: string;
  tags: string[];
  centroidLat: number | null;
  centroidLng: number | null;
  regionType: string | null;
  regionName: string | null;
  regionState: string | null;
  boundary: [number, number][] | null;
  pickupType: string | null;
  pickupLabel: string | null;
  pickupAddress: string | null;
  pickupDetail: string | null;
  contact: { name: string; role: string; phone: string | null; email: string | null } | null;
  perms: AdminPerms;
  members: MemberRow[];
  pending: MemberRow[];
  lists: AdminListRow[];
  savedFilters: Array<{ id: string; name: string }>;
  programs: Array<{
    id: string;
    name: string;
    status: string;
    script: string | null;
    questions: import("@/lib/canvass/outcomes").ProgramQuestion[];
    listCount: number;
    attemptCount: number;
  }>;
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
          program: { select: { id: true, name: true, status: true } },
          list: {
            include: {
              checkouts: {
                include: {
                  user: { select: { name: true, email: true, phone: true } },
                },
              },
            },
          },
        },
      },
      programs: {
        orderBy: [{ status: "asc" }, { createdAt: "desc" }],
        include: { _count: { select: { listLinks: true, attempts: true } } },
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

  const canvassedByLink = await Promise.all(
    campaign.listLinks.map(async (ll) => ({
      key: `${ll.programId}:${ll.listId}`,
      done: await countClosedDoors(ll.programId, ll.listId),
    })),
  );
  const canvassedMap = new Map(canvassedByLink.map((row) => [row.key, row.done]));

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
    website: campaign.website,
    iconUrl: campaign.iconUrl,
    color: campaign.color,
    tags: campaign.tags,
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
    pickupAddress: campaign.pickupAddress,
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
    lists: campaign.listLinks.map((ll) => {
      const active = ll.list.checkouts.filter(
        (c) => c.status === "active" && c.programId === ll.programId,
      );
      const completed = ll.list.checkouts.some(
        (c) => c.status === "completed" && c.programId === ll.programId,
      );
      return {
        id: ll.list.id,
        name: ll.list.name,
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
        doorsCanvassed: canvassedMap.get(`${ll.programId}:${ll.listId}`) ?? 0,
        checkedOutBy: active[0]
          ? active[0].user.name ?? contactLabel(active[0].user)
          : null,
        activeCheckouts: active.length,
        completed,
        programId: ll.programId,
        programName: ll.program.name,
      };
    }),
    programs: campaign.programs.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      script: p.script,
      questions: parseProgramQuestions(p.questions),
      listCount: p._count.listLinks,
      attemptCount: p._count.attempts,
    })),
    savedFilters: (
      await prisma.savedVoterFilter.findMany({
        where: { campaignId: campaign.id },
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    ),
  };
}

export interface ListEditView {
  id: string;
  name: string;
  source: string;
  sourceRef: string | null;
  doorsCount: number;
  voterCount: number;
  centroidLat: number | null;
  centroidLng: number | null;
  boundary: [number, number][] | null;
  returnCampaign: { slug: string; name: string } | null;
  /** Stored doors, capped at DOOR_PAGE_SIZE. `doorsStored` is the true total. */
  doorsStored: number;
  doors: Array<{
    id: string;
    address: string;
    lat: number | null;
    lng: number | null;
    /** Raw door outcome key for pin color (contact, lit, …). */
    outcome: string | null;
    latestOutcome: string | null;
    voters: Array<{
      id: string;
      name: string;
      /** Approximate: the voter file records a birth year, not a birth date. */
      age: number | null;
      sex: string | null;
    }>;
  }>;
  linkedCampaignIds: string[];
  campaignOptions: { id: string; name: string }[];
  activeCheckouts: number;
  programName: string | null;
}

// A precinct turf runs a few hundred doors, but a campaign-wide generated list
// has no such ceiling, so cap what one page will render.
const DOOR_PAGE_SIZE = 400;

export async function getListEditView(
  listId: string,
  user: User,
): Promise<ListEditView | null> {
  const list = await prisma.list.findUnique({
    where: { id: listId },
    include: {
      campaignLinks: {
        include: {
          campaign: { select: { slug: true, name: true } },
          program: { select: { id: true, name: true, status: true } },
        },
      },
      households: {
        orderBy: { sortOrder: "asc" },
        take: DOOR_PAGE_SIZE,
        include: {
          household: {
            include: {
              voters: {
                where: { voter: { listLinks: { some: { listId } } } },
                include: {
                  voter: {
                    select: {
                      id: true,
                      firstName: true,
                      middleName: true,
                      lastName: true,
                      suffix: true,
                      yearOfBirth: true,
                      gender: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
      _count: {
        select: {
          households: true,
          voters: true,
          checkouts: { where: { status: "active" } },
        },
      },
    },
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

  const activeProgramLink =
    list.campaignLinks.find((l) => l.program.status === "active") ??
    list.campaignLinks[0] ??
    null;

  const { getCurrentAttemptsForList } = await import("@/lib/canvass/progress");
  const { DOOR_OUTCOME_LABELS } = await import("@/lib/canvass/outcomes");
  const currentAttempts = activeProgramLink
    ? await getCurrentAttemptsForList(activeProgramLink.programId, listId)
    : new Map<string, { outcome: string }>();

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
    source: list.source,
    sourceRef: list.sourceRef,
    doorsCount: list.doorsCount,
    voterCount: list._count.voters,
    centroidLat: list.centroidLat,
    centroidLng: list.centroidLng,
    boundary: Array.isArray(list.boundary)
      ? (list.boundary as [number, number][])
      : null,
    returnCampaign: list.campaignLinks[0]?.campaign ?? null,
    doorsStored: list._count.households,
    programName: activeProgramLink?.program.name ?? null,
    doors: list.households.map(({ household }) => {
      const latest = currentAttempts.get(household.id);
      return {
        id: household.id,
        address: household.displayAddress,
        lat: household.lat,
        lng: household.lng,
        outcome: latest?.outcome ?? null,
        latestOutcome: latest
          ? DOOR_OUTCOME_LABELS[
              latest.outcome as keyof typeof DOOR_OUTCOME_LABELS
            ] ?? latest.outcome
          : null,
        voters: household.voters.map(({ voter }) => ({
          id: voter.id,
          name: [
            voter.firstName,
            voter.middleName,
            voter.lastName,
            voter.suffix,
          ]
            .filter(Boolean)
            .join(" "),
          age:
            voter.yearOfBirth != null
              ? new Date().getFullYear() - voter.yearOfBirth
              : null,
          // "U" is the voter file's unknown marker, which is not worth showing.
          sex: voter.gender && voter.gender !== "U" ? voter.gender : null,
        })),
      };
    }),
    linkedCampaignIds: linkedIds,
    campaignOptions,
    activeCheckouts: list._count.checkouts,
  };
}
