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
}

const DB_NAME = "stridevote-canvass";
const DB_VERSION = 1;

let dbPromise: Promise<IDBPDatabase<CanvassDB>> | null = null;

function packetKey(programId: string, listId: string): string {
  return `${programId}:${listId}`;
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
}

export async function getOutboxForList(listId: string): Promise<SyncAttemptInput[]> {
  const db = await getDb();
  const rows = await db.getAllFromIndex("outbox", "by-list", listId);
  return rows.map(({ queuedAt: _q, ...rest }) => rest);
}

export async function getOutboxCount(listId?: string): Promise<number> {
  const db = await getDb();
  if (!listId) return db.count("outbox");
  return db.countFromIndex("outbox", "by-list", listId);
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
            voterId: person.voterId,
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
  const outbox = await getOutboxForList(listId);
  const merged = mergeOutboxIntoPacket(data.packet, outbox);
  await savePacket(merged);
  return merged;
}

export async function syncOutbox(listId?: string): Promise<{
  synced: number;
  failed: number;
  errors: string[];
}> {
  const db = await getDb();
  const rows = listId
    ? await db.getAllFromIndex("outbox", "by-list", listId)
    : await db.getAll("outbox");
  if (!rows.length) return { synced: 0, failed: 0, errors: [] };

  const attempts = rows.map(({ queuedAt: _q, ...rest }) => clipSyncAttempt(rest));
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

  return { synced, failed, errors };
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
