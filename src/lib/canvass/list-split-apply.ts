/**
 * Load doors, preview a geographic split, and commit it transactionally.
 */

import { Prisma } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { getCurrentAttemptsForList } from "@/lib/canvass/progress";
import {
  MIN_SPLIT_DOORS,
  halfByKey,
  otherHalfKey,
  planListSplit,
  type SplitHalfKey,
  type SplitHalfPlan,
  type SplitPlan,
  type SplitDoorInput,
  type SplitPreview,
  type SplitPreviewHalf,
} from "@/lib/canvass/list-split";

const QUERY_CHUNK = 10000;

function chunked<T>(items: T[], size = QUERY_CHUNK): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function slugify(input: string): string {
  const base = input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base || "list";
}

async function uniqueNameAndSlug(
  preferredName: string,
  opts?: {
    excludeListId?: string;
    reservedNames?: string[];
    reservedSlugs?: string[];
  },
): Promise<{ name: string; slug: string }> {
  const base = preferredName.replace(/\s+\d+$/, "").trim() || preferredName;
  const reservedNames = new Set(opts?.reservedNames ?? []);
  const reservedSlugs = new Set(opts?.reservedSlugs ?? []);
  const notSelf = opts?.excludeListId
    ? { NOT: { id: opts.excludeListId } }
    : {};

  for (let n = 0; n < 50; n++) {
    const name = n === 0 ? preferredName : `${base} ${n + 1}`;
    if (reservedNames.has(name)) continue;

    const nameClash = await prisma.list.findFirst({
      where: { name, ...notSelf },
      select: { id: true },
    });
    if (nameClash) continue;

    const slugBase = slugify(name);
    for (let s = 0; s < 50; s++) {
      const slug = s === 0 ? slugBase : `${slugBase}-${s + 1}`;
      if (reservedSlugs.has(slug)) continue;
      const slugClash = await prisma.list.findFirst({
        where: { slug, ...notSelf },
        select: { id: true },
      });
      if (!slugClash) return { name, slug };
    }
  }
  throw new Error("Could not allocate a unique list name.");
}

export async function loadSplitDoors(
  listId: string,
  programId: string,
): Promise<SplitDoorInput[]> {
  const rows = await prisma.listHousehold.findMany({
    where: { listId },
    orderBy: { sortOrder: "asc" },
    select: {
      householdId: true,
      household: {
        select: {
          addressLine: true,
          city: true,
          unit: true,
          mapboxLat: true,
          mapboxLng: true,
          censusLat: true,
          censusLng: true,
        },
      },
    },
  });

  const attempts = await getCurrentAttemptsForList(programId, listId);

  return rows.map((row) => {
    const lat = row.household.mapboxLat ?? row.household.censusLat;
    const lng = row.household.mapboxLng ?? row.household.censusLng;
    return {
      householdId: row.householdId,
      addressLine: row.household.addressLine,
      city: row.household.city,
      unit: row.household.unit,
      lat,
      lng,
      completed: attempts.has(row.householdId),
    };
  });
}

export type ApplySplitResult =
  | {
      ok: true;
      keptListId: string;
      releasedListId: string;
      keptName: string;
      releasedName: string;
      message: string;
    }
  | { ok: false; message: string };

function toPreviewHalf(
  half: SplitHalfPlan,
  completedIds: Set<string>,
): SplitPreviewHalf {
  return {
    key: half.key,
    suffix: half.suffix,
    name: half.name,
    doorsCount: half.doorsCount,
    completedCount: half.completedCount,
    centroidLat: half.centroidLat,
    centroidLng: half.centroidLng,
    boundary: half.boundary,
    doorPins: half.doorPins.map((pin) => ({
      ...pin,
      completed: completedIds.has(pin.householdId),
    })),
  };
}

export async function buildSplitPreview(
  listId: string,
  programId: string,
  listName: string,
): Promise<{ ok: true; preview: SplitPreview } | { ok: false; message: string }> {
  const doors = await loadSplitDoors(listId, programId);
  if (doors.length < MIN_SPLIT_DOORS) {
    return {
      ok: false,
      message: `Lists need at least ${MIN_SPLIT_DOORS} doors to split.`,
    };
  }
  const result = planListSplit(doors, listName);
  if (!result.ok) return result;

  const completedIds = new Set(
    doors.filter((d) => d.completed).map((d) => d.householdId),
  );

  return {
    ok: true,
    preview: {
      listId,
      programId,
      axis: result.plan.axis,
      baseName: result.plan.baseName,
      halfA: toPreviewHalf(result.plan.halfA, completedIds),
      halfB: toPreviewHalf(result.plan.halfB, completedIds),
    },
  };
}

