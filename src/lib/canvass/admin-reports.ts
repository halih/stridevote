import "server-only";

import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import { parseProgramQuestions } from "@/lib/canvass/programs";
import {
  DOOR_OUTCOME_LABELS,
  type DoorOutcome,
  type ProgramQuestion,
} from "@/lib/canvass/outcomes";
import { getCurrentAttemptsForProgram } from "@/lib/canvass/progress";
import {
  PROGRESSIVE_SCORES,
  PROGRESSIVE_SCORE_LABELS,
  type ProgressiveScore,
} from "@/lib/canvass/progressive-score";
import type { User } from "@/generated/prisma";

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

function addUtcDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

export type ReportRange = "7d" | "30d" | "wave";

export interface CampaignReportsView {
  campaign: { id: string; slug: string; name: string };
  programs: Array<{ id: string; name: string; status: string }>;
  programId: string;
  programName: string;
  range: ReportRange;
  rangeStart: string | null;
  rangeEnd: string;
  headlines: {
    doorsDone: number;
    doorsRemaining: number;
    doorsTotal: number;
    pctComplete: number;
    doorsToday: number;
    doorsLast7: number;
    canvassersThisWeek: number;
    membersActive: number;
    contactRate: number;
    noAnswerRate: number;
    refuseRate: number;
    movedVoters: number;
  };
  pace: Array<{ day: string; doors: number; contacts: number }>;
  outcomesByDay: Array<{ day: string; counts: Record<string, number> }>;
  outcomeTotals: Array<{ key: string; label: string; count: number }>;
  supportIds: Array<{ score: number; count: number }>;
  questionCharts: Array<{
    id: string;
    label: string;
    type: ProgramQuestion["type"];
    bars: Array<{ label: string; count: number }>;
    textResponses: Array<{ text: string; count: number }>;
  }>;
  coverage: Array<{
    listId: string;
    name: string;
    doors: number;
    closed: number;
    remaining: number;
    pct: number;
    checkedOutBy: string | null;
  }>;
  volunteers: Array<{
    userId: string;
    name: string;
    doors: number;
    contacts: number;
    lastActivity: string | null;
  }>;
  progressiveObserved: Array<{ key: string; label: string; count: number }>;
  progressiveTalk: Array<{ key: string; label: string; count: number }>;
  progressiveHeadlines: {
    observedScored: number;
    talkScored: number;
    observedPct0: number;
    talkPct0: number;
    observedPct45: number;
    talkPct45: number;
  };
}

