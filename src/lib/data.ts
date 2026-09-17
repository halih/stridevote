import "server-only";
import { prisma } from "@/lib/db";
import { claimActiveCheckout } from "@/lib/canvass/checkout";
import { getCurrentAttemptsForList } from "@/lib/canvass/progress";
import { DEFAULT_ORIGIN, haversineMiles, listDistanceMiles, pointInPolygon, roundMiles } from "@/lib/geo";
import { getDoorStats, getAttemptLeaderboard } from "@/lib/stats-source";
import { evaluateAchievements, listAllAchievements, type AchievementMetrics } from "@/lib/achievements/evaluate";
import type {
  AchievementListItem,
  AchievementVM,
  BreakdownRow,
  LeaderRow,
  OutcomeRow,
  StatsCampaignOption,
  StatsViewData,
  UnseenUnlockVM,
} from "@/lib/achievements/types";
import type { User } from "@/generated/prisma";

export type DoorPinStatus = "remaining" | "done";

export interface ListDoorPin {
  lat: number;
  lng: number;
  status: DoorPinStatus;
  /** Current door outcome when status is done. */
  outcome: string | null;
}

export type CampaignStatus = "active" | "pending" | "discover";

export interface CampaignContactVM {
  name: string;
  role: string;
  phone: string | null;
  email: string | null;
}

export interface PickupVM {
  type: string; // "locker" | "address"
  label: string;
  address: string;
  detail: string;
}

export interface CampaignVM {
  id: string;
  slug: string;
  name: string;
  office: string;
  district: string;
  website: string | null;
  iconUrl: string | null;
  tags: string[];
  color: string;
  status: CampaignStatus;
  distanceMi: number | null;
  joinedAt: string | null;
  requestedAt: string | null;
  volunteers: number;
  listsTotal: number;
  listsAvailable: number;
  doorsRemaining: number;
  doorsKnocked: number;
  matchTags: string[];
  boundary: [number, number][] | null;
  centroidLat: number | null;
  centroidLng: number | null;
  homeInside: boolean | null;
  contact: CampaignContactVM | null;
  pickup: PickupVM | null;
}

export interface CampaignBoard {
  mine: CampaignVM[];
  discover: CampaignVM[];
}

function boundaryOf(raw: unknown): [number, number][] | null {
  if (!Array.isArray(raw)) return null;
  return raw as [number, number][];
}

function pickupOf(c: {
  pickupType: string | null;
  pickupLabel: string | null;
  pickupAddress: string | null;
  pickupDetail: string | null;
}): PickupVM | null {
  if (!c.pickupType || !c.pickupLabel) return null;
  return {
    type: c.pickupType,
    label: c.pickupLabel,
    address: c.pickupAddress ?? "",
    detail: c.pickupDetail ?? "",
  };
}

