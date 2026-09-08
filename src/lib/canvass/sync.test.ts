import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DOOR_NOTES_MAX,
  PERSON_NOTES_MAX,
  SYNC_BATCH_MAX,
} from "@/lib/canvass/outcomes";
import {
  chunkItems,
  clipSyncAttempt,
  clipUnknownAttempt,
} from "@/lib/canvass/sync-payload";
import { parseSyncBatch, type SyncAttemptInput } from "@/lib/canvass/sync";

function attempt(overrides: Partial<SyncAttemptInput> = {}): SyncAttemptInput {
  return {
    clientAttemptId: "11111111-1111-4111-8111-111111111111",
    programId: "prog",
    listId: "list",
    householdId: "house",
    campaignId: "camp",
    outcome: "contact",
    notes: "ok",
    capturedAt: "2026-09-07T12:00:00.000Z",
    ...overrides,
  };
}

describe("sync payload chunking and notes", () => {
  it("chunks into batches of 100", () => {
    const items = Array.from({ length: 101 }, (_, i) => i);
    const chunks = chunkItems(items);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].length, SYNC_BATCH_MAX);
    assert.deepEqual(chunks[1], [100]);
  });

  it("clips door and person notes to the server max", () => {
    const longDoor = "d".repeat(DOOR_NOTES_MAX + 50);
    const longPerson = "p".repeat(PERSON_NOTES_MAX + 10);
    const clipped = clipSyncAttempt(
      attempt({
        notes: longDoor,
        people: [
          {
            voterId: "v1",
            outcome: "talked",
            notes: longPerson,
          },
        ],
      }),
    );
    assert.equal(clipped.notes?.length, DOOR_NOTES_MAX);
    assert.equal(clipped.people?.[0].notes?.length, PERSON_NOTES_MAX);
  });
});

describe("parseSyncBatch", () => {
  it("rejects more than 100 attempts at the envelope", () => {
    const parsed = parseSyncBatch({
      attempts: Array.from({ length: 101 }, () => attempt()),
    });
    assert.equal(parsed.ok, false);
  });

  it("accepts a clipped oversized note and still syncs siblings", () => {
    const good = attempt({
      clientAttemptId: "22222222-2222-4222-8222-222222222222",
      notes: "fine",
    });
    const long = attempt({
      clientAttemptId: "33333333-3333-4333-8333-333333333333",
      notes: "n".repeat(DOOR_NOTES_MAX + 1),
    });
    const parsed = parseSyncBatch({ attempts: [long, good] });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.rejected.length, 0);
    assert.equal(parsed.attempts.length, 2);
    assert.equal(parsed.attempts[0].notes?.length, DOOR_NOTES_MAX);
  });

  it("acks an invalid knock without dropping the rest of the batch", () => {
    const bad = {
      ...attempt({ clientAttemptId: "44444444-4444-4444-8444-444444444444" }),
      outcome: "not-a-real-outcome",
    };
    const good = attempt({
      clientAttemptId: "55555555-5555-4555-8555-555555555555",
    });
    const parsed = parseSyncBatch({ attempts: [bad, good] });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.equal(parsed.attempts.length, 1);
    assert.equal(parsed.attempts[0].clientAttemptId, good.clientAttemptId);
    assert.equal(parsed.rejected.length, 1);
    assert.equal(parsed.rejected[0].clientAttemptId, bad.clientAttemptId);
    assert.equal(parsed.rejected[0].ok, false);
  });

  it("clips unknown payloads before schema parse", () => {
    const clipped = clipUnknownAttempt({
      notes: "x".repeat(DOOR_NOTES_MAX + 3),
      people: [{ notes: "y".repeat(PERSON_NOTES_MAX + 3) }],
    }) as { notes: string; people: Array<{ notes: string }> };
    assert.equal(clipped.notes.length, DOOR_NOTES_MAX);
    assert.equal(clipped.people[0].notes.length, PERSON_NOTES_MAX);
  });
});
