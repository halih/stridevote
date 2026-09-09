import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { normalizePhone } from "@/lib/phone";

describe("phone normalization", () => {
  it("canonicalizes formatted US numbers for OTP challenge lookup", () => {
    assert.equal(normalizePhone("(206) 555-0134"), "+12065550134");
    assert.equal(normalizePhone("1-206-555-0134"), "+12065550134");
    assert.equal(normalizePhone("+1 206 555 0134"), "+12065550134");
  });

  it("rejects unusable destinations", () => {
    assert.equal(normalizePhone(""), null);
    assert.equal(normalizePhone("555"), null);
  });
});
