import "server-only";
import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import type { DoorOutcome } from "@/lib/canvass/outcomes";
import { completeMinivanJob, MINIVAN_PUSH_JOB_TYPES } from "@/lib/minivan/jobs";

/** VanID (as string) → door outcome StrideVote last pushed to VAN. */
export type MinivanPushedOutcomes = Record<string, DoorOutcome>;

const PENDING_KEY = "pendingPushedOutcomes";

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Read `list.data.minivan.pushedOutcomes` (what we've already sent to VAN). */
export function readMinivanPushedOutcomes(data: unknown): MinivanPushedOutcomes {
  const minivan = asRecord(asRecord(data)?.minivan);
  const pushed = asRecord(minivan?.pushedOutcomes);
  if (!pushed) return {};
  const out: MinivanPushedOutcomes = {};
  for (const [vanId, outcome] of Object.entries(pushed)) {
    if (typeof outcome === "string") out[vanId] = outcome as DoorOutcome;
  }
  return out;
}

/**
 * Remember what a push job is about to send. Committed onto the list only when
 * the worker reports the job complete, so a failed inject does not suppress a
 * genuine remote result on the next pull.
 */
export async function stagePendingPushedOutcomes(
  jobId: string,
  outcomes: MinivanPushedOutcomes,
) {
  const job = await prisma.miniVanJob.findUnique({
    where: { id: jobId },
    select: { result: true },
  });
  const previous = asRecord(job?.result) ?? {};
  await prisma.miniVanJob.update({
    where: { id: jobId },
    data: {
      result: {
        ...previous,
        [PENDING_KEY]: outcomes,
      } as Prisma.InputJsonValue,
    },
  });
}

/**
 * Finish a `push_canvass` or `sync_canvass` job: merge the staged outcomes
 * into `list.data.minivan.pushedOutcomes`, record push stats, and complete the
 * job with `{ pull?, push }`. Other job types are completed with the raw summary.
 */
export async function completeMinivanPush(
  jobId: string,
  summary: Prisma.InputJsonValue,
) {
  const job = await prisma.miniVanJob.findUnique({
    where: { id: jobId },
    include: {
      campaign: { select: { slug: true } },
      list: { select: { id: true, data: true, deletedAt: true } },
    },
  });
  if (!job) return;
  if (!(MINIVAN_PUSH_JOB_TYPES as readonly string[]).includes(job.type)) {
    await completeMinivanJob(jobId, summary);
    return;
  }

  const previousResult = asRecord(job.result) ?? {};
  const { [PENDING_KEY]: pendingRaw, ...carried } = previousResult;
  const pending = asRecord(pendingRaw) ?? {};

  if (job.list && !job.list.deletedAt) {
    const listData = asRecord(job.list.data) ?? {};
    const minivanMeta = asRecord(listData.minivan) ?? {};
    const pushedOutcomes = {
      ...readMinivanPushedOutcomes(listData),
      ...pending,
    };
    await prisma.list.update({
      where: { id: job.list.id },
      data: {
        data: {
          ...listData,
          minivan: {
            ...minivanMeta,
            lastPushAt: new Date().toISOString(),
            lastPushDoors: Object.keys(pending).length,
            pushedOutcomes,
          },
        } as Prisma.InputJsonValue,
      },
    });
  }

  await completeMinivanJob(jobId, {
    ...carried,
    push: summary,
  } as Prisma.InputJsonValue);

  revalidatePath("/canvass");
  revalidatePath("/stats");
  revalidatePath(`/admin/${job.campaign.slug}`);
}
