import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { testRules, describeChange, highlightSegments, mergeStrayRemovals } from "../../src/options/tester.js";

const EXAMPLE_URL = "https://example.com/new?owner=me&visibility=public&utm_source=x";

const visibility = (extra = {}) => ({
  id: "vis",
  enabled: true,
  name: "Example visibility",
  scope: { type: "host", host: "example.com" },
  actions: [{
    type: "replace",
    parameter: { find: "^visibility$" },
    value: { find: "^public$", replace: "private" },
    ignoreCase: false,
  }],
  ...extra,
});

const tracking = (extra = {}) => ({
  id: "trk",
  enabled: true,
  name: "Tracking",
  scope: { type: "all" },
  actions: [{ type: "remove", parameter: "utm_*" }],
  ...extra,
});

describe("testRules: what is tested", () => {
  test("nothing typed", () => {
    assert.equal(testRules("", { draft: visibility(), rules: [], mode: "all" }).status, "empty");
    assert.equal(testRules("   ", { draft: visibility(), rules: [], mode: "all" }).status, "empty");
  });

  test("text that is not an http or https URL", () => {
    for (const input of ["example.com/new", "not a url", "ftp://example.com/?a=1", "about:reader?url=x"]) {
      assert.equal(testRules(input, { draft: visibility(), rules: [], mode: "all" }).status, "invalid", input);
    }
  });

  test("surrounding spaces are ignored", () => {
    const result = testRules(`  ${EXAMPLE_URL}  `, { draft: visibility(), rules: [], mode: "current" });
    assert.equal(result.status, "ok");
    assert.equal(result.url, "https://example.com/new?owner=me&visibility=private&utm_source=x");
  });
});

describe("testRules: current rule", () => {
  test("runs only the draft", () => {
    const result = testRules(EXAMPLE_URL, { draft: visibility(), rules: [tracking()], mode: "current" });
    assert.equal(result.url, "https://example.com/new?owner=me&visibility=private&utm_source=x");
    assert.deepEqual(result.changes.map(c => c.kind), ["changed"]);
    assert.deepEqual(result.notes, []);
  });

  test("uses the unsaved draft, not the stored version of the rule", () => {
    const stored = visibility();
    const draft = visibility({ actions: [{ type: "remove", parameter: "owner" }] });
    const result = testRules(EXAMPLE_URL, { draft, rules: [stored], mode: "current" });
    assert.equal(result.url, "https://example.com/new?visibility=public&utm_source=x");
  });

  test("a rule that is switched off in the list is still tested", () => {
    const result = testRules(EXAMPLE_URL, { draft: visibility({ enabled: false }), rules: [], mode: "current" });
    assert.equal(result.changes.length, 1);
    assert.deepEqual(result.notes, []);
  });

  test("a rule with errors is not applied, and the result says so", () => {
    const draft = visibility({ scope: { type: "host", host: "" } });
    const result = testRules(EXAMPLE_URL, { draft, rules: [], mode: "current" });
    assert.equal(result.url, EXAMPLE_URL);
    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.notes, ["This rule has errors, so it isn't applied."]);
  });

  test("a rule with only warnings is applied", () => {
    const draft = visibility({ actions: [] });
    const result = testRules(EXAMPLE_URL, { draft, rules: [], mode: "current" });
    assert.equal(result.status, "ok");
    assert.deepEqual(result.notes, []);
  });
});

describe("testRules: why a rule does not apply", () => {
  test("the domain does not match", () => {
    const result = testRules("https://example.net/new?visibility=public", { draft: visibility(), rules: [], mode: "current" });
    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.notes, ["This rule doesn't apply to this URL: the domain doesn't match."]);
  });

  test("the path does not match", () => {
    const draft = visibility({ scope: { type: "host", host: "example.com", path: "/settings" } });
    const result = testRules(EXAMPLE_URL, { draft, rules: [], mode: "current" });
    assert.deepEqual(result.notes, ["This rule doesn't apply to this URL: the path doesn't match."]);
  });

  test("the scope matches but nothing in the query matches: no note, no changes", () => {
    const result = testRules("https://example.com/new?owner=me", { draft: visibility(), rules: [], mode: "current" });
    assert.deepEqual(result.changes, []);
    assert.deepEqual(result.notes, []);
  });
});

