import {
  isGeocodeSource,
  isHouseholdGeocoded,
  type GeocodeSource,
} from "@/lib/household-coords";

/**
 * How a walk-packet door got its lat/lng. Session Mapbox must not be cached.
 * "imported" is a pin that arrived with a door list (Civibyte, MiniVAN) rather
 * than from a geocoder we ran ourselves.
 */
export type DoorCoordSource =
  | GeocodeSource
  | "imported"
  | "session-mapbox"
  | "none";

export interface DoorCoordFields {
  lat: number | null;
  lng: number | null;
  coordSource: DoorCoordSource;
  /** Persistable coords (never session Mapbox). */
  stableLat: number | null;
  stableLng: number | null;
  /** Source of stableLat/stableLng, restored when session coords are dropped. */
  stableCoordSource: DoorCoordSource;
}

/**
 * An imported list carries whatever pin the source app had, and those land off
 * the building often enough to misdraw a walk map — Civibyte splits units of
 * one address across a block. Fetch a temporary Mapbox point for those doors
 * rather than trusting the import.
 */
export function needsSessionGeocode(h: {
  lat?: number | null;
  lng?: number | null;
  geocodeSource?: string | null;
}): boolean {
  return !isHouseholdGeocoded(h) || !isGeocodeSource(h.geocodeSource);
}

export function resolveDoorCoords(opts: {
  lat: number | null | undefined;
  lng: number | null | undefined;
  geocodeSource?: string | null;
  session?: { lat: number; lng: number } | null;
}): DoorCoordFields {
  const hasStable = isHouseholdGeocoded(opts);
  const stableLat = hasStable ? (opts.lat as number) : null;
  const stableLng = hasStable ? (opts.lng as number) : null;
  const stableCoordSource: DoorCoordSource = !hasStable
    ? "none"
    : isGeocodeSource(opts.geocodeSource)
      ? opts.geocodeSource
      : "imported";

  const session =
    opts.session &&
    Number.isFinite(opts.session.lat) &&
    Number.isFinite(opts.session.lng)
      ? opts.session
      : null;

  if (session && needsSessionGeocode(opts)) {
    return {
      lat: session.lat,
      lng: session.lng,
      coordSource: "session-mapbox",
      stableLat,
      stableLng,
      stableCoordSource,
    };
  }

  if (hasStable) {
    return {
      lat: stableLat,
      lng: stableLng,
      coordSource: stableCoordSource,
      stableLat,
      stableLng,
      stableCoordSource,
    };
  }

  return {
    lat: null,
    lng: null,
    coordSource: "none",
    stableLat,
    stableLng,
    stableCoordSource,
  };
}

/** Drop temporary Mapbox points before IndexedDB / any durable store. */
export function persistableDoorCoords<T extends DoorCoordFields>(door: T): T {
  if (door.coordSource !== "session-mapbox") return door;
  return {
    ...door,
    lat: door.stableLat,
    lng: door.stableLng,
    coordSource: door.stableCoordSource,
  };
}

export function packetForOfflineCache<T extends { doors: DoorCoordFields[] }>(
  packet: T,
): T {
  return {
    ...packet,
    doors: packet.doors.map((door) => persistableDoorCoords(door)),
  };
}
