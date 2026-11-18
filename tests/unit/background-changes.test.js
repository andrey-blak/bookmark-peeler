import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createSelfWrites } from "../../src/background/self-writes.js";
import {
  handleBookmarkCreated,
  handleBookmarkChanged,
  applyUrlChanges,
} from "../../src/background/handler.js";

const VIDEO_URL = "https://www.example.com/video?v=Hn4xT9sBq2L&pp=qvRtLd8aWk%3D%3D";
const CLEAN = "https://www.example.com/video?v=Hn4xT9sBq2L";

const removePp = {
  id: "yt",
  scope: { type: "host", host: "example.com" },
  actions: [{ type: "remove", parameter: "pp" }],
};

const stored = (rules, cleanOnEdit = true) => ({ schemaVersion: 1, settings: { cleanOnEdit }, rules });

function setup(storedValue) {
  const calls = { updates: [], reads: 0 };
  const selfWrites = createSelfWrites();
  const deps = {
    selfWrites,
    loadStored: async () => {
      calls.reads++;
      return storedValue;
    },
    updateBookmark: async (id, changes) => {
      calls.updates.push([id, changes]);
    },
  };
  return { deps, calls, selfWrites };
}

describe("handleBookmarkCreated records its own writes", () => {
  test("the cleaned address is recorded, so the edit event it causes can be recognised", async () => {
    const { deps, calls, selfWrites } = setup(stored([removePp]));
    await handleBookmarkCreated({ id: "b1", url: VIDEO_URL }, deps);
    assert.deepEqual(calls.updates, [["b1", { url: CLEAN }]]);
    assert.equal(selfWrites.consume("b1", CLEAN), true);
  });

  test("nothing is recorded when nothing changes", async () => {
    const { deps, selfWrites } = setup(stored([removePp]));
    await handleBookmarkCreated({ id: "b1", url: "https://example.org/?a=1" }, deps);
    assert.equal(selfWrites.consume("b1", "https://example.org/?a=1"), false);
  });
});

describe("handleBookmarkChanged", () => {
  test("cleans an edited address when the setting is on", async () => {
    const { deps, calls, selfWrites } = setup(stored([removePp]));
    await handleBookmarkChanged("b1", { url: VIDEO_URL }, deps);
    assert.deepEqual(calls.updates, [["b1", { url: CLEAN }]]);
    assert.equal(selfWrites.consume("b1", CLEAN), true);
  });

  test("does nothing when the setting is off or missing", async () => {
    for (const value of [stored([removePp], false), { schemaVersion: 1, rules: [removePp] }]) {
      const { deps, calls } = setup(value);
      await handleBookmarkChanged("b1", { url: VIDEO_URL }, deps);
      assert.deepEqual(calls.updates, []);
    }
  });

  test("a change of the title or of anything but the address is ignored without reading storage", async () => {
    const { deps, calls } = setup(stored([removePp]));
    await handleBookmarkChanged("b1", { title: "New title" }, deps);
    await handleBookmarkChanged("b1", {}, deps);
    assert.deepEqual(calls.updates, []);
    assert.equal(calls.reads, 0);
  });

  test("a change the add-on made itself is ignored without reading storage", async () => {
    const { deps, calls, selfWrites } = setup(stored([removePp]));
    selfWrites.add("b1", VIDEO_URL);
    await handleBookmarkChanged("b1", { url: VIDEO_URL }, deps);
    assert.deepEqual(calls.updates, []);
    assert.equal(calls.reads, 0);
  });

  test("does not touch an address that is already clean", async () => {
    const { deps, calls } = setup(stored([removePp]));
    await handleBookmarkChanged("b1", { url: CLEAN }, deps);
    assert.deepEqual(calls.updates, []);
  });

  test("addresses that are not web pages are not touched", async () => {
    const all = { id: "all", scope: { type: "all" }, actions: [{ type: "remove", parameter: "*" }] };
    const { deps, calls } = setup(stored([all]));
    await handleBookmarkChanged("b1", { url: "place:sort=8&maxResults=10" }, deps);
    assert.deepEqual(calls.updates, []);
  });

  test("storage with an unsupported schema version is left alone", async () => {
    const { deps, calls } = setup({ ...stored([removePp]), schemaVersion: 2 });
    await handleBookmarkChanged("b1", { url: VIDEO_URL }, deps);
    assert.deepEqual(calls.updates, []);
  });

  test("a rule that changes its own output does not loop: the event caused by the write is ignored", async () => {
    const grow = { id: "grow", scope: { type: "all" }, actions: [{ type: "replace", value: { find: "x$", replace: "xx" } }] };
    const { deps, calls } = setup(stored([grow]));
    const written = [];

    // Like Firefox: every update fires the change event again.
    deps.updateBookmark = async (id, { url }) => {
      written.push(url);
      calls.updates.push([id, { url }]);
      await handleBookmarkChanged(id, { url }, deps);
    };

    await handleBookmarkChanged("b1", { url: "https://example.org/?a=x" }, deps);
    assert.deepEqual(written, ["https://example.org/?a=xx"]);
  });

  test("errors are passed on to the caller", async () => {
    const { deps } = setup(stored([removePp]));
    deps.updateBookmark = async () => { throw new Error("update failed"); };
    await assert.rejects(handleBookmarkChanged("b1", { url: VIDEO_URL }, deps), /update failed/);
  });
});

