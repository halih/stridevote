import {
  DOOR_NOTES_MAX,
  PERSON_NOTES_MAX,
  SYNC_BATCH_MAX,
} from "@/lib/canvass/outcomes";
import type { SyncAttemptInput } from "@/lib/canvass/sync";

export function chunkItems<T>(items: T[], size = SYNC_BATCH_MAX): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function clipText(value: string | null | undefined, max: number): string | null | undefined {
  if (value == null) return value;
  return value.length > max ? value.slice(0, max) : value;
}

/** Trim notes so a single oversized field cannot fail a whole sync batch. */
export function clipSyncAttempt(attempt: SyncAttemptInput): SyncAttemptInput {
  return {
    ...attempt,
    notes: clipText(attempt.notes, DOOR_NOTES_MAX) ?? null,
    people: attempt.people?.map((person) => ({
      ...person,
      notes: clipText(person.notes, PERSON_NOTES_MAX),
    })),
  };
}

export function clipUnknownAttempt(raw: unknown): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const obj = raw as Record<string, unknown>;
  const notes = typeof obj.notes === "string" ? clipText(obj.notes, DOOR_NOTES_MAX) : obj.notes;
  const people = Array.isArray(obj.people)
    ? obj.people.map((person) => {
        if (!person || typeof person !== "object") return person;
        const row = person as Record<string, unknown>;
        return {
          ...row,
          notes:
            typeof row.notes === "string"
              ? clipText(row.notes, PERSON_NOTES_MAX)
              : row.notes,
        };
      })
    : obj.people;
  return { ...obj, notes, people };
}
