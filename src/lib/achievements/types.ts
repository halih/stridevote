import type { IconName } from "@/components/Icon";

export interface AchievementVM {
  id: string;
  title: string;
  desc: string;
  icon: IconName;
  earned: boolean;
  progress: number; // 0..1
  progressLabel: string;
  /** Display string when earned, e.g. "Sep 7, 2026". */
  earnedAt: string | null;
  campaignId: string | null;
  campaignName: string | null;
}

export interface AchievementListItem extends AchievementVM {
  scope: "overall" | "campaign";
  rowKey: string;
}

export interface UnseenUnlockVM {
  unlockId: string;
  achievementId: string;
  title: string;
  description: string;
  icon: IconName;
  campaignId: string | null;
  campaignName: string | null;
  earnedAt: string | null;
}

export interface OutcomeRow {
  key: string;
  label: string;
  count: number;
  color: string;
}

export interface BreakdownRow {
  id: string;
  name: string;
  color: string;
  doors: number;
}

export interface LeaderRow {
  userId: string;
  name: string;
  doors: number;
  you: boolean;
}

export interface StatsCampaignOption {
  id: string;
  name: string;
  color: string;
  slug: string;
}

export interface StatsViewData {
  campaignId: string | null;
  campaigns: StatsCampaignOption[];
  doorsKnocked: number;
  votersReached: number;
  litDropped: number;
  hoursActive: number;
  listsCheckedOut: number;
  listsCompleted: number;
  campaignsJoined: number;
  responseRate: number;
  weeklyHistory: number[];
  outcomes: OutcomeRow[];
  breakdown: BreakdownRow[];
  achievements: AchievementVM[];
  unseenUnlocks: UnseenUnlockVM[];
  leaderboard: LeaderRow[];
  rank: number;
  empty: boolean;
}
