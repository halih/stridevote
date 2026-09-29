import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { displayIdentity, removingLastLoginIdentifier } from "@/lib/profile-identity";

describe("profile display identity", () => {
  it("builds a name and initials from first and last", () => {
    assert.deepEqual(displayIdentity("Ada", "Lovelace"), {
      name: "Ada Lovelace",
      initials: "AL",
    });
  });

  it("keeps a single name and its initial", () => {
    assert.deepEqual(displayIdentity("Ada", ""), {
      name: "Ada",
      initials: "A",
    });
  });

  it("clears name and initials when both names are blank", () => {
    assert.deepEqual(displayIdentity("  ", ""), { name: null, initials: null });
  });
});

describe("last login identifier", () => {
  it("refuses to drop the phone on a phone-only account", () => {
    assert.equal(
      removingLastLoginIdentifier({
        email: null,
        currentPhone: "+12065550134",
        nextPhone: null,
      }),
      true,
    );
  });

  it("allows clearing a phone when an email remains", () => {
    assert.equal(
      removingLastLoginIdentifier({
        email: "ada@example.com",
        currentPhone: "+12065550134",
        nextPhone: null,
      }),
      false,
    );
  });

  it("allows replacing the phone", () => {
    assert.equal(
      removingLastLoginIdentifier({
        email: null,
        currentPhone: "+12065550134",
        nextPhone: "+12065550199",
      }),
      false,
    );
  });
});
