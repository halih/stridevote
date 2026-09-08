import "server-only";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireMinivanAdapter } from "@/lib/minivan/adapters";
import { completeMinivanJob, failMinivanJob } from "@/lib/minivan/jobs";
import {
  minivanClientAttemptId,
  pullDoorToPersonOutcome,
  pullDispositionToDoor,
} from "@/lib/minivan/map-canvass";
import { applyFieldWriteback } from "@/lib/canvass/field-layer";
import { ensureActiveProgram } from "@/lib/canvass/programs";

export interface TeamCanvassRow {
  vanId: number;
  resultId: number;
  statusLabel?: string | null;
  dateCreated: string;
}

/**
 * Apply TeamCanvasses dispositions only (no survey/notes).
 * The emulator is never the recording device.
 */
export async function applyMinivanPull(
  jobId: string,
  rows: TeamCanvassRow[],
): Promise<{ ok: boolean; error?: string; applied?: number; skipped?: number }> {
  const job = await prisma.miniVanJob.findUnique({
    where: { id: jobId },
    include: {
      campaign: {
        select: {
          id: true,
          slug: true,
          minivanEnabled: true,
          minivanAdapterKey: true,
        },
      },
      list: true,
    },
  });
  if (!job || job.type !== "pull_canvass" || job.status !== "running") {
    return { ok: false, error: "Job not found or not running" };
  }
  if (!job.listId || !job.list || job.list.deletedAt) {
    await failMinivanJob(jobId, "Pull job has no list");
    return { ok: false, error: "No list" };
  }

  let adapter;
  try {
    adapter = requireMinivanAdapter(job.campaign.minivanAdapterKey);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Adapter error";
    await failMinivanJob(jobId, msg);
    return { ok: false, error: msg };
  }

  const program = await ensureActiveProgram(job.campaignId);
  const listVoters = await prisma.listVoter.findMany({
    where: { listId: job.listId, vanId: { not: null } },
    select: {
      voterId: true,
      vanId: true,
      voter: {
        select: {
          householdLinks: { select: { householdId: true }, take: 1 },
        },
      },
    },
  });
  const byVan = new Map(
    listVoters
      .filter((lv) => lv.vanId != null)
      .map((lv) => [
        lv.vanId as number,
        {
          voterId: lv.voterId,
          householdId: lv.voter.householdLinks[0]?.householdId ?? null,
        },
      ]),
  );

  // Credit the volunteer who owns the turf, even if an organizer presses Pull.
  const activeCheckout = await prisma.listCheckout.findFirst({
    where: {
      listId: job.listId,
      programId: program.id,
      status: "active",
    },
    select: { id: true, userId: true },
  });
  const assignment = activeCheckout
    ? null
    : await prisma.listCampaign.findFirst({
        where: {
          listId: job.listId,
          programId: program.id,
          visibility: "assigned",
          assignedUserId: { not: null },
        },
        select: { assignedUserId: true },
      });
  let userId =
    activeCheckout?.userId ??
    assignment?.assignedUserId ??
    job.requestedById;
  if (!userId) {
    const admin = await prisma.user.findFirst({
      where: { isPlatformAdmin: true },
      select: { id: true },
    });
    userId = admin?.id ?? null;
  }
  if (!userId) {
    await failMinivanJob(jobId, "No user to attribute MiniVAN pull attempts");
    return { ok: false, error: "No user" };
  }

  // Latest disposition per VanID from the payload.
  const latest = new Map<number, TeamCanvassRow>();
  for (const row of rows) {
    const prev = latest.get(row.vanId);
    if (!prev || row.dateCreated > prev.dateCreated) latest.set(row.vanId, row);
  }

  let applied = 0;
  let skipped = 0;

  // Lit-dropped: expand to every list voter at the same household.
  const householdVanIds = new Map<string, number[]>();
  for (const [vanId, info] of byVan) {
    if (!info.householdId) continue;
    const list = householdVanIds.get(info.householdId) ?? [];
    list.push(vanId);
    householdVanIds.set(info.householdId, list);
  }

  const toApply: Array<{ vanId: number; row: TeamCanvassRow }> = [];
  for (const [vanId, row] of latest) {
    const outcome = pullDispositionToDoor(adapter, row.resultId, row.statusLabel);
    if (!outcome) {
      skipped += 1;
      continue;
    }
    const info = byVan.get(vanId);
    if (!info?.householdId) {
      skipped += 1;
      continue;
    }
    if (outcome === "lit") {
      for (const hhVan of householdVanIds.get(info.householdId) ?? [vanId]) {
        toApply.push({ vanId: hhVan, row: { ...row, vanId: hhVan, resultId: row.resultId } });
      }
    } else {
      toApply.push({ vanId, row });
    }
  }

  // Dedupe by vanId keeping latest.
  const deduped = new Map<number, TeamCanvassRow>();
  for (const item of toApply) {
    const prev = deduped.get(item.vanId);
    if (!prev || item.row.dateCreated > prev.dateCreated) {
      deduped.set(item.vanId, item.row);
    }
  }

  for (const [vanId, row] of deduped) {
    const outcome = pullDispositionToDoor(adapter, row.resultId, row.statusLabel);
    if (!outcome) {
      skipped += 1;
      continue;
    }
    const info = byVan.get(vanId);
    if (!info?.householdId) {
      skipped += 1;
      continue;
    }

    const capturedAt = parseMinivanDate(row.dateCreated);
    const personOutcome = pullDoorToPersonOutcome(outcome);
    const clientAttemptId = minivanClientAttemptId(
      job.listId,
      vanId,
      row.dateCreated,
    );

    const existing = await prisma.canvassAttempt.findUnique({
      where: { clientAttemptId },
    });
    if (existing) {
      // Older pulls created only a door attempt. Repair the missing person row,
      // but preserve its historical user attribution.
      if (personOutcome) {
        await prisma.canvassPersonResponse.upsert({
          where: {
            attemptId_voterId: {
              attemptId: existing.id,
              voterId: info.voterId,
            },
          },
          create: {
            attemptId: existing.id,
            voterId: info.voterId,
            outcome: personOutcome,
          },
          update: { outcome: personOutcome },
        });
      }
      skipped += 1;
      continue;
    }

    const attempt = await prisma.canvassAttempt.create({
      data: {
        clientAttemptId,
        programId: program.id,
        listId: job.listId,
        householdId: info.householdId,
        checkoutId: activeCheckout?.id ?? null,
        userId,
        campaignId: job.campaignId,
        outcome,
        notes: `[MiniVAN pull] ResultID ${row.resultId}`,
        capturedAt,
        packetVersion: "minivan-pull",
        people:
          personOutcome
            ? {
                create: {
                  voterId: info.voterId,
                  outcome: personOutcome,
                },
              }
            : undefined,
      },
    });

    await applyFieldWriteback({
      attemptId: attempt.id,
      householdId: info.householdId,
      campaignId: job.campaignId,
      programId: program.id,
      userId,
      capturedAt,
      outcome,
      observedScore: null,
      people:
        personOutcome
          ? [{ voterId: info.voterId, outcome: personOutcome }]
          : [],
    });
    applied += 1;
  }

  const listData = (job.list.data ?? {}) as Record<string, unknown>;
  const minivanMeta = {
    ...((listData.minivan as Record<string, unknown>) ?? {}),
    lastPullAt: new Date().toISOString(),
    lastPullApplied: applied,
    lastPullSkipped: skipped,
  };
  await prisma.list.update({
    where: { id: job.listId },
    data: { data: { ...listData, minivan: minivanMeta } },
  });

  await completeMinivanJob(jobId, { applied, skipped, total: rows.length });
  revalidatePath("/canvass");
  revalidatePath("/stats");
  revalidatePath(`/admin/${job.campaign.slug}`);
  return { ok: true, applied, skipped };
}

function parseMinivanDate(raw: string): Date {
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  const withZ = /Z$|[+-]\d{2}:?\d{2}$/.test(normalized)
    ? normalized
    : `${normalized}Z`;
  const d = new Date(withZ);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}
