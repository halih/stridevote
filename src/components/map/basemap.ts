import { useSyncExternalStore } from "react";

export type Basemap = "street" | "satellite";

export interface BasemapTiles {
  /** XYZ tile template. May contain `{s}` for Leaflet subdomains. */
  url: string;
  attribution: string;
  maxZoom: number;
}

export const BASEMAP_TILES: Record<Basemap, BasemapTiles> = {
  street: {
    url:
      process.env.NEXT_PUBLIC_MAP_TILE_URL ??
      "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMap contributors",
    maxZoom: 19,
  },
  satellite: {
    url:
      process.env.NEXT_PUBLIC_MAP_SATELLITE_TILE_URL ??
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
    attribution: "Imagery © Esri, Maxar, Earthstar Geographics",
    maxZoom: 19,
  },
};

/** MapLibre has no subdomain templating; pin `{s}` to one host. */
export function maplibreTileUrl(url: string): string {
  return url.replace("{s}", "a");
}

const STORAGE_KEY = "stridevote.map.basemap";
const DEFAULT_BASEMAP: Basemap = "street";

function isBasemap(value: unknown): value is Basemap {
  return value === "street" || value === "satellite";
}

/**
 * The preference lives in a module-level store rather than per map instance so
 * the walk map and the list overview agree, and so a map that remounts (view
 * toggle, packet reload) comes back with the imagery the volunteer picked.
 */
let current: Basemap | null = null;
const listeners = new Set<() => void>();

function readStored(): Basemap {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isBasemap(stored) ? stored : DEFAULT_BASEMAP;
  } catch {
    return DEFAULT_BASEMAP;
  }
}

function getSnapshot(): Basemap {
  if (current === null) current = readStored();
  return current;
}

function getServerSnapshot(): Basemap {
  return DEFAULT_BASEMAP;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setBasemap(next: Basemap): void {
  if (current === next) return;
  current = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // The choice still applies for this session.
  }
  for (const listener of listeners) listener();
}

export function useBasemap(): [Basemap, (next: Basemap) => void] {
  const basemap = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return [basemap, setBasemap];
}
