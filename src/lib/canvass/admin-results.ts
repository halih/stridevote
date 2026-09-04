import "server-only";
import { prisma } from "@/lib/db";
import { can } from "@/lib/authz";
import { parseProgramQuestions } from "@/lib/canvass/programs";
import {
  DOOR_OUTCOME_LABELS,
  type DoorOutcome,
} from "@/lib/canvass/outcomes";
import { getCurrentAttemptsForList } from "@/lib/canvass/progress";
import type { User } from "@/generated/prisma";
import type { ProgramQuestion } from "@/lib/canvass/outcomes";

export interface ProgramAdminRow {
  id: string;
  name: string;
  status: string;
  script: string | null;
  questions: ProgramQuestion[];
  startsAt: string | null;
  endsAt: string | null;
  listCount: number;
  attemptCount: number;
}

export async function getCampaignPrograms(
  campaignId: string,
  user: User,
): Promise<ProgramAdminRow[] | null> {
  if (!(await can(user, campaignId, "lists:manage"))) return null;
  const programs = await prisma.canvassProgram.findMany({
    where: { campaignId },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    include: {
      _count: { select: { listLinks: true, attempts: true } },
    },
  });
  return programs.map((p) => ({
    id: p.id,
    name: p.name,
    status: p.status,
    script: p.script,
    questions: parseProgramQuestions(p.questions),
    startsAt: p.startsAt?.toISOString() ?? null,
    endsAt: p.endsAt?.toISOString() ?? null,
    listCount: p._count.listLinks,
    attemptCount: p._count.attempts,
  }));
}

export interface ProgramResultsView {
  program: ProgramAdminRow;
  doorsTotal: number;
  doorsClosed: number;
  doorsWithAttempt: number;
  outcomeCounts: Record<string, number>;
  volunteerTotals: Array<{ userId: string; name: string; attempts: number }>;
  lists: Array<{
    listId: string;
    name: string;
    doors: number;
    closed: number;
    checkedOutBy: string | null;
  }>;
  doorHistory: Array<{
    id: string;
    clientAttemptId: string;
    listName: string;
    address: string;
    outcome: string;
    outcomeLabel: string;
    canvasser: string;
    capturedAt: string;
    notes: string | null;
    staleCheckout: boolean;
    superseded: boolean;
    support: number | null;
  }>;
  staleAttempts: Array<{
    id: string;
    listName: string;
    address: string;
    canvasser: string;
    outcomeLabel: string;
    capturedAt: string;
  }>;
}

export async function getProgramResults(
  programId: string,
  user: User,
): Promise<ProgramResultsView | null> {
  const program = await prisma.canvassProgram.findUnique({
    where: { id: programId },
    include: {
      _count: { select: { listLinks: true, attempts: true } },
      listLinks: {
        include: {
          list: {
            include: {
              checkouts: {
                where: { status: "active", programId },
                include: {
                  user: { select: { name: true, email: true, phone: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!program) return null;
  if (
    !(await can(user, program.campaignId, "lists:manage")) &&
    !(await can(user, program.campaignId, "voters:view"))
  ) {
    return null;
  }

  const showNotes = await can(user, program.campaignId, "lists:manage");

  const programRow: ProgramAdminRow = {
    id: program.id,
    name: program.name,
    status: program.status,
    script: program.script,
    questions: parseProgramQuestions(program.questions),
    startsAt: program.startsAt?.toISOString() ?? null,
    endsAt: program.endsAt?.toISOString() ?? null,
    listCount: program._count.listLinks,
    attemptCount: program._count.attempts,
  };

  let doorsTotal = 0;
  let doorsClosed = 0;
  const lists = [];
  for (const link of program.listLinks) {
    const snapCount = await prisma.programListHousehold.count({
      where: { programId, listId: link.listId },
    });
    const doors = snapCount || link.list.doorsCount;
    const current = await getCurrentAttemptsForList(programId, link.listId);
    let closed = 0;
    for (const row of current.values()) {
      closed += 1;
    }
    doorsTotal += doors;
    doorsClosed += closed;
    const active = link.list.checkouts[0];
    lists.push({
      listId: link.listId,
      name: link.list.name,
      doors,
      closed,
      checkedOutBy: active
        ? active.user.name ?? active.user.email ?? active.user.phone ?? "Volunteer"
        : null,
    });
  }

  const attempts = await prisma.canvassAttempt.findMany({
    where: { programId },
    orderBy: { capturedAt: "desc" },
    take: 200,
    include: {
      list: { select: { name: true } },
      household: { select: { displayAddress: true } },
      user: { select: { name: true, email: true, phone: true } },
      people: { select: { support: true, outcome: true } },
    },
  });

  const supersededIds = new Set(
    attempts
      .map((a) => a.supersedesClientId)
      .filter((id): id is string => Boolean(id)),
  );

  const outcomeCounts: Record<string, number> = {};
  const volunteerMap = new Map<string, { name: string; attempts: number }>();
  let doorsWithAttempt = 0;
  const seenHousehold = new Set<string>();

  for (const a of attempts) {
    if (!supersededIds.has(a.clientAttemptId)) {
      outcomeCounts[a.outcome] = (outcomeCounts[a.outcome] ?? 0) + 1;
      if (!seenHousehold.has(`${a.listId}:${a.householdId}`)) {
        seenHousehold.add(`${a.listId}:${a.householdId}`);
        doorsWithAttempt += 1;
      }
    }
    const name = a.user.name ?? a.user.email ?? a.user.phone ?? "Volunteer";
    const prev = volunteerMap.get(a.userId) ?? { name, attempts: 0 };
    prev.attempts += 1;
    volunteerMap.set(a.userId, prev);
  }

  return {
    program: programRow,
    doorsTotal,
    doorsClosed,
    doorsWithAttempt,
    outcomeCounts,
    volunteerTotals: [...volunteerMap.entries()]
      .map(([userId, row]) => ({ userId, ...row }))
      .sort((a, b) => b.attempts - a.attempts),
    lists,
    doorHistory: attempts.map((a) => {
      const talked = a.people.find((p) => p.outcome === "talked" && p.support != null);
      return {
        id: a.id,
        clientAttemptId: a.clientAttemptId,
        listName: a.list.name,
        address: a.household.displayAddress,
        outcome: a.outcome,
        outcomeLabel: DOOR_OUTCOME_LABELS[a.outcome as DoorOutcome] ?? a.outcome,
        canvasser: a.user.name ?? a.user.email ?? a.user.phone ?? "Volunteer",
        capturedAt: a.capturedAt.toISOString(),
        notes: showNotes ? a.notes : null,
        staleCheckout: a.staleCheckout,
        superseded: supersededIds.has(a.clientAttemptId),
        support: talked?.support ?? null,
      };
    }),
    staleAttempts: attempts
      .filter((a) => a.staleCheckout && !supersededIds.has(a.clientAttemptId))
      .map((a) => ({
        id: a.id,
        listName: a.list.name,
        address: a.household.displayAddress,
        canvasser: a.user.name ?? a.user.email ?? a.user.phone ?? "Volunteer",
        outcomeLabel: DOOR_OUTCOME_LABELS[a.outcome as DoorOutcome] ?? a.outcome,
        capturedAt: a.capturedAt.toISOString(),
      })),
  };
}
