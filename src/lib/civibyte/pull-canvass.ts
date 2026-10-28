import "server-only";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";
import { applyFieldWriteback } from "@/lib/canvass/field-layer";
import {
  authenticateCivibyteGuest,
  getCivibyteDoorCanvass,
  getCivibyteSession,
  type CivibyteDoorCanvass,
} from "@/lib/civibyte/client";
import {
  civibyteClientAttemptId,
  civibyteDoorOutcome,
  type CivibyteDoorLink,
  type CivibyteListMeta,
} from "@/lib/civibyte/map";

function readCivibyteMeta(data: unknown): CivibyteListMeta | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const meta = (data as Record<string, unknown>).civibyte;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const candidate = meta as Partial<CivibyteListMeta>;
  if (
    !candidate.sessionId ||
    !candidate.doors ||
    typeof candidate.doors !== "object"
  ) {
    return null;
  }
  return candidate as CivibyteListMeta;
}

function detailAnswers(
  detail: CivibyteDoorCanvass | undefined,
  voterPk: string,
) {
  const answers =
    detail?.voters.find((voter) => voter.voterPk === voterPk)?.answers ?? [];
  return Object.fromEntries(
    answers.map((answer) => [
      String(answer.questionId),
      {
        answerOptionIds: answer.answerOptionIds ?? [],
        textValue: answer.textValue ?? null,
        numericValue: answer.numericValue ?? null,
      },
    ]),
  );
}

