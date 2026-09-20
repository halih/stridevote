"use client";

import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { FieldPacket } from "@/lib/canvass/packet";
import type { SyncAttemptInput } from "@/lib/canvass/sync";
import { chunkItems, clipSyncAttempt } from "@/lib/canvass/sync-payload";
import {
  DOOR_OUTCOME_LABELS,
  type DoorOutcome,
  PACKET_TTL_MS,
} from "@/lib/canvass/outcomes";
import { packetForOfflineCache } from "@/lib/canvass/door-coords";

interface CanvassDB extends DBSchema {
  packets: {
    key: string; // `${programId}:${listId}`
    value: FieldPacket;
  };
  outbox: {
    key: string; // clientAttemptId
    value: SyncAttemptInput & { queuedAt: string };
    indexes: { "by-list": string };
  };
  acks: {
    key: string; // clientAttemptId
    value: { clientAttemptId: string; ackedAt: string };
  };
  observedScores: {
    key: string; // `${programId}:${listId}:${householdId}`
    value: PendingObservedScore;
    indexes: { "by-list": string };
  };
}

const DB_NAME = "stridevote-canvass";
const DB_VERSION = 2;

export interface PendingObservedScore {
  queueKey: string;
  clientEventId: string;
  programId: string;
  listId: string;
  householdId: string;
  campaignId: string;
  observedScore: number | null;
  capturedAt: string;
}

let dbPromise: Promise<IDBPDatabase<CanvassDB>> | null = null;

function packetKey(programId: string, listId: string): string {
  return `${programId}:${listId}`;
}

function observedScoreQueueKey(
  programId: string,
  listId: string,
  householdId: string,
): string {
  return `${programId}:${listId}:${householdId}`;
}

function getDb() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available"));
  }
  if (!dbPromise) {
    dbPromise = openDB<CanvassDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("packets")) {
          db.createObjectStore("packets");
        }
        if (!db.objectStoreNames.contains("outbox")) {
          const outbox = db.createObjectStore("outbox", { keyPath: "clientAttemptId" });
          outbox.createIndex("by-list", "listId");
        }
        if (!db.objectStoreNames.contains("acks")) {
          db.createObjectStore("acks", { keyPath: "clientAttemptId" });
        }
        if (!db.objectStoreNames.contains("observedScores")) {
          const scores = db.createObjectStore("observedScores", {
            keyPath: "queueKey",
          });
          scores.createIndex("by-list", "listId");
        }
      },
    });
  }
  return dbPromise;
}

export async function savePacket(packet: FieldPacket): Promise<void> {
  const db = await getDb();
  await db.put(
    "packets",
    packetForOfflineCache(packet),
    packetKey(packet.programId, packet.listId),
  );
}

export async function getPacket(
  programId: string,
  listId: string,
): Promise<FieldPacket | null> {
  const db = await getDb();
  return (await db.get("packets", packetKey(programId, listId))) ?? null;
}

export async function deletePacket(programId: string, listId: string): Promise<void> {
  const db = await getDb();
  await db.delete("packets", packetKey(programId, listId));
}

export function isPacketExpired(packet: FieldPacket, now = Date.now()): boolean {
  const downloaded = Date.parse(packet.downloadedAt);
  if (!Number.isFinite(downloaded)) return true;
  return now - downloaded > PACKET_TTL_MS;
}

export async function enqueueAttempt(attempt: SyncAttemptInput): Promise<void> {
  const db = await getDb();
  await db.put("outbox", {
    ...clipSyncAttempt(attempt),
    queuedAt: new Date().toISOString(),
  });
  // Completing the door with a score (or clearing it) supersedes any unsynced
  // standalone pick for that household so reload/sync cannot resurrect it.
  if (attempt.observedScore !== undefined || attempt.clearObservedScore) {
    await db.delete(
      "observedScores",
      observedScoreQueueKey(attempt.programId, attempt.listId, attempt.householdId),
    );
  }
}

export async function getOutboxForList(listId: string): Promise<SyncAttemptInput[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("outbox", "by-list", listId);
  return rows.map(({ queuedAt, ...rest }) => {
    void queuedAt;
    return rest;
  });
}

export async function getOutboxCount(listId?: string): Promise<number> {
  const db = await getDb();
  if (!listId) {
    return (await db.count("outbox")) + (await db.count("observedScores"));
  }
  return (
    (await db.countFromIndex("outbox", "by-list", listId)) +
    (await db.countFromIndex("observedScores", "by-list", listId))
  );
}

