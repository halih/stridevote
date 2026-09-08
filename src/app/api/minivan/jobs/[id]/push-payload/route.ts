import { NextResponse } from "next/server";
import {
  authorizeMinivanWorker,
  unauthorizedMinivan,
} from "@/lib/minivan/worker-auth";
import { buildMinivanPushPayload } from "@/lib/minivan/push-payload";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!authorizeMinivanWorker(req)) return unauthorizedMinivan();
  const { id } = await ctx.params;
  const result = await buildMinivanPushPayload(id);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
