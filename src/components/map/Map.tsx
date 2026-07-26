"use client";

import dynamic from "next/dynamic";
import type { MapProps } from "./types";

// Leaflet touches window, so load it client-only.
const LeafletMap = dynamic(() => import("./LeafletMap").then((m) => m.LeafletMap), {
  ssr: false,
  loading: () => (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ink-faint)",
        fontSize: 12,
      }}
    >
      Loading map…
    </div>
  ),
});

export function Map(props: MapProps) {
  return (
    <div
      className="fakemap"
      style={{ width: "100%", aspectRatio: props.aspectRatio ?? 4 / 3 }}
    >
      <LeafletMap {...props} />
      {props.caption ? <span className="map-caption">{props.caption}</span> : null}
    </div>
  );
}

export type { MapProps } from "./types";
