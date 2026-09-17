import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { orderForStreetWalk, parseStreetAddress } from "./walk-order";

interface TestDoor {
  addressLine: string;
  city: string;
  unit: string | null;
  lat: number | null;
  lng: number | null;
}

const BASE_LAT = 47.6;
const BASE_LNG = -122.3;
/** ~44 m between houses on a block. */
const DOOR_STEP_LAT = 0.0004;
/** ~22 m across the road — closer than the next house, which is the trap. */
const STREET_STEP_LNG = 0.0003;

function door(
  addressLine: string,
  lat: number | null,
  lng: number | null,
  unit: string | null = null,
): TestDoor {
  return { addressLine, city: "SEATTLE", unit, lat, lng };
}

function walk(doors: TestDoor[], start?: { lat: number; lng: number }): string[] {
  return orderForStreetWalk(doors, {
    pointOf: (d) => (d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null),
    addressOf: (d) => ({ addressLine: d.addressLine, city: d.city, unit: d.unit }),
    start,
  }).map((d) => d.addressLine);
}

function streetOf(addressLine: string): string {
  return parseStreetAddress(addressLine).street;
}

/** How many times the walk leaves one street for another. */
function streetSwitches(lines: string[]): number {
  let switches = 0;
  for (let i = 1; i < lines.length; i++) {
    if (streetOf(lines[i]) !== streetOf(lines[i - 1])) switches += 1;
  }
  return switches;
}

function houseNumbers(lines: string[], street: string): number[] {
  return lines
    .filter((line) => streetOf(line) === street)
    .map((line) => parseStreetAddress(line).houseNumber ?? -1);
}

function isMonotone(values: number[]): boolean {
  const ascending = values.every((v, i) => i === 0 || v >= values[i - 1]);
  const descending = values.every((v, i) => i === 0 || v <= values[i - 1]);
  return ascending || descending;
}

describe("street address parsing", () => {
  it("splits the house number off the street name", () => {
    assert.deepEqual(parseStreetAddress("123 NE 45TH ST"), {
      street: "NE 45TH ST",
      houseNumber: 123,
    });
    assert.deepEqual(parseStreetAddress("1200 12TH AVE E"), {
      street: "12TH AVE E",
      houseNumber: 1200,
    });
  });

  it("keeps unnumbered lines whole so they still walk together", () => {
    assert.deepEqual(parseStreetAddress("PO BOX 12"), {
      street: "PO BOX 12",
      houseNumber: null,
    });
  });
});

