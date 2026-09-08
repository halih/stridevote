import { NextResponse } from "next/server";
import {
  authorizeMinivanWorker,
  unauthorizedMinivan,
} from "@/lib/minivan/worker-auth";
import { completeMinivanJob } from "@/lib/minivan/jobs";
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
  await completeMinivanJob(
    id,
    body.result ?? (body as Prisma.InputJsonValue),
  );
  return NextResponse.json({ ok: true });
}
