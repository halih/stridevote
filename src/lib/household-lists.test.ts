import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildVoterWhere,
  filtersAreActive,
  sanitizeVoterFilters,
} from "./voter-filters";
import { normalizeHouseholdAddress } from "./household-address";
import {
  buildCensusBatchCsv,
  censusStatusFromMatch,
  parseCensusBatchResponse,
} from "./geocode-census";
import {
  canPersistMapboxCoords,
  geocodeMapboxForwardBatch,
  resultFromMapboxFeature,
} from "./geocode-mapbox";
import {
  packetForOfflineCache,
  persistableDoorCoords,
  resolveDoorCoords,
} from "./canvass/door-coords";
import { pointInPolygon } from "./geo";

describe("voter filter serialization", () => {
  it("drops blank values and never keeps page", () => {
    const cleaned = sanitizeVoterFilters({
      query: "  sofie ",
      page: "3",
      precinct: "",
      likelyPrimary: "1",
    });
    assert.deepEqual(cleaned, { query: "sofie", likelyPrimary: "1" });
    assert.equal(filtersAreActive({}), false);
    assert.equal(filtersAreActive(cleaned), true);
  });

  it("ORs audience filters and scopes to campaign", () => {
    const { where, filtered } = buildVoterWhere("camp-1", {
      likelyPrimary: "1",
      likelyGeneral: "1",
      newVoter: "1",
    });
    assert.equal(filtered, true);
    const and = where.AND as unknown[];
    assert.ok(and.some((clause) => JSON.stringify(clause).includes("camp-1")));
    assert.ok(
      and.some(
        (clause) =>
          typeof clause === "object" &&
          clause !== null &&
          "OR" in clause &&
          Array.isArray((clause as { OR: unknown[] }).OR) &&
          (clause as { OR: unknown[] }).OR.length === 3,
      ),
    );
  });

  it("excludes apartment residences as an AND, not an audience OR", () => {
    const { where, filtered } = buildVoterWhere("camp-1", {
      noApartments: "1",
      likelyPrimary: "1",
    });
    assert.equal(filtered, true);
    const and = where.AND as unknown[];
    assert.ok(and.some((clause) => JSON.stringify(clause).includes('"NOT"')));
    assert.ok(and.some((clause) => JSON.stringify(clause).includes("unit")));
  });

  it("scopes named precinct filters by county and code", () => {
    const { where } = buildVoterWhere("camp-1", { precinct: "KI:0001" });
    const serialized = JSON.stringify(where);
    assert.ok(serialized.includes('"countyCode":"KI"'));
    assert.ok(serialized.includes('"precinctCode":"0001"'));
  });

  it("excludes Republicans from talk score 0 or observed 0 when talk is missing", () => {
    const { where } = buildVoterWhere("camp-1", { excludeRepublicans: "1" });
    const serialized = JSON.stringify(where);
    assert.ok(serialized.includes('"talkScore":{"gt":0}'));
    assert.ok(serialized.includes('"observedScore":0'));
    assert.equal(serialized.includes("scoreMin"), false);
  });

  it("keeps unscored voters when excluding Republicans", () => {
    const { where } = buildVoterWhere("camp-1", { excludeRepublicans: "1" });
    const serialized = JSON.stringify(where);
    // A SQL `NOT (talkScore = 0)` drops NULL rows, so the clause must be
    // expressed as positive matches that include unscored voters.
    assert.equal(serialized.includes('"NOT"'), false);
    assert.ok(serialized.includes('"talkScore":null'));
    assert.ok(serialized.includes('"none"'));
  });

  it("excludes inaccessible from this campaign or the master field layer", () => {
    const { where } = buildVoterWhere(
      "camp-1",
      { excludeInaccessible: "1" },
      new Date(),
      {
        canvassedHouseholdIds: [],
        inaccessibleHouseholdIds: ["hh-1"],
        unsafeHouseholdIds: [],
      },
    );
    const serialized = JSON.stringify(where);
    assert.ok(serialized.includes('"accessStatus":"inaccessible"'));
    assert.ok(serialized.includes("hh-1"));
  });
});

describe("address / unit normalization", () => {
  it("collapses street casing and abbreviations", () => {
    const a = normalizeHouseholdAddress({
      registrationAddress: "123 North Main Street",
      city: "Seattle",
      state: "wa",
      postalCode: "98133-1234",
    });
    const b = normalizeHouseholdAddress({
      registrationAddress: "123 N MAIN ST",
      city: "SEATTLE",
      state: "WA",
      postalCode: "98133",
    });
    assert.equal(a.normalizedKey, b.normalizedKey);
    assert.equal(a.unit, null);
  });

  it("keeps separate units as separate doors", () => {
    const apt1 = normalizeHouseholdAddress({
      registrationAddress: "500 Pine St Apt 1",
      city: "Seattle",
      state: "WA",
      postalCode: "98101",
    });
    const apt2 = normalizeHouseholdAddress({
      registrationAddress: "500 Pine Street Unit 2",
      city: "Seattle",
      state: "WA",
      postalCode: "98101",
    });
    assert.notEqual(apt1.normalizedKey, apt2.normalizedKey);
    assert.equal(apt1.unit, "1");
    assert.equal(apt2.unit, "2");
  });
});

