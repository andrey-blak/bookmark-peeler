import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseQuery, serializeQuery } from "../../src/core/query.js";
import { applyAction } from "../../src/core/actions.js";

// Runs one action on the query string and returns the resulting query string.
function run(action, query) {
  return serializeQuery(applyAction(action, parseQuery(query)));
}

const replace = (rest) => ({ type: "replace", ...rest });

describe("applyAction: replace, filtering by parameter", () => {
  test("the visibility example: public becomes private for one parameter name", () => {
    const action = replace({
      parameter: { find: "^visibility$" },
      value: { find: "^public$", replace: "private" },
    });
    assert.equal(
      run(action, "owner=me&visibility=public&other=public"),
      "owner=me&visibility=private&other=public",
    );
  });

  test("a value that does not match is left alone", () => {
    const action = replace({
      parameter: { find: "^visibility$" },
      value: { find: "^public$", replace: "private" },
    });
    assert.equal(run(action, "visibility=internal"), "visibility=internal");
  });

  test("the parameter pattern is an unanchored regex", () => {
    const action = replace({
      parameter: { find: "visibility" },
      value: { find: "^public$", replace: "private" },
    });
    assert.equal(
      run(action, "x_visibility=public&visibility_x=public&other=public"),
      "x_visibility=private&visibility_x=private&other=public",
    );
  });

  test("without a parameter pattern the value rewrite applies to every parameter", () => {
    const action = replace({ value: { find: "^public$", replace: "private" } });
    assert.equal(run(action, "a=public&b=public&c=x"), "a=private&b=private&c=x");
  });
});

describe("applyAction: replace, renaming", () => {
  test("renames with capture groups", () => {
    const action = replace({ parameter: { find: "^utm_(.*)$", replace: "$1" } });
    assert.equal(run(action, "utm_source=x&utm_medium=y&v=1"), "source=x&medium=y&v=1");
  });

  test("an empty replacement removes the matched text", () => {
    const action = replace({ parameter: { find: "^utm_", replace: "" } });
    assert.equal(run(action, "utm_source=x"), "source=x");
  });

  test("renaming keeps the raw value untouched", () => {
    const action = replace({ parameter: { find: "^a$", replace: "b" } });
    assert.equal(run(action, "a=%7e+%41&c=1"), "b=%7e+%41&c=1");
  });

  test("a rename that would leave an empty name is ignored", () => {
    const action = replace({ parameter: { find: "^a$", replace: "" } });
    assert.equal(run(action, "a=1"), "a=1");
  });

  test("a name can be renamed on a parameter without a value", () => {
    const action = replace({ parameter: { find: "^fbclid$", replace: "fb" } });
    assert.equal(run(action, "a=1&fbclid&b=2"), "a=1&fb&b=2");
  });
});

describe("applyAction: replace, values", () => {
  test("replaces every match, not just the first", () => {
    const action = replace({ value: { find: "a", replace: "b" } });
    assert.equal(run(action, "x=banana"), "x=bbnbnb");
  });

  test("supports capture groups and $&", () => {
    assert.equal(run(replace({ value: { find: "(\\d+)", replace: "$1$1" } }), "n=5"), "n=55");
    assert.equal(run(replace({ value: { find: "\\d+", replace: "[$&]" } }), "n=5"), "n=%5B5%5D");
  });

  test("the pattern sees the decoded value and the result is re-encoded", () => {
    const action = replace({ value: { find: "^a b$", replace: "c d" } });
    assert.equal(run(action, "q=a%20b&r=a+b"), "q=c%20d&r=c%20d");
  });

  test("non-ASCII replacements are percent-encoded as UTF-8", () => {
    const action = replace({ value: { find: "^x$", replace: "привет" } });
    assert.equal(run(action, "q=x"), "q=%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82");
  });

  test("replacing with the same text leaves the raw bytes untouched", () => {
    const action = replace({ value: { find: "^1$", replace: "1" } });
    assert.equal(run(action, "a=%31&b=2"), "a=%31&b=2");
  });

  test("a value replacement keeps the raw name untouched", () => {
    const action = replace({ value: { find: "^1$", replace: "2" } });
    assert.equal(run(action, "a%20b=1"), "a%20b=2");
  });

  test("a parameter without a value never matches a value pattern", () => {
    const action = replace({ value: { find: "^$", replace: "x" } });
    assert.equal(run(action, "a&b=&c=1"), "a&b=x&c=1");
  });

  test("an unchanged parameter is passed through as the same object", () => {
    const parameters = parseQuery("a=1&b=2");
    const result = applyAction(replace({ value: { find: "^2$", replace: "3" } }), parameters);
    assert.equal(result[0], parameters[0]);
    assert.notEqual(result[1], parameters[1]);
  });
});

