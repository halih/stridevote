import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma";

export const MINIVAN_JOB_TYPES = [
  "import_list",
  "pull_canvass",
  "push_canvass",
] as const;

export type MinivanJobType = (typeof MINIVAN_JOB_TYPES)[number];

export const MINIVAN_JOB_STATUSES = [
  "pending",
  "running",
  "completed",
  "failed",
] as const;

export type MinivanJobStatus = (typeof MINIVAN_JOB_STATUSES)[number];

export interface EnqueueMinivanJobInput {
  type: MinivanJobType;
  campaignId: string;
  listId?: string | null;
  requestedById?: string | null;
  payload?: Prisma.InputJsonValue;
}

/** Enqueue a job. Does not start the emulator — the worker polls claim. */
export async function enqueueMinivanJob(input: EnqueueMinivanJobInput) {
  return prisma.miniVanJob.create({
    data: {
      type: input.type,
      campaignId: input.campaignId,
      listId: input.listId ?? null,
      requestedById: input.requestedById ?? null,
      payload: input.payload ?? {},
      status: "pending",
    },
  });
}

/**
 * Claim the oldest pending job if none is already running.
 * Returns null when busy or queue empty (same idea as voter-outreach minivanBusy).
 */
export async function claimNextMinivanJob() {
  const running = await prisma.miniVanJob.findFirst({
    where: { status: "running" },
    select: { id: true },
  });
  if (running) return null;

  const next = await prisma.miniVanJob.findFirst({
    where: { status: "pending" },
    orderBy: { createdAt: "asc" },
    include: {
      campaign: {
        select: {
          id: true,
          slug: true,
          name: true,
          minivanEnabled: true,
          minivanAdapterKey: true,
        },
      },
      list: {
        select: {
          id: true,
          name: true,
          source: true,
          sourceRef: true,
          data: true,
        },
      },
    },
  });
  if (!next) return null;

  const updated = await prisma.miniVanJob.updateMany({
    where: { id: next.id, status: "pending" },
    data: { status: "running", claimedAt: new Date() },
  });
  if (updated.count === 0) return null;

  return prisma.miniVanJob.findUnique({
    where: { id: next.id },
    include: {
      campaign: {
        select: {
          id: true,
          slug: true,
          name: true,
          minivanEnabled: true,
          minivanAdapterKey: true,
        },
      },
      list: {
        select: {
          id: true,
          name: true,
          source: true,
          sourceRef: true,
          data: true,
        },
      },
    },
  });
}

export async function completeMinivanJob(
  jobId: string,
  result: Prisma.InputJsonValue,
) {
  return prisma.miniVanJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      result,
      error: null,
      completedAt: new Date(),
    },
  });
}

export async function failMinivanJob(jobId: string, error: string) {
  return prisma.miniVanJob.update({
    where: { id: jobId },
    data: {
      status: "failed",
      error,
      completedAt: new Date(),
    },
  });
}

export async function getLatestListMinivanJob(listId: string) {
  return prisma.miniVanJob.findFirst({
    where: { listId },
    orderBy: { createdAt: "desc" },
  });
}