export async function getCampaignBoard(user: User): Promise<CampaignBoard> {
  const campaigns = await prisma.campaign.findMany({
    where: { archivedAt: null },
    orderBy: { name: "asc" },
    include: {
      contacts: { take: 1 },
      memberships: { where: { userId: user.id } },
      _count: {
        select: {
          memberships: { where: { status: "active" } },
        },
      },
      listLinks: {
        where: {
          list: { deletedAt: null },
          OR: [
            { visibility: "volunteers" },
            { visibility: "assigned", assignedUserId: user.id },
          ],
        },
        include: {
          list: { include: { checkouts: { where: { status: "active" } } } },
        },
      },
    },
  });

  const activeTags = new Set<string>();
  for (const c of campaigns) {
    if (c.memberships[0]?.status === "active") c.tags.forEach((t) => activeTags.add(t));
  }

  const mine: CampaignVM[] = [];
  const discover: CampaignVM[] = [];

  for (const c of campaigns) {
    const membership = c.memberships[0];
    const status: CampaignStatus =
      membership?.status === "active"
        ? "active"
        : membership?.status === "pending"
          ? "pending"
          : "discover";

    const lists = c.listLinks.map((ll) => ll.list);
    const listsTotal = lists.length;
    const listsAvailable = lists.filter((l) => l.checkouts.length === 0).length;
    const doorsRemaining = lists.reduce(
      (s, l) => s + Math.max(0, l.doorsCount - (l.checkouts[0]?.progressDone ?? 0)),
      0,
    );
    const doorsKnocked = lists.reduce(
      (s, l) =>
        s +
        l.checkouts
          .filter((co) => co.userId === user.id)
          .reduce((n, co) => n + co.progressDone, 0),
      0,
    );

    const boundary = boundaryOf(c.boundary);
    const distanceMi =
      user.homeLat != null && user.homeLng != null && c.centroidLat != null && c.centroidLng != null
        ? roundMiles(haversineMiles(user.homeLat, user.homeLng, c.centroidLat, c.centroidLng))
        : null;
    const homeInside =
      boundary && user.homeLat != null && user.homeLng != null
        ? pointInPolygon([user.homeLat, user.homeLng], boundary)
        : null;
    const matchTags =
      status === "discover" ? c.tags.filter((t) => activeTags.has(t)) : [];
    const contact = c.contacts[0]
      ? {
          name: c.contacts[0].name,
          role: c.contacts[0].role,
          phone: c.contacts[0].phone,
          email: c.contacts[0].email,
        }
      : null;

    const vm: CampaignVM = {
      id: c.id,
      slug: c.slug,
      name: c.name,
      office: c.office,
      district: c.district,
      website: c.website,
      iconUrl: c.iconUrl,
      tags: c.tags,
      color: c.color,
      status,
      distanceMi,
      joinedAt: membership?.joinedAt ? formatDate(membership.joinedAt) : null,
      requestedAt: membership?.requestedAt ? formatDate(membership.requestedAt) : null,
      volunteers: c._count.memberships,
      listsTotal,
      listsAvailable,
      doorsRemaining,
      doorsKnocked,
      matchTags,
      boundary,
      centroidLat: c.centroidLat,
      centroidLng: c.centroidLng,
      homeInside,
      contact,
      pickup: pickupOf(c),
    };

    if (status === "discover") discover.push(vm);
    else mine.push(vm);
  }

  discover.sort((a, b) => (a.distanceMi ?? 999) - (b.distanceMi ?? 999));
  return { mine, discover };
}

// ---- Canvass ----
export type ListStatus = "mine" | "taken" | "available";

export interface ListCampaignVM {
  name: string;
  color: string;
  pickup: PickupVM | null;
  campaignId: string;
  programId: string;
  programName: string;
}

export interface ListVM {
  id: string;
  slug: string;
  name: string;
  source: string;
  sourceRef: string | null;
  doorsCount: number;
  distanceMi: number | null;
  status: ListStatus;
  takenBy: string | null;
  progressDone: number;
  progressTotal: number;
  watching: boolean;
  boundary: [number, number][] | null;
  centroidLat: number | null;
  centroidLng: number | null;
  campaigns: ListCampaignVM[];
  /** Active program used for checkout / walk (first active linked program). */
  programId: string | null;
  programName: string | null;
  checkoutId: string | null;
  nativeCanvass: boolean;
  /** MiniVAN pull available (campaign gated + list sourced from MiniVAN). */
  minivanPull: boolean;
  /** Civibyte pull available (campaign gated + imported guest list). */
  civibytePull: boolean;
  /** Admin assigned this list to the volunteer — already theirs, no checkout step. */
  assignedToMe: boolean;
  /** Door pins for map preview (coords + walk status; capped). */
  doorPins: ListDoorPin[];
}

