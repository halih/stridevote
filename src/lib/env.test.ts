import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  EXAMPLE_AUTH_SECRET,
  productionAuthSecretRejected,
} from "@/lib/env";

describe("production AUTH_SECRET", () => {
  it("allows the example secret only outside production", () => {
    assert.equal(productionAuthSecretRejected(EXAMPLE_AUTH_SECRET, "development"), false);
    assert.equal(productionAuthSecretRejected("a-real-secret", "production"), false);
  });

  it("rejects a missing or example secret in production", () => {
    assert.equal(productionAuthSecretRejected("", "production"), true);
    assert.equal(productionAuthSecretRejected(undefined, "production"), true);
    assert.equal(productionAuthSecretRejected(EXAMPLE_AUTH_SECRET, "production"), true);
    assert.equal(productionAuthSecretRejected("dev", "production"), true);
  });
});