export async function getCampaignReportsView(
  slug: string,
  user: User,
  opts: { programId?: string | null; range?: ReportRange | null },
): Promise<CampaignReportsView | null> {
  const campaign = await prisma.campaign.findFirst({
    where: { slug, archivedAt: null },
    select: { id: true, slug: true, name: true },
  });
  if (!campaign) return null;
  if (
    !(await can(user, campaign.id, "lists:manage")) &&
    !(await can(user, campaign.id, "voters:view"))
  ) {
    return null;
  }

  const programs = await prisma.canvassProgram.findMany({
    where: { campaignId: campaign.id },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: { id: true, name: true, status: true, questions: true, createdAt: true },
  });
  if (!programs.length) {
    return emptyView(campaign, opts.range ?? "7d");
  }

  const active =
    programs.find((p) => p.status === "active") ??
    programs[0];
  const program =
    (opts.programId
      ? programs.find((p) => p.id === opts.programId)
      : null) ?? active;

  const range: ReportRange =
    opts.range === "30d" || opts.range === "wave" || opts.range === "7d"
      ? opts.range
      : "7d";

  const now = new Date();
  const rangeEnd = now;
  const rangeStart =
    range === "wave"
      ? null
      : addUtcDays(startOfUtcDay(now), range === "30d" ? -29 : -6);
  const chartStart =
    rangeStart ??
    startOfUtcDay(
      program.createdAt < addUtcDays(now, -89)
        ? addUtcDays(now, -89)
        : program.createdAt,
    );

  const questions = parseProgramQuestions(program.questions);
  const current = await getCurrentAttemptsForProgram(program.id);

  const listLinks = await prisma.listCampaign.findMany({
    where: { programId: program.id },
    include: {
      list: {
        select: {
          id: true,
          name: true,
          doorsCount: true,
          checkouts: {
            where: { status: "active", programId: program.id },
            take: 1,
            include: {
              user: { select: { name: true, email: true, phone: true } },
            },
          },
        },
      },
    },
  });

  let doorsTotal = 0;
  const coverage: CampaignReportsView["coverage"] = [];
  for (const link of listLinks) {
    const snapCount = await prisma.programListHousehold.count({
      where: { programId: program.id, listId: link.listId },
    });
    const doors = snapCount || link.list.doorsCount;
    let closed = 0;
    for (const row of current.values()) {
      if (row.listId === link.listId) closed += 1;
    }
    doorsTotal += doors;
    const activeCheckout = link.list.checkouts[0];
    coverage.push({
      listId: link.listId,
      name: link.list.name,
      doors,
      closed,
      remaining: Math.max(0, doors - closed),
      pct: doors ? Math.round((closed / doors) * 100) : 0,
      checkedOutBy: activeCheckout
        ? activeCheckout.user.name ??
          activeCheckout.user.email ??
          activeCheckout.user.phone ??
          "Volunteer"
        : null,
    });
  }
  coverage.sort((a, b) => b.remaining - a.remaining || a.name.localeCompare(b.name));

  const currentIds = [...current.values()].map((c) => c.clientAttemptId);
  const currentAttempts =
    currentIds.length === 0
      ? []
      : await prisma.canvassAttempt.findMany({
          where: { clientAttemptId: { in: currentIds } },
          select: {
            clientAttemptId: true,
            householdId: true,
            listId: true,
            userId: true,
            outcome: true,
            capturedAt: true,
            observedScore: true,
            user: { select: { name: true, email: true, phone: true } },
            people: {
              select: {
                outcome: true,
                support: true,
                talkScore: true,
                answers: true,
              },
            },
          },
        });

  const inRange = (d: Date) =>
    !rangeStart || d >= rangeStart;

  const paceMap = new Map<string, { doors: number; contacts: number }>();
  const outcomeDayMap = new Map<string, Record<string, number>>();
  const outcomeTotals: Record<string, number> = {};
  const supportCounts = new Map<number, number>();
  const volunteerMap = new Map<
    string,
    { name: string; doors: number; contacts: number; lastActivity: Date | null }
  >();
  const observedDist = emptyScoreDist();
  const talkDist = emptyScoreDist();
  let observedScored = 0;
  let talkScored = 0;
  let movedVoters = 0;
  let doorsToday = 0;
  let doorsLast7 = 0;
  const weekStart = addUtcDays(startOfUtcDay(now), -6);
  const todayKey = dayKey(startOfUtcDay(now));
  const canvassersWeek = new Set<string>();

  const questionAgg = new Map<
    string,
    {
      question: ProgramQuestion;
      optionCounts: Map<string, number>;
      textCounts: Map<string, number>;
    }
  >();
  for (const q of questions) {
    questionAgg.set(q.id, {
      question: q,
      optionCounts: new Map(),
      textCounts: new Map(),
    });
  }

  for (const a of currentAttempts) {
    if (!inRange(a.capturedAt)) continue;
    const day = dayKey(a.capturedAt);
    const pace = paceMap.get(day) ?? { doors: 0, contacts: 0 };
    pace.doors += 1;
    if (a.outcome === "contact") pace.contacts += 1;
    paceMap.set(day, pace);

    const dayOutcomes = outcomeDayMap.get(day) ?? {};
    dayOutcomes[a.outcome] = (dayOutcomes[a.outcome] ?? 0) + 1;
    outcomeDayMap.set(day, dayOutcomes);
    outcomeTotals[a.outcome] = (outcomeTotals[a.outcome] ?? 0) + 1;

    if (day === todayKey) doorsToday += 1;
    if (a.capturedAt >= weekStart) {
      doorsLast7 += 1;
      canvassersWeek.add(a.userId);
    }

    const name = a.user.name ?? a.user.email ?? a.user.phone ?? "Volunteer";
    const vol = volunteerMap.get(a.userId) ?? {
      name,
      doors: 0,
      contacts: 0,
      lastActivity: null as Date | null,
    };
    vol.doors += 1;
    if (a.outcome === "contact") vol.contacts += 1;
    if (!vol.lastActivity || a.capturedAt > vol.lastActivity) {
      vol.lastActivity = a.capturedAt;
    }
    volunteerMap.set(a.userId, vol);

    if (a.observedScore == null) {
      observedDist.unknown += 1;
    } else if (a.observedScore >= 0 && a.observedScore <= 5) {
      observedDist[a.observedScore as ProgressiveScore] += 1;
      observedScored += 1;
    }

    for (const p of a.people) {
      if (p.outcome === "moved") movedVoters += 1;
      if (p.outcome !== "talked") continue;
      if (p.support != null) {
        supportCounts.set(p.support, (supportCounts.get(p.support) ?? 0) + 1);
      }
      if (p.talkScore == null) {
        talkDist.unknown += 1;
      } else if (p.talkScore >= 0 && p.talkScore <= 5) {
        talkDist[p.talkScore as ProgressiveScore] += 1;
        talkScored += 1;
      }
      const answers =
        p.answers && typeof p.answers === "object" && !Array.isArray(p.answers)
          ? (p.answers as Record<string, unknown>)
          : {};
      for (const [qid, agg] of questionAgg) {
        const raw = answers[qid];
        if (raw == null || raw === "") continue;
        if (agg.question.type === "multi" && Array.isArray(raw)) {
          for (const opt of raw) {
            if (typeof opt === "string") {
              agg.optionCounts.set(opt, (agg.optionCounts.get(opt) ?? 0) + 1);
            }
          }
        } else if (agg.question.type === "text" && typeof raw === "string") {
          const t = raw.trim();
          if (t) agg.textCounts.set(t, (agg.textCounts.get(t) ?? 0) + 1);
        } else if (agg.question.type === "support" && typeof raw === "number") {
          const label = String(raw);
          agg.optionCounts.set(label, (agg.optionCounts.get(label) ?? 0) + 1);
        } else if (typeof raw === "string" || typeof raw === "number") {
          const label = String(raw);
          agg.optionCounts.set(label, (agg.optionCounts.get(label) ?? 0) + 1);
        }
      }
    }
  }

  const dayKeys = enumerateDays(chartStart, rangeEnd);
  const pace = dayKeys.map((day) => ({
    day,
    doors: paceMap.get(day)?.doors ?? 0,
    contacts: paceMap.get(day)?.contacts ?? 0,
  }));
  const outcomesByDay = dayKeys.map((day) => ({
    day,
    counts: outcomeDayMap.get(day) ?? {},
  }));

  const doorsDoneInRange = currentAttempts.filter((a) => inRange(a.capturedAt)).length;
  // Headlines for completion use all current doors in the wave, not only the date range.
  const doorsDone = current.size;
  const doorsRemaining = Math.max(0, doorsTotal - doorsDone);
  const withResult = Object.values(outcomeTotals).reduce((s, n) => s + n, 0);
  const contacts = outcomeTotals.contact ?? 0;
  const noAnswers = outcomeTotals.no_answer ?? 0;
  const refuses = outcomeTotals.refused ?? 0;

  const membersActive = await prisma.campaignMembership.count({
    where: { campaignId: campaign.id, status: "active" },
  });

  const pct = (n: number, d: number) => (d ? Math.round((n / d) * 100) : 0);

  return {
    campaign,
    programs: programs.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
    })),
    programId: program.id,
    programName: program.name,
    range,
    rangeStart: rangeStart?.toISOString() ?? null,
    rangeEnd: rangeEnd.toISOString(),
    headlines: {
      doorsDone,
      doorsRemaining,
      doorsTotal,
      pctComplete: pct(doorsDone, doorsTotal),
      doorsToday,
      doorsLast7,
      canvassersThisWeek: canvassersWeek.size,
      membersActive,
      contactRate: pct(contacts, withResult || doorsDoneInRange),
      noAnswerRate: pct(noAnswers, withResult || doorsDoneInRange),
      refuseRate: pct(refuses, withResult || doorsDoneInRange),
      movedVoters,
    },
    pace,
    outcomesByDay,
    outcomeTotals: Object.entries(outcomeTotals)
      .map(([key, count]) => ({
        key,
        label: DOOR_OUTCOME_LABELS[key as DoorOutcome] ?? key,
        count,
      }))
      .sort((a, b) => b.count - a.count),
    supportIds: [1, 2, 3, 4, 5].map((score) => ({
      score,
      count: supportCounts.get(score) ?? 0,
    })),
    questionCharts: [...questionAgg.values()].map(({ question, optionCounts, textCounts }) => {
      let bars: Array<{ label: string; count: number }> = [];
      if (question.type === "yes_no") {
        bars = ["Yes", "No"].map((label) => ({
          label,
          count: optionCounts.get(label) ?? 0,
        }));
      } else if (question.type === "support") {
        bars = [1, 2, 3, 4, 5].map((n) => ({
          label: String(n),
          count: optionCounts.get(String(n)) ?? 0,
        }));
      } else if (question.type === "single" || question.type === "multi") {
        const opts = question.options ?? [];
        bars = opts.map((label) => ({
          label,
          count: optionCounts.get(label) ?? 0,
        }));
        for (const [label, count] of optionCounts) {
          if (!opts.includes(label)) bars.push({ label, count });
        }
      }
      return {
        id: question.id,
        label: question.label,
        type: question.type,
        bars,
        textResponses: [...textCounts.entries()]
          .map(([text, count]) => ({ text, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 25),
      };
    }),
    coverage,
    volunteers: [...volunteerMap.entries()]
      .map(([userId, row]) => ({
        userId,
        name: row.name,
        doors: row.doors,
        contacts: row.contacts,
        lastActivity: row.lastActivity?.toISOString() ?? null,
      }))
      .sort((a, b) => b.doors - a.doors || a.name.localeCompare(b.name)),
    progressiveObserved: scoreDistRows(observedDist),
    progressiveTalk: scoreDistRows(talkDist),
    progressiveHeadlines: {
      observedScored,
      talkScored,
      observedPct0: pct(observedDist[0], observedScored),
      talkPct0: pct(talkDist[0], talkScored),
      observedPct45: pct(observedDist[4] + observedDist[5], observedScored),
      talkPct45: pct(talkDist[4] + talkDist[5], talkScored),
    },
  };
}