export async function enqueueObservedScore(
  input: Omit<PendingObservedScore, "queueKey" | "clientEventId" | "capturedAt">,
): Promise<PendingObservedScore> {
  const db = await getDb();
  const item: PendingObservedScore = {
    ...input,
    queueKey: observedScoreQueueKey(input.programId, input.listId, input.householdId),
    clientEventId: crypto.randomUUID(),
    capturedAt: new Date().toISOString(),
  };
  // One row per door: a later choice supersedes an unsynced earlier choice.
  await db.put("observedScores", item);
  return item;
}

export async function getObservedScoresForList(
  listId: string,
): Promise<PendingObservedScore[]> {
  const db = await getDb();
  return db.getAllFromIndex("observedScores", "by-list", listId);
}

export async function removeOutboxItems(clientAttemptIds: string[]): Promise<void> {
  if (!clientAttemptIds.length) return;
  const db = await getDb();
  const tx = db.transaction(["outbox", "acks"], "readwrite");
  for (const id of clientAttemptIds) {
    await tx.objectStore("outbox").delete(id);
    await tx.objectStore("acks").put({
      clientAttemptId: id,
      ackedAt: new Date().toISOString(),
    });
  }
  await tx.done;
}

/** Apply local outbox on top of a freshly downloaded packet (never lose unacked work). */
export function mergeOutboxIntoPacket(
  packet: FieldPacket,
  outbox: SyncAttemptInput[],
): FieldPacket {
  if (!outbox.length) return packet;
  const byHousehold = new Map<string, SyncAttemptInput>();
  const superseded = new Set(
    outbox
      .map((a) => a.supersedesClientId)
      .filter((id): id is string => Boolean(id)),
  );
  const sorted = [...outbox].sort(
    (a, b) => Date.parse(a.capturedAt) - Date.parse(b.capturedAt),
  );
  for (const attempt of sorted) {
    if (superseded.has(attempt.clientAttemptId)) continue;
    byHousehold.set(attempt.householdId, attempt);
  }

  return {
    ...packet,
    doors: packet.doors.map((door) => {
      const local = byHousehold.get(door.householdId);
      if (!local) return door;
      const support =
        local.people?.find((p) => p.outcome === "talked" && p.support != null)
          ?.support ?? null;
      return {
        ...door,
        field:
          local.observedScore !== undefined || local.clearObservedScore
            ? {
                accessStatus: door.field?.accessStatus ?? "ok",
                observedScore: local.clearObservedScore
                  ? null
                  : (local.observedScore ?? null),
                observedScoreAt: local.capturedAt,
              }
            : door.field,
        current: {
          clientAttemptId: local.clientAttemptId,
          outcome: local.outcome,
          outcomeLabel:
            DOOR_OUTCOME_LABELS[local.outcome as DoorOutcome] ?? local.outcome,
          closed: true,
          support,
          observedScore:
            local.observedScore !== undefined
              ? local.observedScore
              : door.current?.observedScore ?? null,
          notes: local.notes ?? null,
          people: (local.people ?? door.current?.people ?? []).map((person) => ({
            voterId: person.voterId ?? null,
            offList: person.offList ?? false,
            outcome: person.outcome,
            support: person.support ?? null,
            talkScore: person.talkScore ?? null,
            answers: person.answers ?? {},
            notes: person.notes ?? null,
          })),
          capturedAt: local.capturedAt,
        },
      };
    }),
  };
}

/** Overlay standalone observed-score changes without marking a door complete. */
export function mergeObservedScoresIntoPacket(
  packet: FieldPacket,
  scores: PendingObservedScore[],
): FieldPacket {
  if (!scores.length) return packet;
  const latest = new Map<string, PendingObservedScore>();
  for (const score of scores) {
    const prior = latest.get(score.householdId);
    if (!prior || score.capturedAt > prior.capturedAt) {
      latest.set(score.householdId, score);
    }
  }
  return {
    ...packet,
    doors: packet.doors.map((door) => {
      const score = latest.get(door.householdId);
      if (!score) return door;
      const existingAt = door.field?.observedScoreAt;
      if (existingAt && existingAt >= score.capturedAt) return door;
      return {
        ...door,
        field: {
          accessStatus: door.field?.accessStatus ?? "ok",
          observedScore: score.observedScore,
          observedScoreAt: score.capturedAt,
        },
      };
    }),
  };
}

