/**
 * King and Snohomish County address-point geocoding (ArcGIS FeatureServer).
 * Uses FeatureServer geometry (outSR=4326), never the counties' Lat/Long attributes.
 */

import { normalizeHouseholdAddress } from "@/lib/household-address";

export type CountyCode = "KI" | "SN";

export interface CountyHouseholdInput {
  id: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  unit: string | null;
  countyCode: CountyCode;
}

export type CountyMatchStatus = "matched" | "unmatched" | "ambiguous";

export interface CountyGeocodeResult {
  id: string;
  status: CountyMatchStatus;
  lat: number | null;
  lng: number | null;
  ref: string | null;
}

export interface CountyAddressPoint {
  ref: string;
  houseNumber: string;
  streetLine: string;
  postalCode: string;
  unit: string | null;
  city: string | null;
  lat: number;
  lng: number;
}

interface CountyLayer {
  countyCode: CountyCode;
  url: string;
  idField: string;
  houseField: string;
  zipField: string;
  streetField: string;
  unitField: string;
  cityField: string | null;
  outFields: string;
  houseAsNumber: boolean;
}

export const COUNTY_LAYERS: Record<CountyCode, CountyLayer> = {
  KI: {
    countyCode: "KI",
    url: "https://services.arcgis.com/Ej0PsM5Aw677QF1W/arcgis/rest/services/ADDRESS_POINT_642/FeatureServer/0/query",
    idField: "SITEID",
    houseField: "ADDR_HN",
    zipField: "ZIP5",
    streetField: "ADDR_FULL",
    unitField: "Unit",
    cityField: "POSTALCTYNAME",
    outFields: "SITEID,ADDR_HN,ADDR_FULL,ZIP5,Unit,POSTALCTYNAME,CTYNAME",
    houseAsNumber: false,
  },
  SN: {
    countyCode: "SN",
    url: "https://services6.arcgis.com/z6WYi9VRHfgwgtyW/arcgis/rest/services/Building_Address_Points/FeatureServer/0/query",
    idField: "Site_NGUID",
    houseField: "Add_Number",
    zipField: "Post_Code",
    streetField: "LFULL_ADD",
    unitField: "Unit",
    cityField: "Post_Comm",
    outFields:
      "Site_NGUID,Add_Number,LFULL_ADD,Post_Code,Unit,UNITNUM,UNITTYP,Post_Comm",
    houseAsNumber: true,
  },
};

const STREET_ABBREV: Record<string, string> = {
  STREET: "ST",
  STR: "ST",
  AVENUE: "AVE",
  AV: "AVE",
  BOULEVARD: "BLVD",
  DRIVE: "DR",
  ROAD: "RD",
  LANE: "LN",
  COURT: "CT",
  PLACE: "PL",
  TERRACE: "TER",
  TERR: "TER",
  CIRCLE: "CIR",
  HIGHWAY: "HWY",
  PARKWAY: "PKWY",
  TRAIL: "TRL",
  WAY: "WAY",
};

const DIRECTION: Record<string, string> = {
  NORTH: "N",
  SOUTH: "S",
  EAST: "E",
  WEST: "W",
  NORTHEAST: "NE",
  NORTHWEST: "NW",
  SOUTHEAST: "SE",
  SOUTHWEST: "SW",
};

