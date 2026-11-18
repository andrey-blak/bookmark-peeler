import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isExcluded, siteIssues, validSites, parseSites, sitesText } from "../../src/core/exclusions.js";

const url = "https://www.example.com/video?v=Hn4xT9sBq2L&pp=qvRtLd8aWk";

describe("isExcluded", () => {
  test("a listed domain is excluded, with its subdomains", () => {
    assert.equal(isExcluded("https://example.com/p?a=1", ["example.com"]), true);
    assert.equal(isExcluded(url, ["example.com"]), true);
    assert.equal(isExcluded("https://a.b.example.com/", ["example.com"]), true);
  });

  test("another domain is not", () => {
    assert.equal(isExcluded("https://example.org/", ["example.com"]), false);
    assert.equal(isExcluded("https://example.net/?utm_source=x", ["example.com", "example.org"]), false);
  });

  test("a longer name that merely ends with the domain is not excluded", () => {
    assert.equal(isExcluded("https://notexample.com/", ["example.com"]), false);
    assert.equal(isExcluded("https://example.com.evil.example/", ["example.com"]), false);
  });

  test("listing a subdomain excludes it and what is under it, not the parent", () => {
    assert.equal(isExcluded("https://www.example.com/", ["www.example.com"]), true);
    assert.equal(isExcluded("https://m.www.example.com/", ["www.example.com"]), true);
    assert.equal(isExcluded("https://example.com/", ["www.example.com"]), false);
  });

  test("case does not matter", () => {
    assert.equal(isExcluded("https://EXAMPLE.com/", ["Example.COM"]), true);
  });

  test("the port, the path, the query and the fragment do not matter", () => {
    assert.equal(isExcluded("https://example.com:8443/a/b?c=d#e", ["example.com"]), true);
  });

  test("a domain in non-ASCII letters matches its punycode form", () => {
    assert.equal(isExcluded("https://xn--e1afmkfd.example/", ["пример.example"]), true);
  });

  test("spaces around an entry are ignored", () => {
    assert.equal(isExcluded("https://example.com/", ["  example.com  "]), true);
  });

  test("an empty list, or nothing, excludes nothing", () => {
    assert.equal(isExcluded(url, []), false);
    assert.equal(isExcluded(url, undefined), false);
    assert.equal(isExcluded(url, "example.com"), false);
  });

  test("entries that are not a plain domain exclude nothing, and do not stop the valid ones", () => {
    for (const entry of ["*", "*.example.com", "example.*", "example.com/path", "example.com:8080", "exam ple.com", "", 5, null]) {
      assert.equal(isExcluded("https://example.com/", [entry]), false, String(entry));
    }
    assert.equal(isExcluded("https://example.org/", ["*", "example.org"]), true);
  });

  test("something that is not a URL is not excluded", () => {
    assert.equal(isExcluded("not a url", ["example.com"]), false);
    assert.equal(isExcluded("", ["example.com"]), false);
  });
});

describe("siteIssues", () => {
  test("a list of plain domains has no issues", () => {
    assert.deepEqual(siteIssues(["example.com", "www.example.org", "localhost", "127.0.0.1"]), []);
  });

  test("a wildcard says that wildcards are not supported and that subdomains are included", () => {
    const [issue] = siteIssues(["example.com", "*.example.net"]);
    assert.equal(issue.index, 1);
    assert.equal(issue.entry, "*.example.net");
    assert.match(issue.message, /wildcard/i);
    assert.match(issue.message, /subdomains/i);
  });

  test("a path, a port or a space is not a plain domain", () => {
    for (const entry of ["example.com/path", "example.com:8080", "exam ple.com", "https://example.com", "user@example.com"]) {
      const [issue] = siteIssues([entry]);
      assert.equal(issue?.index, 0, entry);
      assert.match(issue.message, /just the domain/i);
    }
  });

  test("every bad entry is reported, with its place in the list", () => {
    const issues = siteIssues(["a.example", "*", "b.example", "c.example/x"]);
    assert.deepEqual(issues.map(i => i.index), [1, 3]);
  });

  test("anything but a list, or entries that are not text, are reported or ignored without throwing", () => {
    assert.deepEqual(siteIssues(undefined), []);
    assert.deepEqual(siteIssues([5]).map(i => i.index), [0]);
  });
});

describe("validSites", () => {
  test("the plain domains stay, in order, and the bad entries are left out", () => {
    assert.deepEqual(validSites(["example.com", "*example.com", "example.com:800", "e 2", "example.org"]), ["example.com", "example.org"]);
  });

  test("a list without bad entries is the same", () => {
    assert.deepEqual(validSites(["example.com"]), ["example.com"]);
    assert.deepEqual(validSites([]), []);
  });
});

describe("parseSites and sitesText", () => {
  test("one site per line, trimmed, blank lines dropped", () => {
    assert.deepEqual(parseSites("example.com\n  example.org  \n\n   \nexample.net\n"), ["example.com", "example.org", "example.net"]);
  });

  test("Windows line breaks work too", () => {
    assert.deepEqual(parseSites("example.com\r\nexample.org\r\n"), ["example.com", "example.org"]);
  });

  test("empty text is an empty list", () => {
    assert.deepEqual(parseSites(""), []);
  });

  test("the text of a list is its entries, one per line", () => {
    assert.equal(sitesText(["example.com", "example.org"]), "example.com\nexample.org");
    assert.equal(sitesText([]), "");
  });

  test("text goes to a list and back without change", () => {
    const text = "example.com\nexample.org";
    assert.equal(sitesText(parseSites(text)), text);
  });
});
