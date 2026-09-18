import type { DoorOutcome } from "@/lib/canvass/outcomes";
import type { MinivanAdapter } from "./adapters/types";
import { normalizeMinivanLabel } from "./adapters/types";

/** Resolve a TeamCanvasses ResultID / status label to a StrideVote door outcome. */
export function pullDispositionToDoor(
  adapter: MinivanAdapter,
  resultId: number | null | undefined,
  statusLabel?: string | null,
): DoorOutcome | null {
  if (resultId != null && Object.prototype.hasOwnProperty.call(adapter.pullResultIdToDoor, resultId)) {
    return adapter.pullResultIdToDoor[resultId] ?? null;
  }
  const key = normalizeMinivanLabel(statusLabel);
  if (key && Object.prototype.hasOwnProperty.call(adapter.pullStatusLabelToDoor, key)) {
    return adapter.pullStatusLabelToDoor[key] ?? null;
  }
  return null;
}

/** A MiniVAN "Canvassed" row belongs to one VanID, so it is one reached voter. */
export function pullDoorToPersonOutcome(
  outcome: DoorOutcome,
): "talked" | null {
  return outcome === "contact" ? "talked" : null;
}

/** Portable status slug used by apply_to_list household expansion. */
export function doorToPortableStatus(outcome: DoorOutcome): string {
  switch (outcome) {
    case "contact":
      return "canvassed";
    case "no_answer":
      return "not-home";
    case "refused":
      return "refused";
    case "inaccessible":
    case "unsafe":
      return "inaccessible";
    case "moved":
      return "moved";
    case "lit":
      return "lit-dropped";
    default:
      return outcome;
  }
}

export function pushDoorToStatusLabel(
  adapter: MinivanAdapter,
  outcome: DoorOutcome,
): string | null {
  return adapter.pushDoorToStatusLabel[outcome] ?? null;
}

export function isHouseholdStatus(
  adapter: MinivanAdapter,
  statusSlug: string | null | undefined,
): boolean {
  const slug = (statusSlug ?? "").toLowerCase();
  if (slug === "lit-dropped") return true;
  return adapter.householdStatuses.includes(slug);
}

/** Normalize MiniVAN TeamCanvass timestamps for attempt ids. */
export function minivanAttemptDateKey(dateCreated: string): string {
  return dateCreated.replace(/\s+/g, "T").slice(0, 19);
}

/**
 * Stable clientAttemptId for MiniVAN pull rows (idempotent).
 * `vendorKey` is the printed list number (`List.sourceRef`), not a StrideVote list id.
 */
export function minivanClientAttemptId(
  vendorKey: string,
  vanId: number,
  dateCreated: string,
): string {
  return `minivan:${vendorKey}:${vanId}:${minivanAttemptDateKey(dateCreated)}`;
}