describe("census batch parsing", () => {
  it("builds csv and parses match coords", () => {
    const csv = buildCensusBatchCsv([
      {
        id: "h1",
        street: "1600 Pennsylvania Ave NW",
        city: "Washington",
        state: "DC",
        zip: "20500",
      },
    ]);
    assert.match(csv, /^h1,/);

    // The live API puts the indicator (Match / No_Match / Tie) in column 3 and
    // the quality (Exact / Non_Exact) in column 4.
    const parsed = parseCensusBatchResponse(
      [
        'h1,"1600 Pennsylvania Ave NW, Washington, DC, 20500",Match,Exact,"1600 PENNSYLVANIA AVE NW, WASHINGTON, DC, 20500","-77.0365,38.8977",123,L',
        'h2,"9 Nowhere Rd, Washington, DC, 20500",No_Match',
        'h3,"1 Main St, Washington, DC, 20500",Tie',
      ].join("\n"),
    );
    assert.equal(parsed[0]?.match, "Exact");
    assert.equal(parsed[0]?.lat, 38.8977);
    assert.equal(parsed[0]?.lng, -77.0365);
    assert.equal(parsed[1]?.match, "No_Match");
    assert.equal(parsed[2]?.match, "Tie");
    assert.equal(censusStatusFromMatch(parsed[0]!.match), "matched");
    assert.equal(censusStatusFromMatch("Non_Exact"), "matched");
    assert.equal(censusStatusFromMatch("Tie"), "ambiguous");
    assert.equal(censusStatusFromMatch("No_Match"), "unmatched");
  });
});

describe("mapbox storage terms", () => {
  it("never persists Mapbox results (permanent geocoding disabled)", () => {
    assert.equal(canPersistMapboxCoords(), false);
  });

  it("uses persistent lat/lng and only overlays session when missing", () => {
    const census = resolveDoorCoords({
      lat: 47.6,
      lng: -122.3,
      geocodeSource: "census",
      session: { lat: 47.61, lng: -122.33 },
    });
    assert.equal(census.coordSource, "census");
    assert.equal(census.lat, 47.6);

    const county = resolveDoorCoords({
      lat: 47.7,
      lng: -122.4,
      geocodeSource: "county",
      session: { lat: 1, lng: 2 },
    });
    assert.equal(county.coordSource, "county");
    assert.equal(county.lat, 47.7);

    const session = resolveDoorCoords({
      lat: null,
      lng: null,
      geocodeSource: null,
      session: { lat: 47.61, lng: -122.33 },
    });
    assert.equal(session.coordSource, "session-mapbox");
    assert.equal(session.lat, 47.61);
    assert.equal(session.stableLat, null);
  });

  it("strips session Mapbox coords before durable cache", () => {
    const door = persistableDoorCoords(
      resolveDoorCoords({
        lat: null,
        lng: null,
        session: { lat: 47.61, lng: -122.33 },
      }),
    );
    assert.equal(door.coordSource, "none");
    assert.equal(door.lat, null);
    const packet = packetForOfflineCache({
      doors: [
        resolveDoorCoords({
          lat: 47.6,
          lng: -122.3,
          geocodeSource: "census",
        }),
      ],
    });
    assert.equal(packet.doors[0]?.coordSource, "census");
  });

  it("parses a Mapbox feature and batch response", async () => {
    const parsed = resultFromMapboxFeature({
      geometry: { coordinates: [-122.33, 47.61] },
      properties: { full_address: "1 Main St" },
      relevance: 0.9,
    });
    assert.equal(parsed?.lat, 47.61);

    let requested: string | undefined;
    const fetchImpl: typeof fetch = async (input) => {
      requested = String(input);
      return new Response(
        JSON.stringify({
          batch: [
            {
              features: [
                { geometry: { coordinates: [-122.3, 47.6] }, properties: {} },
              ],
            },
            { features: [] },
          ],
        }),
        { status: 200 },
      );
    };
    const results = await geocodeMapboxForwardBatch(
      [
        { addressLine: "1 Main", city: "Seattle", state: "WA", postalCode: "98101" },
        { addressLine: "nope", city: "Seattle", state: "WA", postalCode: "98101" },
      ],
      { token: "pk.test", fetchImpl },
    );
    assert.match(requested ?? "", /permanent=false/);
    assert.equal(results[0]?.lat, 47.6);
    assert.equal(results[1], null);
  });
});

describe("polygon inclusion", () => {
  it("includes interior points and excludes exterior", () => {
    const square: [number, number][] = [
      [47.7, -122.4],
      [47.7, -122.3],
      [47.6, -122.3],
      [47.6, -122.4],
    ];
    assert.equal(pointInPolygon([47.65, -122.35], square), true);
    assert.equal(pointInPolygon([47.8, -122.35], square), false);
  });
});

describe("household expansion semantics", () => {
  it("documents that every household member is snapshotted when any seed matches", () => {
    // Pure helper: once a household is selected, all campaign voters at that
    // door are included even if they fail the seed filter. Precinct turfs
    // select that household set from registered precinct, not the whole campaign.
    const seedIds = new Set(["v1"]);
    const householdMembers = ["v1", "v2", "v3"];
    const snapshot = householdMembers.map((voterId) => ({
      voterId,
      matchedSeed: seedIds.has(voterId),
    }));
    assert.equal(snapshot.length, 3);
    assert.equal(snapshot.filter((row) => row.matchedSeed).length, 1);
  });
});
