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
  type PersonOutcome,
  type ProgramQuestion,
} from "@/lib/canvass/outcomes";
import {
  downloadPacket,
  enqueueAttempt,
  getOutboxCount,
  getPacket,
  isPacketExpired,
  mergeOutboxIntoPacket,
  getOutboxForList,
  purgePacketIfSynced,
  syncOutbox,
} from "@/lib/canvass/offline-store";
import { orderFieldPacketFrom } from "@/lib/canvass/packet-order";
import { DoorSheet } from "@/components/canvass/DoorSheet";
import { ListCompleteSheet } from "@/components/canvass/ListCompleteSheet";
import { MapHelp, type MapHelpItem } from "@/components/map/MapHelp";
import { useVolunteerLocation } from "@/lib/use-volunteer-location";

type WalkFilter = "all" | "remaining" | "done";
type WalkViewMode = "map" | "list";

function doorStatus(door: FieldPacketDoor): "remaining" | "done" {
  return door.current ? "done" : "remaining";
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
  const [online, setOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [pendingCount, setPendingCount] = useState(0);
  const [filter, setFilter] = useState<WalkFilter>("all");
  const [view, setView] = useState<WalkViewMode>("map");
  const [index, setIndex] = useState(0);
  const [sheetDoor, setSheetDoor] = useState<FieldPacketDoor | null>(null);
  const [completeOpen, setCompleteOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
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
            const outbox = await getOutboxForList(listId);
            cached = mergeOutboxIntoPacket(cached, outbox);
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
    pendingDoorId.current = nextDoor?.householdId ?? null;

    setPacket(merged);
    await refreshPending();
    setSheetDoor(null);
    if (justFinished) setCompleteOpen(true);

    if (navigator.onLine) {
      try {
        const result = await syncOutbox(listId);
        await refreshPending();
        if (justFinished) {
          // Celebration sheet covers the feedback.
        } else if (result.failed) {
          toast("Saved locally; some results still pending sync");
        } else {
          toast("Saved");
        }
      } catch {
        if (!justFinished) toast("Saved offline — will sync when connected");
      }
    } else if (!justFinished) {
      toast("Saved offline");
    }
  }

  function quickLog(door: FieldPacketDoor, outcome: DoorOutcome) {
    void saveAttempt({
      door,
      outcome,
      notes: null,
      supersedesClientId: door.current?.clientAttemptId ?? null,
      people: [],
    });
  }

  function onRelease() {
    setMenuOpen(false);
    setCompleteOpen(false);
    startTransition(async () => {
      const pendingLocal = await getOutboxCount(listId);
      if (pendingLocal > 0) {
        toast("Sync your results before releasing this list.");
        return;
      }
      if (packet) {
        await purgePacketIfSynced(packet.programId, packet.listId);
      }
      const res = await releaseList(listId, programId);
      toast(res.message);
      if (res.ok) router.push("/canvass");
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
  const pct = total ? Math.round((closed / total) * 100) : 0;
  const mappedDoors = filteredDoors.filter((d) => d.lat != null && d.lng != null);
  const mapHelpItems = useMemo((): MapHelpItem[] => {
    const items: MapHelpItem[] = [
      {
        text: mappedDoors.length
          ? `${mappedDoors.length} door${mappedDoors.length === 1 ? "" : "s"} on map`
          : filter === "all"
            ? "No geocoded doors yet — use the list to walk"
            : "No doors in this filter on the map",
      },
      { text: "Tap a pin to open that door" },
      { color: DOOR_PIN_COLORS.talked, text: "Talked" },
      { color: DOOR_PIN_COLORS.lit, text: "Lit drop" },
      { color: DOOR_PIN_COLORS.other, text: "Other result" },
      { color: DOOR_PIN_COLORS.remaining, text: "Not visited" },
    ];
    if (location.you) items.push({ color: "#185FA5", text: "Current location" });
    if (location.home) items.push({ text: "Dark pin = home" });
    return items;
  }, [mappedDoors.length, filter, location.you, location.home]);

  return (
    <div className="walk">
      <header className="walk-header">
        <div className="walk-header-main">
          <div className="walk-title">
            <h1>{listName}</h1>
            <p>
              {packet
                ? `${closed}/${total} done · ${packet.programName}`
                : "Loading…"}
              {!online ? " · Offline" : pendingCount > 0 ? ` · ${pendingCount} pending` : ""}
            </p>
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
              <Icon name="menu" size={18} />
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
                  role="menuitem"
                  disabled={pending}
                  onClick={onRelease}
                >
                  Release list
                </button>
              </div>
            ) : null}
          </div>
        </div>
        {packet && !loading ? (
          <div className="progress-row">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="progress-label">
              {closed}/{total} doors
            </span>
          </div>
        ) : null}
      </header>

      {loading ? <div className="empty-state">Loading doors…</div> : null}
      {error ? <div className="empty-state">{error}</div> : null}

      {packet && !loading ? (
        <>
          <div className="walk-toolbar">
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
            <div className="row" style={{ gap: 6 }}>
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
          </div>

          {view === "map" ? (
            <div className="walk-map-stage">
              <div className="walk-map-frame">
                <Map
                  aspectRatio={1}
                  markers={mappedDoors.map((d) => {
                    return {
                      id: d.householdId,
                      lat: d.lat!,
                      lng: d.lng!,
                      color: doorPinColor(d.current?.outcome),
                      current: currentDoor?.householdId === d.householdId,
                      title: d.address,
                    };
                  })}
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
                        <div className="walk-door-nav">
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
                      <p>
                        {currentDoor.voters.length} voter
                        {currentDoor.voters.length === 1 ? "" : "s"}
                      </p>
                    </div>
                  </div>
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
                      currentDoor.voters.map((v) => (
                        <li key={v.voterId}>
                          <span>
                            {v.firstName} {v.lastName}
                          </span>
                          <small>
                            {[v.age != null ? String(v.age) : null, v.sex]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </li>
                      ))
                    ) : (
                      <li>
                        <span>No voters linked at this door</span>
                      </li>
                    )}
                  </ul>
                  <div className="walk-door-actions">
                    <div className="walk-quick-results">
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
                        onClick={() => quickLog(currentDoor, "lit")}
                      >
                        Lit drop
                      </button>
                      <button
                        type="button"
                        className="btn btn-outline btn-sm"
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

