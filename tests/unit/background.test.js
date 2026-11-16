import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { handleBookmarkCreated } from "../../src/background/handler.js";

const YOUTUBE = "https://www.youtube.com/watch?v=KAq7MwkoFR8&pp=ugUEEgJydQ%3D%3D";
const CLEAN = "https://www.youtube.com/watch?v=KAq7MwkoFR8";

const removePp = {
  id: "yt",
  scope: { type: "host", host: "youtube.com" },
  actions: [{ type: "remove", parameter: "pp" }],
};

const config = (rules) => ({ schemaVersion: 1, settings: { cleanOnEdit: false }, rules });

// Fake browser access: records the updates and counts the storage reads.
function setup(stored) {
  const calls = { updates: [], reads: 0 };
  const state = { stored };

  const deps = {
    loadStored: async () => {
      calls.reads++;
      return state.stored;
    },
    updateBookmark: async (id, changes) => {
      calls.updates.push([id, changes]);
    },
  };

  return { deps, calls, state };
}

describe("handleBookmarkCreated", () => {
  test("replaces the URL of a new bookmark with the cleaned one", async () => {
    const { deps, calls } = setup(config([removePp]));
    await handleBookmarkCreated({ id: "b1", url: YOUTUBE }, deps);
    assert.deepEqual(calls.updates, [["b1", { url: CLEAN }]]);
  });

  test("does not touch a bookmark when nothing changes", async () => {
    const { deps, calls } = setup(config([removePp]));
    await handleBookmarkCreated({ id: "b1", url: "https://example.org/?a=1" }, deps);
    assert.deepEqual(calls.updates, []);
  });

  test("ignores folders and separators, which have no URL, without reading storage", async () => {
    const { deps, calls } = setup(config([removePp]));
    await handleBookmarkCreated({ id: "f1", title: "Folder", type: "folder" }, deps);
    await handleBookmarkCreated({ id: "s1", type: "separator" }, deps);
    assert.deepEqual(calls.updates, []);
    assert.equal(calls.reads, 0);
  });

  test("empty storage means no rules", async () => {
    for (const stored of [undefined, {}]) {
      const { deps, calls } = setup(stored);
      await handleBookmarkCreated({ id: "b1", url: YOUTUBE }, deps);
      assert.deepEqual(calls.updates, []);
    }
  });

  test("a disabled rule is not applied", async () => {
    const { deps, calls } = setup(config([{ ...removePp, enabled: false }]));
    await handleBookmarkCreated({ id: "b1", url: YOUTUBE }, deps);
    assert.deepEqual(calls.updates, []);
  });

  test("a rule with errors is skipped while the valid rules still apply", async () => {
    const broken = { id: "bad", scope: { type: "host", host: "" }, actions: [{ type: "remove", parameter: "v" }] };
    const { deps, calls } = setup(config([broken, removePp]));
    await handleBookmarkCreated({ id: "b1", url: YOUTUBE }, deps);
    assert.deepEqual(calls.updates, [["b1", { url: CLEAN }]]);
  });

  test("a rule whose only problem is a warning is applied", async () => {
    const warned = { id: "w", scope: { type: "all" }, actions: [] };
    const { deps, calls } = setup(config([warned, removePp]));
    await handleBookmarkCreated({ id: "b1", url: YOUTUBE }, deps);
    assert.deepEqual(calls.updates, [["b1", { url: CLEAN }]]);
  });

  test("storage with an unsupported schema version is left alone", async () => {
    const { deps, calls } = setup({ ...config([removePp]), schemaVersion: 2 });
    await handleBookmarkCreated({ id: "b1", url: YOUTUBE }, deps);
    assert.deepEqual(calls.updates, []);
  });

  test("bookmarks that are not web pages are not touched", async () => {
    const rule = { id: "all", scope: { type: "all" }, actions: [{ type: "remove", parameter: "*" }] };
    const { deps, calls } = setup(config([rule]));
    await handleBookmarkCreated({ id: "b1", url: "place:sort=8&maxResults=10" }, deps);
    await handleBookmarkCreated({ id: "b2", url: "about:reader?url=x" }, deps);
    assert.deepEqual(calls.updates, []);
  });

  test("rules are read from storage on every bookmark, so edited rules apply at once", async () => {
    const { deps, calls, state } = setup(config([]));
    await handleBookmarkCreated({ id: "b1", url: YOUTUBE }, deps);
    state.stored = config([removePp]);
    await handleBookmarkCreated({ id: "b2", url: YOUTUBE }, deps);
    assert.deepEqual(calls.updates, [["b2", { url: CLEAN }]]);
    assert.equal(calls.reads, 2);
  });

  test("a storage error is passed on to the caller", async () => {
    const deps = {
      loadStored: async () => { throw new Error("storage down"); },
      updateBookmark: async () => {},
    };
    await assert.rejects(handleBookmarkCreated({ id: "b1", url: YOUTUBE }, deps), /storage down/);
  });

  test("an update error is passed on to the caller", async () => {
    const { deps } = setup(config([removePp]));
    deps.updateBookmark = async () => { throw new Error("update failed"); };
    await assert.rejects(handleBookmarkCreated({ id: "b1", url: YOUTUBE }, deps), /update failed/);
  });
});
