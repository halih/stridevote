import type { DoorOutcome } from "@/lib/canvass/outcomes";

/** Portable MiniVAN disposition slug (from ResultShortName). */
export type MinivanStatusSlug =
  | "canvassed"
  | "not-home"
  | "refused"
  | "inaccessible"
  | "moved"
  | "lit-dropped"
  | "deceased"
  | string;

/**
 * Campaign-specific MiniVAN ↔ StrideVote mapping.
 * Pull only uses ResultID / status labels → door outcomes.
 * Push also maps support and program survey questions by text.
 */
export interface MinivanAdapter {
  /** Registry key stored on Campaign.minivanAdapterKey */
  key: string;
  label: string;

  /** ResultID → door outcome for pull (TeamCanvasses). Missing / deceased → null (skip). */
  pullResultIdToDoor: Record<number, DoorOutcome | null>;

  /** ResultShortName (normalized) → door outcome when ResultID map misses. */
  pullStatusLabelToDoor: Record<string, DoorOutcome | null>;

  /** Door outcome → portable status label for push. */
  pushDoorToStatusLabel: Partial<Record<DoorOutcome, string>>;

  /**
   * Candidate-support survey: StrideVote support 1–5 maps to MiniVAN response
   * sort order (1 = strongest). Used on push; not available on TeamCanvasses pull.
   */
  supportSortOrder?: boolean;

  /**
   * Map StrideVote program question id → MiniVAN survey question short name
   * (matched by text on the target list). Optional extras for push.
   */
  programQuestionToSurveyName?: Record<string, string>;

  /** Portable status slugs that apply to the whole door on push (lit-dropped always). */
  householdStatuses: string[];
}

export function normalizeMinivanLabel(label: string | null | undefined): string {
  return (label ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}
