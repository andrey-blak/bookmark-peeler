import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig } from "../../src/core/schema.js";
import { planMigration, mergeConfigs } from "../../src/core/migration.js";

const rule = (id, extra = {}) => ({
  id,
  enabled: true,
  scope: { type: "all" },
  actions: [{ type: "remove", parameter: "a" }],
  ...extra,
});

const raw = (rules, settings = { cleanOnEdit: false }) => ({ schemaVersion: 1, settings, rules });
const ids = config => config.rules.map(r => r.id);
const plan = (local, sync, done = false) => planMigration({ local, sync, done });

describe("planMigration", () => {
  test("once done, nothing more is done", () => {
    assert.equal(plan(raw([rule("a")]), raw([rule("b")]), true).action, "none");
  });

  test("no rules on either side: just mark it done", () => {
    assert.equal(plan({}, {}).action, "mark");
    assert.equal(plan(undefined, undefined).action, "mark");
    assert.equal(plan(raw([]), raw([])).action, "mark");
  });

  test("rules here and nothing synced: copy them", () => {
    assert.equal(plan(raw([rule("a")]), {}).action, "copy");
    assert.equal(plan(raw([rule("a")]), raw([])).action, "copy");
  });

  test("nothing here and rules synced: use the synced ones, and mark it done", () => {
    assert.equal(plan({}, raw([rule("a")])).action, "mark");
    assert.equal(plan(raw([]), raw([rule("a")])).action, "mark");
  });

  test("the same rules on both sides: nothing to ask", () => {
    assert.equal(plan(raw([rule("a"), rule("b")]), raw([rule("a"), rule("b")])).action, "mark");
  });

  test("different rules on both sides: ask, with both configs", () => {
    const result = plan(raw([rule("a")]), raw([rule("b"), rule("c")]));
    assert.equal(result.action, "ask");
    assert.deepEqual(ids(result.local), ["a"]);
    assert.deepEqual(ids(result.sync), ["b", "c"]);
  });

  test("the same ids with different content are different", () => {
    assert.equal(plan(raw([rule("a")]), raw([rule("a", { name: "other" })])).action, "ask");
  });

  test("a schema version that is not known, on either side, leaves everything alone", () => {
    assert.equal(plan({ ...raw([rule("a")]), schemaVersion: 2 }, {}).action, "none");
    assert.equal(plan(raw([rule("a")]), { ...raw([rule("b")]), schemaVersion: 2 }).action, "none");
  });

  test("the configs that come back are normalised like stored data", () => {
    const result = plan(raw([{ id: "a", scope: { type: "all" }, extra: 1 }]), {});
    assert.deepEqual(result.local, normalizeConfig(raw([{ id: "a", scope: { type: "all" } }])));
  });
});

describe("mergeConfigs", () => {
  const local = normalizeConfig(raw([rule("a"), rule("b", { name: "local b" }), rule("c")], { cleanOnEdit: true }));
  const sync = normalizeConfig(raw([rule("d"), rule("b", { name: "synced b" })], { cleanOnEdit: false }));

  test("the synced rules first, in their order, then the rules that only exist here", () => {
    assert.deepEqual(ids(mergeConfigs(local, sync)), ["d", "b", "a", "c"]);
  });

  test("a rule on both sides comes from the synced side", () => {
    const merged = mergeConfigs(local, sync);
    assert.equal(merged.rules.find(r => r.id === "b").name, "synced b");
  });

  test("the settings are the synced ones", () => {
    assert.deepEqual(mergeConfigs(local, sync).settings, { cleanOnEdit: false, excludedSites: [] });
  });

  test("keeps the schema version and does not modify its inputs", () => {
    const before = JSON.stringify([local, sync]);
    const merged = mergeConfigs(local, sync);
    assert.equal(merged.schemaVersion, 1);
    assert.equal(JSON.stringify([local, sync]), before);
  });

  test("merging with an empty side gives the other side", () => {
    const empty = normalizeConfig(raw([]));
    assert.deepEqual(ids(mergeConfigs(local, empty)), ["a", "b", "c"]);
    assert.deepEqual(ids(mergeConfigs(empty, sync)), ["d", "b"]);
  });
});