describe("applyUrlChanges", () => {
  function bulk(currentUrls = {}) {
    const calls = { updates: [] };
    const selfWrites = createSelfWrites();
    const deps = {
      selfWrites,
      getBookmark: async id => (id in currentUrls ? { id, url: currentUrls[id] } : null),
      updateBookmark: async (id, changes) => {
        calls.updates.push([id, changes.url]);
      },
    };
    return { deps, calls, selfWrites };
  }

  test("sets each address and reports which bookmarks were updated", async () => {
    const { deps, calls } = bulk();
    const result = await applyUrlChanges([{ id: "a", url: "https://example.org/1" }, { id: "b", url: "https://example.org/2" }], deps);
    assert.deepEqual(calls.updates, [["a", "https://example.org/1"], ["b", "https://example.org/2"]]);
    assert.deepEqual(result, { updated: ["a", "b"], skipped: [], failed: [] });
  });

  test("records every write, so the edit events they cause are ignored", async () => {
    const { deps, selfWrites } = bulk();
    await applyUrlChanges([{ id: "a", url: "https://example.org/1" }], deps);
    assert.equal(selfWrites.consume("a", "https://example.org/1"), true);
  });

  test("with `expect`, a bookmark that has been changed since is skipped", async () => {
    const { deps, calls } = bulk({ a: "https://example.org/now", b: "https://example.org/changed" });
    const result = await applyUrlChanges([
      { id: "a", url: "https://example.org/before", expect: "https://example.org/now" },
      { id: "b", url: "https://example.org/before", expect: "https://example.org/now" },
    ], deps);
    assert.deepEqual(calls.updates, [["a", "https://example.org/before"]]);
    assert.deepEqual(result, { updated: ["a"], skipped: ["b"], failed: [] });
  });

  test("with `expect`, a bookmark that no longer exists is skipped", async () => {
    const { deps, calls } = bulk();
    const result = await applyUrlChanges([{ id: "gone", url: "https://example.org/", expect: "https://example.org/x" }], deps);
    assert.deepEqual(calls.updates, []);
    assert.deepEqual(result.skipped, ["gone"]);
  });

  test("a failing update is reported and the others still run", async () => {
    const { deps, calls } = bulk();
    deps.updateBookmark = async (id, changes) => {
      if (id === "b") throw new Error("nope");
      calls.updates.push([id, changes.url]);
    };
    const result = await applyUrlChanges([
      { id: "a", url: "https://example.org/1" },
      { id: "b", url: "https://example.org/2" },
      { id: "c", url: "https://example.org/3" },
    ], deps);
    assert.deepEqual(result, { updated: ["a", "c"], skipped: [], failed: ["b"] });
  });

  test("nothing to do", async () => {
    const { deps } = bulk();
    assert.deepEqual(await applyUrlChanges([], deps), { updated: [], skipped: [], failed: [] });
  });
});

describe("excluded sites", () => {
  const withSites = (excludedSites, cleanOnEdit = true) => ({
    schemaVersion: 1,
    settings: { cleanOnEdit, excludedSites },
    rules: [removePp],
  });

  test("a new bookmark on an excluded site is left alone", async () => {
    const { deps, calls } = setup(withSites(["example.com"]));
    await handleBookmarkCreated({ id: "b1", url: VIDEO_URL }, deps);
    assert.deepEqual(calls.updates, []);
  });

  test("an edited bookmark on an excluded site is left alone", async () => {
    const { deps, calls } = setup(withSites(["example.com"]));
    await handleBookmarkChanged("b1", { url: VIDEO_URL }, deps);
    assert.deepEqual(calls.updates, []);
  });

  test("subdomains of an excluded site are left alone too", async () => {
    const { deps, calls } = setup(withSites(["example.com"]));
    await handleBookmarkCreated({ id: "b1", url: "https://www.example.com/video?pp=x" }, deps);
    assert.deepEqual(calls.updates, []);
  });

  test("a site that is not excluded is cleaned as usual", async () => {
    const { deps, calls } = setup(withSites(["example.org"]));
    await handleBookmarkCreated({ id: "b1", url: VIDEO_URL }, deps);
    assert.equal(calls.updates.length, 1);
  });

  test("entries that are not plain domains do not exclude anything", async () => {
    const { deps, calls } = setup(withSites(["*", "example.com/video"]));
    await handleBookmarkCreated({ id: "b1", url: VIDEO_URL }, deps);
    assert.equal(calls.updates.length, 1);
  });

  test("storage without the setting excludes nothing", async () => {
    const { deps, calls } = setup({ schemaVersion: 1, settings: { cleanOnEdit: true }, rules: [removePp] });
    await handleBookmarkCreated({ id: "b1", url: VIDEO_URL }, deps);
    assert.equal(calls.updates.length, 1);
  });
});