function compress(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizeStreetLine(line: string): string {
  return compress(line)
    .split(" ")
    .map((token) => DIRECTION[token] ?? STREET_ABBREV[token] ?? token)
    .join(" ");
}

export function houseNumberOf(addressLine: string): string | null {
  const match = addressLine.trim().match(/^(\d+[A-Z]?)/i);
  return match ? match[1].toUpperCase() : null;
}

export function normalizeUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const cleaned = compress(unit)
    .replace(/^(APT|APARTMENT|UNIT|STE|SUITE|#|NO|NUM|RM|ROOM|FL|FLOOR|BLDG|BUILDING)\s*/i, "")
    .replace(/\s+/g, "");
  return cleaned || null;
}

/** Street portion of a county ADDR_FULL / LFULL_ADD (drop city/state/zip suffix). */
export function streetFromCountyFull(full: string, houseNumber: string): string {
  let street = full.split(",")[0]?.trim() ?? full;
  const prefix = new RegExp(`^${houseNumber}\\s+`, "i");
  street = street.replace(prefix, "");
  return normalizeStreetLine(street);
}

export function householdStreetKey(addressLine: string): string {
  const hn = houseNumberOf(addressLine);
  const withoutHn = hn
    ? addressLine.replace(new RegExp(`^${hn}\\s+`, "i"), "")
    : addressLine;
  return normalizeStreetLine(withoutHn);
}

type ArcFeature = {
  attributes?: Record<string, unknown>;
  geometry?: { x?: number; y?: number };
};

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function sqlIn(values: string[], asNumber: boolean): string {
  if (asNumber) {
    return values
      .map((v) => {
        const n = Number(v);
        return Number.isFinite(n) ? String(n) : sqlLiteral(v);
      })
      .join(",");
  }
  return values.map(sqlLiteral).join(",");
}

export function parseCountyFeature(
  countyCode: CountyCode,
  feature: ArcFeature,
): CountyAddressPoint | null {
  const layer = COUNTY_LAYERS[countyCode];
  const attrs = feature.attributes ?? {};
  const lat = feature.geometry?.y;
  const lng = feature.geometry?.x;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  const houseNumber = String(attrs[layer.houseField] ?? "").trim();
  const full = String(attrs[layer.streetField] ?? "").trim();
  if (!houseNumber || !full) return null;

  const postalCode = String(attrs[layer.zipField] ?? "").trim().slice(0, 5);
  const unitRaw =
    (attrs[layer.unitField] as string | null | undefined) ??
    (attrs.UNITNUM as string | null | undefined) ??
    null;
  const cityField = layer.cityField
    ? String(attrs[layer.cityField] ?? attrs.CTYNAME ?? "").trim() || null
    : null;
  const ref = String(attrs[layer.idField] ?? "").trim() || null;
  if (!ref) return null;

  let streetLine = streetFromCountyFull(full, houseNumber);
  if (cityField) {
    const cityNorm = compress(cityField);
    if (streetLine === cityNorm) {
      streetLine = "";
    } else if (streetLine.endsWith(` ${cityNorm}`)) {
      streetLine = streetLine.slice(0, -(cityNorm.length + 1)).trim();
    }
  }

  return {
    ref,
    houseNumber: houseNumber.toUpperCase(),
    streetLine,
    postalCode,
    unit: normalizeUnit(unitRaw),
    city: cityField ? compress(cityField) : null,
    lat: lat as number,
    lng: lng as number,
  };
}

export async function queryCountyCandidates(
  countyCode: CountyCode,
  postalCode: string,
  houseNumbers: string[],
  options: { fetchImpl?: typeof fetch } = {},
): Promise<CountyAddressPoint[]> {
  if (!houseNumbers.length) return [];
  const layer = COUNTY_LAYERS[countyCode];
  const fetchImpl = options.fetchImpl ?? fetch;
  const uniqueHouses = [...new Set(houseNumbers.filter(Boolean))];
  const out: CountyAddressPoint[] = [];

  for (let i = 0; i < uniqueHouses.length; i += 40) {
    const chunk = uniqueHouses.slice(i, i + 40);
    const where = `${layer.zipField}=${sqlLiteral(postalCode)} AND ${layer.houseField} IN (${sqlIn(chunk, layer.houseAsNumber)})`;
    const body = new URLSearchParams({
      f: "json",
      where,
      outFields: layer.outFields,
      returnGeometry: "true",
      outSR: "4326",
      resultRecordCount: "2000",
    });

    let attempt = 0;
    for (;;) {
      try {
        const response = await fetchImpl(layer.url, { method: "POST", body });
        if (!response.ok) {
          throw new Error(`County ${countyCode} geocoder HTTP ${response.status}`);
        }
        const json = (await response.json()) as { features?: ArcFeature[] };
        for (const feature of json.features ?? []) {
          const parsed = parseCountyFeature(countyCode, feature);
          if (parsed) out.push(parsed);
        }
        break;
      } catch (err) {
        attempt += 1;
        if (attempt >= 4) throw err;
        await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      }
    }
  }

  return out;
}

function streetMatches(a: string, b: string): boolean {
  if (a === b) return true;
  // Recovery: allow containment when abbreviations differ slightly.
  if (a.length >= 4 && b.length >= 4 && (a.includes(b) || b.includes(a))) {
    return true;
  }
  return false;
}

export function matchHouseholdToCountyPoints(
  household: CountyHouseholdInput,
  candidates: CountyAddressPoint[],
): CountyGeocodeResult {
  const hn = houseNumberOf(household.addressLine);
  if (!hn) {
    return { id: household.id, status: "unmatched", lat: null, lng: null, ref: null };
  }

  const wantStreet = householdStreetKey(household.addressLine);
  const wantUnit = normalizeUnit(household.unit);
  const wantZip = household.postalCode.slice(0, 5);
  const wantCity = compress(household.city);

  const sameDoor = candidates.filter(
    (c) => c.houseNumber === hn && c.postalCode === wantZip,
  );

  const exactStreet = sameDoor.filter((c) => c.streetLine === wantStreet);
  const recoveryStreet = exactStreet.length
    ? exactStreet
    : sameDoor.filter((c) => streetMatches(c.streetLine, wantStreet));

  // Prefer city agreement when available, but don't require it (postal cities vary).
  const cityPreferred = recoveryStreet.filter(
    (c) => !c.city || c.city === wantCity,
  );
  const pool = cityPreferred.length ? cityPreferred : recoveryStreet;

  if (!pool.length) {
    return { id: household.id, status: "unmatched", lat: null, lng: null, ref: null };
  }

  let chosen = pool;
  if (wantUnit) {
    const unitHits = pool.filter((c) => c.unit === wantUnit);
    if (unitHits.length === 1) {
      const hit = unitHits[0];
      return {
        id: household.id,
        status: "matched",
        lat: hit.lat,
        lng: hit.lng,
        ref: hit.ref,
      };
    }
    if (unitHits.length > 1) {
      return { id: household.id, status: "ambiguous", lat: null, lng: null, ref: null };
    }
    // Unit-bearing household with only unitless county points: ambiguous if many,
    // unmatched if none with matching unit.
    const unitless = pool.filter((c) => !c.unit);
    if (unitless.length === 1 && pool.length === 1) {
      chosen = unitless;
    } else {
      return { id: household.id, status: "unmatched", lat: null, lng: null, ref: null };
    }
  } else {
    const unitless = pool.filter((c) => !c.unit);
    if (unitless.length === 1) {
      chosen = unitless;
    } else if (unitless.length > 1) {
      // Distinct refs at same street without units → ambiguous.
      const refs = new Set(unitless.map((c) => `${c.lat},${c.lng}`));
      if (refs.size > 1) {
        return { id: household.id, status: "ambiguous", lat: null, lng: null, ref: null };
      }
      chosen = [unitless[0]];
    } else if (pool.length === 1) {
      chosen = pool;
    } else {
      return { id: household.id, status: "ambiguous", lat: null, lng: null, ref: null };
    }
  }

  if (chosen.length !== 1) {
    return { id: household.id, status: "ambiguous", lat: null, lng: null, ref: null };
  }

  const hit = chosen[0];
  return {
    id: household.id,
    status: "matched",
    lat: hit.lat,
    lng: hit.lng,
    ref: hit.ref,
  };
}

/** Normalize a county feature into the same household key shape as VRDB rebuild. */
export function countyPointNormalizedKey(point: {
  streetLine: string;
  houseNumber: string;
  city: string;
  state?: string;
  postalCode: string;
  unit: string | null;
}): string {
  return normalizeHouseholdAddress({
    registrationAddress: `${point.houseNumber} ${point.streetLine}${
      point.unit ? ` UNIT ${point.unit}` : ""
    }`,
    city: point.city,
    state: point.state ?? "WA",
    postalCode: point.postalCode,
  }).normalizedKey;
}

export async function geocodeCountyBatch(
  households: CountyHouseholdInput[],
  options: { fetchImpl?: typeof fetch } = {},
): Promise<CountyGeocodeResult[]> {
  const results: CountyGeocodeResult[] = [];
  const byCountyZip = new Map<string, CountyHouseholdInput[]>();
  for (const h of households) {
    const key = `${h.countyCode}|${h.postalCode.slice(0, 5)}`;
    const list = byCountyZip.get(key) ?? [];
    list.push(h);
    byCountyZip.set(key, list);
  }

  for (const [key, group] of byCountyZip) {
    const [countyCode, zip] = key.split("|") as [CountyCode, string];
    const houseNumbers = group
      .map((h) => houseNumberOf(h.addressLine))
      .filter((n): n is string => Boolean(n));
    const candidates = await queryCountyCandidates(
      countyCode,
      zip,
      houseNumbers,
      options,
    );
    for (const household of group) {
      results.push(matchHouseholdToCountyPoints(household, candidates));
    }
  }

  return results;
}

export function isCountyCode(value: string | null | undefined): value is CountyCode {
  return value === "KI" || value === "SN";
}
