import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hostMatches, pathMatches, matchesScope, scopeMismatch } from "../../src/core/scope.js";

describe("hostMatches", () => {
  test("exact host", () => {
    assert.equal(hostMatches("example.com", true, "example.com"), true);
  });

  test("case-insensitive", () => {
    assert.equal(hostMatches("Example.com", true, "example.com"), true);
    assert.equal(hostMatches("example.com", true, "WWW.EXAMPLE.COM"), true);
  });

  test("subdomains match when enabled", () => {
    assert.equal(hostMatches("example.com", true, "www.example.com"), true);
    assert.equal(hostMatches("example.com", true, "a.b.example.com"), true);
  });

  test("subdomains are on by default", () => {
    assert.equal(hostMatches("example.com", undefined, "www.example.com"), true);
  });

  test("subdomains do not match when disabled", () => {
    assert.equal(hostMatches("example.com", false, "www.example.com"), false);
    assert.equal(hostMatches("example.com", false, "example.com"), true);
  });

  test("a longer name that merely ends with the host is not a match", () => {
    assert.equal(hostMatches("example.com", true, "notexample.com"), false);
    assert.equal(hostMatches("example.com", true, "example.com.evil.example"), false);
  });

  test("a host rule with a subdomain does not match the parent", () => {
    assert.equal(hostMatches("www.example.com", true, "example.com"), false);
    assert.equal(hostMatches("www.example.com", true, "m.www.example.com"), true);
  });

  test("internationalised host names match their punycode form", () => {
    assert.equal(hostMatches("пример.example", true, "xn--e1afmkfd.example"), true);
  });

  test("IP addresses and localhost match exactly", () => {
    assert.equal(hostMatches("127.0.0.1", true, "127.0.0.1"), true);
    assert.equal(hostMatches("localhost", true, "localhost"), true);
  });

  test("wildcards are not supported: such a host matches nothing", () => {
    assert.equal(hostMatches("*.example.com", true, "www.example.com"), false);
    assert.equal(hostMatches("example.*", true, "example.com"), false);
    assert.equal(hostMatches("*", true, "example.com"), false);
  });

  test("empty or invalid hosts never match", () => {
    assert.equal(hostMatches("", true, "example.com"), false);
    assert.equal(hostMatches(undefined, true, "example.com"), false);
    assert.equal(hostMatches("example.com/video", true, "example.com"), false);
    assert.equal(hostMatches("example.com:8080", true, "example.com"), false);
    assert.equal(hostMatches("exam ple.com", true, "example.com"), false);
  });
});

describe("pathMatches", () => {
  test("no pattern matches every path", () => {
    assert.equal(pathMatches(undefined, "/anything/here"), true);
    assert.equal(pathMatches("", "/anything/here"), true);
    assert.equal(pathMatches(null, "/"), true);
  });

  test("a plain path matches exactly", () => {
    assert.equal(pathMatches("/video", "/video"), true);
    assert.equal(pathMatches("/video", "/video/x"), false);
    assert.equal(pathMatches("/video", "/videoing"), false);
    assert.equal(pathMatches("/video", "/"), false);
  });

  test("a trailing slash is ignored on both sides", () => {
    assert.equal(pathMatches("/video", "/video/"), true);
    assert.equal(pathMatches("/video/", "/video"), true);
    assert.equal(pathMatches("/video/", "/video/"), true);
  });

  test("the leading slash of the pattern is optional", () => {
    assert.equal(pathMatches("video", "/video"), true);
  });

  test("/ matches only the root", () => {
    assert.equal(pathMatches("/", "/"), true);
    assert.equal(pathMatches("/", "/video"), false);
  });

  test("* matches anything except /", () => {
    assert.equal(pathMatches("/albums/*", "/albums/abc"), true);
    assert.equal(pathMatches("/albums/*", "/albums/abc/def"), false);
    assert.equal(pathMatches("/albums/*", "/albums"), false);
    assert.equal(pathMatches("/albums/*", "/albums/"), false);
  });

  test("* works inside a segment and in the middle", () => {
    assert.equal(pathMatches("/p-*/x", "/p-1/x"), true);
    assert.equal(pathMatches("/p-*/x", "/p-1/2/x"), false);
    assert.equal(pathMatches("/*/edit", "/post/edit"), true);
    assert.equal(pathMatches("/*/edit", "/a/b/edit"), false);
  });

  test("** matches anything including /", () => {
    assert.equal(pathMatches("/a/**", "/a/b"), true);
    assert.equal(pathMatches("/a/**", "/a/b/c/d"), true);
    assert.equal(pathMatches("/a/**/z", "/a/b/c/z"), true);
    assert.equal(pathMatches("/a/**/z", "/a/z"), false);
  });

  test("/a/** does not match /a itself", () => {
    assert.equal(pathMatches("/a/**", "/a"), false);
    assert.equal(pathMatches("/a/**", "/a/"), false);
  });

  test("/** matches every path except the root", () => {
    assert.equal(pathMatches("/**", "/a"), true);
    assert.equal(pathMatches("/**", "/a/b"), true);
  });

  test("regex characters in the pattern are literal", () => {
    assert.equal(pathMatches("/a.b", "/a.b"), true);
    assert.equal(pathMatches("/a.b", "/axb"), false);
    assert.equal(pathMatches("/a+b", "/a+b"), true);
    assert.equal(pathMatches("/(x)", "/(x)"), true);
    assert.equal(pathMatches("/[x]", "/x"), false);
    assert.equal(pathMatches("/a|b", "/a"), false);
  });

  test("matching is case-sensitive", () => {
    assert.equal(pathMatches("/Video", "/video"), false);
  });

  test("percent-encoded paths are decoded before matching", () => {
    assert.equal(pathMatches("/a b", "/a%20b"), true);
    assert.equal(pathMatches("/привет", "/%D0%BF%D1%80%D0%B8%D0%B2%D0%B5%D1%82"), true);
  });

  test("a malformed escape in the path falls back to the raw text", () => {
    assert.equal(pathMatches("/a%zz", "/a%zz"), true);
  });
});

