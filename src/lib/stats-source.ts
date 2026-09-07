// Door-outcome and leaderboard stats from real CanvassAttempt rows.

import { prisma } from "@/lib/db";
import type { DoorOutcome } from "@/lib/canvass/outcomes";

export interface OutcomeCounts {
  contact: number;
  no_answer: number;
  refused: number;
  lit: number;
  unsafe: number;
  inaccessible: number;
  moved: number;
}

export interface DoorStats {
  doorsKnocked: number;
  votersReached: number;
  litDropped: number;
  contacts: number;
  hoursActive: number;
  weeklyHistory: number[]; // last 8 weeks, oldest → newest
  outcomes: OutcomeCounts;
  /** Unique doors per campaignId (overall view only; empty when scoped). */
  doorsByCampaign: Record<string, number>;
}

export interface LeaderboardEntry {
  userId: string;
  name: string;
  doors: number;
}

export function emptyOutcomes(): OutcomeCounts {
  return {
    contact: 0,
    no_answer: 0,
    refused: 0,
    lit: 0,
    unsafe: 0,
    inaccessible: 0,
    moved: 0,
  };
}

function emptyDoorStats(): DoorStats {
  return {
    doorsKnocked: 0,
    votersReached: 0,
    litDropped: 0,
    contacts: 0,
    hoursActive: 0,
    weeklyHistory: Array.from({ length: 8 }, () => 0),
    outcomes: emptyOutcomes(),
    doorsByCampaign: {},
  };
}

/** Display name as "First L." when possible. */
export function anonymizeVolunteerName(
  name: string | null | undefined,
  initials?: string | null,
): string {
  const trimmed = name?.trim();
  if (trimmed) {
    const parts = trimmed.split(/\s+/).filter(Boolean);
    if (parts.length === 1) return parts[0];
    const last = parts[parts.length - 1];
    return `${parts[0]} ${last.charAt(0).toUpperCase()}.`;
  }
  if (initials?.trim()) return initials.trim();
  return "Volunteer";
}

export async function getDoorStats(
  userId: string,
  campaignId?: string | null,
): Promise<DoorStats> {
  const attempts = await prisma.canvassAttempt.findMany({
    where: {
      userId,
      ...(campaignId ? { campaignId } : {}),
    },
    orderBy: { capturedAt: "desc" },
    select: {
      clientAttemptId: true,
      supersedesClientId: true,
      outcome: true,
      capturedAt: true,
      householdId: true,
      listId: true,
      programId: true,
      campaignId: true,
      people: { select: { outcome: true } },
    },
  });

  if (!attempts.length) return emptyDoorStats();

  const superseded = new Set(
    attempts
      .map((a) => a.supersedesClientId)
      .filter((id): id is string => Boolean(id)),
  );

  const outcomes = emptyOutcomes();
  const doors = new Set<string>();
  const doorsByCampaign = new Map<string, Set<string>>();
  let votersReached = 0;
  let litDropped = 0;
  let contacts = 0;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = 0;
  const weekBuckets = Array.from({ length: 8 }, () => 0);
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  for (const a of attempts) {
    if (superseded.has(a.clientAttemptId)) continue;
    const key = `${a.programId}:${a.listId}:${a.householdId}`;
    doors.add(key);

    if (!campaignId) {
      let set = doorsByCampaign.get(a.campaignId);
      if (!set) {
        set = new Set();
        doorsByCampaign.set(a.campaignId, set);
      }
      set.add(key);
    }

    const outcome = a.outcome as DoorOutcome;
    if (outcome in outcomes) {
      outcomes[outcome as keyof OutcomeCounts] += 1;
    }
    if (outcome === "lit") litDropped += 1;
    if (outcome === "contact") contacts += 1;
    votersReached += a.people.filter((p) => p.outcome === "talked").length;
    const t = a.capturedAt.getTime();
    earliest = Math.min(earliest, t);
    latest = Math.max(latest, t);
    const weeksAgo = Math.floor((now - t) / weekMs);
    if (weeksAgo >= 0 && weeksAgo < 8) {
      weekBuckets[7 - weeksAgo] += 1;
    }
  }

  const hoursActive =
    latest > earliest && Number.isFinite(earliest)
      ? Math.max(1, Math.round((latest - earliest) / (1000 * 60 * 60)))
      : doors.size > 0
        ? 1
        : 0;

  const byCampaign: Record<string, number> = {};
  for (const [id, set] of doorsByCampaign) {
    byCampaign[id] = set.size;
  }

  return {
    doorsKnocked: doors.size,
    votersReached,
    litDropped,
    contacts,
    hoursActive,
    weeklyHistory: weekBuckets,
    outcomes,
    doorsByCampaign: byCampaign,
  };
}

/** Unique-door leaderboard for the given campaigns. */
export async function getAttemptLeaderboard(
  campaignIds: string[],
): Promise<LeaderboardEntry[]> {
  if (!campaignIds.length) return [];

  const attempts = await prisma.canvassAttempt.findMany({
    where: { campaignId: { in: campaignIds } },
    select: {
      userId: true,
      clientAttemptId: true,
      supersedesClientId: true,
      programId: true,
      listId: true,
      householdId: true,
      user: { select: { name: true, initials: true } },
    },
  });
  if (!attempts.length) return [];

  const superseded = new Set(
    attempts
      .map((a) => a.supersedesClientId)
      .filter((id): id is string => Boolean(id)),
  );
  const doorsByUser = new Map<string, { name: string; doors: Set<string> }>();
  for (const a of attempts) {
    if (superseded.has(a.clientAttemptId)) continue;
    const name = anonymizeVolunteerName(a.user.name, a.user.initials);
    let entry = doorsByUser.get(a.userId);
    if (!entry) {
      entry = { name, doors: new Set() };
      doorsByUser.set(a.userId, entry);
    }
    entry.doors.add(`${a.programId}:${a.listId}:${a.householdId}`);
  }
  return [...doorsByUser.entries()]
    .map(([userId, { name, doors }]) => ({
      userId,
      name,
      doors: doors.size,
    }))
    .sort((a, b) => b.doors - a.doors)
    .slice(0, 10);
}
