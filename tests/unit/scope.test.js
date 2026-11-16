import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { hostMatches, pathMatches, matchesScope } from "../../src/core/scope.js";

describe("hostMatches", () => {
  test("exact host", () => {
    assert.equal(hostMatches("youtube.com", true, "youtube.com"), true);
  });

  test("case-insensitive", () => {
    assert.equal(hostMatches("YouTube.com", true, "youtube.com"), true);
    assert.equal(hostMatches("youtube.com", true, "WWW.YOUTUBE.COM"), true);
  });

  test("subdomains match when enabled", () => {
    assert.equal(hostMatches("youtube.com", true, "www.youtube.com"), true);
    assert.equal(hostMatches("youtube.com", true, "a.b.youtube.com"), true);
  });

  test("subdomains are on by default", () => {
    assert.equal(hostMatches("youtube.com", undefined, "www.youtube.com"), true);
  });

  test("subdomains do not match when disabled", () => {
    assert.equal(hostMatches("youtube.com", false, "www.youtube.com"), false);
    assert.equal(hostMatches("youtube.com", false, "youtube.com"), true);
  });

  test("a longer name that merely ends with the host is not a match", () => {
    assert.equal(hostMatches("youtube.com", true, "notyoutube.com"), false);
    assert.equal(hostMatches("youtube.com", true, "youtube.com.evil.org"), false);
  });

  test("a host rule with a subdomain does not match the parent", () => {
    assert.equal(hostMatches("www.youtube.com", true, "youtube.com"), false);
    assert.equal(hostMatches("www.youtube.com", true, "m.www.youtube.com"), true);
  });

  test("internationalised host names match their punycode form", () => {
    assert.equal(hostMatches("пример.рф", true, "xn--e1afmkfd.xn--p1ai"), true);
  });

  test("IP addresses and localhost match exactly", () => {
    assert.equal(hostMatches("127.0.0.1", true, "127.0.0.1"), true);
    assert.equal(hostMatches("localhost", true, "localhost"), true);
  });

  test("wildcards are not supported: such a host matches nothing", () => {
    assert.equal(hostMatches("*.youtube.com", true, "www.youtube.com"), false);
    assert.equal(hostMatches("youtube.*", true, "youtube.com"), false);
    assert.equal(hostMatches("*", true, "youtube.com"), false);
  });

  test("empty or invalid hosts never match", () => {
    assert.equal(hostMatches("", true, "youtube.com"), false);
    assert.equal(hostMatches(undefined, true, "youtube.com"), false);
    assert.equal(hostMatches("youtube.com/watch", true, "youtube.com"), false);
    assert.equal(hostMatches("youtube.com:8080", true, "youtube.com"), false);
    assert.equal(hostMatches("you tube.com", true, "youtube.com"), false);
  });
});

describe("pathMatches", () => {
  test("no pattern matches every path", () => {
    assert.equal(pathMatches(undefined, "/anything/here"), true);
    assert.equal(pathMatches("", "/anything/here"), true);
    assert.equal(pathMatches(null, "/"), true);
  });

  test("a plain path matches exactly", () => {
    assert.equal(pathMatches("/watch", "/watch"), true);
    assert.equal(pathMatches("/watch", "/watch/x"), false);
    assert.equal(pathMatches("/watch", "/watching"), false);
    assert.equal(pathMatches("/watch", "/"), false);
  });

  test("a trailing slash is ignored on both sides", () => {
    assert.equal(pathMatches("/watch", "/watch/"), true);
    assert.equal(pathMatches("/watch/", "/watch"), true);
    assert.equal(pathMatches("/watch/", "/watch/"), true);
  });

  test("the leading slash of the pattern is optional", () => {
    assert.equal(pathMatches("watch", "/watch"), true);
  });

  test("/ matches only the root", () => {
    assert.equal(pathMatches("/", "/"), true);
    assert.equal(pathMatches("/", "/watch"), false);
  });

  test("* matches anything except /", () => {
    assert.equal(pathMatches("/playlist/*", "/playlist/abc"), true);
    assert.equal(pathMatches("/playlist/*", "/playlist/abc/def"), false);
    assert.equal(pathMatches("/playlist/*", "/playlist"), false);
    assert.equal(pathMatches("/playlist/*", "/playlist/"), false);
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
    assert.equal(pathMatches("/Watch", "/watch"), false);
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
  const youtube = "https://www.youtube.com/watch?v=KAq7MwkoFR8&pp=ugUEEgJydQ%3D%3D";

  test("all matches any valid URL", () => {
    assert.equal(matchesScope({ type: "all" }, youtube), true);
    assert.equal(matchesScope({ type: "all" }, "http://localhost:3000/x"), true);
  });

  test("all does not match something that is not a URL", () => {
    assert.equal(matchesScope({ type: "all" }, "not a url"), false);
  });

  test("host scope matches the host, with subdomains by default", () => {
    assert.equal(matchesScope({ type: "host", host: "youtube.com" }, youtube), true);
    assert.equal(matchesScope({ type: "host", host: "vimeo.com" }, youtube), false);
  });

  test("host scope can exclude subdomains", () => {
    const scope = { type: "host", host: "youtube.com", subdomains: false };
    assert.equal(matchesScope(scope, youtube), false);
    assert.equal(matchesScope(scope, "https://youtube.com/watch?v=1"), true);
  });

  test("host + path", () => {
    const scope = { type: "host", host: "youtube.com", path: "/watch" };
    assert.equal(matchesScope(scope, youtube), true);
    assert.equal(matchesScope(scope, "https://www.youtube.com/playlist?list=1"), false);
  });

  test("host + path pattern", () => {
    const scope = { type: "host", host: "youtube.com", path: "/playlist/*" };
    assert.equal(matchesScope(scope, "https://www.youtube.com/playlist/abc?x=1"), true);
    assert.equal(matchesScope(scope, "https://www.youtube.com/playlist/abc/def"), false);
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
    assert.equal(matchesScope({ type: "regex", host: "youtube.com" }, youtube), false);
    assert.equal(matchesScope({}, youtube), false);
    assert.equal(matchesScope(undefined, youtube), false);
  });

  test("a host scope without a host never matches", () => {
    assert.equal(matchesScope({ type: "host" }, youtube), false);
  });
});