describe("matchesScope", () => {
  const videoUrl = "https://www.example.com/video?v=Hn4xT9sBq2L&pp=qvRtLd8aWk%3D%3D";

  test("all matches any valid URL", () => {
    assert.equal(matchesScope({ type: "all" }, videoUrl), true);
    assert.equal(matchesScope({ type: "all" }, "http://localhost:3000/x"), true);
  });

  test("all does not match something that is not a URL", () => {
    assert.equal(matchesScope({ type: "all" }, "not a url"), false);
  });

  test("host scope matches the host, with subdomains by default", () => {
    assert.equal(matchesScope({ type: "host", host: "example.com" }, videoUrl), true);
    assert.equal(matchesScope({ type: "host", host: "example.net" }, videoUrl), false);
  });

  test("host scope can exclude subdomains", () => {
    const scope = { type: "host", host: "example.com", subdomains: false };
    assert.equal(matchesScope(scope, videoUrl), false);
    assert.equal(matchesScope(scope, "https://example.com/video?v=1"), true);
  });

  test("host + path", () => {
    const scope = { type: "host", host: "example.com", path: "/video" };
    assert.equal(matchesScope(scope, videoUrl), true);
    assert.equal(matchesScope(scope, "https://www.example.com/albums?list=1"), false);
  });

  test("host + path pattern", () => {
    const scope = { type: "host", host: "example.com", path: "/albums/*" };
    assert.equal(matchesScope(scope, "https://www.example.com/albums/abc?x=1"), true);
    assert.equal(matchesScope(scope, "https://www.example.com/albums/abc/def"), false);
  });

  test("port, query and fragment are ignored", () => {
    const scope = { type: "host", host: "example.com", path: "/p" };
    assert.equal(matchesScope(scope, "https://example.com:8443/p?a=1#frag"), true);
  });

  test("a path of / with no query matches the bare host", () => {
    const scope = { type: "host", host: "example.com", path: "/" };
    assert.equal(matchesScope(scope, "https://example.com"), true);
    assert.equal(matchesScope(scope, "https://example.com/"), true);
    assert.equal(matchesScope(scope, "https://example.com/x"), false);
  });

  test("unknown scope types and missing scopes never match", () => {
    assert.equal(matchesScope({ type: "regex", host: "example.com" }, videoUrl), false);
    assert.equal(matchesScope({}, videoUrl), false);
    assert.equal(matchesScope(undefined, videoUrl), false);
  });

  test("a host scope without a host never matches", () => {
    assert.equal(matchesScope({ type: "host" }, videoUrl), false);
  });
});

describe("scopeMismatch", () => {
  const url = "https://www.example.com/video?v=1";

  test("null when the scope matches", () => {
    assert.equal(scopeMismatch({ type: "all" }, url), null);
    assert.equal(scopeMismatch({ type: "host", host: "example.com" }, url), null);
    assert.equal(scopeMismatch({ type: "host", host: "example.com", path: "/video" }, url), null);
  });

  test("says domain when the domain does not match", () => {
    assert.equal(scopeMismatch({ type: "host", host: "example.net" }, url), "domain");
    assert.equal(scopeMismatch({ type: "host", host: "example.com", subdomains: false }, url), "domain");
  });

  test("says path when the domain matches and the path does not", () => {
    assert.equal(scopeMismatch({ type: "host", host: "example.com", path: "/albums" }, url), "path");
  });

  test("a domain mismatch wins over a path mismatch", () => {
    assert.equal(scopeMismatch({ type: "host", host: "example.net", path: "/albums" }, url), "domain");
  });

  test("something that is not a URL, or a scope that is not valid, is not reported", () => {
    assert.equal(scopeMismatch({ type: "all" }, "not a url"), null);
    assert.equal(scopeMismatch({ type: "regex" }, url), null);
    assert.equal(scopeMismatch(undefined, url), null);
  });
});