describe("street-first walk order", () => {
  it("finishes one street before crossing to the next", () => {
    // Two parallel streets, closer to each other than houses are to their
    // neighbors: a nearest-door tour ping-pongs across the road here.
    const doors: TestDoor[] = [];
    for (let i = 0; i < 6; i++) {
      doors.push(door(`${100 + i * 2} MAIN ST`, BASE_LAT + i * DOOR_STEP_LAT, BASE_LNG));
      doors.push(
        door(
          `${100 + i * 2} PINE ST`,
          BASE_LAT + i * DOOR_STEP_LAT,
          BASE_LNG + STREET_STEP_LNG,
        ),
      );
    }

    const order = walk(doors);
    assert.equal(order.length, 12);
    assert.equal(streetSwitches(order), 1);
    assert.ok(isMonotone(houseNumbers(order, "MAIN ST")));
    assert.ok(isMonotone(houseNumbers(order, "PINE ST")));
  });

  it("enters each street at the end nearest the previous one", () => {
    const doors: TestDoor[] = [];
    for (let i = 0; i < 5; i++) {
      doors.push(door(`${100 + i * 2} MAIN ST`, BASE_LAT + i * DOOR_STEP_LAT, BASE_LNG));
      doors.push(
        door(
          `${100 + i * 2} PINE ST`,
          BASE_LAT + i * DOOR_STEP_LAT,
          BASE_LNG + STREET_STEP_LNG,
        ),
      );
    }

    // Starting at the north end of Main, the walk should run Main southbound
    // and pick Pine up at its south end rather than hiking back north.
    const order = walk(doors, { lat: BASE_LAT + 4 * DOOR_STEP_LAT, lng: BASE_LNG });
    assert.equal(streetOf(order[0]), "MAIN ST");
    assert.deepEqual(houseNumbers(order, "MAIN ST"), [108, 106, 104, 102, 100]);
    assert.deepEqual(houseNumbers(order, "PINE ST"), [100, 102, 104, 106, 108]);
  });

  it("covers both sides of a long block in a single pass", () => {
    const doors: TestDoor[] = [];
    for (let i = 0; i < 6; i++) {
      doors.push(door(`${101 + i * 2} MAIN ST`, BASE_LAT + i * 0.0008, BASE_LNG));
      doors.push(
        door(`${100 + i * 2} MAIN ST`, BASE_LAT + i * 0.0008, BASE_LNG + STREET_STEP_LNG),
      );
    }

    // One trip up the block taking both sides as they come — not one lap per
    // side, which would walk the street twice.
    const order = walk(doors, { lat: BASE_LAT, lng: BASE_LNG });
    assert.deepEqual(
      order.map((line) => parseStreetAddress(line).houseNumber),
      [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111],
    );
  });

  it("runs the house numbers on a short block", () => {
    const doors = [
      door("101 CEDAR CT", BASE_LAT, BASE_LNG),
      door("102 CEDAR CT", BASE_LAT, BASE_LNG + STREET_STEP_LNG),
      door("103 CEDAR CT", BASE_LAT + 0.0002, BASE_LNG),
      door("104 CEDAR CT", BASE_LAT + 0.0002, BASE_LNG + STREET_STEP_LNG),
    ];

    const order = walk(doors, { lat: BASE_LAT, lng: BASE_LNG });
    assert.deepEqual(order.map((line) => parseStreetAddress(line).houseNumber), [
      101, 102, 103, 104,
    ]);
  });

  it("breaks a repeated street name into blocks you can actually walk between", () => {
    const doors: TestDoor[] = [];
    for (let i = 0; i < 4; i++) {
      doors.push(door(`${100 + i * 2} OAK ST`, BASE_LAT + i * DOOR_STEP_LAT, BASE_LNG));
      // Same name, a mile north — a separate block, not the tail of the first.
      doors.push(
        door(`${200 + i * 2} OAK ST`, BASE_LAT + 0.02 + i * DOOR_STEP_LAT, BASE_LNG),
      );
    }

    const order = walk(doors, { lat: BASE_LAT + 0.02, lng: BASE_LNG });
    const numbers = order.map((line) => parseStreetAddress(line).houseNumber!);
    assert.ok(
      numbers.slice(0, 4).every((n) => n >= 200),
      `expected the near block first, got ${numbers.join(", ")}`,
    );
    assert.ok(numbers.slice(4).every((n) => n < 200));
  });

  it("keeps a rural road together even though neighbors are far apart", () => {
    // Houses a third of a mile apart on each road, the roads a tenth of a mile
    // apart: a fixed block gap would cut every door into its own block and the
    // walk would alternate between the two roads.
    const doors: TestDoor[] = [];
    for (let i = 0; i < 5; i++) {
      doors.push(door(`${100 + i * 2} FARM RD`, BASE_LAT + i * 0.005, BASE_LNG));
      doors.push(door(`${100 + i * 2} RIVER RD`, BASE_LAT + i * 0.005, BASE_LNG + 0.002));
    }

    const order = walk(doors, { lat: BASE_LAT, lng: BASE_LNG });
    assert.equal(streetSwitches(order), 1);
    assert.ok(isMonotone(houseNumbers(order, "FARM RD")));
    assert.ok(isMonotone(houseNumbers(order, "RIVER RD")));
  });

  it("keeps ungeocoded doors with their own street", () => {
    const doors = [
      door("100 MAIN ST", BASE_LAT, BASE_LNG),
      door("104 MAIN ST", BASE_LAT + 2 * DOOR_STEP_LAT, BASE_LNG),
      door("102 MAIN ST", null, null),
      door("100 PINE ST", BASE_LAT, BASE_LNG + STREET_STEP_LNG),
    ];

    const order = walk(doors, { lat: BASE_LAT, lng: BASE_LNG });
    assert.equal(order.length, 4);
    assert.equal(streetSwitches(order), 1);
    // The door we couldn't geocode still walks in sequence on its own street.
    assert.deepEqual(houseNumbers(order, "MAIN ST"), [100, 102, 104]);
  });

  it("sends doors on a street with no coordinates at all to the end", () => {
    const doors = [
      door("100 BIRCH LN", null, null),
      door("100 MAIN ST", BASE_LAT, BASE_LNG),
      door("102 MAIN ST", BASE_LAT + DOOR_STEP_LAT, BASE_LNG),
    ];

    assert.deepEqual(walk(doors), ["100 MAIN ST", "102 MAIN ST", "100 BIRCH LN"]);
  });

  it("orders apartment units naturally within a door", () => {
    const doors = [
      door("500 PINE ST", BASE_LAT, BASE_LNG, "10"),
      door("500 PINE ST", BASE_LAT, BASE_LNG, "2"),
      door("500 PINE ST", BASE_LAT, BASE_LNG, "1"),
      door("600 PINE ST", BASE_LAT + DOOR_STEP_LAT, BASE_LNG, null),
    ];

    const ordered = orderForStreetWalk(doors, {
      pointOf: (d) => (d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null),
      addressOf: (d) => ({ addressLine: d.addressLine, city: d.city, unit: d.unit }),
      start: { lat: BASE_LAT, lng: BASE_LNG },
    });
    assert.deepEqual(
      ordered.map((d) => `${d.addressLine}${d.unit ? ` #${d.unit}` : ""}`),
      ["500 PINE ST #1", "500 PINE ST #2", "500 PINE ST #10", "600 PINE ST"],
    );
  });

  it("keeps one apartment building together when unit geocodes disagree", () => {
    const doors = [
      door("500 PINE ST", BASE_LAT, BASE_LNG, "1"),
      // Same building, but its imported pin is more than a mile away.
      door("500 PINE ST", BASE_LAT + 0.02, BASE_LNG, "2"),
      door("600 PINE ST", BASE_LAT + DOOR_STEP_LAT, BASE_LNG),
    ];

    const ordered = orderForStreetWalk(doors, {
      pointOf: (d) => (d.lat != null && d.lng != null ? { lat: d.lat, lng: d.lng } : null),
      addressOf: (d) => ({ addressLine: d.addressLine, city: d.city, unit: d.unit }),
      start: { lat: BASE_LAT, lng: BASE_LNG },
    });
    const apartmentPositions = ordered
      .map((d, index) => (d.addressLine === "500 PINE ST" ? index : -1))
      .filter((index) => index >= 0);
    assert.equal(apartmentPositions[1] - apartmentPositions[0], 1);
  });

  it("keeps the same street name in different cities apart", () => {
    const doors = [
      door("100 MAIN ST", BASE_LAT, BASE_LNG),
      { ...door("102 MAIN ST", BASE_LAT + DOOR_STEP_LAT, BASE_LNG), city: "BURIEN" },
      door("104 MAIN ST", BASE_LAT + 2 * DOOR_STEP_LAT, BASE_LNG),
    ];

    const order = walk(doors, { lat: BASE_LAT, lng: BASE_LNG });
    assert.equal(order.length, 3);
    assert.equal(order[2], "102 MAIN ST");
  });

  it("returns short inputs untouched", () => {
    assert.deepEqual(walk([]), []);
    assert.deepEqual(walk([door("1 MAIN ST", BASE_LAT, BASE_LNG)]), ["1 MAIN ST"]);
  });
});
