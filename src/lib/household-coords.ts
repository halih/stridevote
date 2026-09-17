/**
 * Persistent household coordinates: one lat/lng plus the source that produced it.
 * Mapbox (legacy stored) and county GIS are the same accuracy band and do not
 * replace each other; both beat Census street interpolation.
 */

export type GeocodeSource = "census" | "county" | "mapbox";

/** Higher wins. Equal ranks do not replace each other. */
const SOURCE_RANK: Record<GeocodeSource, number> = {
  census: 1,
  county: 2,
  mapbox: 2,
};

export function isGeocodeSource(value: string | null | undefined): value is GeocodeSource {
  return value === "census" || value === "county" || value === "mapbox";
}

export function geocodeSourceRank(source: string | null | undefined): number {
  return isGeocodeSource(source) ? SOURCE_RANK[source] : 0;
}

/** True when incoming may write over the household's current persistent pin. */
export function canReplaceGeocode(
  current: string | null | undefined,
  incoming: string | null | undefined,
): boolean {
  return geocodeSourceRank(incoming) > geocodeSourceRank(current);
}

/**
 * Persistent lat/lng to write on household create/update.
 * Rank-0 imports (Civibyte, MiniVAN) fill a blank pin but never displace
 * census / county / mapbox.
 */
export function importedGeocodeWrite(opts: {
  current?: {
    lat?: number | null;
    lng?: number | null;
    geocodeSource?: string | null;
  } | null;
  lat: number;
  lng: number;
  source: string;
}): {
  lat: number;
  lng: number;
  geocodeSource: string;
  geocodeStatus: "matched";
} | null {
  const current = opts.current ?? {};
  if (
    isHouseholdGeocoded(current) &&
    !canReplaceGeocode(current.geocodeSource, opts.source)
  ) {
    return null;
  }
  return {
    lat: opts.lat,
    lng: opts.lng,
    geocodeSource: opts.source,
    geocodeStatus: "matched",
  };
}

export function isHouseholdGeocoded(h: {
  lat?: number | null;
  lng?: number | null;
}): boolean {
  return (
    h.lat != null &&
    h.lng != null &&
    Number.isFinite(h.lat) &&
    Number.isFinite(h.lng)
  );
}

export function resolveHouseholdCoords(h: {
  lat?: number | null;
  lng?: number | null;
  geocodeSource?: string | null;
}): {
  lat: number | null;
  lng: number | null;
  source: GeocodeSource | null;
} {
  if (!isHouseholdGeocoded(h)) {
    return { lat: null, lng: null, source: null };
  }
  return {
    lat: h.lat as number,
    lng: h.lng as number,
    source: isGeocodeSource(h.geocodeSource) ? h.geocodeSource : null,
  };
}

/** Fields to write when a geocoder match is accepted. */
export function geocodeWriteData(opts: {
  lat: number;
  lng: number;
  source: GeocodeSource;
  ref?: string | null;
}): {
  lat: number;
  lng: number;
  geocodeSource: GeocodeSource;
  geocodeRef: string | null;
} {
  return {
    lat: opts.lat,
    lng: opts.lng,
    geocodeSource: opts.source,
    geocodeRef: opts.ref ?? null,
  };
}
