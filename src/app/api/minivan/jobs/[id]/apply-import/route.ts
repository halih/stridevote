import { NextResponse } from "next/server";
import {
  authorizeMinivanWorker,
  unauthorizedMinivan,
} from "@/lib/minivan/worker-auth";
import { applyMinivanImport, type MinivanImportPayload } from "@/lib/minivan/apply-import";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  if (!authorizeMinivanWorker(req)) return unauthorizedMinivan();
  const { id } = await ctx.params;
  const body = (await req.json()) as MinivanImportPayload;
  if (!body?.people || !Array.isArray(body.people)) {
    return NextResponse.json({ ok: false, error: "people required" }, { status: 400 });
  }
  const result = await applyMinivanImport(id, body);
  if (!result.ok) {
    return NextResponse.json(result, { status: 400 });
  }
  return NextResponse.json(result);
}
