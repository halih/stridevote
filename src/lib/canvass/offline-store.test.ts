import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { FieldPacket } from "@/lib/canvass/packet";
import type { SyncAttemptInput } from "@/lib/canvass/sync";
import {
  mergeObservedScoresIntoPacket,
  mergeOutboxIntoPacket,
  type PendingObservedScore,
} from "@/lib/canvass/offline-store";

function packet(): FieldPacket {
  return {
    doors: [
      {
        householdId: "house",
        field: {
          accessStatus: "ok",
          observedScore: 1,
          observedScoreAt: "2026-09-15T20:00:00.000Z",
        },
        current: null,
      },
    ],
  } as FieldPacket;
}

describe("offline observed scores", () => {
  it("overlays a score without completing the door", () => {
    const score: PendingObservedScore = {
      queueKey: "program:list:house",
      clientEventId: "11111111-1111-4111-8111-111111111111",
      programId: "program",
      listId: "list",
      householdId: "house",
      campaignId: "campaign",
      observedScore: 4,
      capturedAt: "2026-09-15T21:00:00.000Z",
    };

    const merged = mergeObservedScoresIntoPacket(packet(), [score]);
    assert.equal(merged.doors[0].field?.observedScore, 4);
    assert.equal(merged.doors[0].field?.observedScoreAt, score.capturedAt);
    assert.equal(merged.doors[0].current, null);
  });

  it("keeps the card and result sheet field score in sync", () => {
    const attempt = {
      clientAttemptId: "22222222-2222-4222-8222-222222222222",
      programId: "program",
      listId: "list",
      householdId: "house",
      campaignId: "campaign",
      outcome: "contact",
      capturedAt: "2026-09-15T22:00:00.000Z",
      observedScore: 5,
    } satisfies SyncAttemptInput;

    const merged = mergeOutboxIntoPacket(packet(), [attempt]);
    assert.equal(merged.doors[0].field?.observedScore, 5);
    assert.equal(merged.doors[0].current?.observedScore, 5);
  });

  it("does not let an older standalone score overwrite a later outbox score", () => {
    const attempt = {
      clientAttemptId: "22222222-2222-4222-8222-222222222222",
      programId: "program",
      listId: "list",
      householdId: "house",
      campaignId: "campaign",
      outcome: "contact",
      capturedAt: "2026-09-15T22:00:00.000Z",
      observedScore: 5,
    } satisfies SyncAttemptInput;
    const stale: PendingObservedScore = {
      queueKey: "program:list:house",
      clientEventId: "11111111-1111-4111-8111-111111111111",
      programId: "program",
      listId: "list",
      householdId: "house",
      campaignId: "campaign",
      observedScore: 4,
      capturedAt: "2026-09-15T21:00:00.000Z",
    };

    const merged = mergeObservedScoresIntoPacket(
      mergeOutboxIntoPacket(packet(), [attempt]),
      [stale],
    );
    assert.equal(merged.doors[0].field?.observedScore, 5);
    assert.equal(merged.doors[0].field?.observedScoreAt, attempt.capturedAt);
  });

  it("lets a newer standalone score overlay a completed door", () => {
    const attempt = {
      clientAttemptId: "22222222-2222-4222-8222-222222222222",
      programId: "program",
      listId: "list",
      householdId: "house",
      campaignId: "campaign",
      outcome: "contact",
      capturedAt: "2026-09-15T22:00:00.000Z",
      observedScore: 5,
    } satisfies SyncAttemptInput;
    const later: PendingObservedScore = {
      queueKey: "program:list:house",
      clientEventId: "11111111-1111-4111-8111-111111111111",
      programId: "program",
      listId: "list",
      householdId: "house",
      campaignId: "campaign",
      observedScore: 2,
      capturedAt: "2026-09-15T23:00:00.000Z",
    };

    const merged = mergeObservedScoresIntoPacket(
      mergeOutboxIntoPacket(packet(), [attempt]),
      [later],
    );
    assert.equal(merged.doors[0].field?.observedScore, 2);
    assert.equal(merged.doors[0].field?.observedScoreAt, later.capturedAt);
  });
});
