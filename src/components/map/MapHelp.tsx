"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/Icon";

export type MapHelpItem = {
  text: string;
  /** Optional swatch for pin-color legend rows. */
  color?: string;
};

/** Compact map legend behind a help icon (replaces the bottom caption overlay). */
export function MapHelp({ items }: { items: MapHelpItem[] }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointer);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!items.length) return null;

  return (
    <div className="map-help" ref={rootRef}>
      <button
        type="button"
        className={`map-help-btn${open ? " open" : ""}`}
        aria-label="Map legend"
        aria-expanded={open}
        title="Map legend"
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="help" size={15} />
      </button>
      {open ? (
        <div className="map-help-panel" role="dialog" aria-label="Map legend">
          <ul className="map-help-list">
            {items.map((item) => (
              <li key={`${item.color ?? ""}:${item.text}`}>
                {item.color ? (
                  <span
                    className="map-help-swatch"
                    style={{ background: item.color }}
                    aria-hidden
                  />
                ) : null}
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
