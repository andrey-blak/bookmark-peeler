import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { normalizeConfig, readConfig } from "../../src/core/schema.js";
import { createStore } from "../../src/storage/store.js";
import { createMigrator } from "../../src/storage/migrate.js";
import { fakeArea } from "./helpers/fake-area.js";

const rule = (id, extra = {}) => ({
  id,
  enabled: true,
  scope: { type: "all" },
  actions: [{ type: "remove", parameter: "a" }],
  ...extra,
});

const localData = (rules, extra = {}) => ({ schemaVersion: 1, settings: { cleanOnEdit: false }, rules, ...extra });
const ids = config => config.rules.map(r => r.id);

// Areas and a migrator over them. `syncRules` are written the way the new store writes them.
async function setup({ local = {}, syncRules = null, syncSettings = { cleanOnEdit: false } } = {}) {
  const localArea = fakeArea(local);
  const syncArea = fakeArea();
  const store = createStore(syncArea);
  if (syncRules) await store.writeConfig(normalizeConfig({ schemaVersion: 1, settings: syncSettings, rules: syncRules }));
  syncArea.calls.length = 0;

  return { localArea, syncArea, store, migrator: createMigrator({ local: localArea, store }) };
}

const syncedConfig = async ({ store }) => readConfig(await store.loadStored()).config;
const sets = area => area.calls.filter(([name]) => name === "set" || name === "remove");

describe("createMigrator: nothing to ask", () => {
  test("rules here and nothing synced: they are copied to storage.sync and the migration is marked done", async () => {
    const ctx = await setup({ local: localData([rule("a"), rule("b")]) });
    const result = await ctx.migrator.run();

    assert.deepEqual(result, { status: "done" });
    assert.deepEqual(ids(await syncedConfig(ctx)), ["a", "b"]);
    assert.equal(ctx.localArea.data.syncMigrated, true);
  });

  test("the local copy is left in place", async () => {
    const ctx = await setup({ local: localData([rule("a")]) });
    await ctx.migrator.run();
    assert.deepEqual(ctx.localArea.data.rules.map(r => r.id), ["a"]);
  });

  test("nothing here: nothing is written to storage.sync, and the migration is marked done", async () => {
    const ctx = await setup({ syncRules: [rule("b")] });
    const result = await ctx.migrator.run();

    assert.deepEqual(result, { status: "done" });
    assert.deepEqual(sets(ctx.syncArea), []);
    assert.equal(ctx.localArea.data.syncMigrated, true);
  });

  test("already done: nothing is written anywhere", async () => {
    const ctx = await setup({ local: localData([rule("a")], { syncMigrated: true }), syncRules: [rule("b")] });
    const result = await ctx.migrator.run();

    assert.deepEqual(result, { status: "done" });
    assert.deepEqual(sets(ctx.syncArea), []);
    assert.deepEqual(sets(ctx.localArea), []);
  });

  test("local data from a newer version is left alone and not marked", async () => {
    const ctx = await setup({ local: localData([rule("a")], { schemaVersion: 2 }) });
    const result = await ctx.migrator.run();

    assert.deepEqual(result, { status: "done" });
    assert.equal("syncMigrated" in ctx.localArea.data, false);
    assert.deepEqual(sets(ctx.syncArea), []);
  });

  test("a copy that does not fit is reported, and the migration stays open", async () => {
    const huge = rule("a", { actions: [{ type: "remove", parameter: "x".repeat(9000) }] });
    const ctx = await setup({ local: localData([huge]) });
    const result = await ctx.migrator.run();

    assert.equal(result.status, "failed");
    assert.equal(result.error.code, "rule-too-large");
    assert.equal("syncMigrated" in ctx.localArea.data, false);
  });

  test("running twice at once reads the local storage once", async () => {
    const ctx = await setup({ local: localData([rule("a")]) });
    await Promise.all([ctx.migrator.run(), ctx.migrator.run()]);
    assert.equal(ctx.localArea.calls.filter(([name]) => name === "get").length, 1);
  });
});

describe("createMigrator: different rules on both sides", () => {
  const conflict = () => setup({ local: localData([rule("a"), rule("b", { name: "local b" })]), syncRules: [rule("c"), rule("b", { name: "synced b" })] });

  test("asks, with both sides, and writes nothing yet", async () => {
    const ctx = await conflict();
    const result = await ctx.migrator.run();

    assert.equal(result.status, "ask");
    assert.deepEqual(ids(result.local), ["a", "b"]);
    assert.deepEqual(ids(result.sync), ["c", "b"]);
    assert.deepEqual(sets(ctx.syncArea), []);
    assert.equal("syncMigrated" in ctx.localArea.data, false);
  });

  test("Merge: the synced rules first, then the ones only here; a rule on both sides comes from the synced side", async () => {
    const ctx = await conflict();
    const pending = await ctx.migrator.run();
    await ctx.migrator.resolve("merge", pending);

    const merged = await syncedConfig(ctx);
    assert.deepEqual(ids(merged), ["c", "b", "a"]);
    assert.equal(merged.rules[1].name, "synced b");
    assert.equal(ctx.localArea.data.syncMigrated, true);
  });

  test("Use this device's rules: the synced rules are replaced", async () => {
    const ctx = await conflict();
    const pending = await ctx.migrator.run();
    await ctx.migrator.resolve("local", pending);

    const result = await syncedConfig(ctx);
    assert.deepEqual(ids(result), ["a", "b"]);
    assert.equal(result.rules[1].name, "local b");
    assert.equal("rule:c" in ctx.syncArea.data, false);
    assert.equal(ctx.localArea.data.syncMigrated, true);
  });

  test("Use the synced rules: nothing is written to storage.sync", async () => {
    const ctx = await conflict();
    const pending = await ctx.migrator.run();
    await ctx.migrator.resolve("sync", pending);

    assert.deepEqual(sets(ctx.syncArea), []);
    assert.deepEqual(ids(await syncedConfig(ctx)), ["c", "b"]);
    assert.equal(ctx.localArea.data.syncMigrated, true);
  });

  test("an answer that is not one of the three changes nothing and does not mark the migration", async () => {
    const ctx = await conflict();
    const pending = await ctx.migrator.run();
    await ctx.migrator.resolve("cancel", pending);

    assert.deepEqual(sets(ctx.syncArea), []);
    assert.equal("syncMigrated" in ctx.localArea.data, false);
  });
});
