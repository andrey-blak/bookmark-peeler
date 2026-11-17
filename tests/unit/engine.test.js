import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cleanUrl, cleanUrlTraced } from "../../src/core/engine.js";

const YOUTUBE = "https://www.youtube.com/watch?v=KAq7MwkoFR8&pp=ugUEEgJydQ%3D%3D";

const removePp = {
  scope: { type: "host", host: "youtube.com" },
  actions: [{ type: "remove", parameter: "pp" }],
};
const removeUtm = {
  scope: { type: "all" },
  actions: [{ type: "remove", parameter: "utm_*" }],
};

describe("cleanUrl: the basics", () => {
  test("removes pp from a YouTube URL", () => {
    assert.equal(cleanUrl(YOUTUBE, [removePp]), "https://www.youtube.com/watch?v=KAq7MwkoFR8");
  });

  test("a rule for all sites works on any host", () => {
    assert.equal(
      cleanUrl("https://example.org/p?a=1&utm_source=x&utm_medium=y", [removeUtm]),
      "https://example.org/p?a=1",
    );
  });

  test("returns the same string when nothing changes", () => {
    assert.equal(cleanUrl(YOUTUBE, []), YOUTUBE);
    assert.equal(cleanUrl(YOUTUBE, [removeUtm]), YOUTUBE);
  });

  test("a rule whose scope does not match is skipped", () => {
    assert.equal(cleanUrl("https://vimeo.com/1?pp=1", [removePp]), "https://vimeo.com/1?pp=1");
  });

  test("path scopes are respected", () => {
    const rule = {
      scope: { type: "host", host: "youtube.com", path: "/watch" },
      actions: [{ type: "remove", parameter: "pp" }],
    };
    assert.equal(cleanUrl("https://www.youtube.com/playlist?pp=1", [rule]), "https://www.youtube.com/playlist?pp=1");
    assert.equal(cleanUrl("https://www.youtube.com/watch?pp=1&v=2", [rule]), "https://www.youtube.com/watch?v=2");
  });

  test("a URL without a query is returned as it is", () => {
    assert.equal(cleanUrl("https://example.org/p", [removeUtm]), "https://example.org/p");
    assert.equal(cleanUrl("https://example.org/p#utm_source=x", [removeUtm]), "https://example.org/p#utm_source=x");
  });

  test("an empty query is left alone", () => {
    assert.equal(cleanUrl("https://example.org/?", [removeUtm]), "https://example.org/?");
  });
});

describe("cleanUrl: output shape", () => {
  test("the ? is dropped when every parameter is removed", () => {
    assert.equal(cleanUrl("https://example.org/p?utm_source=x", [removeUtm]), "https://example.org/p");
  });

  test("the fragment is kept, with or without a remaining query", () => {
    assert.equal(cleanUrl("https://example.org/p?utm_source=x#top", [removeUtm]), "https://example.org/p#top");
    assert.equal(cleanUrl("https://example.org/p?a=1&utm_source=x#top", [removeUtm]), "https://example.org/p?a=1#top");
  });

  test("everything that is not touched stays byte-identical", () => {
    assert.equal(
      cleanUrl("HTTPS://user:pw@Example.org:8080/a%20b/~c?q=hello%20world&utm_source=x&t=a~b&r=a+b#f?g", [removeUtm]),
      "HTTPS://user:pw@Example.org:8080/a%20b/~c?q=hello%20world&t=a~b&r=a+b#f?g",
    );
  });

  test("a replacement that gives the same text keeps the original string", () => {
    const rule = { scope: { type: "all" }, actions: [{ type: "replace", value: { find: "^1$", replace: "1" } }] };
    assert.equal(cleanUrl("https://example.org/?a=%31", [rule]), "https://example.org/?a=%31");
  });
});

describe("cleanUrl: several rules and actions", () => {
  test("all matching rules apply", () => {
    assert.equal(
      cleanUrl("https://www.youtube.com/watch?v=1&pp=2&utm_source=x", [removeUtm, removePp]),
      "https://www.youtube.com/watch?v=1",
    );
  });

  test("rules run in list order and each sees the previous result", () => {
    const rename = { scope: { type: "all" }, actions: [{ type: "replace", parameter: { find: "^utm_(.*)$", replace: "$1" } }] };
    const removeSource = { scope: { type: "all" }, actions: [{ type: "remove", parameter: "source" }] };

    assert.equal(cleanUrl("https://e.org/?utm_source=x&a=1", [rename, removeSource]), "https://e.org/?a=1");
    assert.equal(cleanUrl("https://e.org/?utm_source=x&a=1", [removeSource, rename]), "https://e.org/?source=x&a=1");
  });

  test("actions inside a rule run in order", () => {
    const rule = {
      scope: { type: "all" },
      actions: [
        { type: "replace", parameter: { find: "^a$", replace: "b" } },
        { type: "remove", parameter: "b" },
      ],
    };
    assert.equal(cleanUrl("https://e.org/?a=1&c=2", [rule]), "https://e.org/?c=2");
  });

  test("the GitHub visibility example", () => {
    const rule = {
      scope: { type: "host", host: "github.com" },
      actions: [{
        type: "replace",
        parameter: { find: "^visibility$" },
        value: { find: "^public$", replace: "private" },
      }],
    };
    assert.equal(
      cleanUrl("https://github.com/new?owner=me&visibility=public", [rule]),
      "https://github.com/new?owner=me&visibility=private",
    );
  });
});

