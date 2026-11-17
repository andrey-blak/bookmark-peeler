import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, readConfig } from "../../src/core/schema.js";
import { createStore, StoreError } from "../../src/storage/store.js";
import { fakeArea } from "./helpers/fake-area.js";

const rule = (id, extra = {}) => ({
  id,
  enabled: true,
  scope: { type: "all" },
  actions: [{ type: "remove", parameter: "a" }],
  ...extra,
});

const config = (rules, settings = { cleanOnEdit: false }) => normalizeConfig({ schemaVersion: 1, settings, rules });
const writes = area => area.calls.filter(([name]) => name === "set" || name === "remove");

describe("loadStored", () => {
  test("empty storage reads as the defaults", async () => {
    const store = createStore(fakeArea());
    assert.deepEqual(readConfig(await store.loadStored()), { status: "ok", config: normalizeConfig({}) });
  });

  test("gives back what writeConfig wrote, in the same shape the rest of the code reads", async () => {
    const store = createStore(fakeArea());
    const written = config([rule("b"), rule("a")], { cleanOnEdit: true });
    await store.writeConfig(written);
    assert.deepEqual(readConfig(await store.loadStored()), { status: "ok", config: written });
  });
});

describe("writeConfig", () => {
  test("the first write sets every item", async () => {
    const area = fakeArea();
    await createStore(area).writeConfig(config([rule("a")]));
    assert.deepEqual(Object.keys(area.data).sort(), ["order", "rule:a", "schemaVersion", "settings"]);
  });

  test("writing the same config again writes nothing", async () => {
    const area = fakeArea();
    const store = createStore(area);
    await store.writeConfig(config([rule("a")]));
    area.calls.length = 0;

    await store.writeConfig(config([rule("a")]));
    assert.deepEqual(writes(area), []);
  });

  test("a changed rule writes only that rule", async () => {
    const area = fakeArea();
    const store = createStore(area);
    await store.writeConfig(config([rule("a"), rule("b")]));
    area.calls.length = 0;

    await store.writeConfig(config([rule("a"), rule("b", { name: "B" })]));
    assert.deepEqual(writes(area), [["set", ["rule:b"]]]);
  });

  test("a deleted rule is removed first and the order is rewritten after", async () => {
    const area = fakeArea();
    const store = createStore(area);
    await store.writeConfig(config([rule("a"), rule("b")]));
    area.calls.length = 0;

    await store.writeConfig(config([rule("a")]));
    assert.deepEqual(writes(area), [["remove", ["rule:b"]], ["set", ["order"]]]);
    assert.equal("rule:b" in area.data, false);
  });

  test("the items of other writers are not touched", async () => {
    const area = fakeArea({ other: 1 });
    await createStore(area).writeConfig(config([rule("a")]));
    assert.equal(area.data.other, 1);
  });

  test("a rule that is too large is refused and nothing is written", async () => {
    const area = fakeArea();
    const store = createStore(area);
    await store.writeConfig(config([rule("a")]));
    area.calls.length = 0;

    // Names are cut to a few dozen characters, so the size comes from a long parameter.
    const huge = rule("b", { actions: [{ type: "remove", parameter: "x".repeat(9000) }] });
    await assert.rejects(store.writeConfig(config([rule("a"), huge])), error => {
      assert.ok(error instanceof StoreError);
      assert.equal(error.code, "rule-too-large");
      assert.equal(error.ruleId, "b");
      return true;
    });
    assert.deepEqual(writes(area), []);
  });

  test("too much in total is refused and nothing is written", async () => {
    const area = fakeArea();
    const rules = [];
    for (let i = 0; i < 15; i++) rules.push(rule(`r${i}`, { actions: [{ type: "remove", parameter: "x".repeat(7000) }] }));

    await assert.rejects(createStore(area).writeConfig(config(rules)), error => error.code === "too-large");
    assert.deepEqual(writes(area), []);
  });

  test("too many rules is refused", async () => {
    const rules = [];
    for (let i = 0; i < 250; i++) rules.push(rule(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`));
    await assert.rejects(createStore(fakeArea()).writeConfig(config(rules)), error => error.code === "too-many");
  });

  test("storage written with a schema version this code does not know is never overwritten", async () => {
    const area = fakeArea({ schemaVersion: 2, order: [], settings: {} });
    await assert.rejects(createStore(area).writeConfig(config([rule("a")])), error => error.code === "unsupported");
    assert.deepEqual(writes(area), []);
  });

  test("a failing storage is reported to the caller", async () => {
    const area = fakeArea();
    area.set = async () => { throw new Error("disk full"); };
    await assert.rejects(createStore(area).writeConfig(config([rule("a")])), /disk full/);
  });
});
