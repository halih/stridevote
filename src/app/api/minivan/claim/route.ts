import { NextResponse } from "next/server";
import {
  authorizeMinivanWorker,
  unauthorizedMinivan,
} from "@/lib/minivan/worker-auth";
import { claimNextMinivanJob } from "@/lib/minivan/jobs";

/** POST /api/minivan/claim — worker claims the next pending job (exclusive). */
export async function POST(req: Request) {
  if (!authorizeMinivanWorker(req)) return unauthorizedMinivan();

  try {
    const job = await claimNextMinivanJob();
    if (!job) {
      return NextResponse.json({ ok: true, job: null });
    }

    return NextResponse.json({
      ok: true,
      job: {
        id: job.id,
        type: job.type,
        campaignId: job.campaignId,
        listId: job.listId,
        payload: job.payload,
        campaign: job.campaign,
        list: job.list,
      },
    });
  } catch (err) {
    console.error("minivan claim failed", err);
    const message = err instanceof Error ? err.message : "Claim failed";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