type ScoreDist = Record<ProgressiveScore | "unknown", number>;

function emptyScoreDist(): ScoreDist {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, unknown: 0 };
}

function scoreDistRows(dist: ScoreDist) {
  return [
    ...PROGRESSIVE_SCORES.map((n) => ({
      key: String(n),
      label: `${n} · ${PROGRESSIVE_SCORE_LABELS[n]}`,
      count: dist[n],
    })),
    { key: "unknown", label: "Unknown", count: dist.unknown },
  ];
}

function enumerateDays(start: Date | null, end: Date): string[] {
  const days: string[] = [];
  let cursor = startOfUtcDay(start ?? addUtcDays(end, -13));
  const last = startOfUtcDay(end);
  while (cursor <= last) {
    days.push(dayKey(cursor));
    cursor = addUtcDays(cursor, 1);
  }
  return days;
}

function emptyView(
  campaign: { id: string; slug: string; name: string },
  range: ReportRange,
): CampaignReportsView {
  return {
    campaign,
    programs: [],
    programId: "",
    programName: "No waves",
    range,
    rangeStart: null,
    rangeEnd: new Date().toISOString(),
    headlines: {
      doorsDone: 0,
      doorsRemaining: 0,
      doorsTotal: 0,
      pctComplete: 0,
      doorsToday: 0,
      doorsLast7: 0,
      canvassersThisWeek: 0,
      membersActive: 0,
      contactRate: 0,
      noAnswerRate: 0,
      refuseRate: 0,
      movedVoters: 0,
    },
    pace: [],
    outcomesByDay: [],
    outcomeTotals: [],
    supportIds: [],
    questionCharts: [],
    coverage: [],
    volunteers: [],
    progressiveObserved: [],
    progressiveTalk: [],
    progressiveHeadlines: {
      observedScored: 0,
      talkScored: 0,
      observedPct0: 0,
      talkPct0: 0,
      observedPct45: 0,
      talkPct45: 0,
    },
  };
}