describe("testRules: all rules", () => {
  test("runs the stored rules in order, with the draft in place of its stored version", () => {
    const stored = [tracking(), visibility({ actions: [] })];
    const draft = visibility();
    const result = testRules(EXAMPLE_URL, { draft, rules: stored, mode: "all" });
    assert.equal(result.url, "https://example.com/new?owner=me&visibility=private");
    assert.deepEqual(result.changes.map(c => [c.kind, c.ruleId]), [["changed", "vis"], ["removed", "trk"]]);
  });

  test("a new draft runs after the stored rules", () => {
    const rename = { id: "ren", scope: { type: "all" }, actions: [{ type: "replace", parameter: { find: "^owner$", replace: "who" } }] };
    const draft = { ...tracking({ id: "new", actions: [{ type: "remove", parameter: "who" }] }) };
    const result = testRules(EXAMPLE_URL, { draft, rules: [rename], mode: "all" });
    assert.equal(result.url, "https://example.com/new?visibility=public&utm_source=x");
  });

  test("rules that are switched off or have errors are left out", () => {
    const stored = [tracking({ enabled: false }), tracking({ id: "bad", scope: { type: "host", host: "" } })];
    const result = testRules(EXAMPLE_URL, { draft: visibility(), rules: stored, mode: "all" });
    assert.equal(result.url, "https://example.com/new?owner=me&visibility=private&utm_source=x");
  });

  test("the draft takes the switch of the stored rule: off in the list means not applied, with a note", () => {
    const result = testRules(EXAMPLE_URL, { draft: visibility(), rules: [visibility({ enabled: false })], mode: "all" });
    assert.equal(result.url, EXAMPLE_URL);
    assert.deepEqual(result.notes, ["This rule is switched off in the list, so it isn't applied."]);
  });

  test("a rule with errors says so in this mode too", () => {
    const draft = visibility({ scope: { type: "host", host: "" } });
    const result = testRules(EXAMPLE_URL, { draft, rules: [tracking()], mode: "all" });
    assert.deepEqual(result.notes, ["This rule has errors, so it isn't applied."]);
    assert.equal(result.url, "https://example.com/new?owner=me&visibility=public");
  });

  test("the scope note is given here as well", () => {
    const result = testRules("https://example.net/new?utm_source=x", { draft: visibility(), rules: [tracking()], mode: "all" });
    assert.deepEqual(result.notes, ["This rule doesn't apply to this URL: the domain doesn't match."]);
    assert.equal(result.url, "https://example.net/new");
  });

  test("an unknown mode means all rules", () => {
    const result = testRules(EXAMPLE_URL, { draft: visibility(), rules: [tracking()], mode: "whatever" });
    assert.equal(result.url, "https://example.com/new?owner=me&visibility=private");
  });

  test("missing rules are an empty list", () => {
    const result = testRules(EXAMPLE_URL, { draft: visibility(), rules: undefined, mode: "all" });
    assert.equal(result.status, "ok");
  });
});

describe("describeChange", () => {
  test("a removed parameter", () => {
    assert.deepEqual(
      describeChange({ kind: "removed", before: { name: "utm_source", value: "x" }, after: null }),
      { kind: "removed", text: "utm_source=x" },
    );
  });

  test("a removed parameter without a value", () => {
    assert.equal(describeChange({ kind: "removed", before: { name: "fbclid", value: null }, after: null }).text, "fbclid");
  });

  test("a changed value", () => {
    const change = { kind: "changed", before: { name: "visibility", value: "public" }, after: { name: "visibility", value: "private" } };
    assert.deepEqual(describeChange(change), { kind: "changed", text: "visibility: public → private" });
  });

  test("a value that appears or disappears", () => {
    const added = { kind: "changed", before: { name: "a", value: null }, after: { name: "a", value: "1" } };
    const dropped = { kind: "changed", before: { name: "a", value: "1" }, after: { name: "a", value: null } };
    assert.equal(describeChange(added).text, "a: (no value) → 1");
    assert.equal(describeChange(dropped).text, "a: 1 → (no value)");
  });

  test("a renamed parameter", () => {
    const change = { kind: "changed", before: { name: "utm_source", value: "x" }, after: { name: "source", value: "x" } };
    assert.equal(describeChange(change).text, "utm_source → source (value x)");
  });

  test("a rename that also changes the value", () => {
    const change = { kind: "changed", before: { name: "a", value: "1" }, after: { name: "b", value: "2" } };
    assert.equal(describeChange(change).text, "a=1 → b=2");
  });
});

describe("highlightSegments", () => {
  const text = segments => segments.map(s => s.text).join("");

  test("marks the parameters that are not in the original", () => {
    const segments = highlightSegments(
      "https://example.com/new?owner=me&visibility=private",
      "https://example.com/new?owner=me&visibility=public&utm_source=x",
    );
    assert.deepEqual(segments, [
      { text: "https://example.com/new?owner=me&", changed: false },
      { text: "visibility=private", changed: true },
    ]);
  });

  test("the segments always add up to the result", () => {
    const result = "https://example.org/p?a=1&b=2&c=3#frag";
    assert.equal(text(highlightSegments(result, "https://example.org/p?a=1&b=9&c=3&d=4#frag")), result);
  });

  test("nothing is marked when nothing changed", () => {
    const url = "https://example.org/?a=1&b=2";
    assert.deepEqual(highlightSegments(url, url), [{ text: url, changed: false }]);
  });

  test("a URL without a query, or with every parameter removed, is one plain segment", () => {
    assert.deepEqual(highlightSegments("https://example.org/p", "https://example.org/p"), [{ text: "https://example.org/p", changed: false }]);
    assert.deepEqual(highlightSegments("https://example.org/p#top", "https://example.org/p?a=1#top"), [{ text: "https://example.org/p#top", changed: false }]);
  });

  test("repeated parameters are matched one by one", () => {
    const segments = highlightSegments("https://example.org/?a=1&a=2", "https://example.org/?a=1&a=3");
    assert.deepEqual(segments, [
      { text: "https://example.org/?a=1&", changed: false },
      { text: "a=2", changed: true },
    ]);
  });

  test("the fragment stays with the text after the last parameter", () => {
    const segments = highlightSegments("https://example.org/?a=2#top", "https://example.org/?a=1#top");
    assert.deepEqual(segments, [
      { text: "https://example.org/?", changed: false },
      { text: "a=2", changed: true },
      { text: "#top", changed: false },
    ]);
  });
});

