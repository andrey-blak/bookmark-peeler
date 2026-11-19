import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { STRINGS } from "../../src/strings.js";
import { t } from "../../src/core/text.js";

const SRC = new URL("../../src/", import.meta.url).pathname;

function sources(dir) {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.(js|html)$/.test(name) && path !== join(SRC, "strings.js") ? [path] : [];
  });
}

const code = sources(SRC).map(path => readFileSync(path, "utf8")).join("\n");

const placeholders = text => new Set([...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]));
const forms = entry => (typeof entry === "string" ? [entry] : Object.values(entry));

describe("t", () => {
  test("fills in values and formats numbers", () => {
    assert.equal(t("rule.copy-name", { name: "A" }), "A copy");
    assert.equal(t("bookmarks", { count: 1234 }), "1,234 bookmarks");
  });

  test("picks the plural form by count", () => {
    assert.equal(t("bookmarks", { count: 1 }), "1 bookmark");
    assert.equal(t("bookmarks", { count: 0 }), "0 bookmarks");
    assert.equal(t("bookmarks", { count: 2 }), "2 bookmarks");
  });

  test("an unknown key is returned as it is, and a missing value leaves its placeholder", () => {
    assert.equal(t("no.such.key"), "no.such.key");
    assert.equal(t("rule.copy-name"), "{name} copy");
  });
});

describe("strings.js", () => {
  test("a plural has the form other, and only forms of English", () => {
    for (const [key, entry] of Object.entries(STRINGS)) {
      if (typeof entry === "string") continue;
      assert.ok(typeof entry.other === "string", `${key} has no "other"`);
      assert.deepEqual(Object.keys(entry).filter(form => !["one", "other"].includes(form)), [], key);
    }
  });

  test("every form of a text has the same values to fill in", () => {
    for (const [key, entry] of Object.entries(STRINGS)) {
      const [first, ...rest] = forms(entry).map(placeholders);
      for (const other of rest) {
        const missing = [...first].filter(name => !other.has(name) && name !== "count");
        const extra = [...other].filter(name => !first.has(name) && name !== "count");
        assert.deepEqual([missing, extra], [[], []], key);
      }
    }
  });

  test("every key the code asks for exists", () => {
    const asked = new Set();
    for (const match of code.matchAll(/\bt\(\s*(?:[^"'`()]*\?\s*)?"([^"]+)"(?:\s*:\s*"([^"]+)")?/g)) {
      asked.add(match[1]);
      if (match[2]) asked.add(match[2]);
    }
    for (const match of code.matchAll(/data-(?:text|title|aria-label)="([^"]+)"/g)) asked.add(match[1]);

    assert.ok(asked.size > 100);
    assert.deepEqual([...asked].filter(key => !(key in STRINGS)), []);
  });

  test("every key is used by the code", () => {
    const unused = Object.keys(STRINGS).filter(key => !code.includes(`"${key}"`));
    assert.deepEqual(unused, []);
  });
});
