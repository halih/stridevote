import type { DoorOutcome } from "@/lib/canvass/outcomes";

export interface CivibyteDoorLink {
  addressPk: string;
  householdId: string;
  voterIdsByPk: Record<string, string>;
}

export interface CivibyteListMeta {
  sessionId: string;
  importedAt: string;
  importStats: {
    doors: number;
    voters: number;
    unmatchedDoors: number;
    unmatchedVoters: number;
  };
  doors: Record<string, CivibyteDoorLink>;
  lastPullAt?: string;
  lastPullApplied?: number;
  lastPullSkipped?: number;
  lastPushAt?: string;
  lastPushApplied?: number;
  lastPushRejected?: number;
  lastPushSkipped?: number;
  pushedAttempts?: Record<string, string>;
}

const RESULT_TO_OUTCOME: Record<string, DoorOutcome | null> = {
  CONTACT: "contact",
  NO_ANSWER: "no_answer",
  REFUSED: "refused",
  LIT_DROPPED: "lit",
  UNSAFE: "unsafe",
  INACCESSIBLE: "inaccessible",
  OTHER: null,
};

const OUTCOME_TO_RESULT: Partial<Record<DoorOutcome, string>> = {
  contact: "CONTACT",
  no_answer: "NO_ANSWER",
  refused: "REFUSED",
  lit: "LIT_DROPPED",
  unsafe: "UNSAFE",
  inaccessible: "INACCESSIBLE",
};

export function civibyteDoorOutcome(
  result: string | null | undefined,
): DoorOutcome | null {
  return result ? (RESULT_TO_OUTCOME[result] ?? null) : null;
}

export function civibyteDoorResult(
  outcome: DoorOutcome,
): string | null {
  return OUTCOME_TO_RESULT[outcome] ?? null;
}

/** Prefer the imported session-door UUID; fall back to stable addressPk after a rebuild. */
export function matchCivibyteSessionDoor<T extends { id: string; addressPk: string }>(
  importedDoorId: string,
  addressPk: string,
  byId: Map<string, T>,
  byAddressPk: Map<string, T>,
): T | undefined {
  return byId.get(importedDoorId) ?? byAddressPk.get(addressPk);
}

/**
 * Stable clientAttemptId for Civibyte pull rows (idempotent).
 * `vendorKey` is `List.sourceRef` (guest link URL) — the volunteer-facing handle.
 * Do not use `canvassingSessionId`; it can change if the link is reissued.
 */
export function civibyteClientAttemptId(
  vendorKey: string,
  sessionDoorId: string,
  attemptedAt: string,
): string {
  return `civibyte:${vendorKey}:${sessionDoorId}:${new Date(attemptedAt).toISOString()}`;
}

export function parseCivibyteAddress(completeAddress: string): {
  registrationAddress: string;
  city: string;
  state: string;
  postalCode: string;
} {
  const parts = completeAddress
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 3) {
    return {
      registrationAddress: completeAddress.trim(),
      city: "",
      state: "WA",
      postalCode: "",
    };
  }

  const stateZip = parts.at(-1)?.match(/^([A-Z]{2})\s+(\d{5})(?:-\d{4})?$/i);
  return {
    registrationAddress: parts.slice(0, -2).join(", "),
    city: parts.at(-2) ?? "",
    state: stateZip?.[1]?.toUpperCase() ?? "WA",
    postalCode: stateZip?.[2] ?? "",
  };
}
