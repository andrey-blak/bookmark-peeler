import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, readConfig } from "../../src/core/schema.js";
import { LIMITS, toItems, assemble, diffItems, checkLimits } from "../../src/core/sync-layout.js";

const rule = (id, extra = {}) => ({
  id,
  enabled: true,
  scope: { type: "all" },
  actions: [{ type: "remove", parameter: "a" }],
  ...extra,
});

const config = (rules, settings = { cleanOnEdit: false }) => normalizeConfig({ schemaVersion: 1, settings, rules });
const ids = raw => raw.rules.map(r => r.id);

describe("toItems", () => {
  test("one item per rule, an order item, the settings and the schema version", () => {
    const items = toItems(config([rule("a"), rule("b")], { cleanOnEdit: true }));
    assert.deepEqual(Object.keys(items).sort(), ["order", "rule:a", "rule:b", "schemaVersion", "settings"]);
    assert.equal(items.schemaVersion, 1);
    assert.deepEqual(items.settings, { cleanOnEdit: true });
    assert.deepEqual(items.order, ["a", "b"]);
    assert.deepEqual(items["rule:b"], rule("b"));
  });

  test("an empty config has an empty order and no rule items", () => {
    const items = toItems(config([]));
    assert.deepEqual(items.order, []);
    assert.equal(Object.keys(items).some(key => key.startsWith("rule:")), false);
  });
});

describe("assemble", () => {
  test("puts the rules back in the stored order, and reads like stored data", () => {
    const original = config([rule("b"), rule("a"), rule("c")], { cleanOnEdit: true });
    const raw = assemble(toItems(original));
    assert.deepEqual(ids(raw), ["b", "a", "c"]);
    assert.deepEqual(readConfig(raw), { status: "ok", config: original });
  });

  test("nothing stored gives an empty result, which reads as the defaults", () => {
    for (const items of [undefined, null, {}]) {
      assert.deepEqual(assemble(items), {});
      assert.equal(readConfig(assemble(items)).status, "ok");
    }
  });

  test("a rule missing from the order is added at the end, in the order of its key", () => {
    const items = toItems(config([rule("a"), rule("b")]));
    items.order = ["a"];
    items["rule:d"] = rule("d");
    items["rule:c"] = rule("c");
    assert.deepEqual(ids(assemble(items)), ["a", "b", "c", "d"]);
  });

  test("an id in the order that has no rule is dropped", () => {
    const items = toItems(config([rule("a")]));
    items.order = ["gone", "a", "also-gone"];
    assert.deepEqual(ids(assemble(items)), ["a"]);
  });

  test("an id twice in the order counts once", () => {
    const items = toItems(config([rule("a"), rule("b")]));
    items.order = ["a", "b", "a"];
    assert.deepEqual(ids(assemble(items)), ["a", "b"]);
  });

  test("an order that is not a list is ignored, and the rules are still all there", () => {
    const items = toItems(config([rule("b"), rule("a")]));
    items.order = "nonsense";
    assert.deepEqual(ids(assemble(items)), ["a", "b"]);
  });

  test("rule items that are not objects, and keys that are not rules, are ignored", () => {
    const items = toItems(config([rule("a")]));
    items["rule:bad"] = "text";
    items["rule:null"] = null;
    items.other = { id: "x" };
    assert.deepEqual(ids(assemble(items)), ["a"]);
  });

  test("a rule without an id gets the one from its key", () => {
    const items = toItems(config([]));
    items["rule:abc"] = { scope: { type: "all" }, actions: [] };
    assert.deepEqual(ids(assemble(items)), ["abc"]);
  });

  test("a schema version that the code does not know passes through, so it is refused", () => {
    const items = toItems(config([rule("a")]));
    items.schemaVersion = 2;
    assert.equal(readConfig(assemble(items)).status, "unsupported");
  });

  test("rules without a schema version are not read: nothing was ever written completely", () => {
    assert.deepEqual(assemble({ "rule:a": rule("a"), order: ["a"] }), {});
  });
});

