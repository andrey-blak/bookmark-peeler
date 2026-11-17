import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createSelfWrites } from "../../src/background/self-writes.js";

describe("createSelfWrites", () => {
  test("a change the add-on made itself is recognised once", () => {
    const writes = createSelfWrites();
    writes.add("b1", "https://example.org/?a=1");
    assert.equal(writes.consume("b1", "https://example.org/?a=1"), true);
    assert.equal(writes.consume("b1", "https://example.org/?a=1"), false);
  });

  test("a change nobody recorded is not ours", () => {
    assert.equal(createSelfWrites().consume("b1", "https://example.org/"), false);
  });

  test("a different address for the same bookmark is not ours, and clears the record", () => {
    const writes = createSelfWrites();
    writes.add("b1", "https://example.org/?a=1");
    assert.equal(writes.consume("b1", "https://example.org/?other"), false);
    assert.equal(writes.consume("b1", "https://example.org/?a=1"), false);
  });

  test("bookmarks are independent", () => {
    const writes = createSelfWrites();
    writes.add("b1", "https://example.org/1");
    writes.add("b2", "https://example.org/2");
    assert.equal(writes.consume("b2", "https://example.org/2"), true);
    assert.equal(writes.consume("b1", "https://example.org/1"), true);
  });

  test("only the latest write of a bookmark counts", () => {
    const writes = createSelfWrites();
    writes.add("b1", "https://example.org/first");
    writes.add("b1", "https://example.org/second");
    assert.equal(writes.consume("b1", "https://example.org/first"), false);
    writes.add("b1", "https://example.org/second");
    assert.equal(writes.consume("b1", "https://example.org/second"), true);
  });

  test("a record expires after the time to live", () => {
    let time = 1000;
    const writes = createSelfWrites({ ttlMs: 500, now: () => time });
    writes.add("b1", "https://example.org/");
    time += 501;
    assert.equal(writes.consume("b1", "https://example.org/"), false);
  });

  test("a record is still good just inside the time to live", () => {
    let time = 1000;
    const writes = createSelfWrites({ ttlMs: 500, now: () => time });
    writes.add("b1", "https://example.org/");
    time += 500;
    assert.equal(writes.consume("b1", "https://example.org/"), true);
  });
});
