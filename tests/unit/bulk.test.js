import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { flattenBookmarks, planClean, undoChanges, diffSegments } from "../../src/options/bulk.js";

const bookmark = (id, url, title = `Title ${id}`) => ({ id, type: "bookmark", title, url });
const folder = (id, children) => ({ id, type: "folder", title: `Folder ${id}`, children });

const rules = [
  { id: "trk", scope: { type: "all" }, actions: [{ type: "remove", parameter: "utm_*" }] },
  { id: "yt", scope: { type: "host", host: "example.net" }, actions: [{ type: "remove", parameter: "pp" }] },
];

describe("flattenBookmarks", () => {
  test("lists the bookmarks of nested folders in tree order", () => {
    const tree = [folder("root", [
      folder("toolbar", [bookmark("a", "https://example.org/a"), folder("sub", [bookmark("b", "https://example.org/b")])]),
      folder("menu", [bookmark("c", "https://example.org/c")]),
    ])];
    assert.deepEqual(flattenBookmarks(tree).map(b => b.id), ["a", "b", "c"]);
  });

  test("keeps the id, title and address", () => {
    const [b] = flattenBookmarks([folder("f", [bookmark("a", "https://example.org/a", "A page")])]);
    assert.deepEqual(b, { id: "a", title: "A page", url: "https://example.org/a" });
  });

  test("skips folders, separators and nodes without an address", () => {
    const tree = [folder("f", [
      { id: "s", type: "separator", title: "" },
      { id: "x", type: "bookmark", title: "No url" },
      bookmark("a", "https://example.org/a"),
      folder("empty", []),
      { id: "nochildren", type: "folder", title: "F" },
    ])];
    assert.deepEqual(flattenBookmarks(tree).map(b => b.id), ["a"]);
  });

  test("an empty tree", () => {
    assert.deepEqual(flattenBookmarks([]), []);
  });
});

describe("planClean", () => {
  const list = [
    { id: "1", title: "Clean", url: "https://example.com/?a=1" },
    { id: "2", title: "Tracked", url: "https://example.com/?a=1&utm_source=x" },
    { id: "3", title: "Video", url: "https://www.example.net/video?v=1&pp=2&utm_medium=y" },
    { id: "4", title: "Smart", url: "place:sort=8&maxResults=10" },
  ];

  test("lists only the bookmarks that would change, with the new address", () => {
    const { total, changes } = planClean(list, rules);
    assert.equal(total, 4);
    assert.deepEqual(changes, [
      { id: "2", title: "Tracked", url: "https://example.com/?a=1&utm_source=x", newUrl: "https://example.com/?a=1" },
      { id: "3", title: "Video", url: "https://www.example.net/video?v=1&pp=2&utm_medium=y", newUrl: "https://www.example.net/video?v=1" },
    ]);
  });

  test("uses only enabled rules without errors", () => {
    const off = { ...rules[0], enabled: false };
    const broken = { id: "bad", scope: { type: "host", host: "" }, actions: [{ type: "remove", parameter: "*" }] };
    const { changes } = planClean(list, [off, broken, rules[1]]);
    assert.deepEqual(changes.map(c => c.id), ["3"]);
  });

  test("without rules nothing changes", () => {
    assert.deepEqual(planClean(list, []), { total: 4, changes: [] });
  });

  test("an empty list of bookmarks", () => {
    assert.deepEqual(planClean([], rules), { total: 0, changes: [] });
  });
});

describe("undoChanges", () => {
  const changes = [
    { id: "a", title: "A", url: "https://example.org/old-a", newUrl: "https://example.org/a" },
    { id: "b", title: "B", url: "https://example.org/old-b", newUrl: "https://example.org/b" },
    { id: "c", title: "C", url: "https://example.org/old-c", newUrl: "https://example.org/c" },
  ];

  test("puts the old address back, but only if the bookmark still has the cleaned one", () => {
    assert.deepEqual(undoChanges(changes, ["a", "c"]), [
      { id: "a", url: "https://example.org/old-a", expect: "https://example.org/a" },
      { id: "c", url: "https://example.org/old-c", expect: "https://example.org/c" },
    ]);
  });

  test("only the bookmarks that were really updated are taken back", () => {
    assert.deepEqual(undoChanges(changes, []), []);
    assert.deepEqual(undoChanges(changes, ["zzz"]), []);
  });
});

describe("diffSegments", () => {
  const change = (url, newUrl) => ({ id: "1", title: "T", url, newUrl });
  const text = segments => segments.map(s => s.text).join("");

  test("a removed parameter is marked in the old address only", () => {
    const { before, after } = diffSegments(change("https://example.com/?a=1&utm_source=x&b=2", "https://example.com/?a=1&b=2"));
    assert.deepEqual(before, [
      { text: "https://example.com/?a=1&", changed: false },
      { text: "utm_source=x", changed: true },
      { text: "&b=2", changed: false },
    ]);
    assert.deepEqual(after, [{ text: "https://example.com/?a=1&b=2", changed: false }]);
  });

  test("a changed value is marked in both addresses", () => {
    const { before, after } = diffSegments(change("https://example.com/new?v=1&visibility=public", "https://example.com/new?v=1&visibility=private"));
    assert.deepEqual(before, [
      { text: "https://example.com/new?v=1&", changed: false },
      { text: "visibility=public", changed: true },
    ]);
    assert.deepEqual(after, [
      { text: "https://example.com/new?v=1&", changed: false },
      { text: "visibility=private", changed: true },
    ]);
  });

  test("when every parameter is removed, all of them are marked in the old address", () => {
    const { before, after } = diffSegments(change("https://example.org/p?a=1&b=2", "https://example.org/p"));
    assert.deepEqual(before.filter(s => s.changed).map(s => s.text), ["a=1", "b=2"]);
    assert.deepEqual(after, [{ text: "https://example.org/p", changed: false }]);
  });

  test("the pieces always add up to the addresses, fragment included", () => {
    const c = change("https://example.org/p?a=1&utm_x=2#top", "https://example.org/p?a=1#top");
    const { before, after } = diffSegments(c);
    assert.equal(text(before), c.url);
    assert.equal(text(after), c.newUrl);
  });
});
