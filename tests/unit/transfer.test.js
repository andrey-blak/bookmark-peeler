import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, validateRule } from "../../src/core/schema.js";
import { exportFile, parseImport, summarizeImport, applyImport, mergeImport } from "../../src/options/transfer.js";

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
  test("is a JSON file", () => {
    assert.equal(exportFile(config([rule("a")])).mime, "application/json");
  });

  test("holds the stored format by default: version, settings and rules", () => {
    const stored = config([rule("a"), rule("b")], { cleanOnEdit: true });
    assert.deepEqual(JSON.parse(exportFile(stored).text), stored);
    assert.equal(exportFile(stored).filename, "bookmark-peeler.json");
  });

  test("only the rules, or only the settings, when asked", () => {
    const stored = config([rule("a")], { cleanOnEdit: true });

    const rulesOnly = exportFile(stored, { rules: true, settings: false });
    assert.deepEqual(JSON.parse(rulesOnly.text), { schemaVersion: 1, rules: stored.rules });
    assert.equal(rulesOnly.filename, "bookmark-peeler-rules.json");

    const settingsOnly = exportFile(stored, { rules: false, settings: true });
    assert.deepEqual(JSON.parse(settingsOnly.text), { schemaVersion: 1, settings: stored.settings });
    assert.equal(settingsOnly.filename, "bookmark-peeler-settings.json");
  });

  test("a file with neither part is refused", () => {
    assert.throws(() => exportFile(config([]), { rules: false, settings: false }));
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
  test("reads back what exportFile wrote, with both parts", () => {
    const stored = config([rule("a"), rule("b", { name: "B", enabled: false })], { cleanOnEdit: true });
    assert.deepEqual(parseImport(exportFile(stored).text), { ok: true, rules: stored.rules, settings: stored.settings });
  });

  test("a file with only the rules, or only the settings, has only that part", () => {
    const stored = config([rule("a")], { cleanOnEdit: true });

    const rulesOnly = parseImport(exportFile(stored, { rules: true, settings: false }).text);
    assert.deepEqual(rulesOnly, { ok: true, rules: stored.rules, settings: null });

    const settingsOnly = parseImport(exportFile(stored, { rules: false, settings: true }).text);
    assert.deepEqual(settingsOnly, { ok: true, rules: null, settings: stored.settings });
  });

  test("a file saved before the parts were separate (version, settings, rules) has both", () => {
    const parsed = parseImport('{"schemaVersion": 1, "settings": {"cleanOnEdit": true}, "rules": []}');
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.rules, []);
    assert.equal(parsed.settings.cleanOnEdit, true);
  });

  test("text that is not JSON", () => {
    for (const text of ["", "not json", "{ broken", "<html></html>"]) {
      assert.deepEqual(parseImport(text), { ok: false, reason: "not-json" }, text);
    }
  });

  test("JSON that has neither rules nor settings, or no version", () => {
    const texts = [
      "[]", "5", "null", '"text"', "{}",
      '{"rules": []}', '{"settings": {}}',
      '{"schemaVersion": 1}',
      '{"schemaVersion": 1, "rules": "no"}',
      '{"schemaVersion": 1, "settings": [1]}',
      '{"schemaVersion": 1, "settings": "no", "rules": null}',
    ];
    for (const text of texts) {
      assert.deepEqual(parseImport(text), { ok: false, reason: "not-config" }, text);
    }
  });

  test("a part of the wrong type is ignored when the other part is fine", () => {
    const parsed = parseImport('{"schemaVersion": 1, "settings": "no", "rules": []}');
    assert.deepEqual(parsed, { ok: true, rules: [], settings: null });
  });

  test("a newer or invalid schema version is refused and the version is reported", () => {
    assert.deepEqual(parseImport('{"schemaVersion": 2, "rules": []}'), { ok: false, reason: "unsupported", version: 2 });
    assert.equal(parseImport('{"schemaVersion": "1", "rules": []}').reason, "unsupported");
    assert.equal(parseImport('{"schemaVersion": 0, "settings": {}}').reason, "unsupported");
  });

  test("unknown fields are dropped and missing ids are filled in", () => {
    const text = JSON.stringify({
      schemaVersion: 1,
      extra: 1,
      rules: [{ scope: { type: "all" }, actions: [{ type: "remove", parameter: "a", extra: 1 }], extra: 1 }],
    });
    const parsed = parseImport(text);
    assert.equal(parsed.ok, true);
    assert.equal("extra" in parsed, false);
    assert.equal("extra" in parsed.rules[0], false);
    assert.equal(typeof parsed.rules[0].id, "string");
    assert.equal(parsed.settings, null);
  });

  test("the settings are filled in like stored ones", () => {
    const parsed = parseImport('{"schemaVersion": 1, "settings": {"cleanOnEdit": true, "other": 1}}');
    assert.deepEqual(parsed.settings, { cleanOnEdit: true, excludedSites: [], undoSeconds: 8 });
  });

  test("rules with errors are kept so they can be fixed", () => {
    const text = JSON.stringify({ schemaVersion: 1, rules: [{ id: "bad", scope: { type: "host", host: "" }, actions: [] }] });
    const { rules } = parseImport(text);
    assert.equal(rules.length, 1);
    assert.ok(validateRule(rules[0]).some(i => i.severity === "error"));
  });

  test("duplicate ids inside the file are made unique", () => {
    const text = JSON.stringify({ schemaVersion: 1, rules: [rule("same"), rule("same")] });
    const { rules } = parseImport(text);
    assert.equal(new Set(ids(rules)).size, 2);
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
    const parsed = { ok: true, rules: imported.rules, settings: imported.settings };
    const existing = [rule("a"), rule("x")];
    assert.deepEqual(summarizeImport(parsed, existing), { rules: { total: 4, withErrors: 1, clashes: 1 }, settings: true });
  });

  test("a file without rules, or without settings", () => {
    assert.deepEqual(summarizeImport({ ok: true, rules: null, settings: {} }, [rule("a")]), { rules: null, settings: true });
    assert.deepEqual(summarizeImport({ ok: true, rules: [], settings: null }, [rule("a")]), {
      rules: { total: 0, withErrors: 0, clashes: 0 },
      settings: false,
    });
  });
});

