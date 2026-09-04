import { prisma } from "@/lib/db";

/**
 * Latest non-superseded attempt per household for a program+list.
 * An attempt is "current" when no other attempt in the same program/list/household
 * has supersedesClientId === this.clientAttemptId.
 */
export async function getCurrentAttemptsForList(
  programId: string,
  listId: string,
): Promise<
  Map<
    string,
    {
      clientAttemptId: string;
      outcome: string;
      capturedAt: Date;
      userId: string;
      support: number | null;
    }
  >
> {
  const attempts = await prisma.canvassAttempt.findMany({
    where: { programId, listId },
    orderBy: { capturedAt: "desc" },
    select: {
      clientAttemptId: true,
      householdId: true,
      outcome: true,
      capturedAt: true,
      userId: true,
      supersedesClientId: true,
      people: { select: { support: true, outcome: true } },
    },
  });

  const superseded = new Set(
    attempts
      .map((a) => a.supersedesClientId)
      .filter((id): id is string => Boolean(id)),
  );

  const byHousehold = new Map<
    string,
    {
      clientAttemptId: string;
      outcome: string;
      capturedAt: Date;
      userId: string;
      support: number | null;
    }
  >();

  for (const a of attempts) {
    if (superseded.has(a.clientAttemptId)) continue;
    if (byHousehold.has(a.householdId)) continue;
    const talked = a.people.find((p) => p.outcome === "talked" && p.support != null);
    byHousehold.set(a.householdId, {
      clientAttemptId: a.clientAttemptId,
      outcome: a.outcome,
      capturedAt: a.capturedAt,
      userId: a.userId,
      support: talked?.support ?? null,
    });
  }

  return byHousehold;
}

/**
 * Latest non-superseded attempt per household for a whole program
 * (across all lists in that wave).
 */
export async function getCurrentAttemptsForProgram(
  programId: string,
): Promise<
  Map<
    string,
    {
      clientAttemptId: string;
      outcome: string;
      capturedAt: Date;
      userId: string;
      listId: string;
    }
  >
> {
  const attempts = await prisma.canvassAttempt.findMany({
    where: { programId },
    orderBy: { capturedAt: "desc" },
    select: {
      clientAttemptId: true,
      householdId: true,
      listId: true,
      outcome: true,
      capturedAt: true,
      userId: true,
      supersedesClientId: true,
    },
  });

  const superseded = new Set(
    attempts
      .map((a) => a.supersedesClientId)
      .filter((id): id is string => Boolean(id)),
  );

  const byHousehold = new Map<
    string,
    {
      clientAttemptId: string;
      outcome: string;
      capturedAt: Date;
      userId: string;
      listId: string;
    }
  >();

  for (const a of attempts) {
    if (superseded.has(a.clientAttemptId)) continue;
    if (byHousehold.has(a.householdId)) continue;
    byHousehold.set(a.householdId, {
      clientAttemptId: a.clientAttemptId,
      outcome: a.outcome,
      capturedAt: a.capturedAt,
      userId: a.userId,
      listId: a.listId,
    });
  }

  return byHousehold;
}

export type CampaignDoorAttempt = {
  clientAttemptId: string;
  outcome: string;
  capturedAt: Date;
  userId: string;
  listId: string;
  programId: string;
  programName: string;
};

/**
 * Current door attempts across every wave in a campaign.
 * - `latestByHousehold`: newest current result (for the Canvass column)
 * - `canvassedHouseholdIds`: doors with a current result in any wave
 * - `inaccessibleHouseholdIds`: doors with a current inaccessible in any wave
 */
export async function getCampaignCanvassAudience(campaignId: string): Promise<{
  latestByHousehold: Map<string, CampaignDoorAttempt>;
  canvassedHouseholdIds: string[];
  inaccessibleHouseholdIds: string[];
}> {
  const attempts = await prisma.canvassAttempt.findMany({
    where: { program: { campaignId } },
    orderBy: { capturedAt: "desc" },
    select: {
      clientAttemptId: true,
      householdId: true,
      listId: true,
      programId: true,
      outcome: true,
      capturedAt: true,
      userId: true,
      supersedesClientId: true,
      program: { select: { name: true } },
    },
  });

  const superseded = new Set(
    attempts
      .map((a) => a.supersedesClientId)
      .filter((id): id is string => Boolean(id)),
  );

  const perProgram = new Map<string, CampaignDoorAttempt>();
  for (const a of attempts) {
    if (superseded.has(a.clientAttemptId)) continue;
    const key = `${a.programId}:${a.householdId}`;
    if (perProgram.has(key)) continue;
    perProgram.set(key, {
      clientAttemptId: a.clientAttemptId,
      outcome: a.outcome,
      capturedAt: a.capturedAt,
      userId: a.userId,
      listId: a.listId,
      programId: a.programId,
      programName: a.program.name,
    });
  }

  const latestByHousehold = new Map<string, CampaignDoorAttempt>();
  const canvassed = new Set<string>();
  const inaccessible = new Set<string>();

  for (const [key, row] of perProgram) {
    const householdId = key.slice(key.indexOf(":") + 1);
    canvassed.add(householdId);
    if (row.outcome === "inaccessible") inaccessible.add(householdId);
    const prev = latestByHousehold.get(householdId);
    if (!prev || row.capturedAt > prev.capturedAt) {
      latestByHousehold.set(householdId, row);
    }
  }

  return {
    latestByHousehold,
    canvassedHouseholdIds: [...canvassed],
    inaccessibleHouseholdIds: [...inaccessible],
  };
}

/** Done doors = households with any current result (lit, contact, etc.). */
export async function countClosedDoors(
  programId: string,
  listId: string,
): Promise<number> {
  const current = await getCurrentAttemptsForList(programId, listId);
  return current.size;
}

/** Refresh denormalized checkout progress from attempt-derived done doors. */
export async function refreshCheckoutProgress(
  checkoutId: string,
): Promise<void> {
  const checkout = await prisma.listCheckout.findUnique({
    where: { id: checkoutId },
    select: { id: true, listId: true, programId: true, progressTotal: true },
  });
  if (!checkout) return;
  const closed = await countClosedDoors(checkout.programId, checkout.listId);
  await prisma.listCheckout.update({
    where: { id: checkout.id },
    data: {
      progressDone: closed,
      progressTotal: checkout.progressTotal || undefined,
    },
  });
}
