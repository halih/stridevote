// Door-outcome statistics. Prefer real canvass attempts; fall back to sample
// data only when the user has no synced attempts yet.

import { prisma } from "@/lib/db";
import type { DoorOutcome } from "@/lib/canvass/outcomes";

export interface OutcomeCounts {
  contact: number;
  no_answer: number;
  refused: number;
  lit: number;
  unsafe: number;
  inaccessible: number;
}

export interface DoorStats {
  isSample: boolean;
  doorsKnocked: number;
  votersReached: number;
  litDropped: number;
  hoursActive: number;
  weeklyHistory: number[]; // last 8 weeks
  outcomes: OutcomeCounts;
}

const SAMPLE: DoorStats = {
  isSample: true,
  doorsKnocked: 794,
  votersReached: 463,
  litDropped: 71,
  hoursActive: 64,
  weeklyHistory: [58, 72, 64, 90, 81, 110, 95, 64],
  outcomes: {
    contact: 327,
    no_answer: 292,
    refused: 73,
    lit: 68,
    unsafe: 9,
    inaccessible: 27,
  },
};

export interface LeaderboardEntry {
  name: string;
  doors: number;
}

const LEADERBOARD: LeaderboardEntry[] = [
  { name: "Priya N.", doors: 1240 },
  { name: "Tom R.", doors: 980 },
  { name: "Sam K.", doors: 875 },
  { name: "Grace T.", doors: 640 },
  { name: "Derek O.", doors: 512 },
  { name: "Noor H.", doors: 455 },
  { name: "Felix B.", doors: 390 },
  { name: "Rosa M.", doors: 310 },
  { name: "Ken S.", doors: 275 },
  { name: "Alicia P.", doors: 190 },
];

function emptyOutcomes(): OutcomeCounts {
  return {
    contact: 0,
    no_answer: 0,
    refused: 0,
    lit: 0,
    unsafe: 0,
    inaccessible: 0,
  };
}

export async function getDoorStats(userId: string): Promise<DoorStats> {
  const attempts = await prisma.canvassAttempt.findMany({
    where: { userId },
    orderBy: { capturedAt: "desc" },
    select: {
      clientAttemptId: true,
      supersedesClientId: true,
      outcome: true,
      capturedAt: true,
      householdId: true,
      listId: true,
      programId: true,
      people: { select: { outcome: true } },
    },
  });

  if (!attempts.length) return SAMPLE;

  const superseded = new Set(
    attempts
      .map((a) => a.supersedesClientId)
      .filter((id): id is string => Boolean(id)),
  );

  const outcomes = emptyOutcomes();
  const doors = new Set<string>();
  let votersReached = 0;
  let litDropped = 0;
  let earliest = Date.now();
  let latest = 0;
  const weekBuckets = Array.from({ length: 8 }, () => 0);
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;

  for (const a of attempts) {
    if (superseded.has(a.clientAttemptId)) continue;
    const key = `${a.programId}:${a.listId}:${a.householdId}`;
    doors.add(key);
    const outcome = a.outcome as DoorOutcome | "moved";
    if (outcome in outcomes) {
      outcomes[outcome as keyof OutcomeCounts] += 1;
    }
    if (outcome === "lit") litDropped += 1;
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
    latest > earliest
      ? Math.max(1, Math.round((latest - earliest) / (1000 * 60 * 60)))
      : doors.size > 0
        ? 1
        : 0;

  return {
    isSample: false,
    doorsKnocked: doors.size,
    votersReached,
    litDropped,
    hoursActive,
    weeklyHistory: weekBuckets,
    outcomes,
  };
}

export function getSampleLeaderboard(): LeaderboardEntry[] {
  return LEADERBOARD.map((e) => ({ ...e }));
}

/** Campaign-scoped leaderboard from real attempts when available. */
export async function getAttemptLeaderboard(
  campaignIds: string[],
): Promise<LeaderboardEntry[]> {
  if (!campaignIds.length) return getSampleLeaderboard();
  const attempts = await prisma.canvassAttempt.findMany({
    where: { campaignId: { in: campaignIds } },
    select: {
      userId: true,
      clientAttemptId: true,
      supersedesClientId: true,
      user: { select: { name: true, initials: true } },
    },
  });
  if (!attempts.length) return getSampleLeaderboard();

  const superseded = new Set(
    attempts
      .map((a) => a.supersedesClientId)
      .filter((id): id is string => Boolean(id)),
  );
  const counts = new Map<string, { name: string; doors: number }>();
  for (const a of attempts) {
    if (superseded.has(a.clientAttemptId)) continue;
    const name =
      a.user.name ??
      (a.user.initials ? `${a.user.initials}` : "Volunteer");
    const prev = counts.get(a.userId) ?? { name, doors: 0 };
    prev.doors += 1;
    counts.set(a.userId, prev);
  }
  return [...counts.values()].sort((a, b) => b.doors - a.doors).slice(0, 10);
}
