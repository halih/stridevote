import "server-only";
import { prisma } from "@/lib/db";
import { haversineMiles, pointInPolygon, roundMiles } from "@/lib/geo";
import { getDoorStats, getSampleLeaderboard } from "@/lib/stats-source";
import type { User } from "@/generated/prisma";

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
    orderBy: { name: "asc" },
    include: {
      contacts: { take: 1 },
      memberships: { where: { userId: user.id } },
      listLinks: {
        where: {
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
      volunteers: c.volunteers,
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
}

export async function getCanvassBoard(user: User): Promise<ListVM[]> {
  const activeMemberships = await prisma.campaignMembership.findMany({
    where: { userId: user.id, status: "active" },
    select: { campaignId: true },
  });
  const activeIds = activeMemberships.map((m) => m.campaignId);
  if (!activeIds.length) return [];

  const lists = await prisma.list.findMany({
    where: {
      campaignLinks: {
        some: {
          campaignId: { in: activeIds },
          OR: [
            { visibility: "volunteers" },
            { visibility: "assigned", assignedUserId: user.id },
          ],
        },
      },
    },
    include: {
      checkouts: { where: { status: "active" }, include: { user: true } },
      watches: { where: { userId: user.id } },
      campaignLinks: {
        where: {
          campaignId: { in: activeIds },
          OR: [
            { visibility: "volunteers" },
            { visibility: "assigned", assignedUserId: user.id },
          ],
        },
        include: { campaign: true },
      },
    },
  });

  const vms: ListVM[] = lists.map((l) => {
    const mineCheckout = l.checkouts.find((co) => co.userId === user.id);
    const otherCheckout = l.checkouts.find((co) => co.userId !== user.id);
    const status: ListStatus = mineCheckout
      ? "mine"
      : otherCheckout
        ? "taken"
        : "available";
    const distanceMi =
      user.homeLat != null && user.homeLng != null && l.centroidLat != null && l.centroidLng != null
        ? roundMiles(haversineMiles(user.homeLat, user.homeLng, l.centroidLat, l.centroidLng))
        : null;
    return {
      id: l.id,
      slug: l.slug,
      name: l.name,
      source: l.source,
      sourceRef: l.sourceRef,
      doorsCount: l.doorsCount,
      distanceMi: distanceMi ?? null,
      status,
      takenBy: otherCheckout?.user.name ?? (otherCheckout ? "another canvasser" : null),
      progressDone: mineCheckout?.progressDone ?? 0,
      progressTotal: mineCheckout?.progressTotal ?? l.doorsCount,
      watching: l.watches.length > 0,
      boundary: boundaryOf(l.boundary),
      centroidLat: l.centroidLat,
      centroidLng: l.centroidLng,
      campaigns: l.campaignLinks.map((cl) => ({
        name: cl.campaign.name,
        color: cl.campaign.color,
        pickup: pickupOf(cl.campaign),
      })),
    };
  });

  vms.sort((a, b) => (a.distanceMi ?? 999) - (b.distanceMi ?? 999));
  return vms;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ---- Stats ----
export interface OutcomeRow {
  key: string;
  label: string;
  count: number;
  color: string;
}
export interface BreakdownRow {
  name: string;
  color: string;
  doors: number;
}
export interface AchievementVM {
  id: string;
  title: string;
  desc: string;
  earned: boolean;
  progress: number; // 0..1
  progressLabel: string;
}
export interface LeaderRow {
  name: string;
  doors: number;
  you: boolean;
}
export interface StatsView {
  isSample: boolean;
  doorsKnocked: number;
  votersReached: number;
  litDropped: number;
  hoursActive: number;
  listsCheckedOut: number;
  campaignsJoined: number;
  responseRate: number;
  weeklyHistory: number[];
  outcomes: OutcomeRow[];
  breakdown: BreakdownRow[];
  achievements: AchievementVM[];
  leaderboard: LeaderRow[];
  rank: number;
}

const OUTCOME_META: { key: keyof import("@/lib/stats-source").OutcomeCounts; label: string; color: string }[] = [
  { key: "contact", label: "Spoke with voter", color: "#2e9e5b" },
  { key: "no_answer", label: "No answer", color: "#8a8f98" },
  { key: "refused", label: "Declined", color: "#c97a2e" },
  { key: "lit", label: "Left literature", color: "#378add" },
  { key: "inaccessible", label: "Inaccessible", color: "#5b6067" },
  { key: "unsafe", label: "Unsafe / skip", color: "#d64545" },
];

export async function getStatsView(user: User): Promise<StatsView> {
  const [doorStats, activeMemberships, checkouts] = await Promise.all([
    getDoorStats(user.id),
    prisma.campaignMembership.findMany({
      where: { userId: user.id, status: "active" },
      include: { campaign: true },
    }),
    prisma.listCheckout.findMany({
      where: { userId: user.id },
      include: { list: { include: { campaignLinks: true } } },
    }),
  ]);

  const realDoors = checkouts.reduce((s, c) => s + c.progressDone, 0);
  const doorsKnocked = doorStats.doorsKnocked + realDoors;
  const listsCheckedOut = checkouts.length;
  const campaignsJoined = activeMemberships.length;

  const totalOutcomes = Object.values(doorStats.outcomes).reduce((s, n) => s + n, 0) || 1;
  const responseRate = Math.round((doorStats.outcomes.contact / totalOutcomes) * 100);

  const outcomes: OutcomeRow[] = OUTCOME_META.map((m) => ({
    key: m.key,
    label: m.label,
    count: doorStats.outcomes[m.key],
    color: m.color,
  }));

  // Doors per active campaign — real progress where present, else a sample split.
  const byCampaign = new Map<string, BreakdownRow>();
  for (const m of activeMemberships) {
    byCampaign.set(m.campaignId, { name: m.campaign.name, color: m.campaign.color, doors: 0 });
  }
  for (const co of checkouts) {
    for (const link of co.list.campaignLinks) {
      const row = byCampaign.get(link.campaignId);
      if (row) row.doors += co.progressDone;
    }
  }
  let breakdown = [...byCampaign.values()];
  const realTotal = breakdown.reduce((s, b) => s + b.doors, 0);
  if (realTotal === 0 && breakdown.length) {
    const per = Math.floor(doorStats.doorsKnocked / breakdown.length);
    breakdown = breakdown.map((b, i) => ({
      ...b,
      doors: i === 0 ? doorStats.doorsKnocked - per * (breakdown.length - 1) : per,
    }));
  }
  breakdown.sort((a, b) => b.doors - a.doors);

  const achievements: AchievementVM[] = [
    achievement("first-list", "First steps", "Check out your first list", listsCheckedOut, 1),
    achievement("centurion", "Centurion", "Knock 100 doors", doorsKnocked, 100),
    achievement("coalition", "Coalition builder", "Join 3 campaigns", campaignsJoined, 3),
    achievement("marathon", "Marathoner", "Knock 1,000 doors", doorsKnocked, 1000),
  ];

  const leaderboard: LeaderRow[] = [
    ...getSampleLeaderboard().map((e) => ({ ...e, you: false })),
    { name: "You", doors: doorsKnocked, you: true },
  ].sort((a, b) => b.doors - a.doors);
  const rank = leaderboard.findIndex((e) => e.you) + 1;

  return {
    isSample: doorStats.isSample,
    doorsKnocked,
    votersReached: doorStats.votersReached,
    litDropped: doorStats.litDropped,
    hoursActive: doorStats.hoursActive,
    listsCheckedOut,
    campaignsJoined,
    responseRate,
    weeklyHistory: doorStats.weeklyHistory,
    outcomes,
    breakdown,
    achievements,
    leaderboard,
    rank,
  };
}

function achievement(
  id: string,
  title: string,
  desc: string,
  value: number,
  target: number,
): AchievementVM {
  const earned = value >= target;
  return {
    id,
    title,
    desc,
    earned,
    progress: Math.min(1, value / target),
    progressLabel: earned ? "Earned" : `${Math.min(value, target)}/${target}`,
  };
}
