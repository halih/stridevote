import { z } from "zod";

/** Household-level dispositions (align with stats-source + moved). */
export const DOOR_OUTCOMES = [
  "contact",
  "no_answer",
  "refused",
  "lit",
  "unsafe",
  "inaccessible",
  "moved",
] as const;

export type DoorOutcome = (typeof DOOR_OUTCOMES)[number];

export const PERSON_OUTCOMES = [
  "talked",
  "refused",
  "moved",
  "not_home",
] as const;

export type PersonOutcome = (typeof PERSON_OUTCOMES)[number];

/**
 * Hard dispositions (contact made / door finished hard). Kept for analytics;
 * volunteer progress treats any logged outcome as done.
 */
export const TERMINAL_DOOR_OUTCOMES: ReadonlySet<DoorOutcome> = new Set([
  "contact",
  "refused",
  "moved",
  "unsafe",
  "inaccessible",
]);

export function isDoorOutcome(value: string): value is DoorOutcome {
  return (DOOR_OUTCOMES as readonly string[]).includes(value);
}

export function isPersonOutcome(value: string): value is PersonOutcome {
  return (PERSON_OUTCOMES as readonly string[]).includes(value);
}

export function isTerminalDoorOutcome(outcome: string): boolean {
  return TERMINAL_DOOR_OUTCOMES.has(outcome as DoorOutcome);
}

/** Any logged door result counts as done for walk progress. */
export function isDoneDoorOutcome(outcome: string): boolean {
  return isDoorOutcome(outcome);
}

/** Map pin colors by door result (shared walk + preview). */
export const DOOR_PIN_COLORS = {
  remaining: "#185FA5",
  /** Contact / talked */
  talked: "#2e9e5b",
  lit: "#c97a2e",
  /** Refused, no answer, inaccessible, unsafe, moved, etc. */
  other: "#8a8f98",
} as const;

export function doorPinColor(
  outcome: string | null | undefined,
  remainingColor: string = DOOR_PIN_COLORS.remaining,
): string {
  if (!outcome) return remainingColor;
  if (outcome === "contact") return DOOR_PIN_COLORS.talked;
  if (outcome === "lit") return DOOR_PIN_COLORS.lit;
  return DOOR_PIN_COLORS.other;
}

export const DOOR_PIN_LEGEND = [
  { color: DOOR_PIN_COLORS.talked, label: "talked" },
  { color: DOOR_PIN_COLORS.lit, label: "lit" },
  { color: DOOR_PIN_COLORS.other, label: "other result" },
] as const;

export const PROGRAM_STATUSES = ["draft", "active", "closed"] as const;
export type ProgramStatus = (typeof PROGRAM_STATUSES)[number];

export const QUESTION_TYPES = [
  "yes_no",
  "single",
  "multi",
  "support",
  "text",
] as const;

export type QuestionType = (typeof QUESTION_TYPES)[number];

export interface ProgramQuestion {
  id: string;
  type: QuestionType;
  label: string;
  required?: boolean;
  options?: string[];
}

export const programQuestionSchema = z.object({
  id: z.string().min(1),
  type: z.enum(QUESTION_TYPES),
  label: z.string().min(1).max(200),
  required: z.boolean().optional(),
  options: z.array(z.string().min(1).max(80)).max(20).optional(),
});

export const PACKET_TTL_MS = 72 * 60 * 60 * 1000;

export const DOOR_OUTCOME_LABELS: Record<DoorOutcome, string> = {
  contact: "Contact",
  no_answer: "No answer",
  refused: "Refused",
  lit: "Lit drop",
  unsafe: "Unsafe",
  inaccessible: "Inaccessible",
  moved: "Moved / vacant",
};

export const PERSON_OUTCOME_LABELS: Record<PersonOutcome, string> = {
  talked: "Talked",
  refused: "Refused",
  moved: "Moved",
  not_home: "Not home",
};