export async function getCanvassBoard(user: User): Promise<ListVM[]> {
  const activeMemberships = await prisma.campaignMembership.findMany({
    where: {
      userId: user.id,
      status: "active",
      campaign: { archivedAt: null },
    },
    select: { campaignId: true },
  });
  const activeIds = activeMemberships.map((m) => m.campaignId);
  if (!activeIds.length) return [];

  const lists = await prisma.list.findMany({
    where: {
      deletedAt: null,
      campaignLinks: {
        some: {
          campaignId: { in: activeIds },
          program: { status: "active" },
          OR: [
            { visibility: "volunteers" },
            { visibility: "assigned", assignedUserId: user.id },
          ],
        },
      },
    },
    include: {
      checkouts: {
        where: { status: { in: ["active", "completed"] } },
        include: { user: true },
      },
      watches: { where: { userId: user.id } },
      campaignLinks: {
        where: {
          campaignId: { in: activeIds },
          program: { status: "active" },
          OR: [
            { visibility: "volunteers" },
            { visibility: "assigned", assignedUserId: user.id },
          ],
        },
        include: { campaign: true, program: true },
      },
      _count: { select: { households: true } },
    },
  });

  // Assigned turfs should already be checked out; repair any gaps so walk/packet work.
  // Skip programs already marked completed for this list.
  for (const l of lists) {
    for (const link of l.campaignLinks) {
      if (link.visibility !== "assigned" || link.assignedUserId !== user.id) continue;
      const completed = l.checkouts.find(
        (co) => co.programId === link.programId && co.status === "completed",
      );
      if (completed) continue;
      const held = l.checkouts.find(
        (co) =>
          co.userId === user.id &&
          co.programId === link.programId &&
          co.status === "active",
      );
      if (held) continue;
      const claimed = await claimActiveCheckout({
        listId: l.id,
        programId: link.programId,
        userId: user.id,
        progressTotal: l.doorsCount,
      });
      if (!claimed.ok) continue;
      const created = await prisma.listCheckout.findUnique({
        where: { id: claimed.id },
        include: { user: true },
      });
      if (created) l.checkouts.push(created);
    }
  }

  // Preview pins: one query for all visible lists (coords only, capped per list).
  const PREVIEW_PIN_CAP = 250;
  const doorPinsByList = new Map<
    string,
    Array<{ lat: number; lng: number; householdId: string }>
  >();
  if (lists.length) {
    const rows = await prisma.listHousehold.findMany({
      where: { listId: { in: lists.map((l) => l.id) } },
      orderBy: { sortOrder: "asc" },
      select: {
        listId: true,
        householdId: true,
        household: {
          select: {
            lat: true,
            lng: true,
          },
        },
      },
    });
    for (const row of rows) {
      const lat = row.household.lat;
      const lng = row.household.lng;
      if (lat == null || lng == null) continue;
      const pins = doorPinsByList.get(row.listId) ?? [];
      if (pins.length >= PREVIEW_PIN_CAP) continue;
      pins.push({ lat, lng, householdId: row.householdId });
      doorPinsByList.set(row.listId, pins);
    }
  }

  // Attempt progress + pin status per program/list (shown on available lists too).
  const closedByKey = new Map<string, number>();
  const attemptsByKey = new Map<
    string,
    Awaited<ReturnType<typeof getCurrentAttemptsForList>>
  >();
  const progressTargets = lists.map((l) => {
    const assignedLink = l.campaignLinks.find(
      (cl) => cl.visibility === "assigned" && cl.assignedUserId === user.id,
    );
    const mineCheckout = l.checkouts.find((co) => co.userId === user.id);
    const primaryLink =
      l.campaignLinks.find((cl) => cl.programId === mineCheckout?.programId) ??
      assignedLink ??
      l.campaignLinks[0] ??
      null;
    return primaryLink
      ? { listId: l.id, programId: primaryLink.programId }
      : null;
  });
  await Promise.all(
    progressTargets.map(async (target) => {
      if (!target) return;
      const key = `${target.programId}:${target.listId}`;
      const current = await getCurrentAttemptsForList(target.programId, target.listId);
      attemptsByKey.set(key, current);
      closedByKey.set(key, current.size);
    }),
  );

  const vms: ListVM[] = lists.flatMap((l) => {
    // Prefer checkout for an active linked program.
    const programIds = new Set(l.campaignLinks.map((cl) => cl.programId));
    const relevantCheckouts = l.checkouts.filter((co) => programIds.has(co.programId));
    const completedProgramIds = new Set(
      relevantCheckouts
        .filter((co) => co.status === "completed")
        .map((co) => co.programId),
    );
    // Fully canvassed + released as completed — leave the volunteer board.
    const openLinks = l.campaignLinks.filter(
      (cl) => !completedProgramIds.has(cl.programId),
    );
    if (!openLinks.length) return [];

    const activeCheckouts = relevantCheckouts.filter((co) => co.status === "active");
    const assignedLink = openLinks.find(
      (cl) => cl.visibility === "assigned" && cl.assignedUserId === user.id,
    );
    const mineCheckout =
      activeCheckouts.find((co) => co.userId === user.id) ??
      (assignedLink
        ? activeCheckouts.find((co) => co.programId === assignedLink.programId)
        : undefined);
    const otherCheckout = activeCheckouts.find((co) => co.userId !== user.id);
    const assignedToMe = Boolean(assignedLink);
    // Assignment puts the list in My lists without a separate checkout step.
    const status: ListStatus =
      mineCheckout || assignedToMe
        ? "mine"
        : otherCheckout
          ? "taken"
          : "available";
    const primaryLink =
      openLinks.find((cl) => cl.programId === mineCheckout?.programId) ??
      assignedLink ??
      openLinks[0] ??
      null;
    const rawPins = doorPinsByList.get(l.id) ?? [];
    const attemptKey = primaryLink
      ? `${primaryLink.programId}:${l.id}`
      : null;
    const attempts = attemptKey ? attemptsByKey.get(attemptKey) : undefined;
    const doorPins = rawPins.map((pin) => {
      const cur = attempts?.get(pin.householdId);
      return {
        lat: pin.lat,
        lng: pin.lng,
        status: (cur ? "done" : "remaining") as DoorPinStatus,
        outcome: cur?.outcome ?? null,
      };
    });
    const origin =
      user.homeLat != null && user.homeLng != null
        ? { lat: user.homeLat, lng: user.homeLng }
        : DEFAULT_ORIGIN;
    const rawDistance = listDistanceMiles(origin, {
      doorPins,
      boundary: boundaryOf(l.boundary),
      centroidLat: l.centroidLat,
      centroidLng: l.centroidLng,
    });
    const distanceMi = rawDistance != null ? roundMiles(rawDistance) : null;
    const closedDoors = attemptKey ? (closedByKey.get(attemptKey) ?? 0) : 0;
    return [
      {
        id: l.id,
        slug: l.slug,
        name: l.name,
        source: l.source,
        sourceRef: l.sourceRef,
        doorsCount: l.doorsCount,
        distanceMi,
        status,
        takenBy: otherCheckout?.user.name ?? (otherCheckout ? "another canvasser" : null),
        progressDone: closedDoors,
        progressTotal: l.doorsCount,
        watching: l.watches.length > 0,
        boundary: boundaryOf(l.boundary),
        centroidLat: l.centroidLat,
        centroidLng: l.centroidLng,
        programId: primaryLink?.programId ?? null,
        programName: primaryLink?.program.name ?? null,
        checkoutId: mineCheckout?.id ?? null,
        nativeCanvass: l.source === "stridevote" || l._count.households > 0,
        minivanPull:
          l.source === "minivan" &&
          openLinks.some((cl) => cl.campaign.minivanEnabled),
        civibytePull:
          l.source === "civibyte" &&
          openLinks.some((cl) => cl.campaign.civibyteEnabled),
        assignedToMe,
        doorPins,
        campaigns: openLinks.map((cl) => ({
          name: cl.campaign.name,
          color: cl.campaign.color,
          pickup: pickupOf(cl.campaign),
          campaignId: cl.campaignId,
          programId: cl.programId,
          programName: cl.program.name,
        })),
      },
    ];
  });

  vms.sort((a, b) => (a.distanceMi ?? 999) - (b.distanceMi ?? 999));
  return vms;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ---- Stats ----
export type {
  AchievementListItem,
  AchievementVM,
  BreakdownRow,
  LeaderRow,
  OutcomeRow,
  StatsCampaignOption,
  UnseenUnlockVM,
};
export type StatsView = StatsViewData;

export interface AchievementsListView {
  items: AchievementListItem[];
  earnedCount: number;
  totalCount: number;
  campaigns: StatsCampaignOption[];
}

const OUTCOME_META: {
  key: keyof import("@/lib/stats-source").OutcomeCounts;
  label: string;
  color: string;
}[] = [
  { key: "contact", label: "Spoke with voter", color: "#2e9e5b" },
  { key: "no_answer", label: "No answer", color: "#8a8f98" },
  { key: "refused", label: "Declined", color: "#c97a2e" },
  { key: "lit", label: "Left literature", color: "#378add" },
  { key: "moved", label: "Moved", color: "#7c5cbf" },
  { key: "inaccessible", label: "Inaccessible", color: "#5b6067" },
  { key: "unsafe", label: "Unsafe / skip", color: "#d64545" },
];

async function checkoutCounts(
  userId: string,
  campaignId?: string | null,
): Promise<{ listsCheckedOut: number; listsCompleted: number }> {
  const where = {
    userId,
    ...(campaignId ? { program: { campaignId } } : {}),
  };
  const [listsCheckedOut, listsCompleted] = await Promise.all([
    prisma.listCheckout.count({ where }),
    prisma.listCheckout.count({ where: { ...where, status: "completed" } }),
  ]);
  return { listsCheckedOut, listsCompleted };
}

function toAchievementMetrics(
  doorStats: Awaited<ReturnType<typeof getDoorStats>>,
  listsCheckedOut: number,
  listsCompleted: number,
  campaignsJoined: number,
): AchievementMetrics {
  return {
    doors_knocked: doorStats.doorsKnocked,
    voters_reached: doorStats.votersReached,
    lists_checked_out: listsCheckedOut,
    lists_completed: listsCompleted,
    campaigns_joined: campaignsJoined,
    contacts: doorStats.contacts,
    lit_dropped: doorStats.litDropped,
  };
}

async function loadAchievementMetricContext(userId: string): Promise<{
  campaigns: StatsCampaignOption[];
  overallMetrics: AchievementMetrics;
  campaignMetrics: { campaignId: string; name: string; metrics: AchievementMetrics }[];
}> {
  const activeMemberships = await prisma.campaignMembership.findMany({
    where: {
      userId,
      status: "active",
      campaign: { archivedAt: null },
    },
    include: { campaign: true },
    orderBy: { joinedAt: "asc" },
  });

  const campaigns: StatsCampaignOption[] = activeMemberships.map((m) => ({
    id: m.campaign.id,
    name: m.campaign.name,
    color: m.campaign.color,
    slug: m.campaign.slug,
  }));
  const campaignsJoined = activeMemberships.length;

  const [overallDoorStats, overallCheckouts] = await Promise.all([
    getDoorStats(userId, null),
    checkoutCounts(userId, null),
  ]);
  const overallMetrics = toAchievementMetrics(
    overallDoorStats,
    overallCheckouts.listsCheckedOut,
    overallCheckouts.listsCompleted,
    campaignsJoined,
  );

  const campaignMetrics = await Promise.all(
    campaigns.map(async (c) => {
      const [ds, co] = await Promise.all([
        getDoorStats(userId, c.id),
        checkoutCounts(userId, c.id),
      ]);
      return {
        campaignId: c.id,
        name: c.name,
        metrics: toAchievementMetrics(
          ds,
          co.listsCheckedOut,
          co.listsCompleted,
          campaignsJoined,
        ),
      };
    }),
  );

  return { campaigns, overallMetrics, campaignMetrics };
}

export async function getAchievementsListView(
  user: User,
): Promise<AchievementsListView> {
  const { campaigns, overallMetrics, campaignMetrics } =
    await loadAchievementMetricContext(user.id);
  const items = await listAllAchievements({
    userId: user.id,
    overallMetrics,
    campaignMetrics,
  });
  const earnedCount = items.filter((i) => i.earned).length;
  return {
    items,
    earnedCount,
    totalCount: items.length,
    campaigns,
  };
}

export async function getStatsView(
  user: User,
  campaignId: string | null = null,
): Promise<StatsView> {
  const activeMemberships = await prisma.campaignMembership.findMany({
    where: {
      userId: user.id,
      status: "active",
      campaign: { archivedAt: null },
    },
    include: { campaign: true },
    orderBy: { joinedAt: "asc" },
  });

  const campaigns: StatsCampaignOption[] = activeMemberships.map((m) => ({
    id: m.campaign.id,
    name: m.campaign.name,
    color: m.campaign.color,
    slug: m.campaign.slug,
  }));

  // Ignore unknown / non-member campaign query params.
  const scopedId =
    campaignId && campaigns.some((c) => c.id === campaignId) ? campaignId : null;

  const membershipIds = campaigns.map((c) => c.id);

  const [doorStats, checkouts, overallDoorStats, overallCheckouts, board] =
    await Promise.all([
      getDoorStats(user.id, scopedId),
      checkoutCounts(user.id, scopedId),
      scopedId ? getDoorStats(user.id, null) : Promise.resolve(null),
      scopedId ? checkoutCounts(user.id, null) : Promise.resolve(null),
      getAttemptLeaderboard(scopedId ? [scopedId] : membershipIds),
    ]);

  const campaignsJoined = activeMemberships.length;
  const overallMetrics = toAchievementMetrics(
    overallDoorStats ?? doorStats,
    (overallCheckouts ?? checkouts).listsCheckedOut,
    (overallCheckouts ?? checkouts).listsCompleted,
    campaignsJoined,
  );
  const viewMetrics = toAchievementMetrics(
    doorStats,
    checkouts.listsCheckedOut,
    checkouts.listsCompleted,
    campaignsJoined,
  );

  const campaignMetrics = await Promise.all(
    campaigns.map(async (c) => {
      if (scopedId === c.id) {
        return { campaignId: c.id, name: c.name, metrics: viewMetrics };
      }
      const [ds, co] = await Promise.all([
        getDoorStats(user.id, c.id),
        checkoutCounts(user.id, c.id),
      ]);
      return {
        campaignId: c.id,
        name: c.name,
        metrics: toAchievementMetrics(
          ds,
          co.listsCheckedOut,
          co.listsCompleted,
          campaignsJoined,
        ),
      };
    }),
  );

  const { achievements, unseenUnlocks } = await evaluateAchievements({
    userId: user.id,
    viewMetrics,
    viewCampaignId: scopedId,
    overallMetrics,
    campaignMetrics,
  });

  const totalOutcomes = Object.values(doorStats.outcomes).reduce((s, n) => s + n, 0);
  const responseRate =
    totalOutcomes > 0
      ? Math.round((doorStats.outcomes.contact / totalOutcomes) * 100)
      : 0;

  const outcomes: OutcomeRow[] = OUTCOME_META.map((m) => ({
    key: m.key,
    label: m.label,
    count: doorStats.outcomes[m.key],
    color: m.color,
  }));

  let breakdown: BreakdownRow[] = [];
  if (!scopedId) {
    const source = overallDoorStats ?? doorStats;
    breakdown = campaigns
      .map((c) => ({
        id: c.id,
        name: c.name,
        color: c.color,
        doors: source.doorsByCampaign[c.id] ?? 0,
      }))
      .filter((b) => b.doors > 0)
      .sort((a, b) => b.doors - a.doors);
  }

  const leaderboard: LeaderRow[] = board.map((e) => ({
    userId: e.userId,
    name: e.userId === user.id ? "You" : e.name,
    doors: e.doors,
    you: e.userId === user.id,
  }));
  if (doorStats.doorsKnocked > 0 && !leaderboard.some((e) => e.you)) {
    leaderboard.push({
      userId: user.id,
      name: "You",
      doors: doorStats.doorsKnocked,
      you: true,
    });
    leaderboard.sort((a, b) => b.doors - a.doors);
  }
  const rank =
    doorStats.doorsKnocked > 0
      ? leaderboard.findIndex((e) => e.you) + 1
      : 0;

  return {
    campaignId: scopedId,
    campaigns,
    doorsKnocked: doorStats.doorsKnocked,
    votersReached: doorStats.votersReached,
    litDropped: doorStats.litDropped,
    hoursActive: doorStats.hoursActive,
    listsCheckedOut: checkouts.listsCheckedOut,
    listsCompleted: checkouts.listsCompleted,
    campaignsJoined,
    responseRate,
    weeklyHistory: doorStats.weeklyHistory,
    outcomes,
    breakdown,
    achievements,
    unseenUnlocks,
    leaderboard,
    rank,
    empty: doorStats.doorsKnocked === 0 && checkouts.listsCheckedOut === 0,
  };
}
