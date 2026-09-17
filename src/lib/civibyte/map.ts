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

export function civibyteDoorOutcome(
  result: string | null | undefined,
): DoorOutcome | null {
  return result ? (RESULT_TO_OUTCOME[result] ?? null) : null;
}

export function civibyteClientAttemptId(
  listId: string,
  sessionDoorId: string,
  attemptedAt: string,
): string {
  return `civibyte:${listId}:${sessionDoorId}:${new Date(attemptedAt).toISOString()}`;
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
