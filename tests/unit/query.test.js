import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { splitUrl, joinUrl, parseQuery, serializeQuery } from "../../src/core/query.js";

// Awkward URLs: every one of them must survive parse -> serialise unchanged.
const URLS = [
  "https://www.example.com/video?v=Hn4xT9sBq2L&pp=qvRtLd8aWk%3D%3D",
  "https://example.com",
  "https://example.com/",
  "https://example.com/path",
  "https://example.com/?",
  "https://example.com/#",
  "https://example.com/?#",
  "https://example.com/?a=1#frag",
  "https://example.com/#frag?not=query",
  "https://example.com/?a=1#frag?b=2#c",
  "https://example.com/?q=hello%20world&t=a~b",
  "https://example.com/?q=a+b&r=%2B",
  "https://example.com/?q=it's&r=(x)&s=!*",
  "https://example.com/?a=b=c",
  "https://example.com/?a&b=&c=1",
  "https://example.com/?a=1&&b=2&",
  "https://example.com/?&",
  "https://example.com/?=x&=",
  "https://example.com/?q=%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82",
  "https://example.com/?q=привет",
  "https://example.com/?q=%zz&r=%E0%A4%A",
  "https://example.com/?a=1;b=2",
  "https://example.com/a b?c d=e f",
  "mailto:someone@example.com?subject=Hi%20there",
  "no-scheme/path?x=1#y",
];

describe("splitUrl / joinUrl", () => {
  test("splits base, query and fragment", () => {
    assert.deepEqual(splitUrl("https://example.com/p?a=1&b=2#top"), {
      base: "https://example.com/p",
      query: "a=1&b=2",
      fragment: "top",
    });
  });

  test("absent query and fragment are null", () => {
    assert.deepEqual(splitUrl("https://example.com/p"), {
      base: "https://example.com/p",
      query: null,
      fragment: null,
    });
  });

  test("empty query and fragment are empty strings, not null", () => {
    assert.deepEqual(splitUrl("https://example.com/?#"), {
      base: "https://example.com/",
      query: "",
      fragment: "",
    });
  });

  test("a ? inside the fragment does not start a query", () => {
    assert.deepEqual(splitUrl("https://example.com/#a?b=1"), {
      base: "https://example.com/",
      query: null,
      fragment: "a?b=1",
    });
  });

  test("only the first # starts the fragment", () => {
    assert.deepEqual(splitUrl("https://example.com/?a=1#x#y"), {
      base: "https://example.com/",
      query: "a=1",
      fragment: "x#y",
    });
  });

  test("a second ? stays inside the query", () => {
    assert.deepEqual(splitUrl("https://example.com/?a=1?b=2"), {
      base: "https://example.com/",
      query: "a=1?b=2",
      fragment: null,
    });
  });

  for (const url of URLS) {
    test(`round trip: ${url}`, () => {
      assert.equal(joinUrl(splitUrl(url)), url);
    });
  }

  test("joinUrl adds ? and # only when the part is not null", () => {
    assert.equal(joinUrl({ base: "https://example.com/", query: null, fragment: null }), "https://example.com/");
    assert.equal(joinUrl({ base: "https://example.com/", query: "", fragment: null }), "https://example.com/?");
    assert.equal(joinUrl({ base: "https://example.com/", query: null, fragment: "" }), "https://example.com/#");
  });
});

describe("parseQuery", () => {
  test("empty query has no parameters", () => {
    assert.deepEqual(parseQuery(""), []);
  });

  test("null query (no ?) has no parameters", () => {
    assert.deepEqual(parseQuery(null), []);
  });

  test("splits on & and exposes decoded name and value", () => {
    const parameters = parseQuery("v=Hn4xT9sBq2L&pp=qvRtLd8aWk%3D%3D");
    assert.deepEqual(
      parameters.map(({ name, value }) => [name, value]),
      [["v", "Hn4xT9sBq2L"], ["pp", "qvRtLd8aWk=="]],
    );
  });

  test("keeps the raw text of name and value", () => {
    const [p] = parseQuery("pp=qvRtLd8aWk%3D%3D");
    assert.equal(p.rawName, "pp");
    assert.equal(p.rawValue, "qvRtLd8aWk%3D%3D");
  });

  test("decodes percent-escapes and + as space", () => {
    const [a, b] = parseQuery("q=hello%20world&r=a+b");
    assert.equal(a.value, "hello world");
    assert.equal(b.value, "a b");
  });

  test("%2B decodes to a literal plus", () => {
    assert.equal(parseQuery("r=%2B")[0].value, "+");
  });

  test("decodes names too", () => {
    assert.equal(parseQuery("a%20b=1")[0].name, "a b");
  });

  test("decodes UTF-8", () => {
    assert.equal(parseQuery("q=%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82")[0].value, "привет");
  });

  test("only the first = separates name from value", () => {
    const [p] = parseQuery("a=b=c");
    assert.equal(p.name, "a");
    assert.equal(p.value, "b=c");
  });

  test("distinguishes no value (a) from empty value (a=)", () => {
    const [bare, empty] = parseQuery("a&b=");
    assert.equal(bare.value, null);
    assert.equal(bare.rawValue, null);
    assert.equal(empty.value, "");
    assert.equal(empty.rawValue, "");
  });

  test("empty segments are kept as parameters with an empty name", () => {
    const parameters = parseQuery("a=1&&b=2&");
    assert.equal(parameters.length, 4);
    assert.equal(parameters[1].name, "");
    assert.equal(parameters[1].value, null);
    assert.equal(parameters[3].name, "");
  });

  test("malformed escapes fall back to the raw text", () => {
    const [a, b] = parseQuery("q=%zz&r=%E0%A4%A");
    assert.equal(a.value, "%zz");
    assert.equal(b.value, "%E0%A4%A");
  });

  test("a bare ? or # character in a value is not special", () => {
    assert.equal(parseQuery("a=1?b=2")[0].value, "1?b=2");
  });
});

describe("serializeQuery", () => {
  test("empty list gives an empty string", () => {
    assert.equal(serializeQuery([]), "");
  });

  test("joins parameters with &", () => {
    assert.equal(serializeQuery(parseQuery("a=1&b=2")), "a=1&b=2");
  });

  test("dropping a parameter leaves the others byte-identical", () => {
    const parameters = parseQuery("q=hello%20world&pp=x&t=a~b&r=a+b");
    const kept = parameters.filter(p => p.name !== "pp");
    assert.equal(serializeQuery(kept), "q=hello%20world&t=a~b&r=a+b");
  });

  for (const url of URLS) {
    test(`full round trip: ${url}`, () => {
      const { base, query, fragment } = splitUrl(url);
      const rebuilt = joinUrl({ base, query: query === null ? null : serializeQuery(parseQuery(query)), fragment });
      assert.equal(rebuilt, url);
    });
  }
});
