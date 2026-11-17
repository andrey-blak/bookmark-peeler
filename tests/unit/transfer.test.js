import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, validateRule } from "../../src/core/schema.js";
import { exportFile, parseImport, summarizeImport, mergeImport } from "../../src/options/transfer.js";

const rule = (id, extra = {}) => ({
  id,
  enabled: true,
  scope: { type: "all" },
  actions: [{ type: "remove", parameter: "a" }],
  ...extra,
});

const config = (rules, settings = { cleanOnEdit: false }) => normalizeConfig({ schemaVersion: 1, settings, rules });
const ids = rules => rules.map(r => r.id);

describe("exportFile", () => {
  test("is a JSON file with a fixed name", () => {
    const file = exportFile(config([rule("a")]));
    assert.equal(file.filename, "bookmark-peeler-rules.json");
    assert.equal(file.mime, "application/json");
  });

  test("holds the stored format: version, settings and rules", () => {
    const stored = config([rule("a"), rule("b")], { cleanOnEdit: true });
    assert.deepEqual(JSON.parse(exportFile(stored).text), stored);
  });

  test("is indented and ends with a newline", () => {
    const { text } = exportFile(config([rule("a")]));
    assert.match(text, /^\{\n  "schemaVersion": 1,/);
    assert.ok(text.endsWith("}\n"));
  });

  test("an empty list is still a valid file", () => {
    assert.deepEqual(JSON.parse(exportFile(config([])).text).rules, []);
  });
});

describe("parseImport", () => {
  test("reads back what exportFile wrote", () => {
    const stored = config([rule("a"), rule("b", { name: "B", enabled: false })], { cleanOnEdit: true });
    assert.deepEqual(parseImport(exportFile(stored).text), { ok: true, config: stored });
  });

  test("text that is not JSON", () => {
    for (const text of ["", "not json", "{ broken", "<html></html>"]) {
      assert.deepEqual(parseImport(text), { ok: false, reason: "not-json" }, text);
    }
  });

  test("JSON that is not a rules file", () => {
    for (const text of ["[]", "5", "null", '"text"', "{}", '{"rules": []}', '{"schemaVersion": 1}', '{"schemaVersion": 1, "rules": "no"}']) {
      assert.deepEqual(parseImport(text), { ok: false, reason: "not-config" }, text);
    }
  });

  test("a newer or invalid schema version is refused and the version is reported", () => {
    assert.deepEqual(parseImport('{"schemaVersion": 2, "rules": []}'), { ok: false, reason: "unsupported", version: 2 });
    assert.equal(parseImport('{"schemaVersion": "1", "rules": []}').reason, "unsupported");
    assert.equal(parseImport('{"schemaVersion": 0, "rules": []}').reason, "unsupported");
  });

  test("unknown fields are dropped and missing ids are filled in", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      extra: 1,
      rules: [{ scope: { type: "all" }, actions: [{ type: "remove", parameter: "a", extra: 1 }], extra: 1 }],
    });
    const { ok, config: parsed } = parseImport(text);
    assert.equal(ok, true);
    assert.equal("extra" in parsed, false);
    assert.equal("extra" in parsed.rules[0], false);
    assert.equal(typeof parsed.rules[0].id, "string");
    assert.deepEqual(parsed.settings, { cleanOnEdit: false });
  });

  test("rules with errors are kept so they can be fixed", () => {
    const text = JSON.stringify({ schemaVersion: 1, rules: [{ id: "bad", scope: { type: "host", host: "" }, actions: [] }] });
    const { config: parsed } = parseImport(text);
    assert.equal(parsed.rules.length, 1);
    assert.ok(validateRule(parsed.rules[0]).some(i => i.severity === "error"));
  });

  test("duplicate ids inside the file are made unique", () => {
    const text = JSON.stringify({ schemaVersion: 1, rules: [rule("same"), rule("same")] });
    const { config: parsed } = parseImport(text);
    assert.equal(new Set(ids(parsed.rules)).size, 2);
  });
});

describe("summarizeImport", () => {
  test("counts the rules, those with errors and those whose id already exists", () => {
    const imported = config([
      rule("a"),
      rule("b", { scope: { type: "host", host: "" } }),
      rule("c", { actions: [] }),
      rule("d"),
    ]);
    const existing = [rule("a"), rule("x")];
    assert.deepEqual(summarizeImport(imported, existing), { total: 4, withErrors: 1, clashes: 1 });
  });

  test("an empty file", () => {
    assert.deepEqual(summarizeImport(config([]), [rule("a")]), { total: 0, withErrors: 0, clashes: 0 });
  });
});

describe("mergeImport", () => {
  test("puts the imported rules after the existing ones", () => {
    const merged = mergeImport([rule("a"), rule("b")], config([rule("c"), rule("d")]).rules);
    assert.deepEqual(ids(merged), ["a", "b", "c", "d"]);
  });

  test("an imported rule with an id that already exists gets a new one, the rest stays the same", () => {
    const existing = [rule("a"), rule("b")];
    const imported = config([rule("b", { name: "imported" }), rule("c")]).rules;
    const merged = mergeImport(existing, imported);

    assert.equal(merged.length, 4);
    assert.equal(merged[1], existing[1]);
    assert.notEqual(merged[2].id, "b");
    assert.equal(merged[2].name, "imported");
    assert.equal(merged[3].id, "c");
    assert.equal(new Set(ids(merged)).size, 4);
  });

  test("importing the same rules twice gives all-different ids", () => {
    const once = mergeImport([], config([rule("a"), rule("b")]).rules);
    const twice = mergeImport(once, config([rule("a"), rule("b")]).rules);
    assert.equal(new Set(ids(twice)).size, 4);
  });

  test("does not modify its inputs", () => {
    const existing = [rule("a")];
    const imported = config([rule("a")]).rules;
    mergeImport(existing, imported);
    assert.deepEqual(ids(existing), ["a"]);
    assert.equal(imported[0].id, "a");
  });
});