describe("applyImport", () => {
  const current = config([rule("a"), rule("b")], { cleanOnEdit: true, undoSeconds: 20, excludedSites: ["old.example"] });
  const parsed = {
    ok: true,
    rules: [rule("c"), rule("a", { name: "imported" })],
    settings: { cleanOnEdit: false, excludedSites: ["new.example"], undoSeconds: 5 },
  };

  test("rules replaced and settings replaced: the config is the file's", () => {
    const next = applyImport(current, parsed, { rules: "replace", settings: true });
    assert.deepEqual(next, { schemaVersion: 1, settings: parsed.settings, rules: parsed.rules });
  });

  test("rules added keep the current ones first and give a clashing id a new one", () => {
    const next = applyImport(current, parsed, { rules: "add", settings: false });
    assert.equal(next.rules.length, 4);
    assert.deepEqual(ids(next.rules).slice(0, 3), ["a", "b", "c"]);
    assert.notEqual(next.rules[3].id, "a");
    assert.equal(next.rules[3].name, "imported");
    assert.deepEqual(next.settings, current.settings);
  });

  test("settings only: the rules stay as they are", () => {
    const next = applyImport(current, parsed, { rules: "none", settings: true });
    assert.deepEqual(next.rules, current.rules);
    assert.deepEqual(next.settings, parsed.settings);
  });

  test("the excluded sites are replaced, not merged", () => {
    const next = applyImport(current, parsed, { rules: "none", settings: true });
    assert.deepEqual(next.settings.excludedSites, ["new.example"]);
  });

  test("a part the file does not have is never applied", () => {
    const noSettings = applyImport(current, { ...parsed, settings: null }, { rules: "replace", settings: true });
    assert.deepEqual(noSettings.settings, current.settings);

    const noRules = applyImport(current, { ...parsed, rules: null }, { rules: "replace", settings: false });
    assert.deepEqual(noRules.rules, current.rules);
  });

  test("does not modify its inputs", () => {
    const before = structuredClone(current);
    applyImport(current, parsed, { rules: "add", settings: true });
    assert.deepEqual(current, before);
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
