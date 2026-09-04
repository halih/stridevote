"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ListVM } from "@/lib/data";
import { Icon } from "@/components/Icon";
import { Map } from "@/components/map/Map";
import { useToast } from "@/components/Toast";
import { checkoutList, releaseList, toggleWatch, previewListSplit, splitList } from "@/lib/actions";
import { ListSheets, type SheetState } from "./ListSheets";
import { sourceLabel } from "@/lib/format";
import { externalListOpen } from "@/lib/canvass/external";
import { downloadPacket, getOutboxCount, purgePacketIfSynced, deletePacket } from "@/lib/canvass/offline-store";
import { DEFAULT_ORIGIN, listDistanceMiles, roundMiles } from "@/lib/geo";
import { useVolunteerLocation } from "@/lib/use-volunteer-location";
import { MIN_SPLIT_DOORS, type SplitHalfKey } from "@/lib/canvass/list-split";

function statusColor(l: ListVM): string {
  if (l.status === "mine") return "#185FA5";
  if (l.status === "taken") return "#8a8f98";
  return l.campaigns[0]?.color ?? "#378ADD";
}

function withDistances(
  lists: ListVM[],
  origin: { lat: number; lng: number },
): ListVM[] {
  return lists
    .map((l) => {
      const miles = listDistanceMiles(origin, l);
      return {
        ...l,
        distanceMi: miles != null ? roundMiles(miles) : null,
      };
    })
    .sort((a, b) => (a.distanceMi ?? 999) - (b.distanceMi ?? 999));
}