describe("applyAction: replace, parameter and value together", () => {
  test("both are replaced when both patterns match", () => {
    const action = replace({
      parameter: { find: "^old$", replace: "new" },
      value: { find: "^1$", replace: "2" },
    });
    assert.equal(run(action, "old=1"), "new=2");
  });

  test("every pattern must match: a parameter that fails one is left whole", () => {
    const action = replace({
      parameter: { find: "^old$", replace: "new" },
      value: { find: "^1$", replace: "2" },
    });
    assert.equal(run(action, "old=5"), "old=5");
  });

  test("a value pattern without a replacement only filters", () => {
    const action = replace({
      parameter: { find: "^visibility$", replace: "vis" },
      value: { find: "^public$" },
    });
    assert.equal(run(action, "visibility=public&visibility=private"), "vis=public&visibility=private");
  });

  test("parameter name and value are replaced from their original text, not from each other's result", () => {
    const action = replace({
      parameter: { find: "^a$", replace: "b" },
      value: { find: "^a$", replace: "b" },
    });
    assert.equal(run(action, "a=a"), "b=b");
  });
});

describe("applyAction: replace, case", () => {
  test("is case-sensitive by default", () => {
    const action = replace({
      parameter: { find: "^visibility$" },
      value: { find: "^public$", replace: "private" },
    });
    assert.equal(run(action, "Visibility=public&visibility=PUBLIC"), "Visibility=public&visibility=PUBLIC");
  });

  test("ignoreCase makes every pattern case-insensitive", () => {
    const action = replace({
      ignoreCase: true,
      parameter: { find: "^visibility$" },
      value: { find: "^public$", replace: "private" },
    });
    assert.equal(run(action, "Visibility=PUBLIC"), "Visibility=private");
  });
});

describe("applyAction: replace, things that do nothing", () => {
  test("an empty or missing pattern is no condition and replaces nothing", () => {
    assert.equal(run(replace({ parameter: { find: "", replace: "x" } }), "a=1"), "a=1");
    assert.equal(run(replace({ value: { replace: "x" } }), "a=1"), "a=1");
    assert.equal(run(replace({}), "a=1"), "a=1");
  });

  test("a pattern with no replacement anywhere changes nothing", () => {
    assert.equal(run(replace({ parameter: { find: "^a$" }, value: { find: "^1$" } }), "a=1"), "a=1");
  });

  test("an invalid regex disables the action instead of throwing", () => {
    assert.equal(run(replace({ value: { find: "(", replace: "x" } }), "a=1"), "a=1");
    assert.equal(run(replace({ parameter: { find: "[", replace: "x" } }), "a=1"), "a=1");
  });

  test("a replacement that cannot be encoded leaves the parameter alone", () => {
    const action = replace({ value: { find: "^1$", replace: "\uD800" } });
    assert.equal(run(action, "a=1&b=2"), "a=1&b=2");
  });

  test("does not modify the input array or its parameters", () => {
    const parameters = parseQuery("a=1&b=2");
    applyAction(replace({ value: { find: "^1$", replace: "9" } }), parameters);
    assert.equal(serializeQuery(parameters), "a=1&b=2");
  });
});

describe("remove and replace together", () => {
  test("actions run in order and each sees the previous result", () => {
    let parameters = parseQuery("visibility=public&utm_source=x&pp=y");
    parameters = applyAction({ type: "remove", parameter: "utm_*" }, parameters);
    parameters = applyAction(replace({
      parameter: { find: "^visibility$" },
      value: { find: "^public$", replace: "private" },
    }), parameters);
    assert.equal(serializeQuery(parameters), "visibility=private&pp=y");
  });
});
