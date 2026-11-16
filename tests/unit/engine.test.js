import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { cleanUrl } from "../../src/core/engine.js";

const YOUTUBE = "https://www.youtube.com/watch?v=KAq7MwkoFR8&pp=ugUEEgJydQ%3D%3D";

const removePp = {
  scope: { type: "host", host: "youtube.com" },
  actions: [{ type: "remove", param: "pp" }],
};
const removeUtm = {
  scope: { type: "all" },
  actions: [{ type: "remove", param: "utm_*" }],
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
      actions: [{ type: "remove", param: "pp" }],
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
    const rename = { scope: { type: "all" }, actions: [{ type: "replace", name: { find: "^utm_(.*)$", replace: "$1" } }] };
    const removeSource = { scope: { type: "all" }, actions: [{ type: "remove", param: "source" }] };

    assert.equal(cleanUrl("https://e.org/?utm_source=x&a=1", [rename, removeSource]), "https://e.org/?a=1");
    assert.equal(cleanUrl("https://e.org/?utm_source=x&a=1", [removeSource, rename]), "https://e.org/?source=x&a=1");
  });

  test("actions inside a rule run in order", () => {
    const rule = {
      scope: { type: "all" },
      actions: [
        { type: "replace", name: { find: "^a$", replace: "b" } },
        { type: "remove", param: "b" },
      ],
    };
    assert.equal(cleanUrl("https://e.org/?a=1&c=2", [rule]), "https://e.org/?c=2");
  });

  test("the GitHub visibility example", () => {
    const rule = {
      scope: { type: "host", host: "github.com" },
      actions: [{
        type: "replace",
        name: { find: "^visibility$" },
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
  const rule = { scope: { type: "all" }, actions: [{ type: "remove", param: "*" }] };

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
