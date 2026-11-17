import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, serializeQuery } from "../../src/core/query.js";
import { applyAction } from "../../src/core/actions.js";
import { cleanUrl, cleanUrlTraced } from "../../src/core/engine.js";

// Runs one action on the query string and returns the resulting query string.
function run(action, query) {
  return serializeQuery(applyAction(action, parseQuery(query)));
}

const keep = parameters => ({ type: "keep", parameters });

describe("applyAction: keep", () => {
  test("keeps the listed parameters and removes all the others", () => {
    assert.equal(run(keep(["v", "t"]), "a=1&v=2&t=3&b=4"), "v=2&t=3");
  });

  test("the parameters that stay keep their exact original text", () => {
    assert.equal(run(keep(["q", "r"]), "x=1&q=hello%20world&r=a+b~c&y=2"), "q=hello%20world&r=a+b~c");
  });

  test("a name with * matches any characters", () => {
    assert.equal(run(keep(["utm_*"]), "a=1&utm_source=x&utm_medium=y&b=2"), "utm_source=x&utm_medium=y");
  });

  test("a plain name matches exactly", () => {
    assert.equal(run(keep(["v"]), "v=1&vv=2&xv=3&v2=4"), "v=1");
  });

  test("matching is case-sensitive", () => {
    assert.equal(run(keep(["v"]), "V=1&v=2"), "v=2");
  });

  test("matches the decoded name", () => {
    assert.equal(run(keep(["a b"]), "a%20b=1&c=2"), "a%20b=1");
    assert.equal(run(keep(["utm_source"]), "utm%5Fsource=1&c=2"), "utm%5Fsource=1");
  });

  test("a parameter without a value is kept by its name", () => {
    assert.equal(run(keep(["fbclid"]), "fbclid&a=1"), "fbclid");
  });

  test("every occurrence of a repeated parameter is kept", () => {
    assert.equal(run(keep(["a"]), "a=1&b=2&a=3"), "a=1&a=3");
  });

  test("any of the listed names keeps a parameter", () => {
    assert.equal(run(keep(["a", "b*"]), "a=1&bb=2&c=3"), "a=1&bb=2");
  });

  test("spaces around a name are trimmed, and blank entries are ignored", () => {
    assert.equal(run(keep([" v ", "", "   ", "\tt\t"]), "a=1&v=2&t=3"), "v=2&t=3");
  });

  test("an empty or missing list, or one with only blank entries, changes nothing", () => {
    assert.equal(run(keep([]), "a=1&b=2"), "a=1&b=2");
    assert.equal(run({ type: "keep" }, "a=1&b=2"), "a=1&b=2");
    assert.equal(run(keep(["", "  "]), "a=1&b=2"), "a=1&b=2");
    assert.equal(run({ type: "keep", parameters: "a" }, "a=1&b=2"), "a=1&b=2");
  });

  test("entries that are not text are ignored", () => {
    assert.equal(run(keep([5, null, "a"]), "a=1&b=2"), "a=1");
  });

  test("empty parts of the query have no name, so they are dropped", () => {
    assert.equal(run(keep(["a", "b"]), "a=1&&b=2&"), "a=1&b=2");
  });

  test("when nothing matches, nothing is kept", () => {
    assert.equal(run(keep(["zzz"]), "a=1&b=2"), "");
  });

  test("does not modify the input array", () => {
    const parameters = parseQuery("a=1&b=2");
    applyAction(keep(["a"]), parameters);
    assert.equal(serializeQuery(parameters), "a=1&b=2");
  });

  test("actions after it work on what is left", () => {
    let parameters = parseQuery("v=1&si=x&feature=y&t=2");
    parameters = applyAction(keep(["v", "t"]), parameters);
    parameters = applyAction({ type: "remove", parameter: "t" }, parameters);
    assert.equal(serializeQuery(parameters), "v=1");
  });
});

describe("keep in the engine", () => {
  const rule = parameters => ({ id: "k", scope: { type: "all" }, actions: [keep(parameters)] });

  test("cleans a URL down to the listed parameters", () => {
    assert.equal(
      cleanUrl("https://example.org/video?v=Hn4xT9sBq2L&si=abc&feature=share", [rule(["v"])]),
      "https://example.org/video?v=Hn4xT9sBq2L",
    );
  });

  test("when nothing is kept the ? goes too, and the fragment stays", () => {
    assert.equal(cleanUrl("https://example.org/p?a=1&b=2#top", [rule(["zzz"])]), "https://example.org/p#top");
  });

  test("a URL that has only listed parameters comes back as the same string", () => {
    const url = "https://example.org/p?v=1&t=2";
    assert.equal(cleanUrl(url, [rule(["v", "t"])]), url);
  });

  test("the dropped parameters are reported as removed, with the rule that removed them", () => {
    const { changes } = cleanUrlTraced("https://example.org/p?v=1&si=x&feature=y", [rule(["v"])]);
    assert.deepEqual(changes.map(c => [c.kind, c.before.name, c.ruleId]), [["removed", "si", "k"], ["removed", "feature", "k"]]);
  });
});
