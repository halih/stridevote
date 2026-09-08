import { NextResponse } from "next/server";
import {
  authorizeMinivanWorker,
  unauthorizedMinivan,
} from "@/lib/minivan/worker-auth";
import { failMinivanJob } from "@/lib/minivan/jobs";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!authorizeMinivanWorker(req)) return unauthorizedMinivan();
  const { id } = await ctx.params;
  const body = (await req.json().catch(() => ({}))) as { error?: string };
  await failMinivanJob(id, body.error?.trim() || "Worker failed");
  return NextResponse.json({ ok: true });
}
