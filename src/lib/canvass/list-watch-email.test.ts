import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { listAvailableEmailContent } from "./list-watch-email";

describe("list availability email", () => {
  it("includes the list, wave, and canvass link", () => {
    const content = listAvailableEmailContent(
      "North End",
      "November GOTV",
      "https://stride.vote/canvass",
    );

    assert.equal(content.subject, "North End is available");
    assert.match(content.text, /North End is available again in November GOTV/);
    assert.match(content.html, /https:\/\/stride\.vote\/canvass/);
  });

  it("escapes user-controlled names in HTML", () => {
    const content = listAvailableEmailContent(
      "<North & South>",
      '"Primary"',
      "https://stride.vote/canvass?a=1&b=2",
    );

    assert.doesNotMatch(content.html, /<North & South>/);
    assert.match(content.html, /&lt;North &amp; South&gt;/);
    assert.match(content.html, /&quot;Primary&quot;/);
    assert.match(content.html, /a=1&amp;b=2/);
  });
});
