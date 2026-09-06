import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canReplaceGeocode,
  geocodeSourceRank,
  isHouseholdGeocoded,
  resolveHouseholdCoords,
} from "./household-coords";
import {
  houseNumberOf,
  householdStreetKey,
  matchHouseholdToCountyPoints,
  normalizeUnit,
  parseCountyFeature,
  streetFromCountyFull,
  type CountyHouseholdInput,
} from "./county-geocode";

describe("geocode source ranking", () => {
  it("lets county and mapbox replace census but not each other", () => {
    assert.equal(canReplaceGeocode(null, "census"), true);
    assert.equal(canReplaceGeocode(null, "county"), true);
    assert.equal(canReplaceGeocode("census", "county"), true);
    assert.equal(canReplaceGeocode("census", "mapbox"), true);
    assert.equal(canReplaceGeocode("county", "census"), false);
    assert.equal(canReplaceGeocode("mapbox", "census"), false);
    assert.equal(canReplaceGeocode("county", "mapbox"), false);
    assert.equal(canReplaceGeocode("mapbox", "county"), false);
    assert.equal(geocodeSourceRank("county"), geocodeSourceRank("mapbox"));
  });

  it("resolves a single persistent pin", () => {
    assert.equal(isHouseholdGeocoded({ lat: null, lng: null }), false);
    assert.deepEqual(
      resolveHouseholdCoords({
        lat: 47.7,
        lng: -122.3,
        geocodeSource: "county",
      }),
      { lat: 47.7, lng: -122.3, source: "county" },
    );
  });
});

describe("county address matching", () => {
  it("parses King geometry (not Lat/Lon attributes) and matches street+unit", () => {
    const point = parseCountyFeature("KI", {
      attributes: {
        SITEID: "site-1",
        ADDR_HN: "16505",
        ADDR_FULL: "16505 CARLYLE HALL RD N",
        ZIP5: "98133",
        Unit: null,
        POSTALCTYNAME: "SHORELINE",
      },
      geometry: { x: -122.35454434323381, y: 47.748856979677733 },
    });
    assert.ok(point);
    assert.equal(point!.streetLine, "CARLYLE HALL RD N");
    assert.equal(point!.lat, 47.748856979677733);

    const household: CountyHouseholdInput = {
      id: "h1",
      addressLine: "16505 CARLYLE HALL RD N",
      city: "SHORELINE",
      state: "WA",
      postalCode: "98133",
      unit: null,
      countyCode: "KI",
    };
    const hit = matchHouseholdToCountyPoints(household, [point!]);
    assert.equal(hit.status, "matched");
    assert.equal(hit.ref, "site-1");
  });

  it("parses Snohomish geometry and marks multi-candidate ties ambiguous", () => {
    const a = parseCountyFeature("SN", {
      attributes: {
        Site_NGUID: "a",
        Add_Number: 24000,
        LFULL_ADD: "24000 VAN RY BLVD MOUNTLAKE TERRACE, WA 98043",
        Post_Code: "98043",
        Unit: "",
        Post_Comm: "MOUNTLAKE TERRACE",
      },
      geometry: { x: -122.31556847933862, y: 47.780910803321035 },
    });
    const b = parseCountyFeature("SN", {
      attributes: {
        Site_NGUID: "b",
        Add_Number: 24000,
        LFULL_ADD: "24000 VAN RY BLVD MOUNTLAKE TERRACE, WA 98043",
        Post_Code: "98043",
        Unit: "",
        Post_Comm: "MOUNTLAKE TERRACE",
      },
      geometry: { x: -122.3157, y: 47.781 },
    });
    assert.ok(a && b);
    const household: CountyHouseholdInput = {
      id: "h2",
      addressLine: "24000 VAN RY BLVD",
      city: "MOUNTLAKE TERRACE",
      state: "WA",
      postalCode: "98043",
      unit: null,
      countyCode: "SN",
    };
    const hit = matchHouseholdToCountyPoints(household, [a!, b!]);
    assert.equal(hit.status, "ambiguous");
  });

  it("matches unit-bearing doors and normalizes helpers", () => {
    assert.equal(houseNumberOf("24015 VAN RY BLVD"), "24015");
    assert.equal(normalizeUnit("UNIT B"), "B");
    assert.equal(
      streetFromCountyFull("9321 244TH ST SW", "9321"),
      "244TH ST SW",
    );
    assert.equal(householdStreetKey("9321 244TH STREET SW"), "244TH ST SW");

    const point = parseCountyFeature("KI", {
      attributes: {
        SITEID: "u1",
        ADDR_HN: "500",
        ADDR_FULL: "500 PINE ST",
        ZIP5: "98101",
        Unit: "APT 2",
        POSTALCTYNAME: "SEATTLE",
      },
      geometry: { x: -122.33, y: 47.61 },
    });
    const hit = matchHouseholdToCountyPoints(
      {
        id: "h3",
        addressLine: "500 PINE ST",
        city: "SEATTLE",
        state: "WA",
        postalCode: "98101",
        unit: "2",
        countyCode: "KI",
      },
      [point!],
    );
    assert.equal(hit.status, "matched");
  });
});
