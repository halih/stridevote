import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  doorPinColor,
  DOOR_PIN_COLORS,
  isDoorOutcome,
  isDoneDoorOutcome,
  isTerminalDoorOutcome,
  PACKET_TTL_MS,
  programQuestionSchema,
} from "@/lib/canvass/outcomes";

describe("canvass outcomes", () => {
  it("recognizes door outcomes and done/terminal rules", () => {
    assert.equal(isDoorOutcome("contact"), true);
    assert.equal(isDoorOutcome("talked"), false);
    assert.equal(isDoneDoorOutcome("lit"), true);
    assert.equal(isDoneDoorOutcome("no_answer"), true);
    assert.equal(isDoneDoorOutcome("talked"), false);
    assert.equal(isTerminalDoorOutcome("contact"), true);
    assert.equal(isTerminalDoorOutcome("no_answer"), false);
    assert.equal(isTerminalDoorOutcome("lit"), false);
    assert.equal(isTerminalDoorOutcome("inaccessible"), true);
  });

  it("maps door outcomes to pin colors", () => {
    assert.equal(doorPinColor(null), DOOR_PIN_COLORS.remaining);
    assert.equal(doorPinColor("contact"), DOOR_PIN_COLORS.talked);
    assert.equal(doorPinColor("lit"), DOOR_PIN_COLORS.lit);
    assert.equal(doorPinColor("inaccessible"), DOOR_PIN_COLORS.other);
    assert.equal(doorPinColor("no_answer"), DOOR_PIN_COLORS.other);
    assert.equal(doorPinColor("moved"), DOOR_PIN_COLORS.other);
    assert.equal(doorPinColor(null, "#abc"), "#abc");
  });

  it("uses a 72-hour packet TTL", () => {
    assert.equal(PACKET_TTL_MS, 72 * 60 * 60 * 1000);
  });

  it("validates program questions", () => {
    const ok = programQuestionSchema.safeParse({
      id: "q1",
      type: "yes_no",
      label: "Willing to volunteer?",
    });
    assert.equal(ok.success, true);
    const bad = programQuestionSchema.safeParse({
      id: "q1",
      type: "branching",
      label: "Nope",
    });
    assert.equal(bad.success, false);
  });
});
