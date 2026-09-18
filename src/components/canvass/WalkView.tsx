"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/Icon";
import { Map } from "@/components/map/Map";
import { useToast } from "@/components/Toast";
import { releaseList } from "@/lib/actions";
import type { FieldPacket, FieldPacketDoor } from "@/lib/canvass/packet";
import type { SyncAttemptInput } from "@/lib/canvass/sync";
import {
  DOOR_PIN_COLORS,
  doorPinColor,
  type DoorOutcome,
} from "@/lib/canvass/outcomes";
import {
  downloadPacket,
  enqueueAttempt,
  enqueueObservedScore,
  getOutboxCount,
  getObservedScoresForList,
  getPacket,
  isPacketExpired,
  mergeObservedScoresIntoPacket,
  mergeOutboxIntoPacket,
  getOutboxForList,
  purgePacketIfSynced,
  syncOutbox,
} from "@/lib/canvass/offline-store";
import { orderFieldPacketFrom } from "@/lib/canvass/packet-order";
import { DoorSheet } from "@/components/canvass/DoorSheet";
import { VotedInPrimaryPill } from "@/components/canvass/VotedInPrimaryPill";
import { ProgressiveScoreControl } from "@/components/canvass/ProgressiveScoreControl";
import type { ProgressiveScore } from "@/lib/canvass/progressive-score";
import {
  isProgressiveScore,
  progressiveScoreCaption,
} from "@/lib/canvass/progressive-score";
import { ListCompleteSheet } from "@/components/canvass/ListCompleteSheet";
import { MapHelp, type MapHelpItem } from "@/components/map/MapHelp";
import { useVolunteerLocation } from "@/lib/use-volunteer-location";

type WalkFilter = "all" | "remaining" | "done";
type WalkViewMode = "map" | "list";
const AUTO_ADVANCE_STORAGE_KEY = "stridevote.canvass.autoAdvance";

function doorStatus(door: FieldPacketDoor): "remaining" | "done" {
  return door.current ? "done" : "remaining";
}

/** Units of an apartment building share a street line, so they share a pin. */
function buildingKey(door: FieldPacketDoor): string {
  const line = door.addressLine.trim().toUpperCase().replace(/\s+/g, " ");
  return `${door.city.trim().toUpperCase()}|${line}`;
}

function packetLooksIncomplete(packet: FieldPacket): boolean {
  if (!packet.doors.length && packet.doorsCount > 0) return true;
  if (packet.doorsCount > 0 && packet.doors.length < packet.doorsCount) return true;
  return false;
}

