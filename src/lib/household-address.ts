/**
 * Normalize Washington voter registration addresses into stable household keys.
 * Separate units stay separate doors; casing and common abbreviations collapse.
 */

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

const UNIT_TYPES = new Set([
  "APT",
  "APARTMENT",
  "UNIT",
  "STE",
  "SUITE",
  "#",
  "NO",
  "NUM",
  "RM",
  "ROOM",
  "FL",
  "FLOOR",
  "BLDG",
  "BUILDING",
]);

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

export interface NormalizedAddress {
  normalizedKey: string;
  displayAddress: string;
  addressLine: string;
  city: string;
  state: string;
  postalCode: string;
  unit: string | null;
}

function compress(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9#\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenize(value: string): string[] {
  return compress(value).split(" ").filter(Boolean);
}

function normalizeToken(token: string): string {
  if (DIRECTION[token]) return DIRECTION[token];
  if (STREET_ABBREV[token]) return STREET_ABBREV[token];
  if (UNIT_TYPES.has(token)) return token === "#" ? "#" : token === "APARTMENT" ? "APT" : token === "SUITE" ? "STE" : token === "BUILDING" ? "BLDG" : token === "ROOM" ? "RM" : token === "FLOOR" ? "FL" : token;
  return token;
}

function extractUnit(tokens: string[]): { street: string[]; unit: string | null } {
  const street: string[] = [];
  let unit: string | null = null;
  for (let i = 0; i < tokens.length; i++) {
    const token = normalizeToken(tokens[i]);
    if (UNIT_TYPES.has(token) || token.startsWith("#")) {
      const rest = tokens
        .slice(i + (token === "#" || UNIT_TYPES.has(token) ? 1 : 0))
        .map(normalizeToken)
        .join(" ")
        .replace(/^#\s*/, "");
      const number = token.startsWith("#") && token.length > 1 ? token.slice(1) : rest;
      unit = number ? number.replace(/\s+/g, "") : null;
      break;
    }
    street.push(token);
  }
  return { street, unit };
}

export function normalizeHouseholdAddress(input: {
  registrationAddress: string;
  city: string;
  state: string;
  postalCode: string;
}): NormalizedAddress {
  const tokens = tokenize(input.registrationAddress);
  const { street, unit } = extractUnit(tokens);
  const addressLine = street.join(" ") || compress(input.registrationAddress);
  const city = compress(input.city);
  const state = compress(input.state).slice(0, 2);
  const postalCode = compress(input.postalCode).slice(0, 5);
  const unitKey = unit ? `|U:${unit}` : "";
  const normalizedKey = `${addressLine}|${city}|${state}|${postalCode}${unitKey}`;
  const displayParts = [
    input.registrationAddress.trim(),
    `${input.city.trim()}, ${input.state.trim()} ${input.postalCode.trim()}`,
  ];
  return {
    normalizedKey,
    displayAddress: displayParts.join(", "),
    addressLine,
    city,
    state,
    postalCode,
    unit,
  };
}
