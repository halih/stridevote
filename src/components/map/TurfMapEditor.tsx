"use client";

import dynamic from "next/dynamic";
import type { PrecinctOverlay } from "@/lib/precinct-geometry";

export type TurfDrawMode = "precinct" | "draw";

export interface TurfMapItem {
  id: string;
  name: string;
  boundary: [number, number][];
  color: string;
  fillOpacity?: number;
}

export interface TurfMapEditorProps {
  districtBoundary: [number, number][];
  districtColor: string;
  turfs: TurfMapItem[];
  precincts?: PrecinctOverlay[];
  mode?: TurfDrawMode;
  selectedPrecinctIds?: string[];
  value: [number, number][] | null;
  onChange: (boundary: [number, number][] | null) => void;
  onSelectPrecinct?: (precinct: PrecinctOverlay) => void;
  resetKey?: number;
}

const LeafletTurfEditor = dynamic(
  () => import("./LeafletTurfEditor").then((module) => module.LeafletTurfEditor),
  {
    ssr: false,
    loading: () => <div className="turf-map-loading">Loading district map…</div>,
  },
);

export function TurfMapEditor(props: TurfMapEditorProps) {
  return (
    <div className="turf-map-editor">
      <LeafletTurfEditor {...props} />
    </div>
  );
}
