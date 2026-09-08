import { NextResponse } from "next/server";
import {
  authorizeMinivanWorker,
  unauthorizedMinivan,
} from "@/lib/minivan/worker-auth";
import { applyMinivanPull, type TeamCanvassRow } from "@/lib/minivan/apply-pull";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!authorizeMinivanWorker(req)) return unauthorizedMinivan();
  const { id } = await ctx.params;
  const body = (await req.json()) as { teamCanvasses?: TeamCanvassRow[] };
  if (!Array.isArray(body.teamCanvasses)) {
    return NextResponse.json(
      { ok: false, error: "teamCanvasses required" },
      { status: 400 },
    );
  }
  const result = await applyMinivanPull(id, body.teamCanvasses);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