describe("stray & signs in what changed", () => {
  const keepAB = (extra = {}) => ({
    id: "k",
    enabled: true,
    name: "Keep",
    scope: { type: "all" },
    actions: [{ type: "keep", parameters: ["a", "b"] }],
    ...extra,
  });
  const removeAll = { id: "all", enabled: true, name: "Remove all", scope: { type: "all" }, actions: [{ type: "remove", parameter: "*" }] };
  const lines = result => result.changes.map(c => describeChange(c).text);

  test("describeChange shows a removed empty part as &", () => {
    assert.deepEqual(
      describeChange({ kind: "removed", before: { name: "", value: null }, after: null }),
      { kind: "removed", text: "&" },
    );
  });

  test("a removed part with a value but no name is still shown as it is", () => {
    assert.equal(describeChange({ kind: "removed", before: { name: "", value: "x" }, after: null }).text, "=x");
  });

  test("all the empty parts removed from a URL are one line, however many there are", () => {
    const result = testRules("https://example.com/p?a=1&&b=2&&&&&", { draft: keepAB(), rules: [], mode: "current" });
    assert.equal(result.url, "https://example.com/p?a=1&b=2");
    assert.deepEqual(lines(result), ["&"]);
    assert.equal(result.changes.length, 1);
  });

  test("with a single stray & it is the same line", () => {
    const result = testRules("https://example.com/p?a=1&&b=2", { draft: keepAB(), rules: [], mode: "current" });
    assert.deepEqual(lines(result), ["&"]);
  });

  test("Remove with * gives the same line for the empty parts, next to the parameters it removed", () => {
    const result = testRules("https://example.com/p?a=1&&b=2&&", { draft: removeAll, rules: [], mode: "current" });
    assert.deepEqual(lines(result), ["a=1", "&", "b=2"]);
  });

  test("the line is at the place of the first empty part", () => {
    const result = testRules("https://example.com/p?&&a=1&c=3&&b=2", { draft: keepAB(), rules: [], mode: "current" });
    assert.deepEqual(lines(result), ["&", "c=3"]);
  });

  test("a part with a value but no name is its own line", () => {
    const result = testRules("https://example.com/p?=x&a=1&&b=2", { draft: keepAB(), rules: [], mode: "current" });
    assert.deepEqual(lines(result), ["=x", "&"]);
  });

  test("the line names the rule in All rules mode, like the others", () => {
    const result = testRules("https://example.com/p?a=1&&b=2", { draft: keepAB(), rules: [keepAB()], mode: "all" });
    assert.deepEqual(result.changes.map(c => c.ruleId), ["k"]);
  });

  test("no stray parts, no such line", () => {
    const result = testRules("https://example.com/p?a=1&c=3", { draft: keepAB(), rules: [], mode: "current" });
    assert.deepEqual(lines(result), ["c=3"]);
  });
});

describe("mergeStrayRemovals", () => {
  const stray = ruleId => ({ kind: "removed", ruleId, before: { name: "", value: null }, after: null });
  const named = (name, ruleId = "r") => ({ kind: "removed", ruleId, before: { name, value: "1" }, after: null });

  test("keeps one stray removal for each rule, at the place of the first", () => {
    const merged = mergeStrayRemovals([named("a"), stray("r"), named("b"), stray("r"), stray("r")]);
    assert.deepEqual(merged.map(c => c.before.name), ["a", "", "b"]);
  });

  test("strays removed by different rules stay one line each", () => {
    const merged = mergeStrayRemovals([stray("one"), named("a"), stray("two")]);
    assert.deepEqual(merged.map(c => c.ruleId), ["one", "r", "two"]);
  });

  test("changes that are not stray removals are all kept as they are", () => {
    const changes = [named("a"), { kind: "changed", ruleId: "r", before: { name: "x", value: "1" }, after: { name: "x", value: "2" } }];
    assert.deepEqual(mergeStrayRemovals(changes), changes);
  });

  test("does not modify its input", () => {
    const changes = [stray("r"), stray("r")];
    mergeStrayRemovals(changes);
    assert.equal(changes.length, 2);
  });
});
