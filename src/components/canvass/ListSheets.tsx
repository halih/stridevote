"use client";

import type { ListVM } from "@/lib/data";
import { BottomSheet } from "@/components/BottomSheet";
import { Icon } from "@/components/Icon";
import { Map } from "@/components/map/Map";
import { sourceLabel } from "@/lib/format";

export type SheetState =
  | { kind: "preview"; list: ListVM }
  | { kind: "checkout"; list: ListVM }
  | null;

export function ListSheets({
  sheet,
  onClose,
  onConfirmCheckout,
  checkoutPending,
}: {
  sheet: SheetState;
  onClose: () => void;
  onConfirmCheckout: (l: ListVM) => void;
  checkoutPending: boolean;
}) {
  const l = sheet?.list ?? null;

  return (
    <BottomSheet open={!!sheet} onClose={onClose}>
      {sheet && l ? (
        sheet.kind === "preview" ? (
          <>
            <h2>{l.name}</h2>
            <p className="sheet-sub">
              {l.neighborhood} · {l.doorsCount} doors ·{" "}
              {l.campaigns.map((c) => c.name).join(" + ")}
            </p>
            {l.boundary && l.boundary.length ? (
              <Map
                polygons={[{ points: l.boundary, color: "#9aa2ad", fillOpacity: 0.08 }]}
              />
            ) : (
              <div className="empty-state">No map preview available for this list.</div>
            )}
            <p className="section-sub" style={{ marginTop: 10 }}>
              Preview only — check out this list to work it.{" "}
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
        ) : (
          <>
            <h2>Ready to canvass {l.name}?</h2>
            <p className="sheet-sub">
              {l.doorsCount} doors · {l.campaigns.map((c) => c.name).join(" + ")}
            </p>
            <div className="eyebrow">Literature pickup</div>
            <div className="stack" style={{ marginTop: 8 }}>
              {l.campaigns.filter((c) => c.pickup).length ? (
                l.campaigns
                  .filter((c) => c.pickup)
                  .map((c) => (
                    <div key={c.name} className="pickup-info-row">
                      <span className="pickup-info-icon">
                        <Icon name={c.pickup!.type === "locker" ? "lock" : "home"} size={15} />
                      </span>
                      <div>
                        <b>{c.name}</b>
                        <span>
                          {c.pickup!.label}
                          {c.pickup!.detail ? ` — ${c.pickup!.detail}` : ""}
                        </span>
                      </div>
                    </div>
                  ))
              ) : (
                <div className="pickup-info-row">
                  <span className="pickup-info-icon">
                    <Icon name="home" size={15} />
                  </span>
                  <div>
                    <b>Pickup details to follow</b>
                    <span>The campaign will share literature pickup info.</span>
                  </div>
                </div>
              )}
            </div>
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
