import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  precinctsFromFeatures,
  precinctsFromStored,
  simplifyGeoJsonGeometry,
  type StoredPrecinct,
} from "./precinct-geometry";

const district: [number, number][] = [
  [47.7, -122.4],
  [47.7, -122.3],
  [47.8, -122.3],
  [47.8, -122.4],
];

describe("precinct overlay filtering", () => {
  it("keeps precincts inside the district and marks them selectable", () => {
    const overlays = precinctsFromFeatures(
      [
        {
          type: "Feature",
          properties: { GEOID: "in", BASENAME: "SEA 32-1234", NAME: "SEA 32-1234 Voting District" },
          geometry: {
            type: "Polygon",
            coordinates: [[
              [-122.38, 47.72],
              [-122.36, 47.72],
              [-122.36, 47.74],
              [-122.38, 47.74],
              [-122.38, 47.72],
            ]],
          },
        },
        {
          type: "Feature",
          properties: { GEOID: "out", BASENAME: "Outside", NAME: "Outside Voting District" },
          geometry: {
            type: "Polygon",
            coordinates: [[
              [-122.2, 47.5],
              [-122.1, 47.5],
              [-122.1, 47.51],
              [-122.2, 47.51],
              [-122.2, 47.5],
            ]],
          },
        },
      ],
      district,
    );
    assert.equal(overlays.length, 1);
    assert.equal(overlays[0].name, "SEA 32-1234");
    assert.equal(overlays[0].selectable, true);
    assert.ok(overlays[0].boundary.length >= 3);
  });
});

const storedPrecinct = (
  code: string,
  ring: number[][],
): StoredPrecinct => ({
  countyCode: "KI",
  code,
  name: `Precinct ${code}`,
  boundary: ring.map(([lng, lat]) => [lat, lng] as [number, number]),
  geometry: { type: "Polygon", coordinates: [ring] },
});

describe("stored precinct overlays", () => {
  it("carries the voter-file code so turfs can be cut without geocoding", () => {
    const overlays = precinctsFromStored(
      [
        storedPrecinct("0001", [
          [-122.38, 47.72],
          [-122.36, 47.72],
          [-122.36, 47.74],
          [-122.38, 47.74],
          [-122.38, 47.72],
        ]),
      ],
      district,
    );
    assert.equal(overlays.length, 1);
    assert.equal(overlays[0].countyCode, "KI");
    assert.equal(overlays[0].code, "0001");
    assert.equal(overlays[0].id, "KI-0001");
    assert.equal(overlays[0].selectable, true);
  });

  it("drops precincts that fall outside the district", () => {
    const overlays = precinctsFromStored(
      [
        storedPrecinct("0002", [
          [-122.2, 47.5],
          [-122.1, 47.5],
          [-122.1, 47.51],
          [-122.2, 47.51],
          [-122.2, 47.5],
        ]),
      ],
      district,
    );
    assert.equal(overlays.length, 0);
  });
});

describe("precinct geometry for storage", () => {
  it("returns a bounding box that encloses the polygon", () => {
    const simplified = simplifyGeoJsonGeometry({
      type: "Polygon",
      coordinates: [[
        [-122.38, 47.72],
        [-122.36, 47.72],
        [-122.36, 47.74],
        [-122.38, 47.74],
        [-122.38, 47.72],
      ]],
    });
    assert.ok(simplified);
    assert.equal(simplified.bbox.minLat, 47.72);
    assert.equal(simplified.bbox.maxLat, 47.74);
    assert.equal(simplified.bbox.minLng, -122.38);
    assert.equal(simplified.bbox.maxLng, -122.36);
    assert.ok(simplified.centroid);
  });

  it("rejects geometry that is not a polygon", () => {
    assert.equal(
      simplifyGeoJsonGeometry({ type: "Point", coordinates: [-122.3, 47.6] }),
      null,
    );
  });
});
