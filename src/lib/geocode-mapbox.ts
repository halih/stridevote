/**
 * Mapbox Geocoding API v6 adapter.
 *
 * Permanent geocoding is disabled. Temporary results may be used for the
 * current walk session only — never written to the database or the offline
 * packet cache.
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
  relevance: number | null;
  placeName: string | null;
}

type MapboxFeature = {
  geometry?: { coordinates?: number[] };
  properties?: {
    full_address?: string;
    name?: string;
    coordinates?: { latitude?: number; longitude?: number };
  };
  relevance?: number;
};

/** v6 batch allows up to 1000 queries; stay under in case of older account limits. */
export const MAPBOX_BATCH_LIMIT = 50;

export function mapboxToken(): string | null {
  return process.env.MAPBOX_ACCESS_TOKEN?.trim() || null;
}

/** Permanent Mapbox storage is disabled; never persist API results. */
export function canPersistMapboxCoords(): boolean {
  return false;
}

export function mapboxForwardQuery(input: MapboxGeocodeInput): string {
  return [input.addressLine, input.city, input.state, input.postalCode]
    .filter(Boolean)
    .join(", ");
}

export function resultFromMapboxFeature(
  feature: MapboxFeature | undefined,
): MapboxGeocodeResult | null {
  if (!feature) return null;
  const coords = feature.geometry?.coordinates;
  const propCoords = feature.properties?.coordinates;
  const lng =
    propCoords?.longitude ?? (Array.isArray(coords) ? coords[0] : undefined);
  const lat =
    propCoords?.latitude ?? (Array.isArray(coords) ? coords[1] : undefined);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return {
    lat: lat as number,
    lng: lng as number,
    relevance: typeof feature.relevance === "number" ? feature.relevance : null,
    placeName:
      feature.properties?.full_address ?? feature.properties?.name ?? null,
  };
}

function batchBody(input: MapboxGeocodeInput) {
  const body: Record<string, unknown> = {
    q: mapboxForwardQuery(input),
    country: "US",
    limit: 1,
    types: ["address"],
    autocomplete: false,
  };
  if (input.postalCode) body.postcode = input.postalCode;
  if (input.state) body.region = input.state;
  if (input.city) body.place = input.city;
  return body;
}

export async function geocodeMapboxForward(
  input: MapboxGeocodeInput,
  options: {
    token?: string | null;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<MapboxGeocodeResult | null> {
  const token = options.token ?? mapboxToken();
  if (!token) return null;
  const fetchImpl = options.fetchImpl ?? fetch;

  const params = new URLSearchParams({
    access_token: token,
    permanent: "false",
    country: "US",
    limit: "1",
    types: "address",
    autocomplete: "false",
  });
  if (input.postalCode) params.set("postcode", input.postalCode);
  if (input.state) params.set("region", input.state);
  if (input.city) params.set("place", input.city);

  const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(mapboxForwardQuery(input))}&${params}`;
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Mapbox geocoder HTTP ${response.status}`);
  }
  const body = (await response.json()) as { features?: MapboxFeature[] };
  return resultFromMapboxFeature(body.features?.[0]);
}

export async function geocodeMapboxForwardBatch(
  inputs: MapboxGeocodeInput[],
  options: {
    token?: string | null;
    fetchImpl?: typeof fetch;
  } = {},
): Promise<Array<MapboxGeocodeResult | null>> {
  if (!inputs.length) return [];
  const token = options.token ?? mapboxToken();
  if (!token) return inputs.map(() => null);
  const fetchImpl = options.fetchImpl ?? fetch;
  const out: Array<MapboxGeocodeResult | null> = [];

  for (let start = 0; start < inputs.length; start += MAPBOX_BATCH_LIMIT) {
    const chunk = inputs.slice(start, start + MAPBOX_BATCH_LIMIT);
    const url = `https://api.mapbox.com/search/geocode/v6/batch?access_token=${encodeURIComponent(token)}&permanent=false`;
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(chunk.map(batchBody)),
      });
      if (!response.ok) {
        console.error(`Mapbox batch geocoder HTTP ${response.status}`);
        out.push(...chunk.map(() => null));
        continue;
      }
      const body = (await response.json()) as {
        batch?: Array<{ features?: MapboxFeature[] }>;
      };
      const rows = body.batch ?? [];
      for (let i = 0; i < chunk.length; i++) {
        out.push(resultFromMapboxFeature(rows[i]?.features?.[0]));
      }
    } catch (err) {
      console.error("Mapbox batch geocoder failed", err);
      out.push(...chunk.map(() => null));
    }
  }
  return out;
}
