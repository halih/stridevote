/**
 * Mapbox Geocoding API v6 adapter for household refinement.
 *
 * Stored coordinates require permanent=true (Mapbox terms). Temporary results
 * must not be written to the database.
 */

export interface MapboxGeocodeInput {
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
}

export interface MapboxGeocodeResult {
  lat: number;
  lng: number;
  permanent: boolean;
  relevance: number | null;
  placeName: string | null;
}

export function mapboxToken(): string | null {
  return process.env.MAPBOX_ACCESS_TOKEN?.trim() || null;
}

export function canPersistMapboxCoords(permanent: boolean): boolean {
  return permanent;
}

export async function geocodeMapboxForward(
  input: MapboxGeocodeInput,
  options: {
    token?: string | null;
    permanent?: boolean;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<MapboxGeocodeResult | null> {
  const token = options.token ?? mapboxToken();
  if (!token) return null;
  const permanent = options.permanent ?? true;
  const fetchImpl = options.fetchImpl ?? fetch;

  const params = new URLSearchParams({
    access_token: token,
    permanent: permanent ? "true" : "false",
    country: "US",
    limit: "1",
    types: "address",
    autocomplete: "false",
  });
  if (input.postalCode) params.set("postcode", input.postalCode);
  if (input.state) params.set("region", input.state);
  if (input.city) params.set("place", input.city);

  const query = [input.addressLine, input.city, input.state, input.postalCode]
    .filter(Boolean)
    .join(", ");
  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(query)}&${params}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Mapbox geocoder HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    features?: Array<{
      geometry?: { coordinates?: number[] };
      properties?: {
        full_address?: string;
        name?: string;
        coordinates?: { latitude?: number; longitude?: number };
        feature_type?: string;
      };
      relevance?: number;
    }>;
  };
  const feature = body.features?.[0];
  if (!feature) return null;

  const coords = feature.geometry?.coordinates;
  const propCoords = feature.properties?.coordinates;
  const lng =
    propCoords?.longitude ??
    (Array.isArray(coords) ? coords[0] : undefined);
  const lat =
    propCoords?.latitude ??
    (Array.isArray(coords) ? coords[1] : undefined);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  return {
    lat: lat as number,
    lng: lng as number,
    permanent,
    relevance: typeof feature.relevance === "number" ? feature.relevance : null,
    placeName:
      feature.properties?.full_address ?? feature.properties?.name ?? null,
  };
}
