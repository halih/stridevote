"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ListVM } from "@/lib/data";
import { Icon } from "@/components/Icon";
import { Map } from "@/components/map/Map";
import { useToast } from "@/components/Toast";
import { checkoutList, releaseList, toggleWatch } from "@/lib/actions";
import { ListSheets, type SheetState } from "./ListSheets";
import { sourceLabel } from "@/lib/format";

function statusColor(l: ListVM): string {
  if (l.status === "mine") return "#185FA5";
  if (l.status === "taken") return "#8a8f98";
  return l.campaigns[0]?.color ?? "#378ADD";
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

  const filtered = useMemo(
    () =>
      sub === "mine"
        ? lists.filter((l) => l.status === "mine")
        : lists.filter((l) => l.status !== "mine"),
    [lists, sub],
  );

  function run(fn: () => Promise<{ ok: boolean; message: string }>, close = false) {
    startTransition(async () => {
      const res = await fn();
      toast(res.message);
      if (close) setSheet(null);
      router.refresh();
    });
  }

  const mapPolys = filtered
    .filter((l) => l.boundary && l.boundary.length)
    .map((l) => ({
      points: l.boundary as [number, number][],
      color: statusColor(l),
      fillOpacity: l.status === "mine" ? 0.32 : l.status === "taken" ? 0.16 : 0.22,
    }));

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

      {view === "map" && mapPolys.length ? (
        <div className="card" style={{ padding: 0, marginBottom: 14 }}>
          <Map
            polygons={mapPolys}
            home={home ? { lat: home.lat, lng: home.lng, inside: true } : undefined}
            caption="Shaded areas are list territory, not exact walking boundaries"
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
              onCheckout={() => setSheet({ kind: "checkout", list: l })}
              onRelease={() => run(() => releaseList(l.id))}
              onWatch={() => run(() => toggleWatch(l.id))}
              onOpen={() => toast("Door-knocking isn't part of this release yet.")}
            />
          ))
        ) : (
          <div className="empty-state">
            {sub === "mine"
              ? "You haven't checked out any lists yet. Switch to Available to find one."
              : "No lists available right now — check back soon."}
          </div>
        )}
      </div>

      <ListSheets
        sheet={sheet}
        onClose={() => setSheet(null)}
        onConfirmCheckout={(l) => run(() => checkoutList(l.id), true)}
        checkoutPending={pending}
      />
    </>
  );
}

function ListCard({
  list: l,
  pending,
  onPreview,
  onCheckout,
  onRelease,
  onWatch,
  onOpen,
}: {
  list: ListVM;
  pending: boolean;
  onPreview: () => void;
  onCheckout: () => void;
  onRelease: () => void;
  onWatch: () => void;
  onOpen: () => void;
}) {
  const pct =
    l.progressTotal > 0 ? Math.round((l.progressDone / l.progressTotal) * 100) : 0;

  return (
    <div className="card list-card">
      <div className="list-top">
        <div>
          <p className="list-name">{l.name}</p>
          <p className="list-loc">
            {l.neighborhood}
            {l.distanceMi != null ? ` · ${l.distanceMi} mi` : ""}
          </p>
        </div>
        {l.status === "taken" ? (
          <span className="pill pill-neutral">With {l.takenBy}</span>
        ) : l.status === "mine" ? (
          <span className="pill pill-active">Checked out</span>
        ) : (
          <span className="pill pill-neutral">{l.doorsCount} doors</span>
        )}
      </div>

      <div className="badges">
        {l.campaigns.map((c) => (
          <span key={c.name} className="badge" style={{ background: c.color }}>
            {c.name}
          </span>
        ))}
        <span className="source-chip">{sourceLabel(l.source)}</span>
      </div>

      <div className="pickup-info">
        {l.campaigns
          .filter((c) => c.pickup)
          .map((c) => (
            <span key={c.name} className="pickup-chip">
              <Icon name={c.pickup!.type === "locker" ? "lock" : "home"} size={12} />
              {c.pickup!.label}
            </span>
          ))}
      </div>

      {l.status === "mine" ? (
        <>
          <div className="progress-row">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${pct}%` }} />
            </div>
            <span className="progress-label">
              {l.progressDone}/{l.progressTotal}
            </span>
          </div>
          <div className="list-foot">
            <div className="row" style={{ gap: 6 }}>
              <button className="icon-btn" onClick={onPreview} title="Preview doors">
                <Icon name="map" size={15} />
              </button>
              <button className="btn btn-outline btn-sm" disabled={pending} onClick={onRelease}>
                Release list
              </button>
            </div>
            <button className="btn btn-primary btn-sm" onClick={onOpen}>
              Open list
            </button>
          </div>
        </>
      ) : l.status === "taken" ? (
        <div className="list-foot">
          <div className="row" style={{ gap: 8 }}>
            <button className="icon-btn" onClick={onPreview} title="Preview doors">
              <Icon name="map" size={15} />
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
          <div className="row" style={{ gap: 8 }}>
            <button className="icon-btn" onClick={onPreview} title="Preview doors">
              <Icon name="map" size={15} />
            </button>
            <span className="taken-note">{l.doorsCount} doors</span>
          </div>
          <button className="btn btn-primary btn-sm" disabled={pending} onClick={onCheckout}>
            Check out
          </button>
        </div>
      )}
    </div>
  );
}
