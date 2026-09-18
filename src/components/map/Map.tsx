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

const WalkMap = dynamic(() => import("./WalkMap").then((m) => m.WalkMap), {
  ssr: false,
  loading: () => (
    <div className="map-loading">
      Loading map…
    </div>
  ),
});

export function Map(props: MapProps) {
  const walk = props.mode === "walk";
  const MapRenderer = walk ? WalkMap : LeafletMap;
  return (
    <div
      // A walk map fills the height its container was given; overview maps size
      // themselves from their width so they can sit inline in cards and sheets.
      className={`fakemap${walk ? " fakemap-fill" : ""}`}
      style={
        walk
          ? { width: "100%", height: "100%" }
          : { width: "100%", aspectRatio: props.aspectRatio ?? 4 / 3 }
      }
    >
      <MapRenderer {...props} />
      {props.caption ? <span className="map-caption">{props.caption}</span> : null}
    </div>
  );
}

export type { MapProps } from "./types";