describe("cleanUrl: rules that are switched off or broken", () => {
  test("a disabled rule is skipped; a rule without enabled counts as enabled", () => {
    assert.equal(cleanUrl(YOUTUBE, [{ ...removePp, enabled: false }]), YOUTUBE);
    assert.equal(cleanUrl(YOUTUBE, [{ ...removePp, enabled: true }]), "https://www.youtube.com/watch?v=KAq7MwkoFR8");
  });

  test("rules with no actions, no scope or no content are ignored without throwing", () => {
    const rules = [null, undefined, {}, { scope: { type: "all" } }, { scope: { type: "all" }, actions: "remove" }, { actions: [] }];
    assert.equal(cleanUrl(YOUTUBE, rules), YOUTUBE);
  });

  test("rules that are not a list change nothing", () => {
    assert.equal(cleanUrl(YOUTUBE, undefined), YOUTUBE);
    assert.equal(cleanUrl(YOUTUBE, null), YOUTUBE);
    assert.equal(cleanUrl(YOUTUBE, {}), YOUTUBE);
  });

  test("a bad rule does not stop the others", () => {
    const bad = { scope: { type: "all" }, actions: [{ type: "replace", value: { find: "(", replace: "x" } }] };
    assert.equal(cleanUrl(YOUTUBE, [bad, removePp]), "https://www.youtube.com/watch?v=KAq7MwkoFR8");
  });

  test("does not modify the rules", () => {
    const rules = [structuredClone(removePp)];
    cleanUrl(YOUTUBE, rules);
    assert.deepEqual(rules, [removePp]);
  });
});

describe("cleanUrl: URLs that are never touched", () => {
  const rule = { scope: { type: "all" }, actions: [{ type: "remove", parameter: "*" }] };

  test("only http and https URLs are cleaned", () => {
    for (const url of [
      "ftp://example.org/?a=1",
      "file:///tmp/x?a=1",
      "about:reader?url=https%3A%2F%2Fexample.org",
      "javascript:void(0)?a=1",
      "place:sort=8&maxResults=10",
      "mailto:someone@example.org?subject=Hi",
    ]) {
      assert.equal(cleanUrl(url, [rule]), url);
    }
  });

  test("something that is not a URL is returned as it is", () => {
    assert.equal(cleanUrl("not a url?a=1", [rule]), "not a url?a=1");
    assert.equal(cleanUrl("", [rule]), "");
  });

  test("http is cleaned too", () => {
    assert.equal(cleanUrl("http://example.org/?a=1", [rule]), "http://example.org/");
  });
});

