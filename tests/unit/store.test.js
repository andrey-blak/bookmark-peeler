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

function setup({ sync = {}, local = {} } = {}) {
  const areas = { sync: fakeArea(sync), local: fakeArea(local) };
  return { ...areas, store: createStore(areas) };
}

describe("loadStored", () => {
  test("empty storage reads as the defaults", async () => {
    const { store } = setup();
    assert.deepEqual(readConfig(await store.loadStored()), { status: "ok", config: normalizeConfig({}) });
  });

  test("gives back what writeConfig wrote, in the same shape the rest of the code reads", async () => {
    const { store } = setup();
    const written = config([rule("b"), rule("a")], { cleanOnEdit: true, undoSeconds: 20, excludedSites: ["example.com"] });
    await store.writeConfig(written);
    assert.deepEqual(readConfig(await store.loadStored()), { status: "ok", config: written });
  });

  test("the settings come from storage.sync and the rules from storage.local", async () => {
    const { store } = setup({
      sync: { schemaVersion: 1, settings: { cleanOnEdit: true } },
      local: { schemaVersion: 1, rules: [rule("a")] },
    });
    const { config: read } = readConfig(await store.loadStored());
    assert.equal(read.settings.cleanOnEdit, true);
    assert.deepEqual(read.rules.map(r => r.id), ["a"]);
  });

  test("settings without any rules yet, and rules without any settings yet, both read", async () => {
    const onlySync = setup({ sync: { schemaVersion: 1, settings: { cleanOnEdit: true } } });
    assert.equal(readConfig(await onlySync.store.loadStored()).config.settings.cleanOnEdit, true);

    const onlyLocal = setup({ local: { schemaVersion: 1, rules: [rule("a")] } });
    assert.equal(readConfig(await onlyLocal.store.loadStored()).config.rules.length, 1);
  });

  test("a schema version this code does not know, in either area, is reported as unsupported", async () => {
    for (const area of ["sync", "local"]) {
      const { store } = setup({ [area]: { schemaVersion: 2 } });
      assert.equal(readConfig(await store.loadStored()).status, "unsupported", area);
    }
  });
});

describe("writeConfig", () => {
  test("the first write puts the settings in sync and the rules in local, and nothing else anywhere", async () => {
    const { store, sync, local } = setup();
    await store.writeConfig(config([rule("a")]));
    assert.deepEqual(Object.keys(sync.data).sort(), ["schemaVersion", "settings"]);
    assert.deepEqual(Object.keys(local.data).sort(), ["rules", "schemaVersion"]);
  });

  test("writing the same config again writes nothing", async () => {
    const { store, sync, local } = setup();
    await store.writeConfig(config([rule("a")]));
    sync.calls.length = 0;
    local.calls.length = 0;

    await store.writeConfig(config([rule("a")]));
    assert.deepEqual(writes(sync), []);
    assert.deepEqual(writes(local), []);
  });

  test("changing a rule writes only to storage.local", async () => {
    const { store, sync, local } = setup();
    await store.writeConfig(config([rule("a")]));
    sync.calls.length = 0;
    local.calls.length = 0;

    await store.writeConfig(config([rule("a", { name: "A" })]));
    assert.deepEqual(writes(sync), []);
    assert.deepEqual(writes(local), [["set", ["schemaVersion", "rules"]]]);
  });

  test("changing a setting writes only to storage.sync", async () => {
    const { store, sync, local } = setup();
    await store.writeConfig(config([rule("a")]));
    sync.calls.length = 0;
    local.calls.length = 0;

    await store.writeConfig(config([rule("a")], { cleanOnEdit: true }));
    assert.deepEqual(writes(local), []);
    assert.deepEqual(writes(sync), [["set", ["schemaVersion", "settings"]]]);
  });

  test("the items of other writers are not touched", async () => {
    const { store, sync, local } = setup({ sync: { other: 1 }, local: { other: 2, syncMigrated: true } });
    await store.writeConfig(config([rule("a")]));
    assert.equal(sync.data.other, 1);
    assert.equal(local.data.other, 2);
    assert.equal(local.data.syncMigrated, true);
  });

  test("many rules are no problem for storage.local", async () => {
    const { store } = setup();
    const rules = [];
    for (let i = 0; i < 600; i++) rules.push(rule(`r${i}`, { actions: [{ type: "remove", parameter: "x".repeat(2000) }] }));
    await store.writeConfig(config(rules));
    assert.equal(readConfig(await store.loadStored()).config.rules.length, 600);
  });

  test("settings that do not fit in one item of storage.sync are refused and nothing is written", async () => {
    const { store, sync, local } = setup();
    const sites = Array.from({ length: 1000 }, (_, i) => `site-number-${i}.example.com`);

    await assert.rejects(store.writeConfig(config([rule("a")], { excludedSites: sites })), error => {
      assert.ok(error instanceof StoreError);
      assert.equal(error.code, "settings-too-large");
      return true;
    });
    assert.deepEqual(writes(sync), []);
    assert.deepEqual(writes(local), []);
  });

  test("storage written with a schema version this code does not know is never overwritten", async () => {
    for (const area of ["sync", "local"]) {
      const { store, sync, local } = setup({ [area]: { schemaVersion: 2 } });
      await assert.rejects(store.writeConfig(config([rule("a")])), error => error.code === "unsupported", area);
      assert.deepEqual(writes(sync), [], area);
      assert.deepEqual(writes(local), [], area);
    }
  });

  test("a failing storage is reported to the caller", async () => {
    const { store, local } = setup();
    local.set = async () => { throw new Error("disk full"); };
    await assert.rejects(store.writeConfig(config([rule("a")])), /disk full/);
  });
});
