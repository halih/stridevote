import { prisma } from "@/lib/db";
import type { ProgressiveScore } from "@/lib/canvass/progressive-score";
import { isProgressiveScore } from "@/lib/canvass/progressive-score";

export const FIELD_EVENT_KINDS = [
  "inaccessible",
  "unsafe",
  "moved",
  "access_cleared",
  "score_observed",
  "score_talk",
  "score_cleared",
] as const;

export type FieldEventKind = (typeof FIELD_EVENT_KINDS)[number];

export type AccessStatus = "ok" | "inaccessible" | "unsafe";
export type ResidenceStatus = "ok" | "moved";

/** Outcomes that prove a volunteer physically reached an accessible door. */
export function clearsHouseholdAccess(outcome: string): boolean {
  return outcome === "contact" || outcome === "no_answer" || outcome === "refused";
}

/** Demo / test campaigns must not pollute the master voter/household field layer. */
export const FIELD_WRITEBACK_EXCLUDED_SLUGS = new Set(["count-binface"]);

type WritebackInput = {
  attemptId: string | null;
  householdId: string;
  campaignId: string;
  programId: string;
  userId: string;
  outcome: string;
  capturedAt: Date;
  observedScore: ProgressiveScore | null | undefined;
  /** Explicit clear of observed score when volunteer clears after a prior value. */
  clearObservedScore?: boolean;
  people: Array<{
    voterId: string;
    outcome: string;
    talkScore?: ProgressiveScore | null;
    clearTalkScore?: boolean;
  }>;
};

/**
 * Append FieldEvents for a synced knock and denormalize Household / Voter
 * current fields used by lists and voter profiles.
 */
export async function applyFieldWriteback(
  input: WritebackInput,
): Promise<void> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: input.campaignId },
    select: { slug: true },
  });
  if (campaign && FIELD_WRITEBACK_EXCLUDED_SLUGS.has(campaign.slug)) {
    return;
  }

  const events: Array<{
    householdId?: string | null;
    voterId?: string | null;
    kind: FieldEventKind;
    value?: number | null;
  }> = [];

  if (input.outcome === "inaccessible" || input.outcome === "unsafe") {
    events.push({
      householdId: input.householdId,
      kind: input.outcome,
    });
  } else if (clearsHouseholdAccess(input.outcome)) {
    events.push({
      householdId: input.householdId,
      kind: "access_cleared",
    });
  }

  if (input.clearObservedScore) {
    events.push({
      householdId: input.householdId,
      kind: "score_cleared",
      value: null,
    });
  } else if (isProgressiveScore(input.observedScore)) {
    events.push({
      householdId: input.householdId,
      kind: "score_observed",
      value: input.observedScore,
    });
  }

  for (const person of input.people) {
    if (person.outcome === "moved") {
      events.push({
        householdId: input.householdId,
        voterId: person.voterId,
        kind: "moved",
      });
    }
    if (person.outcome === "talked") {
      if (person.clearTalkScore) {
        events.push({
          householdId: input.householdId,
          voterId: person.voterId,
          kind: "score_cleared",
          value: null,
        });
      } else if (isProgressiveScore(person.talkScore)) {
        events.push({
          householdId: input.householdId,
          voterId: person.voterId,
          kind: "score_talk",
          value: person.talkScore,
        });
      }
    }
  }

  if (events.length) {
    await prisma.fieldEvent.createMany({
      data: events.map((e) => ({
        householdId: e.householdId ?? null,
        voterId: e.voterId ?? null,
        kind: e.kind,
        value: e.value ?? null,
        campaignId: input.campaignId,
        programId: input.programId,
        attemptId: input.attemptId,
        userId: input.userId,
        capturedAt: input.capturedAt,
      })),
    });
  }

  await recomputeHouseholdAccess(input.householdId);
  await applyHouseholdObservedScore(input);
  await applyVoterMovedAndTalkScores(input);
}

async function recomputeHouseholdAccess(householdId: string): Promise<void> {
  const events = await prisma.fieldEvent.findMany({
    where: {
      householdId,
      kind: { in: ["inaccessible", "unsafe", "access_cleared"] },
    },
    orderBy: { capturedAt: "asc" },
    select: { kind: true, campaignId: true, capturedAt: true },
  });

  let lastClearAt: Date | null = null;
  for (const e of events) {
    if (e.kind === "access_cleared") lastClearAt = e.capturedAt;
  }

  const afterClear = (e: { capturedAt: Date }) =>
    !lastClearAt || e.capturedAt > lastClearAt;

  const inaccessibleCampaigns = new Set(
    events
      .filter((e) => e.kind === "inaccessible" && afterClear(e))
      .map((e) => e.campaignId),
  );
  const unsafeCampaigns = new Set(
    events
      .filter((e) => e.kind === "unsafe" && afterClear(e))
      .map((e) => e.campaignId),
  );

  let accessStatus: AccessStatus = "ok";
  if (unsafeCampaigns.size >= 2) accessStatus = "unsafe";
  else if (inaccessibleCampaigns.size >= 2) accessStatus = "inaccessible";

  await prisma.household.update({
    where: { id: householdId },
    data: {
      accessStatus,
      accessUpdatedAt: new Date(),
    },
  });
}

async function applyHouseholdObservedScore(
  input: WritebackInput,
): Promise<void> {
  if (input.clearObservedScore) {
    await prisma.household.update({
      where: { id: input.householdId },
      data: { observedScore: null, observedScoreAt: input.capturedAt },
    });
    return;
  }
  if (!isProgressiveScore(input.observedScore)) return;
  await prisma.household.update({
    where: { id: input.householdId },
    data: {
      observedScore: input.observedScore,
      observedScoreAt: input.capturedAt,
    },
  });
}

async function applyVoterMovedAndTalkScores(
  input: WritebackInput,
): Promise<void> {
  for (const person of input.people) {
    if (person.outcome === "moved") {
      await prisma.voter.update({
        where: { id: person.voterId },
        data: { residenceStatus: "moved" },
      });
    }
    if (person.outcome !== "talked") continue;
    if (person.clearTalkScore) {
      await prisma.voter.update({
        where: { id: person.voterId },
        data: { talkScore: null, scoreUpdatedAt: input.capturedAt },
      });
    } else if (isProgressiveScore(person.talkScore)) {
      await prisma.voter.update({
        where: { id: person.voterId },
        data: {
          talkScore: person.talkScore,
          scoreUpdatedAt: input.capturedAt,
        },
      });
    }
  }
}