export async function pullCivibyteCanvass(input: {
  listId: string;
  campaignId: string;
  requestedById: string;
}): Promise<{
  applied: number;
  skipped: number;
  /** Remote results that only echoed an attempt StrideVote pushed earlier. */
  echoed: number;
  total: number;
}> {
  const list = await prisma.list.findFirst({
    where: { id: input.listId, source: "civibyte", deletedAt: null },
    include: {
      campaignLinks: {
        where: { campaignId: input.campaignId },
        include: {
          campaign: {
            select: {
              slug: true,
              civibyteEnabled: true,
            },
          },
          program: { select: { id: true, status: true } },
        },
      },
    },
  });
  const link =
    list?.campaignLinks.find(
      (candidate) => candidate.program.status === "active",
    ) ?? list?.campaignLinks[0];
  if (!list || !link)
    throw new Error("Civibyte list not found in this campaign.");
  if (!link.campaign.civibyteEnabled) {
    throw new Error("Civibyte is not enabled for this campaign.");
  }
  const phoneNumber = process.env.CIVIBYTE_GUEST_PHONE;
  if (!phoneNumber || !list.sourceRef) {
    throw new Error(
      "Set CIVIBYTE_GUEST_PHONE and configure the list URL before pulling.",
    );
  }
  const previousMeta = readCivibyteMeta(list.data);
  if (!previousMeta) {
    throw new Error(
      "This list was not imported from Civibyte. Import it again to enable pulls.",
    );
  }

  const auth = await authenticateCivibyteGuest({
    link: list.sourceRef,
    phoneNumber,
    name: process.env.CIVIBYTE_GUEST_NAME,
  });
  const session = await getCivibyteSession(auth);
  const completedDoors = session.sessionDoors.filter(
    (door) => door.doorResult && door.attemptedAt,
  );
  const details = new Map<string, CivibyteDoorCanvass>();
  const detailResults = await Promise.allSettled(
    completedDoors.map(async (door) => ({
      doorId: door.id,
      detail: await getCivibyteDoorCanvass(auth, door.id),
    })),
  );
  for (const result of detailResults) {
    if (result.status === "fulfilled") {
      details.set(result.value.doorId, result.value.detail);
    }
  }

  const activeCheckout = await prisma.listCheckout.findFirst({
    where: {
      listId: list.id,
      programId: link.programId,
      status: "active",
    },
    select: { id: true, userId: true },
  });
  let userId =
    activeCheckout?.userId ?? link.assignedUserId ?? input.requestedById;
  if (!userId) {
    const admin = await prisma.user.findFirst({
      where: { isPlatformAdmin: true },
      select: { id: true },
    });
    userId = admin?.id ?? "";
  }
  if (!userId)
    throw new Error("No user is available to attribute Civibyte attempts.");

  const linksByAddress = new Map<string, CivibyteDoorLink>();
  const importedDoorIdByAddress = new Map<string, string>();
  for (const [doorId, doorLink] of Object.entries(previousMeta.doors)) {
    linksByAddress.set(doorLink.addressPk, doorLink);
    importedDoorIdByAddress.set(doorLink.addressPk, doorId);
  }

  // Outcome of each attempt we previously pushed, keyed by imported door id.
  // A remote result with the same outcome is our own push coming back.
  const pushedAttempts = previousMeta.pushedAttempts ?? {};
  const pushedAttemptIds = Object.values(pushedAttempts);
  const pushedOutcomeByAttemptId = new Map(
    pushedAttemptIds.length
      ? (
          await prisma.canvassAttempt.findMany({
            where: { clientAttemptId: { in: pushedAttemptIds } },
            select: { clientAttemptId: true, outcome: true },
          })
        ).map((attempt) => [attempt.clientAttemptId, attempt.outcome])
      : [],
  );
  const pushedOutcomeForDoor = (door: { id: string; addressPk: string }) => {
    const importedDoorId = previousMeta.doors[door.id]
      ? door.id
      : importedDoorIdByAddress.get(door.addressPk);
    const attemptId = importedDoorId ? pushedAttempts[importedDoorId] : undefined;
    return attemptId ? pushedOutcomeByAttemptId.get(attemptId) ?? null : null;
  };

  const listHouseholdIds = new Set(
    (
      await prisma.listHousehold.findMany({
        where: { listId: list.id },
        select: { householdId: true },
      })
    ).map((row) => row.householdId),
  );

  let applied = 0;
  let skipped = 0;
  let echoed = 0;
  for (const door of completedDoors) {
    const outcome = civibyteDoorOutcome(door.doorResult);
    const attemptedAt = door.attemptedAt;
    const doorLink =
      previousMeta.doors[door.id] ?? linksByAddress.get(door.addressPk);
    if (!outcome || !attemptedAt || !doorLink) {
      skipped += 1;
      continue;
    }
    // Full session door map is copied onto split peers; only apply this list's doors.
    if (!listHouseholdIds.has(doorLink.householdId)) {
      skipped += 1;
      continue;
    }
    const capturedAt = new Date(attemptedAt);
    if (Number.isNaN(capturedAt.getTime())) {
      skipped += 1;
      continue;
    }
    const clientAttemptId = civibyteClientAttemptId(
      list.sourceRef,
      door.id,
      attemptedAt,
    );
    const existing = await prisma.canvassAttempt.findUnique({
      where: { clientAttemptId },
      select: { id: true },
    });
    if (existing) {
      skipped += 1;
      continue;
    }
    if (pushedOutcomeForDoor(door) === outcome) {
      echoed += 1;
      continue;
    }

    const detail = details.get(door.id);
    const contacted =
      outcome === "contact"
        ? (detail?.voters ?? []).flatMap((sourceVoter) => {
            const voterId = doorLink.voterIdsByPk[sourceVoter.voterPk];
            return voterId
              ? [
                  {
                    voterId,
                    outcome: "talked" as const,
                    answers: detailAnswers(detail, sourceVoter.voterPk),
                  },
                ]
              : [];
          })
        : [];
    const attempt = await prisma.canvassAttempt.create({
      data: {
        clientAttemptId,
        programId: link.programId,
        listId: list.id,
        householdId: doorLink.householdId,
        checkoutId: activeCheckout?.id ?? null,
        userId,
        campaignId: input.campaignId,
        outcome,
        notes: detail?.notes || `[Civibyte pull] ${door.doorResult}`,
        capturedAt,
        packetVersion: "civibyte-pull",
        people: contacted.length
          ? {
              create: contacted.map((person) => ({
                voterId: person.voterId,
                outcome: person.outcome,
                answers: person.answers,
              })),
            }
          : undefined,
      },
    });
    await applyFieldWriteback({
      attemptId: attempt.id,
      householdId: doorLink.householdId,
      campaignId: input.campaignId,
      programId: link.programId,
      userId,
      capturedAt,
      outcome,
      observedScore: null,
      people: contacted.map((person) => ({
        voterId: person.voterId,
        outcome: person.outcome,
      })),
    });
    applied += 1;
  }

  const data = list.data as Record<string, unknown>;
  const nextMeta: CivibyteListMeta = {
    ...previousMeta,
    sessionId: session.canvassingSessionId,
    lastPullAt: new Date().toISOString(),
    lastPullApplied: applied,
    lastPullSkipped: skipped,
    lastPullEchoed: echoed,
  };
  await prisma.list.update({
    where: { id: list.id },
    data: {
      data: { ...data, civibyte: nextMeta } as unknown as Prisma.InputJsonValue,
    },
  });
  revalidatePath("/canvass");
  revalidatePath("/stats");
  revalidatePath(`/admin/${link.campaign.slug}`);
  return { applied, skipped, echoed, total: completedDoors.length };
}