export async function downloadPacket(
  listId: string,
  programId: string,
): Promise<FieldPacket> {
  const res = await fetch(
    `/api/canvass/packet?listId=${encodeURIComponent(listId)}&programId=${encodeURIComponent(programId)}`,
  );
  const data = (await res.json()) as {
    ok: boolean;
    message?: string;
    packet?: FieldPacket;
  };
  if (!res.ok || !data.ok || !data.packet) {
    throw new Error(data.message ?? "Could not download list");
  }
  const [outbox, scores] = await Promise.all([
    getOutboxForList(listId),
    getObservedScoresForList(listId),
  ]);
  const merged = mergeObservedScoresIntoPacket(
    mergeOutboxIntoPacket(data.packet, outbox),
    scores,
  );
  await savePacket(merged);
  return merged;
}

async function syncOutboxUnlocked(listId?: string): Promise<{
  synced: number;
  failed: number;
  errors: string[];
}> {
  const db = await getDb();
  const rows = listId
    ? await db.getAllFromIndex("outbox", "by-list", listId)
    : await db.getAll("outbox");
  const attempts = rows.map(({ queuedAt, ...rest }) => {
    void queuedAt;
    return clipSyncAttempt(rest);
  });
  let synced = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const chunk of chunkItems(attempts)) {
    const res = await fetch("/api/canvass/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ attempts: chunk }),
    });
    const data = (await res.json()) as {
      ok: boolean;
      message?: string;
      acks?: Array<{ clientAttemptId: string; ok: boolean; error?: string }>;
    };
    if (!res.ok || !data.ok || !data.acks) {
      throw new Error(data.message ?? "Sync failed");
    }

    const okIds = data.acks.filter((a) => a.ok).map((a) => a.clientAttemptId);
    await removeOutboxItems(okIds);
    synced += okIds.length;
    failed += data.acks.length - okIds.length;
    for (const ack of data.acks) {
      if (!ack.ok) errors.push(ack.error ?? "Unknown error");
    }
  }

  const laterAttemptScoreAt = new Map<string, string>();
  for (const attempt of attempts) {
    if (attempt.observedScore === undefined && !attempt.clearObservedScore) continue;
    const key = observedScoreQueueKey(
      attempt.programId,
      attempt.listId,
      attempt.householdId,
    );
    const prior = laterAttemptScoreAt.get(key);
    if (!prior || attempt.capturedAt > prior) {
      laterAttemptScoreAt.set(key, attempt.capturedAt);
    }
  }

  const scoreRows = listId
    ? await db.getAllFromIndex("observedScores", "by-list", listId)
    : await db.getAll("observedScores");
  for (const score of scoreRows) {
    const attemptAt = laterAttemptScoreAt.get(score.queueKey);
    if (attemptAt && attemptAt >= score.capturedAt) {
      await db.delete("observedScores", score.queueKey);
      continue;
    }
    const res = await fetch("/api/canvass/observed-score", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        clientEventId: score.clientEventId,
        programId: score.programId,
        listId: score.listId,
        householdId: score.householdId,
        campaignId: score.campaignId,
        observedScore: score.observedScore,
        capturedAt: score.capturedAt,
      }),
    });
    const data = (await res.json().catch(() => null)) as {
      ok?: boolean;
      message?: string;
    } | null;
    if (!res.ok || !data?.ok) {
      failed += 1;
      errors.push(data?.message ?? "Observed score sync failed");
      continue;
    }
    // Do not delete a newer choice that replaced this row while it was syncing.
    const current = await db.get("observedScores", score.queueKey);
    if (current?.clientEventId === score.clientEventId) {
      await db.delete("observedScores", score.queueKey);
    }
    synced += 1;
  }

  return { synced, failed, errors };
}

const syncLocks = new Map<string, Promise<unknown>>();

/** Serialize syncs per list so rapid score changes cannot arrive out of order. */
export async function syncOutbox(listId?: string): Promise<{
  synced: number;
  failed: number;
  errors: string[];
}> {
  const key = listId ?? "__all__";
  const prior = syncLocks.get(key) ?? Promise.resolve();
  const current = prior
    .catch(() => undefined)
    .then(() => syncOutboxUnlocked(listId));
  syncLocks.set(key, current);
  try {
    return await current;
  } finally {
    if (syncLocks.get(key) === current) syncLocks.delete(key);
  }
}

/** Purge packet only when outbox for that list is empty. */
export async function purgePacketIfSynced(
  programId: string,
  listId: string,
): Promise<boolean> {
  const pending = await getOutboxCount(listId);
  if (pending > 0) return false;
  await deletePacket(programId, listId);
  return true;
}
