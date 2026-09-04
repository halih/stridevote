/** Shared US state codes and Census TIGER endpoints. */

export const CENSUS_USER_AGENT = "StrideVote/1.0 (campaign canvassing app)";

export const TIGER_LEGISLATIVE =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/Legislative/MapServer";

export const STATE_NAMES: Record<string, string> = {
  AL: "Alabama", AK: "Alaska", AZ: "Arizona", AR: "Arkansas", CA: "California",
  CO: "Colorado", CT: "Connecticut", DE: "Delaware", FL: "Florida", GA: "Georgia",
  HI: "Hawaii", ID: "Idaho", IL: "Illinois", IN: "Indiana", IA: "Iowa",
  KS: "Kansas", KY: "Kentucky", LA: "Louisiana", ME: "Maine", MD: "Maryland",
  MA: "Massachusetts", MI: "Michigan", MN: "Minnesota", MS: "Mississippi", MO: "Missouri",
  MT: "Montana", NE: "Nebraska", NV: "Nevada", NH: "New Hampshire", NJ: "New Jersey",
  NM: "New Mexico", NY: "New York", NC: "North Carolina", ND: "North Dakota", OH: "Ohio",
  OK: "Oklahoma", OR: "Oregon", PA: "Pennsylvania", RI: "Rhode Island", SC: "South Carolina",
  SD: "South Dakota", TN: "Tennessee", TX: "Texas", UT: "Utah", VT: "Vermont",
  VA: "Virginia", WA: "Washington", WV: "West Virginia", WI: "Wisconsin", WY: "Wyoming",
};

/** FIPS codes used by Census TIGER. */
export const STATE_FIPS: Record<string, string> = {
  AL: "01", AK: "02", AZ: "04", AR: "05", CA: "06", CO: "08", CT: "09", DE: "10",
  FL: "12", GA: "13", HI: "15", ID: "16", IL: "17", IN: "18", IA: "19", KS: "20",
  KY: "21", LA: "22", ME: "23", MD: "24", MA: "25", MI: "26", MN: "27", MS: "28",
  MO: "29", MT: "30", NE: "31", NV: "32", NH: "33", NJ: "34", NM: "35", NY: "36",
  NC: "37", ND: "38", OH: "39", OK: "40", OR: "41", PA: "42", RI: "44", SC: "45",
  SD: "46", TN: "47", TX: "48", UT: "49", VT: "50", VA: "51", WA: "53", WV: "54",
  WI: "55", WY: "56",
};

export function stateAbbrev(state: string | null | undefined): string | null {
  if (!state) return null;
  const key = state.trim().toUpperCase();
  if (STATE_FIPS[key]) return key;
  const entry = Object.entries(STATE_NAMES).find(
    ([, name]) => name.toLowerCase() === state.trim().toLowerCase(),
  );
  return entry ? entry[0] : null;
}

export function stateFips(state: string | null | undefined): string | null {
  const abbrev = stateAbbrev(state);
  return abbrev ? STATE_FIPS[abbrev] : null;
}

export function stateName(state: string): string {
  return STATE_NAMES[state.trim().toUpperCase()] ?? state.trim();
}