async function rewriteLiveMembership(
  tx: Prisma.TransactionClient,
  listId: string,
  half: SplitHalfPlan,
  voterRows: Array<{ voterId: string; matchedSeed: boolean }>,
) {
  await tx.listHousehold.deleteMany({ where: { listId } });
  await tx.listVoter.deleteMany({ where: { listId } });

  for (const rows of chunked(
    half.orderedHouseholdIds.map((householdId, index) => ({
      listId,
      householdId,
      sortOrder: index,
    })),
  )) {
    await tx.listHousehold.createMany({ data: rows });
  }
  if (voterRows.length) {
    for (const rows of chunked(
      voterRows.map((row) => ({
        listId,
        voterId: row.voterId,
        matchedSeed: row.matchedSeed,
      })),
    )) {
      await tx.listVoter.createMany({ data: rows });
    }
  }
}

async function rewriteProgramSnapshot(
  tx: Prisma.TransactionClient,
  programId: string,
  listId: string,
  half: SplitHalfPlan,
  voterRows: Array<{ voterId: string; matchedSeed: boolean }>,
) {
  await tx.programListHousehold.deleteMany({ where: { programId, listId } });
  await tx.programListVoter.deleteMany({ where: { programId, listId } });

  for (const rows of chunked(
    half.orderedHouseholdIds.map((householdId, index) => ({
      programId,
      listId,
      householdId,
      sortOrder: index,
    })),
  )) {
    await tx.programListHousehold.createMany({ data: rows });
  }
  if (voterRows.length) {
    for (const rows of chunked(
      voterRows.map((row) => ({
        programId,
        listId,
        voterId: row.voterId,
        matchedSeed: row.matchedSeed,
      })),
    )) {
      await tx.programListVoter.createMany({ data: rows });
    }
  }
}

function votersForHouseholds(
  householdIds: Set<string>,
  byHousehold: Map<string, Array<{ voterId: string; matchedSeed: boolean }>>,
): Array<{ voterId: string; matchedSeed: boolean }> {
  const out: Array<{ voterId: string; matchedSeed: boolean }> = [];
  const seen = new Set<string>();
  for (const householdId of householdIds) {
    for (const member of byHousehold.get(householdId) ?? []) {
      if (seen.has(member.voterId)) continue;
      seen.add(member.voterId);
      out.push(member);
    }
  }
  return out;
}