describe("diffItems", () => {
  const items = rules => toItems(config(rules));

  test("no change, nothing to write", () => {
    assert.deepEqual(diffItems(items([rule("a")]), items([rule("a")])), { set: {}, remove: [] });
  });

  test("a changed rule is the only item written", () => {
    const { set, remove } = diffItems(items([rule("a"), rule("b")]), items([rule("a"), rule("b", { name: "B" })]));
    assert.deepEqual(Object.keys(set), ["rule:b"]);
    assert.deepEqual(remove, []);
  });

  test("a new rule writes the rule and the order", () => {
    const { set, remove } = diffItems(items([rule("a")]), items([rule("a"), rule("b")]));
    assert.deepEqual(Object.keys(set).sort(), ["order", "rule:b"]);
    assert.deepEqual(remove, []);
  });

  test("a deleted rule removes its item and rewrites the order", () => {
    const { set, remove } = diffItems(items([rule("a"), rule("b")]), items([rule("a")]));
    assert.deepEqual(Object.keys(set), ["order"]);
    assert.deepEqual(remove, ["rule:b"]);
  });

  test("reordering writes only the order", () => {
    const { set, remove } = diffItems(items([rule("a"), rule("b")]), items([rule("b"), rule("a")]));
    assert.deepEqual(Object.keys(set), ["order"]);
    assert.deepEqual(remove, []);
  });

  test("a changed setting writes only the settings", () => {
    const next = toItems(config([rule("a")], { cleanOnEdit: true }));
    const { set } = diffItems(items([rule("a")]), next);
    assert.deepEqual(Object.keys(set), ["settings"]);
  });

  test("from nothing, everything is written", () => {
    const { set, remove } = diffItems({}, items([rule("a")]));
    assert.deepEqual(Object.keys(set).sort(), ["order", "rule:a", "schemaVersion", "settings"]);
    assert.deepEqual(remove, []);
  });

  test("keys that are not rules are never removed", () => {
    const { remove } = diffItems({ ...items([rule("a")]), other: 1 }, items([rule("a")]));
    assert.deepEqual(remove, []);
  });
});

describe("checkLimits", () => {
  const sizeOf = (key, value) => key.length + JSON.stringify(value).length;

  test("a normal set of rules is fine", () => {
    assert.deepEqual(checkLimits(toItems(config([rule("a"), rule("b")]))), { ok: true });
  });

  test("the limits are those of storage.sync", () => {
    assert.deepEqual(LIMITS, { totalBytes: 102_400, itemBytes: 8_192, items: 512 });
  });

  test("an item may be exactly as large as the limit, and not a byte larger", () => {
    const key = "rule:a";
    const fill = size => ({ id: "a", pad: "x".repeat(size - sizeOf(key, { id: "a", pad: "" })) });

    assert.equal(sizeOf(key, fill(LIMITS.itemBytes)), LIMITS.itemBytes);
    assert.deepEqual(checkLimits({ [key]: fill(LIMITS.itemBytes) }), { ok: true });

    const over = checkLimits({ [key]: fill(LIMITS.itemBytes + 1) });
    assert.equal(over.ok, false);
    assert.equal(over.reason, "rule-too-large");
    assert.equal(over.ruleId, "a");
  });

  test("the total size counts every key and value", () => {
    const items = {};
    for (let i = 0; i < 13; i++) items[`rule:${i}`] = { id: String(i), pad: "x".repeat(7800) };
    assert.deepEqual(checkLimits(items), { ok: true });

    items["rule:13"] = { id: "13", pad: "x".repeat(7800) };
    const result = checkLimits(items);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "too-large");
  });

  test("too many items", () => {
    const items = {};
    for (let i = 0; i < LIMITS.items; i++) items[`k${i}`] = 1;
    assert.deepEqual(checkLimits(items), { ok: true });

    items.extra = 1;
    assert.equal(checkLimits(items).reason, "too-many");
  });

  test("an order list that no longer fits in one item means too many rules", () => {
    const rules = [];
    for (let i = 0; i < 250; i++) rules.push(rule(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`));
    const result = checkLimits(toItems(config(rules)));
    assert.equal(result.ok, false);
    assert.equal(result.reason, "too-many");
  });
});