describe("cleanUrlTraced", () => {
  const removeUtm = (id = "utm") => ({ id, scope: { type: "all" }, actions: [{ type: "remove", parameter: "utm_*" }] });
  const visibility = {
    id: "vis",
    scope: { type: "host", host: "github.com" },
    actions: [{ type: "replace", parameter: { find: "^visibility$" }, value: { find: "^public$", replace: "private" } }],
  };

  test("gives the same URL as cleanUrl", () => {
    const cases = [
      ["https://e.org/?a=1&utm_source=x#top", [removeUtm()]],
      ["https://github.com/new?owner=me&visibility=public", [visibility]],
      ["https://e.org/?a=1", [removeUtm()]],
      ["https://e.org/p", [removeUtm()]],
      ["ftp://e.org/?utm_source=x", [removeUtm()]],
      ["https://e.org/?utm_source=x", [removeUtm()]],
    ];
    for (const [url, rules] of cases) {
      assert.equal(cleanUrlTraced(url, rules).url, cleanUrl(url, rules), url);
    }
  });

  test("no changes: the same URL and an empty list", () => {
    assert.deepEqual(cleanUrlTraced("https://e.org/?a=1", [removeUtm()]), { url: "https://e.org/?a=1", changes: [] });
    assert.deepEqual(cleanUrlTraced("https://e.org/p", [removeUtm()]), { url: "https://e.org/p", changes: [] });
  });

  test("a removed parameter is reported with its decoded name and value and the rule that removed it", () => {
    const { changes } = cleanUrlTraced("https://e.org/?a=1&utm_source=hello%20world&b=2", [removeUtm("tracking")]);
    assert.deepEqual(changes, [{
      kind: "removed",
      ruleId: "tracking",
      before: { name: "utm_source", value: "hello world" },
      after: null,
    }]);
  });

  test("a changed value is reported with the name, the old and the new value", () => {
    const { changes } = cleanUrlTraced("https://github.com/new?owner=me&visibility=public", [visibility]);
    assert.deepEqual(changes, [{
      kind: "changed",
      ruleId: "vis",
      before: { name: "visibility", value: "public" },
      after: { name: "visibility", value: "private" },
    }]);
  });

  test("a renamed parameter is reported as changed", () => {
    const rename = { id: "r", scope: { type: "all" }, actions: [{ type: "replace", parameter: { find: "^utm_(.*)$", replace: "$1" } }] };
    const { url, changes } = cleanUrlTraced("https://e.org/?utm_source=x&a=1", [rename]);
    assert.equal(url, "https://e.org/?source=x&a=1");
    assert.deepEqual(changes.map(c => [c.kind, c.before.name, c.after.name]), [["changed", "utm_source", "source"]]);
  });

  test("a parameter without a value reports a null value", () => {
    const { changes } = cleanUrlTraced("https://e.org/?fbclid&a=1", [{ id: "r", scope: { type: "all" }, actions: [{ type: "remove", parameter: "fbclid" }] }]);
    assert.deepEqual(changes[0].before, { name: "fbclid", value: null });
  });

  test("changes come in the order of the original URL, with removed and changed mixed", () => {
    const rule = {
      id: "r",
      scope: { type: "all" },
      actions: [
        { type: "remove", parameter: "b" },
        { type: "replace", parameter: { find: "^c$" }, value: { find: "^1$", replace: "9" } },
      ],
    };
    const { url, changes } = cleanUrlTraced("https://e.org/?a=0&b=1&c=1&d=2", [rule]);
    assert.equal(url, "https://e.org/?a=0&c=9&d=2");
    assert.deepEqual(changes.map(c => [c.kind, c.before.name]), [["removed", "b"], ["changed", "c"]]);
  });

  test("a change made after a removal is still matched to the right original parameter", () => {
    const rule = {
      id: "r",
      scope: { type: "all" },
      actions: [
        { type: "remove", parameter: "a" },
        { type: "replace", parameter: { find: "^c$" }, value: { find: "^1$", replace: "9" } },
      ],
    };
    const { changes } = cleanUrlTraced("https://e.org/?a=1&b=1&c=1", [rule]);
    assert.deepEqual(changes.map(c => [c.kind, c.before.name, c.after?.value ?? null]), [["removed", "a", null], ["changed", "c", "9"]]);
  });

  test("each change names the first rule that made it", () => {
    const rules = [
      { id: "first", scope: { type: "all" }, actions: [{ type: "replace", value: { find: "^1$", replace: "2" } }] },
      { id: "second", scope: { type: "all" }, actions: [{ type: "remove", parameter: "b" }, { type: "replace", value: { find: "^2$", replace: "3" } }] },
    ];
    const { changes } = cleanUrlTraced("https://e.org/?a=1&b=1", rules);
    assert.deepEqual(changes.map(c => [c.before.name, c.ruleId]), [["a", "first"], ["b", "first"]]);
  });

  test("a rule without an id gives a null rule id", () => {
    const { changes } = cleanUrlTraced("https://e.org/?utm_source=x", [{ scope: { type: "all" }, actions: [{ type: "remove", parameter: "utm_*" }] }]);
    assert.equal(changes[0].ruleId, null);
  });

  test("changes that cancel each other out leave no trace", () => {
    const rules = [
      { id: "a", scope: { type: "all" }, actions: [{ type: "replace", parameter: { find: "^a$", replace: "b" } }] },
      { id: "b", scope: { type: "all" }, actions: [{ type: "replace", parameter: { find: "^b$", replace: "a" } }] },
    ];
    assert.deepEqual(cleanUrlTraced("https://e.org/?a=1", rules), { url: "https://e.org/?a=1", changes: [] });
  });

  test("disabled rules and rules whose scope does not match leave no trace", () => {
    const rules = [{ ...removeUtm(), enabled: false }, { ...removeUtm("other"), scope: { type: "host", host: "other.com" } }];
    assert.deepEqual(cleanUrlTraced("https://e.org/?utm_source=x", rules).changes, []);
  });
});