export async function applyListSplit(opts: {
  listId: string;
  programId: string;
  userId: string;
  keepHalf: SplitHalfKey;
  checkoutId: string;
}): Promise<ApplySplitResult> {
  const list = await prisma.list.findUnique({
    where: { id: opts.listId },
    include: {
      campaignLinks: true,
      voters: { select: { voterId: true, matchedSeed: true } },
      households: { select: { householdId: true } },
    },
  });
  if (!list) return { ok: false, message: "List not found." };
  if (list.source !== "stridevote") {
    return { ok: false, message: "Only StrideVote lists can be split." };
  }

  const doors = await loadSplitDoors(opts.listId, opts.programId);
  const planned = planListSplit(doors, list.name);
  if (!planned.ok) return planned;

  const plan: SplitPlan = planned.plan;
  const kept = halfByKey(plan, opts.keepHalf);
  const released = halfByKey(plan, otherHalfKey(opts.keepHalf));

  const keptNamed = await uniqueNameAndSlug(kept.name, {
    excludeListId: opts.listId,
  });
  const releasedNamed = await uniqueNameAndSlug(released.name, {
    reservedNames: [keptNamed.name],
    reservedSlugs: [keptNamed.slug],
  });

  const keptHalf: SplitHalfPlan = { ...kept, name: keptNamed.name };
  const releasedHalf: SplitHalfPlan = { ...released, name: releasedNamed.name };

  const seedByVoter = new Map(
    list.voters.map((v) => [v.voterId, v.matchedSeed] as const),
  );
  const householdVoters = await prisma.householdVoter.findMany({
    where: { householdId: { in: list.households.map((h) => h.householdId) } },
    select: { householdId: true, voterId: true },
  });
  const votersByHousehold = new Map<
    string,
    Array<{ voterId: string; matchedSeed: boolean }>
  >();
  for (const row of householdVoters) {
    if (!seedByVoter.has(row.voterId)) continue;
    const bucket = votersByHousehold.get(row.householdId) ?? [];
    bucket.push({
      voterId: row.voterId,
      matchedSeed: seedByVoter.get(row.voterId) ?? false,
    });
    votersByHousehold.set(row.householdId, bucket);
  }

  const keptIds = new Set(keptHalf.householdIds);
  const releasedIds = new Set(releasedHalf.householdIds);
  const keptVoters = votersForHouseholds(keptIds, votersByHousehold);
  const releasedVoters = votersForHouseholds(releasedIds, votersByHousehold);

  const currentLink = list.campaignLinks.find(
    (link) => link.programId === opts.programId,
  );
  if (!currentLink) {
    return { ok: false, message: "List is not published in this program." };
  }

  const releasedListId = await prisma.$transaction(async (tx) => {
    const created = await tx.list.create({
      data: {
        slug: releasedNamed.slug,
        name: releasedNamed.name,
        source: "stridevote",
        doorsCount: releasedHalf.doorsCount,
        centroidLat: releasedHalf.centroidLat,
        centroidLng: releasedHalf.centroidLng,
        boundary: releasedHalf.boundary ?? undefined,
        data: {
          splitFrom: opts.listId,
          splitAxis: plan.axis,
          splitSuffix: releasedHalf.suffix,
        },
      },
    });

    await tx.list.update({
      where: { id: opts.listId },
      data: {
        name: keptNamed.name,
        slug: keptNamed.slug,
        doorsCount: keptHalf.doorsCount,
        centroidLat: keptHalf.centroidLat,
        centroidLng: keptHalf.centroidLng,
        boundary: keptHalf.boundary ?? Prisma.DbNull,
        data: {
          ...(typeof list.data === "object" && list.data && !Array.isArray(list.data)
            ? (list.data as Record<string, unknown>)
            : {}),
          splitAxis: plan.axis,
          splitSuffix: keptHalf.suffix,
          splitReleasedListId: created.id,
        } as Prisma.InputJsonValue,
      },
    });

    // Live membership: rewrite kept, create released.
    await rewriteLiveMembership(tx, opts.listId, keptHalf, keptVoters);
    await rewriteLiveMembership(tx, created.id, releasedHalf, releasedVoters);

    // Program snapshots for the active wave.
    await rewriteProgramSnapshot(
      tx,
      opts.programId,
      opts.listId,
      keptHalf,
      keptVoters,
    );
    await rewriteProgramSnapshot(
      tx,
      opts.programId,
      created.id,
      releasedHalf,
      releasedVoters,
    );

    // Publish released half on the current program as available.
    await tx.listCampaign.create({
      data: {
        listId: created.id,
        campaignId: currentLink.campaignId,
        programId: opts.programId,
        visibility: "volunteers",
        assignedUserId: null,
      },
    });

    // Other program links: draft copies so admins can re-publish later.
    for (const link of list.campaignLinks) {
      if (link.programId === opts.programId) continue;
      await tx.listCampaign.create({
        data: {
          listId: created.id,
          campaignId: link.campaignId,
          programId: link.programId,
          visibility: "draft",
          assignedUserId: null,
        },
      });
    }

    // Migrate attempts for moved doors onto the released list.
    const movedAttempts = await tx.canvassAttempt.findMany({
      where: {
        programId: opts.programId,
        listId: opts.listId,
        householdId: { in: [...releasedIds] },
      },
      select: { id: true, checkoutId: true },
    });
    if (movedAttempts.length) {
      await tx.canvassAttempt.updateMany({
        where: { id: { in: movedAttempts.map((a) => a.id) } },
        data: {
          listId: created.id,
          checkoutId: null,
          staleCheckout: true,
        },
      });
    }

    // Redirects for stale offline packets.
    for (const rows of chunked(
      [...releasedIds].map((householdId) => ({
        fromListId: opts.listId,
        householdId,
        toListId: created.id,
      })),
    )) {
      await tx.listHouseholdRedirect.createMany({ data: rows });
    }

    await tx.listSplit.create({
      data: {
        sourceListId: opts.listId,
        releasedListId: created.id,
        programId: opts.programId,
        userId: opts.userId,
        keptHalfKey: opts.keepHalf,
        axis: plan.axis,
      },
    });

    await tx.listCheckout.update({
      where: { id: opts.checkoutId },
      data: {
        progressTotal: keptHalf.doorsCount,
        progressDone: keptHalf.completedCount,
      },
    });

    // Clear assignment on the kept list if it was admin-assigned — volunteer
    // chose to share; the released half must be self-serve available.
    if (currentLink.visibility === "assigned") {
      await tx.listCampaign.update({
        where: { id: currentLink.id },
        data: { visibility: "volunteers", assignedUserId: null },
      });
    }

    return created.id;
  });

  return {
    ok: true,
    keptListId: opts.listId,
    releasedListId,
    keptName: keptNamed.name,
    releasedName: releasedNamed.name,
    message: `Split into ${keptNamed.name} (yours) and ${releasedNamed.name} (available).`,
  };
}
