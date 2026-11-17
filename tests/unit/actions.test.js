import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { splitUrl, joinUrl, parseQuery, serializeQuery } from "../../src/core/query.js";
import { nameMatches, applyAction } from "../../src/core/actions.js";

// Runs one action on the query string and returns the resulting query string.
function run(action, query) {
  return serializeQuery(applyAction(action, parseQuery(query)));
}

describe("nameMatches", () => {
  test("a plain name matches exactly", () => {
    assert.equal(nameMatches("pp", "pp"), true);
    assert.equal(nameMatches("pp", "ppx"), false);
    assert.equal(nameMatches("pp", "xpp"), false);
    assert.equal(nameMatches("utm", "utm_source"), false);
  });

  test("matching is case-sensitive", () => {
    assert.equal(nameMatches("pp", "PP"), false);
  });

  test("* matches any run of characters, including none", () => {
    assert.equal(nameMatches("utm_*", "utm_source"), true);
    assert.equal(nameMatches("utm_*", "utm_"), true);
    assert.equal(nameMatches("utm_*", "xutm_source"), false);
    assert.equal(nameMatches("*_id", "session_id"), true);
    assert.equal(nameMatches("*_id", "session_idx"), false);
    assert.equal(nameMatches("a*b", "a123b"), true);
    assert.equal(nameMatches("a*b", "ab"), true);
    assert.equal(nameMatches("*", "anything"), true);
    assert.equal(nameMatches("*", ""), true);
  });

  test("** behaves like *", () => {
    assert.equal(nameMatches("utm_**", "utm_source"), true);
  });

  test("regex characters are literal", () => {
    assert.equal(nameMatches("a.b", "a.b"), true);
    assert.equal(nameMatches("a.b", "axb"), false);
    assert.equal(nameMatches("a+b", "a+b"), true);
    assert.equal(nameMatches("(x)", "(x)"), true);
    assert.equal(nameMatches("a|b", "a"), false);
  });

  test("a / in the name is an ordinary character", () => {
    assert.equal(nameMatches("a*b", "a/b"), true);
  });

  test("an empty or missing pattern matches nothing", () => {
    assert.equal(nameMatches("", ""), false);
    assert.equal(nameMatches("", "a"), false);
    assert.equal(nameMatches(undefined, "a"), false);
  });
});

describe("applyAction: remove", () => {
  test("removes the named parameter and leaves the rest byte-identical", () => {
    assert.equal(
      run({ type: "remove", parameter: "pp" }, "q=hello%20world&pp=x&t=a~b&r=a+b"),
      "q=hello%20world&t=a~b&r=a+b",
    );
  });

  test("removes every occurrence of a repeated parameter", () => {
    assert.equal(run({ type: "remove", parameter: "a" }, "a=1&b=2&a=3"), "b=2");
  });

  test("does nothing when the parameter is absent", () => {
    assert.equal(run({ type: "remove", parameter: "zz" }, "a=1&b=2"), "a=1&b=2");
  });

  test("an exact name does not remove longer names", () => {
    assert.equal(run({ type: "remove", parameter: "utm" }, "utm_source=x&utm=y"), "utm_source=x");
  });

  test("is case-sensitive", () => {
    assert.equal(run({ type: "remove", parameter: "pp" }, "PP=1&pp=2"), "PP=1");
  });

  test("removes parameters matching a wildcard", () => {
    assert.equal(
      run({ type: "remove", parameter: "utm_*" }, "v=1&utm_source=a&utm_medium=b&xutm_source=c"),
      "v=1&xutm_source=c",
    );
  });

  test("* removes every parameter", () => {
    assert.equal(run({ type: "remove", parameter: "*" }, "a=1&b=2"), "");
  });

  test("matches the decoded name", () => {
    assert.equal(run({ type: "remove", parameter: "a b" }, "a%20b=1&c=2"), "c=2");
    assert.equal(run({ type: "remove", parameter: "utm_source" }, "utm%5Fsource=1&c=2"), "c=2");
    assert.equal(run({ type: "remove", parameter: "a b" }, "a+b=1&c=2"), "c=2");
  });

  test("removes a parameter that has no value", () => {
    assert.equal(run({ type: "remove", parameter: "fbclid" }, "a=1&fbclid&b=2"), "a=1&b=2");
    assert.equal(run({ type: "remove", parameter: "fbclid" }, "a=1&fbclid="), "a=1");
  });

  test("an empty or missing parameter removes nothing", () => {
    assert.equal(run({ type: "remove", parameter: "" }, "a=1&&b=2"), "a=1&&b=2");
    assert.equal(run({ type: "remove" }, "a=1&b=2"), "a=1&b=2");
  });

  test("does not modify the input array", () => {
    const parameters = parseQuery("a=1&pp=2");
    applyAction({ type: "remove", parameter: "pp" }, parameters);
    assert.equal(serializeQuery(parameters), "a=1&pp=2");
  });

  test("the example from the task: pp removed from a Example URL", () => {
    const { base, query, fragment } = splitUrl(
      "https://www.example.com/video?v=Hn4xT9sBq2L&pp=qvRtLd8aWk%3D%3D",
    );
    const cleaned = serializeQuery(applyAction({ type: "remove", parameter: "pp" }, parseQuery(query)));
    assert.equal(
      joinUrl({ base, query: cleaned, fragment }),
      "https://www.example.com/video?v=Hn4xT9sBq2L",
    );
  });
});

describe("applyAction: other input", () => {
  test("an unknown action type changes nothing", () => {
    assert.equal(run({ type: "explode", parameter: "a" }, "a=1&b=2"), "a=1&b=2");
  });

  test("a missing action changes nothing", () => {
    assert.equal(serializeQuery(applyAction(undefined, parseQuery("a=1"))), "a=1");
  });
});