export function WalkView({
  listId,
  programId,
  listName,
  home,
}: {
  listId: string;
  programId: string;
  listName: string;
  home: { lat: number; lng: number } | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const location = useVolunteerLocation(home);
  const [packet, setPacket] = useState<FieldPacket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Always start true so SSR and first client paint match; sync after mount.
  const [online, setOnline] = useState(true);
  const [pendingCount, setPendingCount] = useState(0);
  const [filter, setFilter] = useState<WalkFilter>("all");
  const [view, setView] = useState<WalkViewMode>("map");
  const [index, setIndex] = useState(0);
  const [sheetDoor, setSheetDoor] = useState<FieldPacketDoor | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [autoAdvance, setAutoAdvance] = useState(false);
  const [quickObserved, setQuickObserved] = useState<{
    householdId: string;
    score: ProgressiveScore | null;
    touched: boolean;
  } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const pendingDoorId = useRef<string | null>(null);
  const gpsOrderedVersion = useRef<string | null>(null);
  const walkStarted = useRef(false);

  const refreshPending = useCallback(async () => {
    try {
      setPendingCount(await getOutboxCount(listId));
    } catch {
      setPendingCount(0);
    }
  }, [listId]);

  const load = useCallback(
    async (forceDownload: boolean) => {
      setLoading(true);
      setError(null);
      try {
        let cached: FieldPacket | null = null;
        if (!forceDownload) {
          cached = await getPacket(programId, listId);
          if (cached) {
            const [outbox, scores] = await Promise.all([
              getOutboxForList(listId),
              getObservedScoresForList(listId),
            ]);
            cached = mergeObservedScoresIntoPacket(
              mergeOutboxIntoPacket(cached, outbox),
              scores,
            );
          }
        }

        if (!navigator.onLine) {
          if (cached && !isPacketExpired(cached) && !packetLooksIncomplete(cached)) {
            setPacket(cached);
            return;
          }
          if (cached && isPacketExpired(cached)) {
            setError(
              "This offline copy expired (72 hours). Connect to refresh before knocking more doors.",
            );
            setPacket(cached);
            return;
          }
          if (cached && packetLooksIncomplete(cached)) {
            setError(
              "This offline copy is missing doors. Connect once to download the full list.",
            );
            setPacket(cached);
            return;
          }
          setError("No offline copy yet. Connect once to download this list.");
          return;
        }

        // Always refresh online so incomplete/stale snapshots don't stick in IndexedDB.
        const next = await downloadPacket(listId, programId);
        const outbox = await getOutboxForList(listId);
        setPacket(mergeOutboxIntoPacket(next, outbox));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not load list");
      } finally {
        setLoading(false);
        await refreshPending();
      }
    },
    [listId, programId, refreshPending],
  );

  useEffect(() => {
    void load(false);
  }, [load]);

  useEffect(() => {
    const stored = (() => {
      try {
        return window.localStorage.getItem(AUTO_ADVANCE_STORAGE_KEY) === "true";
      } catch {
        return false;
      }
    })();
    // Defer hydration of this client-only preference until after the effect.
    queueMicrotask(() => setAutoAdvance(stored));
  }, []);

  useEffect(() => {
    if (!packet || !location.you || gpsOrderedVersion.current === packet.version) {
      return;
    }
    gpsOrderedVersion.current = packet.version;
    if (walkStarted.current) return;
    const ordered = orderFieldPacketFrom(packet, location.you);
    setIndex(0);
    setPacket(ordered);
  }, [packet, location.you]);

  useEffect(() => {
    setOnline(navigator.onLine);
    function onOnline() {
      setOnline(true);
      void syncOutbox(listId)
        .then((r) => {
          if (r.synced) {
            toast(`Synced ${r.synced} result${r.synced === 1 ? "" : "s"}`);
          }
        })
        .catch(() => undefined)
        .finally(() => refreshPending());
    }
    function onOffline() {
      setOnline(false);
    }
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [listId, refreshPending, toast]);

  useEffect(() => {
    if (!menuOpen) return;
    function onPointer(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const filteredDoors = useMemo(() => {
    if (!packet) return [];
    return packet.doors.filter((d) => {
      const status = doorStatus(d);
      if (filter === "all") return true;
      return status === filter;
    });
  }, [packet, filter]);

  const currentDoor = filteredDoors[index] ?? filteredDoors[0] ?? null;
  const savedObservedRaw =
    currentDoor?.field?.observedScore ?? currentDoor?.current?.observedScore;
  const savedObservedScore = isProgressiveScore(savedObservedRaw)
    ? savedObservedRaw
    : null;
  const quickObservedScore =
    currentDoor && quickObserved?.householdId === currentDoor.householdId
      ? quickObserved.score
      : null;
  const quickObservedTouched =
    currentDoor != null &&
    quickObserved?.householdId === currentDoor.householdId &&
    quickObserved.touched;
  const displayObservedScore = quickObservedTouched
    ? quickObservedScore
    : savedObservedScore;

  useEffect(() => {
    if (pendingDoorId.current) return;
    setIndex(0);
  }, [filter]);

  useEffect(() => {
    if (!pendingDoorId.current) return;
    const idx = filteredDoors.findIndex(
      (d) => d.householdId === pendingDoorId.current,
    );
    if (idx < 0) return;
    setIndex(idx);
    pendingDoorId.current = null;
  }, [filteredDoors, packet]);

  async function forceSync() {
    setMenuOpen(false);
    try {
      const result = await syncOutbox(listId);
      await refreshPending();
      if (result.failed) {
        toast(`Synced ${result.synced}, ${result.failed} failed`);
      } else {
        toast(result.synced ? `Synced ${result.synced}` : "Nothing pending");
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : "Sync failed");
    }
  }

  async function saveAttempt(input: {
    door: FieldPacketDoor;
    outcome: DoorOutcome;
    notes: string | null;
    supersedesClientId: string | null;
    observedScore?: number | null;
    clearObservedScore?: boolean;
    people: SyncAttemptInput["people"];
  }) {
    if (!packet) return;
    walkStarted.current = true;
    if (isPacketExpired(packet) && !navigator.onLine) {
      toast("Offline copy expired — connect to refresh before logging more doors.");
      return;
    }

    const attempt: SyncAttemptInput = {
      clientAttemptId: crypto.randomUUID(),
      programId: packet.programId,
      listId: packet.listId,
      householdId: input.door.householdId,
      checkoutId: packet.checkoutId,
      campaignId: packet.campaignId,
      outcome: input.outcome,
      notes: input.notes,
      capturedAt: new Date().toISOString(),
      supersedesClientId: input.supersedesClientId,
      packetVersion: packet.version,
      observedScore: input.observedScore,
      clearObservedScore: input.clearObservedScore,
      people: input.people,
    };

    await enqueueAttempt(attempt);
    const outbox = await getOutboxForList(listId);
    const remainingBefore = packet.doors.filter(
      (d) => doorStatus(d) === "remaining",
    ).length;
    const merged = mergeOutboxIntoPacket(packet, outbox);
    const remainingAfter = merged.doors.filter(
      (d) => doorStatus(d) === "remaining",
    ).length;
    const justFinished = remainingBefore > 0 && remainingAfter === 0;

    // Advance forward in the fixed walk tour only — never wrap to an earlier
    // door (that produced 3→4→3 when the last unfinished pair traded).
    const remaining = merged.doors.filter((d) => {
      if (d.householdId === input.door.householdId) return false;
      const status = doorStatus(d);
      if (filter === "remaining") return status === "remaining";
      if (filter === "done") return status === "done";
      // "all" — keep walking unfinished doors after a save
      return status === "remaining";
    });
    const nextDoor =
      remaining.find((d) => d.sortOrder > input.door.sortOrder) ?? null;
    // Set before setPacket so the filteredDoors effect sees it on the same update.
    pendingDoorId.current = autoAdvance
      ? nextDoor?.householdId ?? null
      : input.door.householdId;
    // A completed door is absent from the Remaining filter. Keep it visible
    // when auto-advance is off instead of appearing to move anyway.
    if (!autoAdvance && filter === "remaining") setFilter("all");

    // The saved attempt is now the source of truth for this door, so drop the
    // quick pick — otherwise it keeps overriding what the sheet just saved.
    setQuickObserved((prev) =>
      prev?.householdId === input.door.householdId ? null : prev,
    );
    setPacket(merged);
    await refreshPending();
    setSheetDoor(null);
    if (justFinished) setCompleteOpen(true);

    const nextLabel =
      autoAdvance && nextDoor ? ` — next: ${nextDoor.address}` : "";
    toast(
      justFinished
        ? "Saved — list complete"
        : `Saved${navigator.onLine ? "" : " offline"}${nextLabel}`,
    );

    if (navigator.onLine) {
      try {
        const result = await syncOutbox(listId);
        await refreshPending();
        if (justFinished) {
          // Celebration sheet covers the feedback.
        } else if (result.failed) {
          toast("Saved locally; some results still pending sync");
        }
      } catch {
        if (!justFinished) toast("Saved locally — will sync when connected");
      }
    }
  }

  function quickLog(door: FieldPacketDoor, outcome: DoorOutcome) {
    const scorePayload = quickObservedTouched
      ? {
          observedScore: quickObservedScore,
          clearObservedScore: quickObservedScore == null ? true : undefined,
        }
      : {};
    void saveAttempt({
      door,
      outcome,
      notes: door.current?.notes ?? null,
      supersedesClientId: door.current?.clientAttemptId ?? null,
      people: (door.current?.people ?? []).map((person) => ({
        ...person,
        preserveTalkScore: person.talkScore != null ? true : undefined,
      })),
      ...scorePayload,
    });
  }

  async function saveObservedScore(
    door: FieldPacketDoor,
    score: ProgressiveScore | null,
  ) {
    if (!packet) return;
    if (isPacketExpired(packet) && !navigator.onLine) {
      toast("Offline copy expired — connect before logging more field data.");
      return;
    }
    try {
      const queued = await enqueueObservedScore({
        programId: packet.programId,
        listId: packet.listId,
        householdId: door.householdId,
        campaignId: packet.campaignId,
        observedScore: score,
      });
      setPacket((current) =>
        current
          ? {
              ...current,
              doors: current.doors.map((row) =>
                row.householdId === door.householdId
                  ? {
                      ...row,
                      field: {
                        accessStatus: row.field?.accessStatus ?? "ok",
                        observedScore: score,
                        observedScoreAt: queued.capturedAt,
                      },
                    }
                  : row,
              ),
            }
          : current,
      );
      setQuickObserved((current) =>
        current?.householdId === door.householdId ? null : current,
      );
      await refreshPending();
      toast(
        navigator.onLine
          ? "Observed score saved"
          : "Observed score saved offline",
      );
      if (navigator.onLine) {
        const result = await syncOutbox(listId);
        await refreshPending();
        if (result.failed) {
          toast("Observed score saved locally; sync still pending");
        }
      }
    } catch (err) {
      toast(
        err instanceof Error
          ? err.message
          : "Could not save observed score locally",
      );
    }
  }

  function onRelease() {
    setMenuOpen(false);
    if (!navigator.onLine) {
      toast("Reconnect and sync before releasing this list.");
      return;
    }
    startTransition(async () => {
      let pendingLocal: number;
      try {
        pendingLocal = await getOutboxCount(listId);
      } catch {
        toast("Could not verify saved results. Keep the list and try again.");
        return;
      }
      if (pendingLocal > 0) {
        toast("Sync your results before releasing this list.");
        return;
      }
      if (packet) {
        const purged = await purgePacketIfSynced(packet.programId, packet.listId);
        if (!purged) {
          toast("Sync your results before releasing this list.");
          return;
        }
      }
      const res = await releaseList(listId, programId);
      toast(res.message);
      if (res.ok) {
        setCompleteOpen(false);
        router.push("/canvass");
      }
    });
  }

  function focusDoor(door: FieldPacketDoor, openSheet = false) {
    walkStarted.current = true;
    const idx = filteredDoors.findIndex((d) => d.householdId === door.householdId);
    if (idx >= 0) {
      setIndex(idx);
    } else {
      pendingDoorId.current = door.householdId;
      setFilter("all");
    }
    if (openSheet) setSheetDoor(door);
  }

  function selectDoor(door: FieldPacketDoor) {
    focusDoor(door, true);
  }

  function goNext() {
    if (!currentDoor || index >= filteredDoors.length - 1) return;
    walkStarted.current = true;
    setIndex((i) => Math.min(filteredDoors.length - 1, i + 1));
  }

  function goPrevious() {
    if (index <= 0) return;
    walkStarted.current = true;
    setIndex((i) => Math.max(0, i - 1));
  }

  const closed = packet?.doors.filter((d) => doorStatus(d) === "done").length ?? 0;
  const total = packet?.doors.length ?? 0;
  const allDoorsComplete = total > 0 && closed === total;
  const pct = total ? Math.round((closed / total) * 100) : 0;
  // Rides along on the progress label so connectivity needs no line of its own.
  const statusNote = !online
    ? "Offline"
    : pendingCount > 0
      ? `${pendingCount} pending`
      : null;
  const releaseBlocked = pending || !online || pendingCount > 0;
  const releaseHint = !online
    ? "Your results are saved on this phone. Reconnect and sync before releasing."
    : pendingCount > 0
      ? `${pendingCount} saved update${pendingCount === 1 ? "" : "s"} still need to sync before releasing.`
      : null;
  const mappedDoors = useMemo(
    () => filteredDoors.filter((d) => d.lat != null && d.lng != null),
    [filteredDoors],
  );
  const mappedDoorMarkers = useMemo(() => {
    const buildings = new globalThis.Map<string, FieldPacketDoor[]>();
    for (const door of mappedDoors) {
      const key = buildingKey(door);
      const group = buildings.get(key);
      if (group) group.push(door);
      else buildings.set(key, [door]);
    }

    return [...buildings.values()].map((doors) => {
      const selected =
        doors.find((door) => door.householdId === currentDoor?.householdId) ??
        doors.find((door) => doorStatus(door) === "remaining") ??
        doors[0];
      const lats = doors.map((door) => door.lat!).sort((a, b) => a - b);
      const lngs = doors.map((door) => door.lng!).sort((a, b) => a - b);
      const middle = Math.floor(doors.length / 2);
      const lat =
        doors.length % 2
          ? lats[middle]
          : (lats[middle - 1] + lats[middle]) / 2;
      const lng =
        doors.length % 2
          ? lngs[middle]
          : (lngs[middle - 1] + lngs[middle]) / 2;
      return {
        id: selected.householdId,
        lat,
        lng,
        color: doorPinColor(selected.current?.outcome),
        current: doors.some(
          (door) => door.householdId === currentDoor?.householdId,
        ),
        title:
          doors.length > 1
            ? `${selected.addressLine} · ${doors.length} doors`
            : selected.address,
        count: doors.length,
      };
    });
  }, [mappedDoors, currentDoor?.householdId]);
  const apartmentBuildingCount = mappedDoorMarkers.filter(
    (marker) => marker.count > 1,
  ).length;
  // One pin can stand for a whole building, so the card lists that building's
  // units to switch between without hunting for them in the door list.
  const currentBuildingDoors = useMemo(() => {
    if (!currentDoor) return [];
    const key = buildingKey(currentDoor);
    const doors = filteredDoors.filter((door) => buildingKey(door) === key);
    return doors.length > 1 ? doors : [];
  }, [filteredDoors, currentDoor]);
  const mapHelpItems = useMemo((): MapHelpItem[] => {
    const items: MapHelpItem[] = [
      {
        text: mappedDoors.length
          ? `${mappedDoors.length} door${mappedDoors.length === 1 ? "" : "s"} on map`
          : filter === "all"
            ? "No geocoded doors yet — use the list to walk"
            : "No doors in this filter on the map",
      },
      { text: "Tap a pin — or just near it — to select that door" },
      ...(apartmentBuildingCount
        ? [
            {
              text: "A numbered pin is one building — pick its unit under the map",
            },
          ]
        : []),
      { color: DOOR_PIN_COLORS.talked, text: "Talked" },
      { color: DOOR_PIN_COLORS.lit, text: "Lit drop" },
      { color: DOOR_PIN_COLORS.other, text: "Other result" },
      { color: DOOR_PIN_COLORS.remaining, text: "Not visited" },
    ];
    if (location.you) items.push({ color: "#185FA5", text: "Current location" });
    if (location.home) items.push({ text: "Dark pin = home" });
    return items;
  }, [
    mappedDoors.length,
    apartmentBuildingCount,
    filter,
    location.you,
    location.home,
  ]);

  return (
    <div className="walk">
      <header className="walk-header">
        <div className="walk-header-main">
          <div className="walk-title">
            <div className="walk-title-row">
              <h1>{listName}</h1>
              {packet ? (
                <span className="walk-wave">{packet.programName}</span>
              ) : null}
            </div>
            {!packet && (loading || statusNote) ? (
              <p>{loading ? "Loading…" : statusNote}</p>
            ) : null}
            {packet && !loading ? (
              <div className="progress-row">
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="progress-label">
                  {closed}/{total} doors
                  {statusNote ? ` · ${statusNote}` : ""}
                </span>
              </div>
            ) : null}
          </div>
          <div className="walk-menu" ref={menuRef}>
            <button
              type="button"
              className="icon-btn"
              aria-expanded={menuOpen}
              aria-haspopup="menu"
              aria-label="Walk options"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <Icon name="menu" size={20} />
            </button>
            {menuOpen ? (
              <div className="walk-menu-panel" role="menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    router.push("/canvass");
                  }}
                >
                  Back to lists
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!online || pending}
                  onClick={() => void forceSync()}
                >
                  Force sync
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={!online || pending}
                  onClick={() => {
                    setMenuOpen(false);
                    void load(true);
                  }}
                >
                  Download again
                </button>
                <button
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={autoAdvance}
                  onClick={() => {
                    const next = !autoAdvance;
                    setAutoAdvance(next);
                    try {
                      window.localStorage.setItem(
                        AUTO_ADVANCE_STORAGE_KEY,
                        String(next),
                      );
                    } catch {
                      // The setting still applies for this session.
                    }
                    toast(`Auto-advance ${next ? "on" : "off"}`);
                  }}
                >
                  Auto-advance: {autoAdvance ? "On" : "Off"}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={releaseBlocked}
                  title={releaseHint ?? undefined}
                  onClick={onRelease}
                >
                  Release list
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {allDoorsComplete && !completeOpen ? (
        <div className="card list-release-reminder" role="status">
          <div>
            <b>All doors are complete</b>
            <p>
              {releaseHint ??
                "Release this list so it moves to Completed."}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            disabled={releaseBlocked}
            onClick={onRelease}
          >
            Release list
          </button>
        </div>
      ) : null}

      {loading ? <div className="empty-state">Loading doors…</div> : null}
      {error ? <div className="empty-state">{error}</div> : null}

      {packet && !loading ? (
        <>
          {/* View icons lead on the left so they clear the menu button above. */}
          <div className="walk-toolbar">
            <div className="row walk-view-toggle" style={{ gap: 6 }}>
              <button
                type="button"
                className={`icon-btn ${view === "map" ? "active" : ""}`}
                onClick={() => setView("map")}
                title="Map"
              >
                <Icon name="map" size={16} />
              </button>
              <button
                type="button"
                className={`icon-btn ${view === "list" ? "active" : ""}`}
                onClick={() => setView("list")}
                title="List"
              >
                <Icon name="list" size={16} />
              </button>
            </div>
            <div className="segmented walk-filter">
              {(["all", "remaining", "done"] as WalkFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={filter === f ? "active" : ""}
                  onClick={() => setFilter(f)}
                >
                  {f === "all" ? "All" : f[0]!.toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {view === "map" ? (
            <div className="walk-map-stage">
              <div className="walk-map-frame">
                <Map
                  mode="walk"
                  markers={mappedDoorMarkers}
                  home={location.home ? { ...location.home, inside: true } : undefined}
                  you={location.you ?? undefined}
                  onMarkerClick={(marker) => {
                    if (!marker.id || !packet) return;
                    const door = packet.doors.find((d) => d.householdId === marker.id);
                    if (door) focusDoor(door);
                  }}
                />
                <MapHelp items={mapHelpItems} />
              </div>

              {currentDoor ? (
                <div className="card walk-door-card">
                  <div className="list-door-heading">
                    <span className="list-door-number">{currentDoor.sortOrder + 1}</span>
                    <div className="walk-door-heading-text">
                      <div className="walk-door-title-row">
                        <h3>{currentDoor.address}</h3>
                        <div className="walk-door-nav-btns">
                          <button
                            type="button"
                            className="icon-btn"
                            title="Previous"
                            aria-label="Previous door"
                            disabled={index <= 0}
                            onClick={goPrevious}
                          >
                            <Icon name="chevronLeft" size={16} />
                          </button>
                          <button
                            type="button"
                            className="icon-btn"
                            title="Next"
                            aria-label="Next door"
                            disabled={index >= filteredDoors.length - 1}
                            onClick={goNext}
                          >
                            <Icon name="chevronRight" size={16} />
                          </button>
                        </div>
                      </div>
                      <div className="walk-door-meta-row">
                        <p>
                          {currentDoor.voters.length} voter
                          {currentDoor.voters.length === 1 ? "" : "s"}
                        </p>
                        {currentDoor.current ? (
                          <span
                            className={`pill ${
                              doorStatus(currentDoor) === "done"
                                ? "pill-active"
                                : "pill-pending"
                            }`}
                          >
                            {currentDoor.current.outcomeLabel}
                            {currentDoor.current.support != null
                              ? ` · ${currentDoor.current.support}`
                              : ""}
                          </span>
                        ) : (
                          <span className="pill pill-neutral">Not visited</span>
                        )}
                      </div>
                    </div>
                  </div>
                  {currentBuildingDoors.length ? (
                    <div className="walk-door-units">
                      <span className="walk-door-units-label">
                        {currentBuildingDoors.length} doors at{" "}
                        {currentDoor.addressLine}
                      </span>
                      <div className="walk-door-unit-chips">
                        {currentBuildingDoors.map((unitDoor) => (
                          <button
                            key={unitDoor.householdId}
                            type="button"
                            aria-pressed={
                              unitDoor.householdId === currentDoor.householdId
                            }
                            className={`walk-door-unit${
                              doorStatus(unitDoor) === "done" ? " done" : ""
                            }${
                              unitDoor.householdId === currentDoor.householdId
                                ? " active"
                                : ""
                            }`}
                            onClick={() => focusDoor(unitDoor)}
                          >
                            {unitDoor.unit ? `#${unitDoor.unit}` : "Main"}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  {currentDoor.history.length ? (
                    <div className="walk-history">
                      {currentDoor.history.map((h) => (
                        <span
                          key={`${h.programName}-${h.capturedAt}`}
                          className="pill pill-neutral"
                        >
                          {h.programName}: {h.outcomeLabel}
                          {h.support != null ? ` (${h.support})` : ""}
                        </span>
                      ))}
                    </div>
                  ) : null}
                  <ul className="list-door-voters">
                    {currentDoor.voters.length ? (
                      currentDoor.voters.map((v) => {
                        const score = progressiveScoreCaption({
                          talkScore: v.talkScore ?? null,
                          scoreUpdatedAt: v.scoreUpdatedAt ?? null,
                          scoreSource: v.scoreSource ?? null,
                          observedScore: currentDoor.field?.observedScore ?? null,
                          observedScoreAt: currentDoor.field?.observedScoreAt ?? null,
                        });
                        return (
                          <li key={v.voterId}>
                            <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                              <span>
                                {v.firstName} {v.lastName}
                              </span>
                              {v.votedInPrimary ? <VotedInPrimaryPill compact /> : null}
                            </span>
                            <small>
                              {[
                                v.age != null ? String(v.age) : null,
                                v.sex,
                                score,
                              ]
                                .filter(Boolean)
                                .join(" · ")}
                            </small>
                          </li>
                        );
                      })
                    ) : (
                      <li>
                        <span>No voters linked at this door</span>
                      </li>
                    )}
                  </ul>
                  <div className="walk-door-actions-block">
                    <div className="walk-door-actions">
                      <div className="walk-quick-results">
                        <button
                          type="button"
                          className={`btn btn-sm ${
                            currentDoor.current?.outcome === "lit"
                              ? "btn-primary"
                              : "btn-outline"
                          }`}
                          onClick={() => quickLog(currentDoor, "lit")}
                        >
                          Lit drop
                        </button>
                        <button
                          type="button"
                          className={`btn btn-sm ${
                            currentDoor.current?.outcome === "inaccessible"
                              ? "btn-primary"
                              : "btn-outline"
                          }`}
                          onClick={() => quickLog(currentDoor, "inaccessible")}
                        >
                          Inaccessible
                        </button>
                      </div>
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        onClick={() => {
                          walkStarted.current = true;
                          setSheetDoor(currentDoor);
                        }}
                      >
                        {currentDoor.current ? "Update result" : "Log result"}
                      </button>
                    </div>
                    <ProgressiveScoreControl
                      label="Observed progressive score (signs)"
                      value={displayObservedScore}
                      onChange={(v) => {
                        if (!currentDoor) return;
                        setQuickObserved({
                          householdId: currentDoor.householdId,
                          score: v,
                          touched: true,
                        });
                        void saveObservedScore(currentDoor, v);
                      }}
                    />
                  </div>
                </div>
              ) : (
                <div className="empty-state">No doors in this filter.</div>
              )}
            </div>
          ) : null}

          {view === "list" ? (
            <div className="stack walk-door-list">
              {filteredDoors.length ? (
                filteredDoors.map((door) => (
                  <button
                    key={door.householdId}
                    type="button"
                    className="card list-door-card walk-list-item"
                    onClick={() => selectDoor(door)}
                  >
                    <div className="list-door-heading">
                      <span className="list-door-number">{door.sortOrder + 1}</span>
                      <div className="walk-door-heading-text">
                        <div className="walk-door-title-row">
                          <h3>{door.address}</h3>
                          {door.current ? (
                            <span
                              className={`pill ${
                                doorStatus(door) === "done"
                                  ? "pill-active"
                                  : "pill-pending"
                              }`}
                            >
                              {door.current.outcomeLabel}
                              {door.current.support != null
                                ? ` · ${door.current.support}`
                                : ""}
                            </span>
                          ) : (
                            <span className="pill pill-neutral">Not visited</span>
                          )}
                        </div>
                        <p>
                          {door.voters.length} voter
                          {door.voters.length === 1 ? "" : "s"}
                        </p>
                      </div>
                    </div>
                  </button>
                ))
              ) : (
                <div className="empty-state">No doors in this filter.</div>
              )}
            </div>
          ) : null}
        </>
      ) : null}

      {sheetDoor && packet ? (
        <DoorSheet
          door={sheetDoor}
          script={packet.script}
          questions={packet.questions}
          onClose={() => setSheetDoor(null)}
          onSave={(payload) => void saveAttempt({ door: sheetDoor, ...payload })}
        />
      ) : null}

      <ListCompleteSheet
        open={completeOpen}
        listName={listName}
        doorsDone={closed}
        pending={pending}
        releaseBlocked={releaseBlocked}
        releaseHint={releaseHint}
        onRelease={onRelease}
        onKeepWalking={() => setCompleteOpen(false)}
      />
    </div>
  );
}

export type { DoorOutcome, PersonOutcome, ProgramQuestion } from "@/lib/canvass/outcomes";
export {
  DOOR_OUTCOMES,
  DOOR_OUTCOME_LABELS,
  PERSON_OUTCOMES,
  PERSON_OUTCOME_LABELS,
} from "@/lib/canvass/outcomes";