export function CanvassView({
  lists,
  home,
}: {
  lists: ListVM[];
  home: { lat: number; lng: number } | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const [pending, startTransition] = useTransition();
  const [sub, setSub] = useState<"mine" | "available">("mine");
  const [view, setView] = useState<"list" | "map">("list");
  const [sheet, setSheet] = useState<SheetState>(null);
  const location = useVolunteerLocation(home);
  const origin = location.origin ?? DEFAULT_ORIGIN;

  const locatedLists = useMemo(
    () => withDistances(lists, origin),
    [lists, origin],
  );

  const filtered = useMemo(
    () =>
      sub === "mine"
        ? locatedLists.filter((l) => l.status === "mine")
        : locatedLists.filter((l) => l.status !== "mine"),
    [locatedLists, sub],
  );

  function run(fn: () => Promise<{ ok: boolean; message: string }>, close = false) {
    startTransition(async () => {
      const res = await fn();
      toast(res.message);
      if (close) setSheet(null);
      router.refresh();
    });
  }

  function onCheckout(list: ListVM) {
    startTransition(async () => {
      const programId = list.programId ?? list.campaigns[0]?.programId;
      const res = await checkoutList(list.id, programId ?? undefined);
      toast(res.message);
      if (!res.ok) return;
      setSheet(null);
      if (list.nativeCanvass && programId) {
        try {
          await downloadPacket(list.id, programId);
          toast("List ready offline");
        } catch (err) {
          toast(
            err instanceof Error
              ? err.message
              : "Checked out — download when you have a signal",
          );
        }
      }
      router.refresh();
    });
  }

  function onRelease(list: ListVM) {
    startTransition(async () => {
      try {
        const pendingLocal = await getOutboxCount(list.id);
        if (pendingLocal > 0) {
          toast("Sync your results before releasing this list.");
          return;
        }
      } catch {
        // IndexedDB unavailable — allow release.
      }
      const programId = list.programId ?? undefined;
      const res = await releaseList(list.id, programId);
      toast(res.message);
      if (res.ok && list.programId) {
        await purgePacketIfSynced(list.programId, list.id);
      }
      router.refresh();
    });
  }

  function onSplit(list: ListVM) {
    startTransition(async () => {
      try {
        const pendingLocal = await getOutboxCount(list.id);
        if (pendingLocal > 0) {
          toast("Sync your results before splitting this list.");
          return;
        }
      } catch {
        // IndexedDB unavailable — allow split preview.
      }
      const programId = list.programId ?? undefined;
      const res = await previewListSplit(list.id, programId);
      if (!res.ok || !res.preview) {
        toast(res.message);
        return;
      }
      setSheet({ kind: "split", list, preview: res.preview });
    });
  }

  function onConfirmSplit(keepHalf: SplitHalfKey) {
    if (!sheet || sheet.kind !== "split") {
      toast("Open split again to confirm.");
      return;
    }
    const list = sheet.list;
    const programId = list.programId ?? sheet.preview.programId;
    startTransition(async () => {
      const res = await splitList(list.id, keepHalf, programId);
      toast(res.message);
      if (!res.ok) return;
      setSheet(null);
      setSub("mine");
      if (programId) {
        try {
          await deletePacket(programId, list.id);
          await downloadPacket(list.id, programId);
        } catch {
          // Packet refresh is best-effort; volunteer can reopen the list.
        }
      }
      router.refresh();
    });
  }

  function onOpen(list: ListVM) {
    if (!list.nativeCanvass) {
      const ext = externalListOpen(list.source, list.sourceRef);
      if (ext?.href) {
        window.open(ext.href, "_blank", "noopener,noreferrer");
        return;
      }
      toast(ext?.hint ?? "Open this list in the external app.");
      return;
    }
    if (!list.programId) {
      toast("No active program for this list.");
      return;
    }
    router.push(`/canvass/${list.id}?programId=${encodeURIComponent(list.programId)}`);
  }

  const mapPolys = filtered
    .filter((l) => l.boundary && l.boundary.length)
    .map((l) => ({
      points: l.boundary as [number, number][],
      color: statusColor(l),
      fillOpacity: l.status === "mine" ? 0.32 : l.status === "taken" ? 0.16 : 0.22,
    }));

  const distanceHint =
    location.originSource === "gps"
      ? "Distance to nearest door from your current location"
      : location.originSource === "profile"
        ? "Distance to nearest door from your profile home"
        : `Distance to nearest door from ${DEFAULT_ORIGIN.label}`;

  const mapCaptionParts = [
    "Shaded areas are list territory, not exact walking boundaries",
  ];
  if (location.you) mapCaptionParts.push("blue = current location");
  if (location.home) mapCaptionParts.push("dark = home");

  return (
    <>
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <div className="segmented" style={{ maxWidth: 230 }}>
          <button className={sub === "mine" ? "active" : ""} onClick={() => setSub("mine")}>
            My lists
          </button>
          <button className={sub === "available" ? "active" : ""} onClick={() => setSub("available")}>
            Available
          </button>
        </div>
        <div className="row" style={{ gap: 6 }}>
          <button
            className={`icon-btn ${view === "list" ? "active" : ""}`}
            onClick={() => setView("list")}
            title="List view"
          >
            <Icon name="list" size={16} />
          </button>
          <button
            className={`icon-btn ${view === "map" ? "active" : ""}`}
            onClick={() => setView("map")}
            title="Map view"
          >
            <Icon name="map" size={16} />
          </button>
        </div>
      </div>
      <p className="section-sub" style={{ marginTop: -6, marginBottom: 12 }}>
        {distanceHint}
      </p>

      {view === "map" && mapPolys.length ? (
        <div className="card" style={{ padding: 0, marginBottom: 14 }}>
          <Map
            polygons={mapPolys}
            home={location.home ? { ...location.home, inside: true } : undefined}
            you={location.you ?? undefined}
            caption={mapCaptionParts.join(" · ")}
          />
        </div>
      ) : null}

      <div className="stack">
        {filtered.length ? (
          filtered.map((l) => (
            <ListCard
              key={l.id}
              list={l}
              pending={pending}
              onPreview={() => setSheet({ kind: "preview", list: l })}
              onPickup={() => setSheet({ kind: "pickup", list: l })}
              onCheckout={() => setSheet({ kind: "checkout", list: l })}
              onRelease={() => onRelease(l)}
              onSplit={() => onSplit(l)}
              onWatch={() => run(() => toggleWatch(l.id))}
              onOpen={() => onOpen(l)}
            />
          ))
        ) : (
          <div className="empty-state">
            {sub === "mine"
              ? "No lists assigned or checked out yet. Switch to Available to find one."
              : "No lists available right now — check back soon."}
          </div>
        )}
      </div>

      <ListSheets
        sheet={sheet}
        onClose={() => setSheet(null)}
        onConfirmCheckout={(l) => onCheckout(l)}
        onConfirmSplit={onConfirmSplit}
        checkoutPending={pending}
        home={location.home}
        you={location.you}
      />
    </>
  );
}

function ListCard({
  list: l,
  pending,
  onPreview,
  onPickup,
  onCheckout,
  onRelease,
  onSplit,
  onWatch,
  onOpen,
}: {
  list: ListVM;
  pending: boolean;
  onPreview: () => void;
  onPickup: () => void;
  onCheckout: () => void;
  onRelease: () => void;
  onSplit: () => void;
  onWatch: () => void;
  onOpen: () => void;
}) {
  const pct =
    l.progressTotal > 0 ? Math.round((l.progressDone / l.progressTotal) * 100) : 0;
  const external = !l.nativeCanvass
    ? externalListOpen(l.source, l.sourceRef)
    : null;
  const hasPickup = l.campaigns.some((c) => c.pickup);
  const canSplit =
    l.status === "mine" &&
    l.nativeCanvass &&
    l.doorsCount >= MIN_SPLIT_DOORS;

  return (
    <div className="card list-card">
      <div className="list-top">
        <div>
          <p className="list-name">{l.name}</p>
          {l.distanceMi != null ? <p className="list-loc">{l.distanceMi} mi</p> : null}
          {l.programName ? (
            <p className="list-loc" style={{ marginTop: 2 }}>
              {l.programName}
            </p>
          ) : null}
        </div>
        {l.status === "taken" ? (
          <span className="pill pill-neutral">With {l.takenBy}</span>
        ) : l.status === "mine" ? (
          <span className="pill pill-active">
            {l.assignedToMe ? "Assigned" : "Checked out"}
          </span>
        ) : (
          <span className="pill pill-neutral">{l.doorsCount} doors</span>
        )}
      </div>

      <div className="badges">
        {l.campaigns.map((c) => (
          <span key={`${c.campaignId}-${c.programId}`} className="badge" style={{ background: c.color }}>
            {c.name}
          </span>
        ))}
        <span className="source-chip">{sourceLabel(l.source)}</span>
      </div>

      <div className="pickup-info">
        {hasPickup ? (
          <button type="button" className="pickup-chip pickup-chip-btn" onClick={onPickup}>
            <Icon
              name={
                l.campaigns.find((c) => c.pickup)?.pickup?.type === "locker"
                  ? "lock"
                  : "home"
              }
              size={12}
            />
            Literature pickup
          </button>
        ) : null}
      </div>

      {l.nativeCanvass ? (
        <div className="progress-row">
          <div className="progress-track">
            <div className="progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="progress-label">
            {l.progressDone}/{l.progressTotal} doors
          </span>
        </div>
      ) : null}

      {l.status === "mine" ? (
        <>
          {external ? <p className="taken-note">{external.hint}</p> : null}
          <div className="list-foot">
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={onPreview}>
                <Icon name="map" size={14} /> Preview
              </button>
              {canSplit ? (
                <button
                  type="button"
                  className="btn btn-outline btn-sm"
                  disabled={pending}
                  onClick={onSplit}
                >
                  Split list
                </button>
              ) : null}
              {!l.assignedToMe ? (
                <button className="btn btn-outline btn-sm" disabled={pending} onClick={onRelease}>
                  Release list
                </button>
              ) : null}
            </div>
            <button className="btn btn-primary btn-sm" onClick={onOpen}>
              {l.nativeCanvass ? "Open list" : external?.label ?? "Open externally"}
            </button>
          </div>
        </>
      ) : l.status === "taken" ? (
        <div className="list-foot">
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={onPreview}>
              <Icon name="map" size={14} /> Preview
            </button>
            <span className="taken-note">In progress with {l.takenBy}</span>
          </div>
          <button
            className={`btn ${l.watching ? "btn-pending" : "btn-outline"} btn-sm`}
            disabled={pending}
            onClick={onWatch}
          >
            <Icon name="bell" size={13} /> {l.watching ? "Watching" : "Notify me"}
          </button>
        </div>
      ) : (
        <div className="list-foot">
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn btn-outline btn-sm" onClick={onPreview}>
              <Icon name="map" size={14} /> Preview
            </button>
          </div>
          <button className="btn btn-primary btn-sm" disabled={pending} onClick={onCheckout}>
            Check out
          </button>
        </div>
      )}
    </div>
  );
}
