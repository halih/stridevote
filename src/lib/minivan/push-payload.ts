import "server-only";
import { prisma } from "@/lib/db";
import { requireMinivanAdapter } from "@/lib/minivan/adapters";
import {
  doorToPortableStatus,
  minivanPushOutcome,
  pushDoorToStatusLabel,
} from "@/lib/minivan/map-canvass";
import { ensureActiveProgram } from "@/lib/canvass/programs";
import { isDoorOutcome } from "@/lib/canvass/outcomes";
import { MINIVAN_PUSH_JOB_TYPES } from "@/lib/minivan/jobs";
import {
  stagePendingPushedOutcomes,
  type MinivanPushedOutcomes,
} from "@/lib/minivan/pushed-outcomes";

/**
 * Build export_list_json-shaped payload for apply_and_sync.py.
 * Includes survey/notes from StrideVote (push is the rich direction).
 */
export async function buildMinivanPushPayload(jobId: string): Promise<{
  ok: boolean;
  error?: string;
  printedListNumber?: string;
  listIdInternal?: number | null;
  data?: {
    list: { list_id: number; name: string | null; people_count: number; door_count: number };
    voters: Array<Record<string, unknown>>;
  };
}> {
  const job = await prisma.miniVanJob.findUnique({
    where: { id: jobId },
    include: {
      campaign: {
        select: { minivanAdapterKey: true, minivanEnabled: true },
      },
      list: true,
    },
  });
  if (
    !job ||
    !(MINIVAN_PUSH_JOB_TYPES as readonly string[]).includes(job.type) ||
    job.status !== "running"
  ) {
    return { ok: false, error: "Job not found or not running" };
  }
  if (!job.list || job.list.deletedAt) {
    return { ok: false, error: "No active list on job" };
  }

  let adapter;
  try {
    adapter = requireMinivanAdapter(job.campaign.minivanAdapterKey);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Adapter error" };
  }

  const program = await ensureActiveProgram(job.campaignId);
  const attempts = await prisma.canvassAttempt.findMany({
    where: { programId: program.id, listId: job.list.id },
    orderBy: { capturedAt: "desc" },
    include: { people: true },
  });
  // Latest attempt per household (same fold as progress.ts).
  const current = new Map<string, (typeof attempts)[number]>();
  const superseded = new Set(
    attempts.map((a) => a.supersedesClientId).filter((id): id is string => !!id),
  );
  for (const a of attempts) {
    if (superseded.has(a.clientAttemptId)) continue;
    if (!current.has(a.householdId)) current.set(a.householdId, a);
  }

  const listVoters = await prisma.listVoter.findMany({
    where: { listId: job.list.id },
    include: {
      voter: {
        select: {
          id: true,
          firstName: true,
          middleName: true,
          lastName: true,
          registrationAddress: true,
          city: true,
          state: true,
          postalCode: true,
          householdLinks: {
            select: {
              household: {
                select: {
                  id: true,
                  addressLine: true,
                  unit: true,
                  city: true,
                  state: true,
                  postalCode: true,
                },
              },
            },
            take: 1,
          },
        },
      },
    },
  });

  const listData = (job.list.data ?? {}) as {
    minivan?: { listId?: number; printedListNumber?: string };
  };
  const vanListId = listData.minivan?.listId ?? 0;

  const voters: Array<Record<string, unknown>> = [];
  // What we are about to send per VanID, so the next pull can ignore echoes.
  const pushedOutcomes: MinivanPushedOutcomes = {};
  for (const lv of listVoters) {
    const hh = lv.voter.householdLinks[0]?.household;
    const householdId = hh?.id;
    const attempt = householdId ? current.get(householdId) : undefined;
    let canvass: Record<string, unknown> | null = null;

    if (attempt && isDoorOutcome(attempt.outcome)) {
      const pushOutcome = minivanPushOutcome(attempt.outcome, attempt.people);
      const statusLabel = pushDoorToStatusLabel(adapter, pushOutcome);
      if (statusLabel) {
        if (lv.vanId != null) pushedOutcomes[String(lv.vanId)] = pushOutcome;
        const person =
          attempt.people.find((p) => p.voterId === lv.voterId) ??
          attempt.people.find((p) => p.voterId != null);
        const survey_responses: Array<{
          question: string;
          question_short: string;
          response: string;
        }> = [];
        if (adapter.supportSortOrder && person?.support != null) {
          // apply_to_list remaps by response text; candidate sort order 1–5
          // is resolved on the MiniVAN list via SRSortOrder in van_bridge style.
          survey_responses.push({
            question: "Candidate support",
            question_short: "Support",
            response: String(person.support),
          });
        }
        canvass = {
          status: doorToPortableStatus(pushOutcome),
          status_label: statusLabel,
          date: attempt.capturedAt.toISOString().replace("T", " ").slice(0, 19),
          source: "stridevote",
          notes: attempt.notes ?? person?.notes ?? null,
          survey_responses,
          van: { result_id: null, survey_responses: [] },
        };
      }
    }

    const streetNo =
      (hh?.addressLine ?? lv.voter.registrationAddress).match(/^(\d+)/)?.[1] ?? null;
    voters.push({
      name: {
        first: lv.voter.firstName,
        middle: lv.voter.middleName,
        last: lv.voter.lastName,
      },
      address: {
        street_no: streetNo,
        street_prefix: null,
        street_name: null,
        street_type: null,
        street_suffix: null,
        apt_no: hh?.unit ?? null,
        city: hh?.city ?? lv.voter.city,
        state: hh?.state ?? lv.voter.state,
        zip5: (hh?.postalCode ?? lv.voter.postalCode).slice(0, 5),
        full: hh
          ? `${hh.addressLine}${hh.unit ? ` #${hh.unit}` : ""}, ${hh.city}, ${hh.state} ${hh.postalCode}`
          : lv.voter.registrationAddress,
      },
      canvass,
      van: { van_id: lv.vanId },
    });
  }

  await stagePendingPushedOutcomes(jobId, pushedOutcomes);

  return {
    ok: true,
    printedListNumber:
      job.list.sourceRef ?? listData.minivan?.printedListNumber ?? undefined,
    listIdInternal: vanListId || null,
    data: {
      list: {
        list_id: vanListId,
        name: job.list.name,
        people_count: voters.length,
        door_count: job.list.doorsCount,
      },
      voters,
    },
  };
}
