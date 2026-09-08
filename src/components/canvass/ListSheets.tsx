"use client";

import type { ListVM } from "@/lib/data";
import type { SplitPreview, SplitHalfKey } from "@/lib/canvass/list-split";
import { BottomSheet } from "@/components/BottomSheet";
import { Icon } from "@/components/Icon";
import { Map } from "@/components/map/Map";
import { MapHelp, type MapHelpItem } from "@/components/map/MapHelp";
import { doorPinColor, DOOR_PIN_COLORS } from "@/lib/canvass/outcomes";
import { useMemo, useState } from "react";

const HALF_A_COLOR = "#185FA5";
const HALF_B_COLOR = "#D85A30";

export type SheetState =
  | { kind: "preview"; list: ListVM }
  | { kind: "checkout"; list: ListVM }
  | { kind: "pickup"; list: ListVM }
  | { kind: "split"; list: ListVM; preview: SplitPreview }
  | { kind: "open"; list: ListVM }
  | null;

function PickupDetails({ list }: { list: ListVM }) {
  const withPickup = list.campaigns.filter((c) => c.pickup);
  if (!withPickup.length) {
    return (
      <div className="pickup-info-row">
        <span className="pickup-info-icon">
          <Icon name="home" size={15} />
        </span>
        <div>
          <b>Pickup details to follow</b>
          <span>The campaign will share literature pickup info.</span>
        </div>
      </div>
    );
  }
  return (
    <div className="stack" style={{ marginTop: 8 }}>
      {withPickup.map((c) => (
        <div key={`${c.campaignId}-pickup`} className="pickup-info-row">
          <span className="pickup-info-icon">
            <Icon name={c.pickup!.type === "locker" ? "lock" : "home"} size={15} />
          </span>
          <div>
            <b>{c.name}</b>
            <span>
              {c.pickup!.label}
              {c.pickup!.address ? ` · ${c.pickup!.address}` : ""}
              {c.pickup!.detail ? ` — ${c.pickup!.detail}` : ""}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function SplitSheetBody({
  preview,
  pending,
  onConfirm,
}: {
  preview: SplitPreview;
  pending: boolean;
  onConfirm: (keepHalf: SplitHalfKey) => void;
}) {
  const [keep, setKeep] = useState<SplitHalfKey>("a");
  const keepHalf = keep === "a" ? preview.halfA : preview.halfB;
  const otherHalf = keep === "a" ? preview.halfB : preview.halfA;

  const polygons = useMemo(() => {
    const out: Array<{
      points: [number, number][];
      color: string;
      fillOpacity: number;
      weight: number;
    }> = [];
    if (preview.halfA.boundary?.length) {
      out.push({
        points: preview.halfA.boundary,
        color: HALF_A_COLOR,
        fillOpacity: keep === "a" ? 0.35 : 0.18,
        weight: keep === "a" ? 3.5 : 2,
      });
    }
    if (preview.halfB.boundary?.length) {
      out.push({
        points: preview.halfB.boundary,
        color: HALF_B_COLOR,
        fillOpacity: keep === "b" ? 0.35 : 0.18,
        weight: keep === "b" ? 3.5 : 2,
      });
    }
    return out;
  }, [preview, keep]);

  const markers = useMemo(
    () => [
      ...preview.halfA.doorPins.map((pin) => ({
        lat: pin.lat,
        lng: pin.lng,
        color: pin.completed
          ? DOOR_PIN_COLORS.talked
          : keep === "a"
            ? HALF_A_COLOR
            : "#8a8f98",
      })),
      ...preview.halfB.doorPins.map((pin) => ({
        lat: pin.lat,
        lng: pin.lng,
        color: pin.completed
          ? DOOR_PIN_COLORS.talked
          : keep === "b"
            ? HALF_B_COLOR
            : "#8a8f98",
      })),
    ],
    [preview, keep],
  );

  const helpItems: MapHelpItem[] = [
    { color: HALF_A_COLOR, text: preview.halfA.name },
    { color: HALF_B_COLOR, text: preview.halfB.name },
    { color: DOOR_PIN_COLORS.talked, text: "Already completed" },
  ];

  return (
    <>
      <h2>Split this list?</h2>
      <p className="sheet-sub">
        Two non-overlapping halves split by a clean geographic line (for
        example, everything east of a north–south street). Choose the half you
        keep; the other goes back to Available.
      </p>

      <div className="sheet-map">
        <Map aspectRatio={1.15} polygons={polygons} markers={markers} />
        <MapHelp items={helpItems} />
      </div>

      <div className="eyebrow" style={{ marginTop: 12 }}>
        Which half do you keep?
      </div>
      <div className="stack" style={{ marginTop: 8, gap: 8 }}>
        {([preview.halfA, preview.halfB] as const).map((half) => {
          const selected = keep === half.key;
          const color = half.key === "a" ? HALF_A_COLOR : HALF_B_COLOR;
          return (
            <button
              key={half.key}
              type="button"
              className="btn btn-outline btn-block"
              aria-pressed={selected}
              style={{
                borderColor: color,
                borderWidth: selected ? 2 : 1,
                background: selected ? `${color}14` : "transparent",
                color: "inherit",
                textAlign: "left",
              }}
              onClick={() => setKeep(half.key)}
            >
              <span style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
                <span
                  aria-hidden
                  style={{
                    width: 16,
                    height: 16,
                    marginTop: 2,
                    borderRadius: "50%",
                    border: `2px solid ${color}`,
                    background: selected ? color : "transparent",
                    flexShrink: 0,
                  }}
                />
                <span>
                  <strong>{half.name}</strong>
                  <span
                    style={{
                      display: "block",
                      fontWeight: 400,
                      opacity: 0.85,
                      fontSize: 13,
                    }}
                  >
                    {half.doorsCount} doors
                    {half.completedCount > 0
                      ? ` · ${half.completedCount} done`
                      : ""}
                    {selected ? " · selected" : ""}
                  </span>
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="section-sub" style={{ marginTop: 12 }}>
        You keep <b>{keepHalf.name}</b>.{" "}
        <b>{otherHalf.name}</b> ({otherHalf.doorsCount} doors) becomes
        available to the campaign.
      </p>

      <button
        className="btn btn-primary btn-block"
        style={{ marginTop: 14 }}
        disabled={pending}
        onClick={() => onConfirm(keep)}
      >
        {pending
          ? "Splitting…"
          : `Confirm — keep ${keepHalf.suffix}`}
      </button>
    </>
  );
}

function MinivanOpenSheetBody({
  list,
  onWalkHere,
  onCopyFailed,
}: {
  list: ListVM;
  onWalkHere: () => void;
  onCopyFailed: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copyListNumber(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard is blocked without HTTPS or permission — the number is on screen.
      onCopyFailed();
    }
  }

  return (
    <>
      <h2>How do you want to walk {list.name}?</h2>
      <p className="sheet-sub">
        These doors came from MiniVAN, so you can knock them here or in MiniVAN
        itself. Results only sync back to VAN from the doors you knock here.
      </p>

      <button
        className="btn btn-primary btn-block"
        style={{ marginTop: 14 }}
        onClick={onWalkHere}
      >
        Canvass in StrideVote
      </button>

      <div className="eyebrow" style={{ marginTop: 18 }}>
        Or use MiniVAN
      </div>
      {list.sourceRef ? (
        <div className="minivan-list-number">
          <span className="section-sub">
            List number <b>{list.sourceRef}</b>
          </span>
          <button
            type="button"
            className="btn btn-outline btn-sm"
            onClick={() => void copyListNumber(list.sourceRef!)}
          >
            <Icon name={copied ? "check" : "copy"} size={14} />{" "}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : null}
      <ol className="sheet-steps">
        <li>Open MiniVAN on your phone and sign in with your VAN account.</li>
        <li>Tap the menu, then “Download a new list”.</li>
        <li>
          {list.sourceRef
            ? `Enter list number ${list.sourceRef} and confirm.`
            : "Enter the list number your organizer gave you and confirm."}
        </li>
        <li>Knock the doors in MiniVAN — nothing to log here.</li>
        <li>
          When you are done, come back here and tap Pull MiniVAN so the door
          counts sync in StrideVote.
        </li>
      </ol>
    </>
  );
}

export function ListSheets({
  sheet,
  onClose,
  onConfirmCheckout,
  onConfirmSplit,
  onWalkHere,
  onCopyFailed,
  checkoutPending,
  home,
  you,
}: {
  sheet: SheetState;
  onClose: () => void;
  onConfirmCheckout: (l: ListVM) => void;
  onConfirmSplit?: (keepHalf: SplitHalfKey) => void;
  onWalkHere?: (l: ListVM) => void;
  onCopyFailed?: () => void;
  checkoutPending: boolean;
  home: { lat: number; lng: number } | null;
  you: { lat: number; lng: number } | null;
}) {
  const l = sheet?.list ?? null;
  const previewColor = l?.campaigns[0]?.color ?? "#185FA5";
  const hasBoundary = Boolean(l?.boundary?.length);
  const hasPins = Boolean(l?.doorPins.length);
  const showMap = hasBoundary || hasPins || Boolean(home) || Boolean(you);

  const mapHelpItems = useMemo((): MapHelpItem[] => {
    if (!l) return [];
    const items: MapHelpItem[] = [];
    if (hasPins) {
      items.push({
        text: `${l.doorPins.length}${l.doorPins.length < l.doorsCount ? "+" : ""} doors on map`,
      });
    } else if (hasBoundary) {
      items.push({ text: "List boundary" });
    }
    items.push(
      { color: DOOR_PIN_COLORS.talked, text: "Talked" },
      { color: DOOR_PIN_COLORS.lit, text: "Lit drop" },
      { color: DOOR_PIN_COLORS.other, text: "Other result" },
      { color: previewColor, text: "Not visited" },
    );
    if (you) items.push({ color: "#185FA5", text: "Current location" });
    if (home) items.push({ text: "Dark pin = home" });
    return items;
  }, [l, hasPins, hasBoundary, previewColor, home, you]);

  return (
    <BottomSheet open={!!sheet} onClose={onClose}>
      {sheet && l ? (
        sheet.kind === "preview" ? (
          <>
            <h2>{l.name}</h2>
            <p className="sheet-sub">
              {l.doorsCount} doors · {l.campaigns.map((c) => c.name).join(" + ")}
            </p>
            {showMap ? (
              <div className="sheet-map">
                <Map
                  aspectRatio={1.15}
                  polygons={
                    hasBoundary
                      ? [
                          {
                            points: l.boundary!,
                            color: previewColor,
                            fillOpacity: 0.22,
                            weight: 3.5,
                          },
                        ]
                      : []
                  }
                  markers={l.doorPins.map((pin) => ({
                    lat: pin.lat,
                    lng: pin.lng,
                    color: doorPinColor(pin.outcome, previewColor),
                  }))}
                  home={home ? { ...home, inside: true } : undefined}
                  you={you ?? undefined}
                />
                <MapHelp items={mapHelpItems} />
              </div>
            ) : (
              <div className="empty-state">No map preview available for this list.</div>
            )}
            <p className="section-sub" style={{ marginTop: 10 }}>
              {l.status === "mine"
                ? "Preview of this list’s turf and doors."
                : "Preview only — check out this list to work it."}
              {l.source === "minivan" ? (
                <>
                  {" "}
                  <span className="source-chip source-chip-minivan">MiniVAN</span>
                </>
              ) : null}
            </p>
            {l.status === "available" ? (
              <button
                className="btn btn-primary btn-block"
                style={{ marginTop: 14 }}
                disabled={checkoutPending}
                onClick={() => onConfirmCheckout(l)}
              >
                Check out this list
              </button>
            ) : null}
          </>
        ) : sheet.kind === "pickup" ? (
          <>
            <h2>Literature pickup</h2>
            <p className="sheet-sub">
              Where to pick up materials for {l.name}
            </p>
            <PickupDetails list={l} />
          </>
        ) : sheet.kind === "split" ? (
          <SplitSheetBody
            preview={sheet.preview}
            pending={checkoutPending}
            onConfirm={(keepHalf) => onConfirmSplit?.(keepHalf)}
          />
        ) : sheet.kind === "open" ? (
          <MinivanOpenSheetBody
            list={l}
            onWalkHere={() => onWalkHere?.(l)}
            onCopyFailed={() => onCopyFailed?.()}
          />
        ) : (
          <>
            <h2>Ready to canvass {l.name}?</h2>
            <p className="sheet-sub">
              {l.doorsCount} doors · {l.campaigns.map((c) => c.name).join(" + ")}
            </p>
            <div className="eyebrow">Literature pickup</div>
            <PickupDetails list={l} />
            <button
              className="btn btn-primary btn-block"
              style={{ marginTop: 16 }}
              disabled={checkoutPending}
              onClick={() => onConfirmCheckout(l)}
            >
              Confirm checkout
            </button>
          </>
        )
      ) : null}
    </BottomSheet>
  );
}
