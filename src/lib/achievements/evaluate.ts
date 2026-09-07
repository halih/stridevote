import "server-only";

import { prisma } from "@/lib/db";
import {
  ACHIEVEMENT_CATALOG,
  campaignScopeKey,
  catalogById,
  overallScopeKey,
  type AchievementDef,
  type AchievementMetric,
} from "@/lib/achievements/catalog";
import type {
  AchievementListItem,
  AchievementVM,
  UnseenUnlockVM,
} from "@/lib/achievements/types";

export type { AchievementListItem, AchievementVM, UnseenUnlockVM };

export interface AchievementMetrics {
  doors_knocked: number;
  voters_reached: number;
  lists_checked_out: number;
  lists_completed: number;
  campaigns_joined: number;
  contacts: number;
  lit_dropped: number;
}

function metricValue(metrics: AchievementMetrics, metric: AchievementMetric): number {
  return metrics[metric];
}

export function formatEarnedAt(date: Date | null | undefined): string | null {
  if (!date) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function toVM(
  def: AchievementDef,
  value: number,
  opts: {
    earnedAt: Date | null;
    campaignId: string | null;
    campaignName: string | null;
  },
): AchievementVM {
  const earned = value >= def.threshold;
  const earnedAtLabel = earned ? formatEarnedAt(opts.earnedAt) : null;
  return {
    id: def.id,
    title: def.title,
    desc: def.description,
    icon: def.icon,
    earned,
    progress: Math.min(1, value / def.threshold),
    progressLabel: earned
      ? earnedAtLabel
        ? `Earned ${earnedAtLabel}`
        : "Earned"
      : `${Math.min(value, def.threshold)}/${def.threshold}`,
    earnedAt: earnedAtLabel,
    campaignId: opts.campaignId,
    campaignName: opts.campaignName,
  };
}

async function ensureUnlocks(
  userId: string,
  earned: { def: AchievementDef; scopeKey: string; campaignId: string | null }[],
): Promise<void> {
  if (!earned.length) return;

  const existing = await prisma.userAchievementUnlock.findMany({
    where: {
      userId,
      OR: earned.map((e) => ({
        achievementId: e.def.id,
        scopeKey: e.scopeKey,
      })),
    },
    select: { achievementId: true, scopeKey: true },
  });
  const have = new Set(existing.map((r) => `${r.achievementId}:${r.scopeKey}`));

  const toCreate = earned.filter((e) => !have.has(`${e.def.id}:${e.scopeKey}`));
  if (!toCreate.length) return;

  await prisma.userAchievementUnlock.createMany({
    data: toCreate.map((e) => ({
      userId,
      achievementId: e.def.id,
      scopeKey: e.scopeKey,
      campaignId: e.campaignId,
    })),
    skipDuplicates: true,
  });
}

type UnlockRow = {
  id: string;
  achievementId: string;
  scopeKey: string;
  campaignId: string | null;
  earnedAt: Date;
  seenAt: Date | null;
  campaign: { name: string } | null;
};

async function loadUnlocks(userId: string): Promise<UnlockRow[]> {
  return prisma.userAchievementUnlock.findMany({
    where: { userId },
    orderBy: { earnedAt: "asc" },
    include: { campaign: { select: { name: true } } },
  });
}

function unlockMap(rows: UnlockRow[]): Map<string, UnlockRow> {
  return new Map(rows.map((r) => [`${r.achievementId}:${r.scopeKey}`, r]));
}

function collectPendingEarns(opts: {
  overallMetrics: AchievementMetrics;
  campaignMetrics: { campaignId: string; name: string; metrics: AchievementMetrics }[];
}): { def: AchievementDef; scopeKey: string; campaignId: string | null }[] {
  const pendingEarn: {
    def: AchievementDef;
    scopeKey: string;
    campaignId: string | null;
  }[] = [];

  for (const def of ACHIEVEMENT_CATALOG) {
    if (def.scope !== "overall") continue;
    const value = metricValue(opts.overallMetrics, def.metric);
    if (value >= def.threshold) {
      pendingEarn.push({
        def,
        scopeKey: overallScopeKey(),
        campaignId: null,
      });
    }
  }

  for (const camp of opts.campaignMetrics) {
    for (const def of ACHIEVEMENT_CATALOG) {
      if (def.scope !== "campaign") continue;
      const value = metricValue(camp.metrics, def.metric);
      if (value >= def.threshold) {
        pendingEarn.push({
          def,
          scopeKey: campaignScopeKey(camp.campaignId),
          campaignId: camp.campaignId,
        });
      }
    }
  }

  return pendingEarn;
}

/**
 * Evaluate catalog achievements for a scope, persist new unlocks, return VMs
 * plus any unseen unlocks (for the celebration sheet).
 */
export async function evaluateAchievements(opts: {
  userId: string;
  viewMetrics: AchievementMetrics;
  viewCampaignId: string | null;
  overallMetrics: AchievementMetrics;
  campaignMetrics: { campaignId: string; name: string; metrics: AchievementMetrics }[];
}): Promise<{ achievements: AchievementVM[]; unseenUnlocks: UnseenUnlockVM[] }> {
  await ensureUnlocks(
    opts.userId,
    collectPendingEarns({
      overallMetrics: opts.overallMetrics,
      campaignMetrics: opts.campaignMetrics,
    }),
  );

  const unlocks = await loadUnlocks(opts.userId);
  const byKey = unlockMap(unlocks);
  const campNameById = new Map(
    opts.campaignMetrics.map((c) => [c.campaignId, c.name]),
  );

  const defsForView = ACHIEVEMENT_CATALOG.filter((d) =>
    opts.viewCampaignId ? d.scope === "campaign" : d.scope === "overall",
  );
  const scopeKey = opts.viewCampaignId
    ? campaignScopeKey(opts.viewCampaignId)
    : overallScopeKey();
  const campaignName = opts.viewCampaignId
    ? campNameById.get(opts.viewCampaignId) ?? null
    : null;

  const achievementsAll = defsForView.map((def) => {
    const row = byKey.get(`${def.id}:${scopeKey}`);
    return {
      vm: toVM(def, metricValue(opts.viewMetrics, def.metric), {
        earnedAt: row?.earnedAt ?? null,
        campaignId: opts.viewCampaignId,
        campaignName,
      }),
      earnedAtMs: row?.earnedAt?.getTime() ?? 0,
    };
  });

  // Stats preview: 3 most recently earned + 3 closest to earning.
  const recentlyEarned = achievementsAll
    .filter((a) => a.vm.earned)
    .sort((a, b) => b.earnedAtMs - a.earnedAtMs)
    .slice(0, 3)
    .map((a) => a.vm);
  const closestToEarn = achievementsAll
    .filter((a) => !a.vm.earned)
    .sort((a, b) => b.vm.progress - a.vm.progress || a.vm.title.localeCompare(b.vm.title))
    .slice(0, 3)
    .map((a) => a.vm);
  const achievements = [...recentlyEarned, ...closestToEarn];

  const unseenUnlocks: UnseenUnlockVM[] = [];
  for (const row of unlocks) {
    if (row.seenAt) continue;
    const def = catalogById(row.achievementId);
    if (!def) continue;
    unseenUnlocks.push({
      unlockId: row.id,
      achievementId: row.achievementId,
      title: def.title,
      description: def.description,
      icon: def.icon,
      campaignId: row.campaignId,
      campaignName:
        row.campaign?.name ??
        (row.campaignId ? campNameById.get(row.campaignId) ?? null : null),
      earnedAt: formatEarnedAt(row.earnedAt),
    });
  }

  unseenUnlocks.sort((a, b) => {
    const aMatch =
      (opts.viewCampaignId == null && a.campaignId == null) ||
      a.campaignId === opts.viewCampaignId
        ? 0
        : 1;
    const bMatch =
      (opts.viewCampaignId == null && b.campaignId == null) ||
      b.campaignId === opts.viewCampaignId
        ? 0
        : 1;
    return aMatch - bMatch;
  });

  return { achievements, unseenUnlocks };
}

/** Full catalog progress for the Achievements list page. */
export async function listAllAchievements(opts: {
  userId: string;
  overallMetrics: AchievementMetrics;
  campaignMetrics: { campaignId: string; name: string; metrics: AchievementMetrics }[];
}): Promise<AchievementListItem[]> {
  await ensureUnlocks(
    opts.userId,
    collectPendingEarns({
      overallMetrics: opts.overallMetrics,
      campaignMetrics: opts.campaignMetrics,
    }),
  );

  const unlocks = await loadUnlocks(opts.userId);
  const byKey = unlockMap(unlocks);
  const items: AchievementListItem[] = [];

  for (const def of ACHIEVEMENT_CATALOG) {
    if (def.scope === "overall") {
      const scopeKey = overallScopeKey();
      const row = byKey.get(`${def.id}:${scopeKey}`);
      const vm = toVM(def, metricValue(opts.overallMetrics, def.metric), {
        earnedAt: row?.earnedAt ?? null,
        campaignId: null,
        campaignName: null,
      });
      items.push({
        ...vm,
        scope: "overall",
        rowKey: `${def.id}:${scopeKey}`,
      });
      continue;
    }

    for (const camp of opts.campaignMetrics) {
      const scopeKey = campaignScopeKey(camp.campaignId);
      const row = byKey.get(`${def.id}:${scopeKey}`);
      const vm = toVM(def, metricValue(camp.metrics, def.metric), {
        earnedAt: row?.earnedAt ?? null,
        campaignId: camp.campaignId,
        campaignName: camp.name,
      });
      items.push({
        ...vm,
        scope: "campaign",
        rowKey: `${def.id}:${scopeKey}`,
      });
    }
  }

  // Earned first (newest earned first), then in-progress by progress desc.
  items.sort((a, b) => {
    if (a.earned !== b.earned) return a.earned ? -1 : 1;
    if (a.earned && b.earned) {
      const aDate = byKey.get(a.rowKey)?.earnedAt?.getTime() ?? 0;
      const bDate = byKey.get(b.rowKey)?.earnedAt?.getTime() ?? 0;
      return bDate - aDate;
    }
    return b.progress - a.progress;
  });

  return items;
}

export async function markAchievementUnlocksSeen(
  userId: string,
  unlockIds: string[],
): Promise<void> {
  if (!unlockIds.length) return;
  await prisma.userAchievementUnlock.updateMany({
    where: { userId, id: { in: unlockIds }, seenAt: null },
    data: { seenAt: new Date() },
  });
}
