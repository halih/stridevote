import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { applyFieldWriteback } from "@/lib/canvass/field-layer";
import { isProgressiveScore } from "@/lib/canvass/progressive-score";

const bodySchema = z.object({
  programId: z.string().min(1),
  listId: z.string().min(1),
  householdId: z.string().min(1),
  campaignId: z.string().min(1),
  observedScore: z.number().int().min(0).max(5).nullable(),
});

export async function POST(request: Request) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ ok: false, message: "Please sign in." }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, message: "Invalid score update." }, { status: 400 });
  }
  const input = parsed.data;

  const checkout = await prisma.listCheckout.findFirst({
    where: {
      listId: input.listId,
      programId: input.programId,
      userId: user.id,
      status: "active",
      list: { deletedAt: null },
    },
    select: { id: true },
  });
  const link = await prisma.listCampaign.findFirst({
    where: {
      listId: input.listId,
      programId: input.programId,
      campaignId: input.campaignId,
      list: { deletedAt: null },
      campaign: { archivedAt: null },
    },
    select: { id: true },
  });
  const snapshotHousehold = await prisma.programListHousehold.findUnique({
    where: {
      programId_listId_householdId: {
        programId: input.programId,
        listId: input.listId,
        householdId: input.householdId,
      },
    },
    select: { id: true },
  });
  const liveHousehold = snapshotHousehold
    ? null
    : await prisma.listHousehold.findUnique({
        where: {
          listId_householdId: {
            listId: input.listId,
            householdId: input.householdId,
          },
        },
        select: { id: true },
      });
  if (!checkout || !link || (!snapshotHousehold && !liveHousehold)) {
    return NextResponse.json(
      { ok: false, message: "This door is not available for field updates." },
      { status: 403 },
    );
  }

  const capturedAt = new Date();
  const observedScore = isProgressiveScore(input.observedScore)
    ? input.observedScore
    : null;
  await applyFieldWriteback({
    attemptId: null,
    householdId: input.householdId,
    campaignId: input.campaignId,
    programId: input.programId,
    userId: user.id,
    outcome: "",
    capturedAt,
    observedScore,
    clearObservedScore: observedScore == null,
    people: [],
  });

  return NextResponse.json({ ok: true, capturedAt: capturedAt.toISOString() });
}
