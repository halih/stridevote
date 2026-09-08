import { test } from "node:test";
import assert from "node:assert/strict";
import { imraanAdapter } from "./adapters/imraan";
import { getMinivanAdapter, requireMinivanAdapter } from "./adapters/index";
import {
  doorToPortableStatus,
  minivanClientAttemptId,
  pullDoorToPersonOutcome,
  pullDispositionToDoor,
  pushDoorToStatusLabel,
} from "./map-canvass";
import { extractStreetNo, matchKey, matchMinivanPeople } from "./match";

test("imraan adapter maps ResultIDs to door outcomes", () => {
  assert.equal(pullDispositionToDoor(imraanAdapter, 14), "contact");
  assert.equal(pullDispositionToDoor(imraanAdapter, 1), "no_answer");
  assert.equal(pullDispositionToDoor(imraanAdapter, 21), "lit");
  assert.equal(pullDispositionToDoor(imraanAdapter, 4), null);
});

test("MiniVAN contacts count one reached voter per VanID", () => {
  assert.equal(pullDoorToPersonOutcome("contact"), "talked");
  assert.equal(pullDoorToPersonOutcome("no_answer"), null);
  assert.equal(pullDoorToPersonOutcome("lit"), null);
});

test("imraan adapter maps status labels when ResultID unknown", () => {
  assert.equal(pullDispositionToDoor(imraanAdapter, 999, "Lit Dropped"), "lit");
  assert.equal(pullDispositionToDoor(imraanAdapter, null, "Not Home"), "no_answer");
});

test("push door labels round-trip for imraan", () => {
  assert.equal(pushDoorToStatusLabel(imraanAdapter, "contact"), "Canvassed");
  assert.equal(pushDoorToStatusLabel(imraanAdapter, "lit"), "Lit Dropped");
  assert.equal(doorToPortableStatus("lit"), "lit-dropped");
  assert.equal(doorToPortableStatus("no_answer"), "not-home");
});

test("adapter registry", () => {
  assert.equal(getMinivanAdapter("imraan")?.key, "imraan");
  assert.equal(getMinivanAdapter("missing"), null);
  assert.throws(() => requireMinivanAdapter(null));
});

test("match by last + house + zip with first-name disambiguation", () => {
  const voters = [
    { id: "v1", firstName: "Cheryl", lastName: "Bortz", streetNo: "766", postalCode: "98133" },
    { id: "v2", firstName: "Charles", lastName: "Bortz", streetNo: "766", postalCode: "98133" },
  ];
  const { mapping, stats } = matchMinivanPeople(
    [
      { vanId: 1, firstName: "Cheryl", lastName: "Bortz", streetNo: "766", zip5: "98133" },
      { vanId: 2, firstName: "C", lastName: "Bortz", streetNo: "766", zip5: "98133" },
      { vanId: 3, firstName: "Nobody", lastName: "Else", streetNo: "1", zip5: "00000" },
    ],
    voters,
  );
  assert.equal(mapping.get(1), "v1");
  assert.equal(stats.matched, 1);
  assert.equal(stats.ambiguous, 1); // initial C matches both Cheryl and Charles
  assert.equal(stats.no_match, 1);
});

test("extractStreetNo and matchKey", () => {
  assert.equal(extractStreetNo("766 N 161st Pl"), "766");
  assert.equal(matchKey("Bortz", "766", "98133-5671"), "BORTZ|766|98133");
});

test("minivanClientAttemptId is stable", () => {
  assert.equal(
    minivanClientAttemptId("list1", 2086019, "2026-07-05 08:58:03"),
    "minivan:list1:2086019:2026-07-05T08:58:03",
  );
});
