import { z } from "zod";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import {
  DOOR_OUTCOMES,
  PERSON_OUTCOMES,
  isDoorOutcome,
} from "@/lib/canvass/outcomes";
import { refreshCheckoutProgress } from "@/lib/canvass/progress";
import { resolveSplitRedirect } from "@/lib/canvass/list-split-redirect";
import { applyFieldWriteback } from "@/lib/canvass/field-layer";
import { isProgressiveScore } from "@/lib/canvass/progressive-score";

const progressiveScoreSchema = z.number().int().min(0).max(5).nullable();

const personResponseSchema = z.object({
  voterId: z.string().min(1),
  outcome: z.enum(PERSON_OUTCOMES),
  support: z.number().int().min(1).max(5).nullable().optional(),
  talkScore: progressiveScoreSchema.optional(),
  clearTalkScore: z.boolean().optional(),
  answers: z.record(z.unknown()).optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const syncAttemptSchema = z.object({
  clientAttemptId: z.string().uuid(),
  programId: z.string().min(1),
  listId: z.string().min(1),
  householdId: z.string().min(1),
  checkoutId: z.string().min(1).nullable().optional(),
  campaignId: z.string().min(1),
  outcome: z.enum(DOOR_OUTCOMES),
  notes: z.string().max(4000).nullable().optional(),
  capturedAt: z.string().datetime(),
  supersedesClientId: z.string().uuid().nullable().optional(),
  packetVersion: z.string().max(80).nullable().optional(),
  observedScore: progressiveScoreSchema.optional(),
  clearObservedScore: z.boolean().optional(),
  people: z.array(personResponseSchema).max(40).optional(),
});

export const syncBatchSchema = z.object({
  attempts: z.array(syncAttemptSchema).min(1).max(100),
});

export type SyncAttemptInput = z.infer<typeof syncAttemptSchema>;

export interface SyncAck {
  clientAttemptId: string;
  ok: boolean;
  error?: string;
  staleCheckout?: boolean;
}

export async function syncAttemptsForUser(
  userId: string,
  attempts: SyncAttemptInput[],
): Promise<SyncAck[]> {
  const acks: SyncAck[] = [];
  const checkoutIdsToRefresh = new Set<string>();

  for (const attempt of attempts) {
    try {
      const ack = await syncOneAttempt(userId, attempt);
      acks.push(ack);
      if (ack.ok && attempt.checkoutId) {
        checkoutIdsToRefresh.add(attempt.checkoutId);
      }
    } catch (err) {
      acks.push({
        clientAttemptId: attempt.clientAttemptId,
        ok: false,
        error: err instanceof Error ? err.message : "Sync failed",
      });
    }
  }

  for (const checkoutId of checkoutIdsToRefresh) {
    try {
      await refreshCheckoutProgress(checkoutId);
    } catch {
      // Progress refresh is best-effort; attempts already persisted.
    }
  }

  return acks;
}

async function syncOneAttempt(
  userId: string,
  input: SyncAttemptInput,
): Promise<SyncAck> {
  if (!isDoorOutcome(input.outcome)) {
    return {
      clientAttemptId: input.clientAttemptId,
      ok: false,
      error: "Invalid outcome",
    };
  }

  const existing = await prisma.canvassAttempt.findUnique({
    where: { clientAttemptId: input.clientAttemptId },
    select: { id: true, userId: true, staleCheckout: true },
  });
  if (existing) {
    if (existing.userId !== userId) {
      return {
        clientAttemptId: input.clientAttemptId,
        ok: false,
        error: "Attempt belongs to another user",
      };
    }
    return {
      clientAttemptId: input.clientAttemptId,
      ok: true,
      staleCheckout: existing.staleCheckout,
    };
  }

  const resolvedListId = await resolveSplitRedirect(
    input.listId,
    input.householdId,
  );

  const link = await prisma.listCampaign.findFirst({
    where: {
      listId: resolvedListId,
      programId: input.programId,
      campaignId: input.campaignId,
    },
    select: { id: true },
  });
  if (!link) {
    return {
      clientAttemptId: input.clientAttemptId,
      ok: false,
      error: "List is not published in this program",
    };
  }

  const onSnapshot = await prisma.programListHousehold.findUnique({
    where: {
      programId_listId_householdId: {
        programId: input.programId,
        listId: resolvedListId,
        householdId: input.householdId,
      },
    },
    select: { id: true },
  });
  // Fall back to live list membership for older packets / external gaps.
  const onList =
    onSnapshot ||
    (await prisma.listHousehold.findUnique({
      where: {
        listId_householdId: {
          listId: resolvedListId,
          householdId: input.householdId,
        },
      },
      select: { id: true },
    }));
  if (!onList) {
    return {
      clientAttemptId: input.clientAttemptId,
      ok: false,
      error: "Household is not on this list",
    };
  }

  if (input.supersedesClientId) {
    const prior = await prisma.canvassAttempt.findUnique({
      where: { clientAttemptId: input.supersedesClientId },
      select: { userId: true, programId: true, listId: true, householdId: true },
    });
    if (!prior) {
      return {
        clientAttemptId: input.clientAttemptId,
        ok: false,
        error: "Superseded attempt not found",
      };
    }
    if (prior.userId !== userId) {
      return {
        clientAttemptId: input.clientAttemptId,
        ok: false,
        error: "Can only replace your own results",
      };
    }
    if (
      prior.programId !== input.programId ||
      prior.householdId !== input.householdId ||
      (prior.listId !== resolvedListId && prior.listId !== input.listId)
    ) {
      return {
        clientAttemptId: input.clientAttemptId,
        ok: false,
        error: "Replacement must target the same door",
      };
    }
  }

  let checkoutId = input.checkoutId ?? null;
  let staleCheckout = false;

  const activeMine = await prisma.listCheckout.findFirst({
    where: {
      listId: resolvedListId,
      programId: input.programId,
      userId,
      status: "active",
    },
    select: { id: true },
  });

  if (activeMine) {
    checkoutId = activeMine.id;
  } else {
    // Accept late work from a released/reassigned checkout; flag for admin.
    staleCheckout = true;
    if (checkoutId) {
      const claimed = await prisma.listCheckout.findFirst({
        where: {
          id: checkoutId,
          listId: { in: [resolvedListId, input.listId] },
          programId: input.programId,
          userId,
        },
        select: { id: true },
      });
      if (!claimed) checkoutId = null;
    }
  }

  const people = input.people ?? [];
  if (people.length) {
    const allowed = await prisma.programListVoter.findMany({
      where: {
        programId: input.programId,
        listId: resolvedListId,
        voterId: { in: people.map((p) => p.voterId) },
      },
      select: { voterId: true },
    });
    let allowedIds = new Set(allowed.map((a) => a.voterId));
    if (!allowedIds.size) {
      const live = await prisma.listVoter.findMany({
        where: {
          listId: resolvedListId,
          voterId: { in: people.map((p) => p.voterId) },
        },
        select: { voterId: true },
      });
      allowedIds = new Set(live.map((a) => a.voterId));
    }
    for (const person of people) {
      if (!allowedIds.has(person.voterId)) {
        return {
          clientAttemptId: input.clientAttemptId,
          ok: false,
          error: "Voter is not on this list",
        };
      }
    }
  }

  const capturedAt = new Date(input.capturedAt);
  const observedScore = isProgressiveScore(input.observedScore)
    ? input.observedScore
    : null;

  const created = await prisma.canvassAttempt.create({
    data: {
      clientAttemptId: input.clientAttemptId,
      programId: input.programId,
      listId: resolvedListId,
      householdId: input.householdId,
      checkoutId,
      userId,
      campaignId: input.campaignId,
      outcome: input.outcome,
      notes: input.notes ?? null,
      capturedAt,
      supersedesClientId: input.supersedesClientId ?? null,
      staleCheckout,
      packetVersion: input.packetVersion ?? null,
      observedScore,
      people: {
        create: people.map((p) => ({
          voter: { connect: { id: p.voterId } },
          outcome: p.outcome,
          support: p.support ?? null,
          talkScore: isProgressiveScore(p.talkScore) ? p.talkScore : null,
          answers: (p.answers ?? {}) as Prisma.InputJsonValue,
          notes: p.notes ?? null,
        })),
      },
    },
    select: { id: true },
  });

  try {
    await applyFieldWriteback({
      attemptId: created.id,
      householdId: input.householdId,
      campaignId: input.campaignId,
      programId: input.programId,
      userId,
      outcome: input.outcome,
      capturedAt,
      observedScore,
      clearObservedScore: input.clearObservedScore === true,
      people: people.map((p) => ({
        voterId: p.voterId,
        outcome: p.outcome,
        talkScore: isProgressiveScore(p.talkScore) ? p.talkScore : null,
        clearTalkScore: p.clearTalkScore === true,
      })),
    });
  } catch {
    // Attempt already persisted; field write-back is best-effort.
  }

  return {
    clientAttemptId: input.clientAttemptId,
    ok: true,
    staleCheckout,
  };
}
