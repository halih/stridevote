/**
 * US Census Bureau batch geocoder (free, bulk). Used for household baseline coords.
 * https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
 */

export interface CensusAddressInput {
  id: string;
  street: string;
  city: string;
  state: string;
  zip: string;
}

export type CensusMatchQuality = "Exact" | "Non_Exact" | "Tie" | "No_Match" | string;

export interface CensusGeocodeResult {
  id: string;
  match: CensusMatchQuality;
  matchType: string | null;
  matchedAddress: string | null;
  lat: number | null;
  lng: number | null;
}

const CENSUS_BATCH_URL =
  "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
const BATCH_TIMEOUT_MS = 120000;

/** Build the Census batch CSV body (id,street,city,state,zip). */
export function buildCensusBatchCsv(rows: CensusAddressInput[]): string {
  return rows
    .map((row) =>
      [row.id, row.street, row.city, row.state, row.zip]
        .map(csvEscape)
        .join(","),
    )
    .join("\n");
}

function csvEscape(value: string): string {
  const cleaned = value.replace(/"/g, '""');
  return /[",\n]/.test(cleaned) ? `"${cleaned}"` : cleaned;
}

/** Parse Census batch response CSV lines. */
export function parseCensusBatchResponse(text: string): CensusGeocodeResult[] {
  const results: CensusGeocodeResult[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    // Format: id, inputAddress, indicator, matchType, matchedAddress, coords, tigerLineId, side
    // The indicator is Match / No_Match / Tie; matchType carries Exact / Non_Exact.
    const id = cols[0]?.trim() ?? "";
    const indicator = cols[2]?.trim() || "No_Match";
    const matchType = cols[3]?.trim() || null;
    const match = (
      indicator === "Match" ? matchType || "Exact" : indicator
    ) as CensusMatchQuality;
    const matchedAddress = cols[4]?.trim() || null;
    const coords = cols[5]?.trim() || "";
    let lat: number | null = null;
    let lng: number | null = null;
    if (coords.includes(",")) {
      const [lngRaw, latRaw] = coords.split(",");
      const parsedLng = Number(lngRaw);
      const parsedLat = Number(latRaw);
      if (Number.isFinite(parsedLat) && Number.isFinite(parsedLng)) {
        lat = parsedLat;
        lng = parsedLng;
      }
    }
    results.push({ id, match, matchType, matchedAddress, lat, lng });
  }
  return results;
}

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

export function censusStatusFromMatch(match: CensusMatchQuality): string {
  if (match === "Exact" || match === "Non_Exact") return "matched";
  if (match === "Tie") return "ambiguous";
  return "unmatched";
}

export async function geocodeCensusBatch(
  rows: CensusAddressInput[],
  fetchImpl: typeof fetch = fetch,
): Promise<CensusGeocodeResult[]> {
  if (!rows.length) return [];
  const csv = buildCensusBatchCsv(rows);
  const form = new FormData();
  form.append(
    "addressFile",
    new Blob([csv], { type: "text/csv" }),
    "addresses.csv",
  );
  form.append("benchmark", "Public_AR_Current");

  // Without a deadline a stalled connection hangs the batch run indefinitely
  // instead of surfacing to the caller's retry loop.
  const response = await fetchImpl(CENSUS_BATCH_URL, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(BATCH_TIMEOUT_MS),
  });
  if (!response.ok) {
    throw new Error(`Census geocoder HTTP ${response.status}`);
  }
  const text = await response.text();
  return parseCensusBatchResponse(text);
}
