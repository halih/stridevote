import type { IconName } from "@/components/Icon";

export type AchievementScope = "overall" | "campaign";

export type AchievementMetric =
  | "doors_knocked"
  | "voters_reached"
  | "lists_checked_out"
  | "lists_completed"
  | "campaigns_joined"
  | "contacts"
  | "lit_dropped";

export interface AchievementDef {
  id: string;
  title: string;
  description: string;
  icon: IconName;
  scope: AchievementScope;
  metric: AchievementMetric;
  threshold: number;
}

/**
 * Code catalog of achievements. Append here to add badges — evaluate-on-read
 * will compute progress (including historical activity) automatically.
 */
export const ACHIEVEMENT_CATALOG: AchievementDef[] = [
  // Overall
  {
    id: "first-list",
    title: "First steps",
    description: "Check out your first list",
    icon: "list",
    scope: "overall",
    metric: "lists_checked_out",
    threshold: 1,
  },
  {
    id: "first-conversation",
    title: "First conversation",
    description: "Talk to your first voter",
    icon: "contact",
    scope: "overall",
    metric: "voters_reached",
    threshold: 1,
  },
  {
    id: "conversation-starter",
    title: "Conversation starter",
    description: "Talk to 25 voters",
    icon: "contact",
    scope: "overall",
    metric: "voters_reached",
    threshold: 25,
  },
  {
    id: "centurion",
    title: "Centurion",
    description: "Knock 100 doors",
    icon: "door",
    scope: "overall",
    metric: "doors_knocked",
    threshold: 100,
  },
  {
    id: "marathon",
    title: "Marathoner",
    description: "Knock 1,000 doors",
    icon: "trophy",
    scope: "overall",
    metric: "doors_knocked",
    threshold: 1000,
  },
  {
    id: "ten-thousand",
    title: "Ten thousand",
    description: "Knock 10,000 doors",
    icon: "trophy",
    scope: "overall",
    metric: "doors_knocked",
    threshold: 10000,
  },
  {
    id: "lit-100",
    title: "Lit starter",
    description: "Leave literature at 100 doors",
    icon: "lit",
    scope: "overall",
    metric: "lit_dropped",
    threshold: 100,
  },
  {
    id: "lit-500",
    title: "Lit runner",
    description: "Leave literature at 500 doors",
    icon: "lit",
    scope: "overall",
    metric: "lit_dropped",
    threshold: 500,
  },
  {
    id: "lit-1000",
    title: "Lit legend",
    description: "Leave literature at 1,000 doors",
    icon: "lit",
    scope: "overall",
    metric: "lit_dropped",
    threshold: 1000,
  },
  {
    id: "coalition",
    title: "Coalition builder",
    description: "Join 3 campaigns",
    icon: "users",
    scope: "overall",
    metric: "campaigns_joined",
    threshold: 3,
  },
  // Campaign-scoped
  {
    id: "campaign-first-list",
    title: "On the turf",
    description: "Check out a list for this campaign",
    icon: "list",
    scope: "campaign",
    metric: "lists_checked_out",
    threshold: 1,
  },
  {
    id: "campaign-ten",
    title: "Getting started",
    description: "Knock 10 doors on this campaign",
    icon: "door",
    scope: "campaign",
    metric: "doors_knocked",
    threshold: 10,
  },
  {
    id: "campaign-fifty",
    title: "Neighborhood walker",
    description: "Knock 50 doors on this campaign",
    icon: "door",
    scope: "campaign",
    metric: "doors_knocked",
    threshold: 50,
  },
  {
    id: "campaign-centurion",
    title: "Campaign centurion",
    description: "Knock 100 doors on this campaign",
    icon: "trophy",
    scope: "campaign",
    metric: "doors_knocked",
    threshold: 100,
  },
  {
    id: "campaign-thousand",
    title: "Campaign marathoner",
    description: "Knock 1,000 doors on this campaign",
    icon: "trophy",
    scope: "campaign",
    metric: "doors_knocked",
    threshold: 1000,
  },
  {
    id: "campaign-finisher",
    title: "List finisher",
    description: "Complete a list on this campaign",
    icon: "check",
    scope: "campaign",
    metric: "lists_completed",
    threshold: 1,
  },
];

export function catalogById(id: string): AchievementDef | undefined {
  return ACHIEVEMENT_CATALOG.find((a) => a.id === id);
}

export function overallScopeKey(): string {
  return "overall";
}

export function campaignScopeKey(campaignId: string): string {
  return campaignId;
}
