import "server-only";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { isDoorOutcome } from "@/lib/canvass/outcomes";
import { parseProgramQuestions } from "@/lib/canvass/programs";
import {
  authenticateCivibyteGuest,
  getCivibyteSession,
  logCivibyteCanvassBatch,
  type CivibyteCanvassLog,
} from "@/lib/civibyte/client";
import {
  civibyteDoorResult,
  matchCivibyteSessionDoor,
  type CivibyteListMeta,
} from "@/lib/civibyte/map";
import { civibyteAnswersForPerson } from "@/lib/civibyte/push-map";

const BATCH_SIZE = 100;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function readCivibyteMeta(data: unknown): CivibyteListMeta | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const meta = (data as Record<string, unknown>).civibyte;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const candidate = meta as Partial<CivibyteListMeta>;
  if (!candidate.sessionId || !candidate.doors || typeof candidate.doors !== "object") {
    return null;
  }
  return candidate as CivibyteListMeta;
}

export async function pushCivibyteCanvass(input: {
  listId: string;
  campaignId: string;
}): Promise<{ applied: number; rejected: number; skipped: number; total: number }> {
  const list = await prisma.list.findFirst({
    where: { id: input.listId, source: "civibyte", deletedAt: null },
    include: {
      campaignLinks: {
        where: { campaignId: input.campaignId },
        include: {
          campaign: { select: { slug: true, civibyteEnabled: true } },
          program: { select: { id: true, status: true, questions: true } },
        },
      },
    },
  });
  const link =
    list?.campaignLinks.find((candidate) => candidate.program.status === "active") ??
    list?.campaignLinks[0];
  if (!list || !link) throw new Error("CiviByte list not found in this campaign.");
  if (!link.campaign.civibyteEnabled) {
    throw new Error("CiviByte is not enabled for this campaign.");
  }
  const phoneNumber = process.env.CIVIBYTE_GUEST_PHONE;
  if (!phoneNumber || !list.sourceRef) {
    throw new Error(
      "Set CIVIBYTE_GUEST_PHONE and configure the list URL before pushing.",
    );
  }
  const previousMeta = readCivibyteMeta(list.data);
  if (!previousMeta) {
    throw new Error(
      "This list was not imported from CiviByte. Import it again to enable pushes.",
    );
  }

  const auth = await authenticateCivibyteGuest({
    link: list.sourceRef,
    phoneNumber,
    name: process.env.CIVIBYTE_GUEST_NAME,
  });
  const session = await getCivibyteSession(auth);
  const sessionDoorsById = new Map(
    session.sessionDoors.map((door) => [door.id, door]),
  );
  const sessionDoorsByAddress = new Map(
    session.sessionDoors.map((door) => [door.addressPk, door]),
  );
  const programQuestions = parseProgramQuestions(link.program.questions);
  const listHouseholdIds = new Set(
    (
      await prisma.listHousehold.findMany({
        where: { listId: list.id },
        select: { householdId: true },
      })
    ).map((row) => row.householdId),
  );
  const attempts = await prisma.canvassAttempt.findMany({
    where: { listId: list.id, programId: link.programId },
    orderBy: { capturedAt: "desc" },
    include: { people: true },
  });
  const superseded = new Set(
    attempts
      .map((attempt) => attempt.supersedesClientId)
      .filter((id): id is string => Boolean(id)),
  );
  const currentByHousehold = new Map<string, (typeof attempts)[number]>();
  for (const attempt of attempts) {
    if (superseded.has(attempt.clientAttemptId)) continue;
    if (!currentByHousehold.has(attempt.householdId)) {
      currentByHousehold.set(attempt.householdId, attempt);
    }
  }

  const submissions: Array<{ doorId: string; log: CivibyteCanvassLog }> = [];
  let skipped = 0;
  for (const [doorId, doorLink] of Object.entries(previousMeta.doors)) {
    // Full door map is copied onto split peers; only push this list's doors.
    if (!listHouseholdIds.has(doorLink.householdId)) {
      skipped += 1;
      continue;
    }
    const door = matchCivibyteSessionDoor(
      doorId,
      doorLink.addressPk,
      sessionDoorsById,
      sessionDoorsByAddress,
    );
    const attempt = currentByHousehold.get(doorLink.householdId);
    if (
      !door ||
      !attempt ||
      attempt.packetVersion === "civibyte-pull" ||
      attempt.clientAttemptId.startsWith("civibyte:") ||
      !UUID_PATTERN.test(attempt.clientAttemptId) ||
      previousMeta.pushedAttempts?.[doorId] === attempt.clientAttemptId ||
      !isDoorOutcome(attempt.outcome)
    ) {
      skipped += 1;
      continue;
    }
    const doorResult = civibyteDoorResult(attempt.outcome);
    if (!doorResult) {
      skipped += 1;
      continue;
    }
    const remoteAttemptedAt = door.attemptedAt
      ? new Date(door.attemptedAt).getTime()
      : Number.NaN;
    if (
      door.doorResult &&
      Number.isFinite(remoteAttemptedAt) &&
      remoteAttemptedAt >= attempt.capturedAt.getTime()
    ) {
      skipped += 1;
      continue;
    }

    const voterPkById = new Map(
      Object.entries(doorLink.voterIdsByPk).map(([voterPk, voterId]) => [
        voterId,
        voterPk,
      ]),
    );
    const hasOffListContact = attempt.people.some(
      (person) => person.outcome === "talked" && person.offList,
    );
    const voters =
      attempt.outcome === "contact"
        ? attempt.people.flatMap((person) => {
            if (
              person.outcome !== "talked" ||
              person.voterId == null ||
              !voterPkById.has(person.voterId)
            ) {
              return [];
            }
            return [{
              voterPk: voterPkById.get(person.voterId)!,
              answers: civibyteAnswersForPerson({
                survey: session.survey,
                programQuestions,
                support: person.support,
                answers: person.answers,
              }),
            }];
          })
        : door.voterPks.map((voterPk) => ({ voterPk, answers: [] }));

    submissions.push({
      doorId,
      log: {
        clientSubmissionId: attempt.clientAttemptId,
        canvassingSessionId: auth.canvassingSessionId,
        sessionDoorId: door.id,
        addressPk: door.addressPk,
        doorResult,
        ...(attempt.notes ? { doorNotes: attempt.notes } : {}),
        someoneElseContacted:
          attempt.outcome === "contact" &&
          (hasOffListContact || voters.length === 0),
        voters,
      },
    });
  }

  const acknowledged = new Set<string>();
  for (let offset = 0; offset < submissions.length; offset += BATCH_SIZE) {
    const batch = submissions.slice(offset, offset + BATCH_SIZE);
    const ids = await logCivibyteCanvassBatch(
      auth,
      batch.map((submission) => submission.log),
    );
    ids.forEach((id) => acknowledged.add(id));
  }
  const pushedAttempts = { ...(previousMeta.pushedAttempts ?? {}) };
  for (const submission of submissions) {
    if (acknowledged.has(submission.log.clientSubmissionId)) {
      pushedAttempts[submission.doorId] = submission.log.clientSubmissionId;
    }
  }
  const applied = submissions.filter((submission) =>
    acknowledged.has(submission.log.clientSubmissionId),
  ).length;
  const rejected = submissions.length - applied;
  const nextMeta: CivibyteListMeta = {
    ...previousMeta,
    sessionId: session.canvassingSessionId,
    lastPushAt: new Date().toISOString(),
    lastPushApplied: applied,
    lastPushRejected: rejected,
    lastPushSkipped: skipped,
    pushedAttempts,
  };
  const data = list.data as Record<string, unknown>;
  await prisma.list.update({
    where: { id: list.id },
    data: {
      data: { ...data, civibyte: nextMeta } as unknown as Prisma.InputJsonValue,
    },
  });

  revalidatePath("/canvass");
  revalidatePath("/stats");
  revalidatePath(`/admin/${link.campaign.slug}`);
  return { applied, rejected, skipped, total: submissions.length };
}
