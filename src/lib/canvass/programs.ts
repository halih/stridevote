import { prisma } from "@/lib/db";
import type { ProgramQuestion } from "@/lib/canvass/outcomes";
import { programQuestionSchema } from "@/lib/canvass/outcomes";

/** Ensure a campaign has an active program; create "Default" if none. */
export async function ensureActiveProgram(campaignId: string): Promise<{
  id: string;
  name: string;
  status: string;
}> {
  const active = await prisma.canvassProgram.findFirst({
    where: { campaignId, status: "active" },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, status: true },
  });
  if (active) return active;

  const existing = await prisma.canvassProgram.findFirst({
    where: { campaignId },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, status: true },
  });
  if (existing) {
    return prisma.canvassProgram.update({
      where: { id: existing.id },
      data: { status: "active" },
      select: { id: true, name: true, status: true },
    });
  }

  return prisma.canvassProgram.create({
    data: {
      campaignId,
      name: "Default",
      status: "active",
      questions: [],
    },
    select: { id: true, name: true, status: true },
  });
}

export function parseProgramQuestions(raw: unknown): ProgramQuestion[] {
  if (!Array.isArray(raw)) return [];
  const out: ProgramQuestion[] = [];
  for (const item of raw) {
    const parsed = programQuestionSchema.safeParse(item);
    if (parsed.success) out.push(parsed.data);
  }
  return out;
}

/**
 * Copy live ListHousehold / ListVoter rows into the program snapshot.
 * Idempotent: skips households/voters already present.
 */
export async function snapshotListIntoProgram(
  programId: string,
  listId: string,
): Promise<void> {
  const [households, voters] = await Promise.all([
    prisma.listHousehold.findMany({
      where: { listId },
      select: { householdId: true, sortOrder: true },
      orderBy: { sortOrder: "asc" },
    }),
    prisma.listVoter.findMany({
      where: { listId },
      select: { voterId: true, matchedSeed: true },
    }),
  ]);

  if (households.length) {
    await prisma.programListHousehold.createMany({
      data: households.map((h) => ({
        programId,
        listId,
        householdId: h.householdId,
        sortOrder: h.sortOrder,
      })),
      skipDuplicates: true,
    });
  }
  if (voters.length) {
    await prisma.programListVoter.createMany({
      data: voters.map((v) => ({
        programId,
        listId,
        voterId: v.voterId,
        matchedSeed: v.matchedSeed,
      })),
      skipDuplicates: true,
    });
  }
}

/** Publish (or re-publish) a list into a program with visibility / assignee. */
export async function upsertListProgramLink(opts: {
  listId: string;
  campaignId: string;
  programId: string;
  visibility: string;
  assignedUserId?: string | null;
  snapshot?: boolean;
}): Promise<void> {
  await prisma.listCampaign.upsert({
    where: {
      listId_campaignId_programId: {
        listId: opts.listId,
        campaignId: opts.campaignId,
        programId: opts.programId,
      },
    },
    create: {
      listId: opts.listId,
      campaignId: opts.campaignId,
      programId: opts.programId,
      visibility: opts.visibility,
      assignedUserId:
        opts.visibility === "assigned" ? opts.assignedUserId ?? null : null,
    },
    update: {
      visibility: opts.visibility,
      assignedUserId:
        opts.visibility === "assigned" ? opts.assignedUserId ?? null : null,
    },
  });

  if (opts.snapshot !== false && opts.visibility !== "draft") {
    await snapshotListIntoProgram(opts.programId, opts.listId);
  }
}
