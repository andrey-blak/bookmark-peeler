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
      run({ type: "remove", param: "pp" }, "q=hello%20world&pp=x&t=a~b&r=a+b"),
      "q=hello%20world&t=a~b&r=a+b",
    );
  });

  test("removes every occurrence of a repeated parameter", () => {
    assert.equal(run({ type: "remove", param: "a" }, "a=1&b=2&a=3"), "b=2");
  });

  test("does nothing when the parameter is absent", () => {
    assert.equal(run({ type: "remove", param: "zz" }, "a=1&b=2"), "a=1&b=2");
  });

  test("an exact name does not remove longer names", () => {
    assert.equal(run({ type: "remove", param: "utm" }, "utm_source=x&utm=y"), "utm_source=x");
  });

  test("is case-sensitive", () => {
    assert.equal(run({ type: "remove", param: "pp" }, "PP=1&pp=2"), "PP=1");
  });

  test("removes parameters matching a wildcard", () => {
    assert.equal(
      run({ type: "remove", param: "utm_*" }, "v=1&utm_source=a&utm_medium=b&xutm_source=c"),
      "v=1&xutm_source=c",
    );
  });

  test("* removes every parameter", () => {
    assert.equal(run({ type: "remove", param: "*" }, "a=1&b=2"), "");
  });

  test("matches the decoded name", () => {
    assert.equal(run({ type: "remove", param: "a b" }, "a%20b=1&c=2"), "c=2");
    assert.equal(run({ type: "remove", param: "utm_source" }, "utm%5Fsource=1&c=2"), "c=2");
    assert.equal(run({ type: "remove", param: "a b" }, "a+b=1&c=2"), "c=2");
  });

  test("removes a parameter that has no value", () => {
    assert.equal(run({ type: "remove", param: "fbclid" }, "a=1&fbclid&b=2"), "a=1&b=2");
    assert.equal(run({ type: "remove", param: "fbclid" }, "a=1&fbclid="), "a=1");
  });

  test("an empty or missing param removes nothing", () => {
    assert.equal(run({ type: "remove", param: "" }, "a=1&&b=2"), "a=1&&b=2");
    assert.equal(run({ type: "remove" }, "a=1&b=2"), "a=1&b=2");
  });

  test("does not modify the input array", () => {
    const params = parseQuery("a=1&pp=2");
    applyAction({ type: "remove", param: "pp" }, params);
    assert.equal(serializeQuery(params), "a=1&pp=2");
  });

  test("the example from the task: pp removed from a YouTube URL", () => {
    const { base, query, fragment } = splitUrl(
      "https://www.youtube.com/watch?v=KAq7MwkoFR8&pp=ugUEEgJydQ%3D%3D",
    );
    const cleaned = serializeQuery(applyAction({ type: "remove", param: "pp" }, parseQuery(query)));
    assert.equal(
      joinUrl({ base, query: cleaned, fragment }),
      "https://www.youtube.com/watch?v=KAq7MwkoFR8",
    );
  });
});

describe("applyAction: other input", () => {
  test("an unknown action type changes nothing", () => {
    assert.equal(run({ type: "explode", param: "a" }, "a=1&b=2"), "a=1&b=2");
  });

  test("a missing action changes nothing", () => {
    assert.equal(serializeQuery(applyAction(undefined, parseQuery("a=1"))), "a=1");
  });
});
