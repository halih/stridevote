import { NextResponse } from "next/server";
import {
  authorizeMinivanWorker,
  unauthorizedMinivan,
} from "@/lib/minivan/worker-auth";
import { completeMinivanPush } from "@/lib/minivan/pushed-outcomes";
import type { Prisma } from "@/generated/prisma";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!authorizeMinivanWorker(req)) return unauthorizedMinivan();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as {
    result?: Prisma.InputJsonValue;
  };
  // Push/sync jobs commit their staged pushed-outcomes here; other job types
  // are completed with the raw summary.
  await completeMinivanPush(
    id,
    body.result ?? (body as Prisma.InputJsonValue),
  );
  return NextResponse.json({ ok: true });
}
