import {
  isGeocodeSource,
  isHouseholdGeocoded,
  type GeocodeSource,
} from "@/lib/household-coords";

/** How a walk-packet door got its lat/lng. Session Mapbox must not be cached. */
export type DoorCoordSource =
  | GeocodeSource
  | "session-mapbox"
  | "none";

export interface DoorCoordFields {
  lat: number | null;
  lng: number | null;
  coordSource: DoorCoordSource;
  /** Persistable coords (never session Mapbox). */
  stableLat: number | null;
  stableLng: number | null;
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
  const stableSource: DoorCoordSource = hasStable
    ? isGeocodeSource(opts.geocodeSource)
      ? opts.geocodeSource
      : "census"
    : "none";

  if (hasStable) {
    return {
      lat: stableLat,
      lng: stableLng,
      coordSource: stableSource,
      stableLat,
      stableLng,
    };
  }

  if (
    opts.session &&
    Number.isFinite(opts.session.lat) &&
    Number.isFinite(opts.session.lng)
  ) {
    return {
      lat: opts.session.lat,
      lng: opts.session.lng,
      coordSource: "session-mapbox",
      stableLat,
      stableLng,
    };
  }

  return {
    lat: null,
    lng: null,
    coordSource: "none",
    stableLat,
    stableLng,
  };
}

/** Drop temporary Mapbox points before IndexedDB / any durable store. */
export function persistableDoorCoords<T extends DoorCoordFields>(door: T): T {
  if (door.coordSource !== "session-mapbox") return door;
  const hasStable = door.stableLat != null && door.stableLng != null;
  return {
    ...door,
    lat: door.stableLat,
    lng: door.stableLng,
    coordSource: hasStable ? "census" : "none",
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
