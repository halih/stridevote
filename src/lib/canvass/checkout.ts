import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";

export type ClaimCheckoutResult =
  | { ok: true; id: string }
  | { ok: false; message: string };

function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

/**
 * Create or reuse the single active checkout for a list+wave.
 * Relies on a partial unique index: (listId, programId) WHERE status = 'active'.
 */
export async function claimActiveCheckout(input: {
  listId: string;
  programId: string;
  userId: string;
  progressTotal: number;
  progressDone?: number;
}): Promise<ClaimCheckoutResult> {
  const completed = await prisma.listCheckout.findFirst({
    where: {
      listId: input.listId,
      programId: input.programId,
      status: "completed",
    },
    select: { id: true },
  });
  if (completed) {
    return {
      ok: false,
      message: "This list is already completed for this wave.",
    };
  }

  const held = await prisma.listCheckout.findFirst({
    where: {
      listId: input.listId,
      programId: input.programId,
      status: "active",
    },
    select: { id: true, userId: true },
  });
  if (held) {
    if (held.userId === input.userId) return { ok: true, id: held.id };
    return { ok: false, message: "That list is already checked out." };
  }

  try {
    const row = await prisma.listCheckout.create({
      data: {
        listId: input.listId,
        programId: input.programId,
        userId: input.userId,
        status: "active",
        progressTotal: input.progressTotal,
        progressDone: input.progressDone ?? 0,
      },
      select: { id: true },
    });
    return { ok: true, id: row.id };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const winner = await prisma.listCheckout.findFirst({
      where: {
        listId: input.listId,
        programId: input.programId,
        status: "active",
      },
      select: { id: true, userId: true },
    });
    if (winner?.userId === input.userId) return { ok: true, id: winner.id };
    return { ok: false, message: "That list is already checked out." };
  }
}
