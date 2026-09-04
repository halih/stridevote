/** How a walk-packet door got its lat/lng. Session Mapbox must not be cached. */
export type DoorCoordSource =
  | "stored-mapbox"
  | "session-mapbox"
  | "census"
  | "none";

export interface DoorCoordFields {
  lat: number | null;
  lng: number | null;
  coordSource: DoorCoordSource;
  /** Persistable coords (Census or stored permanent Mapbox). */
  stableLat: number | null;
  stableLng: number | null;
}

export function resolveDoorCoords(opts: {
  mapboxLat: number | null | undefined;
  mapboxLng: number | null | undefined;
  censusLat: number | null | undefined;
  censusLng: number | null | undefined;
  session?: { lat: number; lng: number } | null;
}): DoorCoordFields {
  const hasStored =
    opts.mapboxLat != null &&
    opts.mapboxLng != null &&
    Number.isFinite(opts.mapboxLat) &&
    Number.isFinite(opts.mapboxLng);
  const hasCensus =
    opts.censusLat != null &&
    opts.censusLng != null &&
    Number.isFinite(opts.censusLat) &&
    Number.isFinite(opts.censusLng);

  const stableLat = hasStored
    ? (opts.mapboxLat as number)
    : hasCensus
      ? (opts.censusLat as number)
      : null;
  const stableLng = hasStored
    ? (opts.mapboxLng as number)
    : hasCensus
      ? (opts.censusLng as number)
      : null;
  const stableSource: DoorCoordSource = hasStored
    ? "stored-mapbox"
    : hasCensus
      ? "census"
      : "none";

  if (hasStored) {
    return {
      lat: stableLat,
      lng: stableLng,
      coordSource: "stored-mapbox",
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
    lat: stableLat,
    lng: stableLng,
    coordSource: stableSource,
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
