"use client";

import type { ListVM } from "@/lib/data";
import { BottomSheet } from "@/components/BottomSheet";
import { Icon } from "@/components/Icon";
import { Map } from "@/components/map/Map";
import { MapHelp, type MapHelpItem } from "@/components/map/MapHelp";
import { doorPinColor, DOOR_PIN_COLORS } from "@/lib/canvass/outcomes";
import { sourceLabel } from "@/lib/format";
import { useMemo } from "react";

export type SheetState =
  | { kind: "preview"; list: ListVM }
  | { kind: "checkout"; list: ListVM }
  | { kind: "pickup"; list: ListVM }
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

export function ListSheets({
  sheet,
  onClose,
  onConfirmCheckout,
  checkoutPending,
  home,
  you,
}: {
  sheet: SheetState;
  onClose: () => void;
  onConfirmCheckout: (l: ListVM) => void;
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
                : "Preview only — check out this list to work it."}{" "}
              <span className="source-chip">{sourceLabel(l.source)}</span>
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
