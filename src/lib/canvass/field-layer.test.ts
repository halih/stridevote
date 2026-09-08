import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clearsHouseholdAccess } from "@/lib/canvass/field-layer";

describe("field layer access writeback", () => {
  it("clears access when the door was physically reached", () => {
    assert.equal(clearsHouseholdAccess("contact"), true);
    assert.equal(clearsHouseholdAccess("no_answer"), true);
    assert.equal(clearsHouseholdAccess("refused"), true);
  });

  it("does not clear access for blocked or unrelated outcomes", () => {
    assert.equal(clearsHouseholdAccess("inaccessible"), false);
    assert.equal(clearsHouseholdAccess("unsafe"), false);
    assert.equal(clearsHouseholdAccess("moved"), false);
  });
});
