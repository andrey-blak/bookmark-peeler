// Rule scope matching: does a rule apply to a given URL?
//
// scope = { type: "all", except? }
//       | { type: "host", host, subdomains?, path?, except? }
//
// host: "example.com".
//   With subdomains (default true) www.example.com matches too.
// path: optional.
//   A path without wildcards matches exactly.
//   In a pattern, * matches anything except /, and ** matches anything including /.
//   A trailing slash is ignored.
//   Matching is case-sensitive and runs on the percent-decoded path.
//   Port, query and fragment are never part of the match.
// except: optional list of domains where the scope does not match, whatever the rest says.
//   An entry is a plain domain and covers its subdomains, like the list of excluded sites.

/** Lower-cased ASCII (punycode) host name, or null when the text cannot be a plain host name. */
export function normalizeHost(host) {
  // No wildcards: "*" would be accepted by the URL parser but can never match a real host.
  if (typeof host !== "string" || host === "" || /[\/?#@:*\s]/.test(host)) return null;

  try {
    return new URL("http://" + host).hostname || null;
  } catch {
    return null;
  }
}

export function hostMatches(host, subdomains, hostname) {
  const expected = normalizeHost(host);
  if (expected === null) return false;

  const actual = hostname.toLowerCase();
  return actual === expected
    || (subdomains !== false && actual.endsWith("." + expected));
}

function decodePath(path) {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

// "/video/" -> "/video", "video" -> "/video", "/" -> ""
function normalizePath(path) {
  const withSlash = path.startsWith("/") ? path : "/" + path;
  return withSlash.replace(/\/+$/, "");
}

function globToRegExp(glob) {
  let source = "";

  for (let i = 0; i < glob.length; i++) {
    if (glob[i] === "*") {
      if (glob[i + 1] === "*") {
        source += ".*";
        i++;
      } else {
        source += "[^/]*";
      }
    } else {
      source += glob[i].replace(/[.+?^${}()|[\]\\]/g, "\\$&");
    }
  }

  return new RegExp("^" + source + "$");
}

export function pathMatches(pattern, pathname) {
  if (!pattern) return true;

  return globToRegExp(normalizePath(pattern))
    .test(normalizePath(decodePath(pathname)));
}

// The entries of a list of sites that can be used, trimmed. Entries that are not a plain domain match nothing.
const usableSites = sites => (Array.isArray(sites) ? sites : [])
  .filter(entry => typeof entry === "string")
  .map(entry => entry.trim())
  .filter(entry => entry !== "");

const onSiteList = (hostname, sites) => usableSites(sites).some(entry => hostMatches(entry, true, hostname));

/** Whether the URL is on one of the sites, or on a subdomain of one. */
export function isExcluded(url, sites) {
  try {
    return onSiteList(new URL(url).hostname, sites);
  } catch {
    return false;
  }
}

export function matchesScope(scope, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

  if (onSiteList(parsed.hostname, scope?.except)) return false;

  switch (scope?.type) {
    case "all":
      return true;
    case "host":
      return hostMatches(scope.host, scope.subdomains, parsed.hostname)
        && pathMatches(scope.path, parsed.pathname);
    default:
      return false;
  }
}

/**
 * Why a scope does not match a URL: "domain", "path" (the domain matches, the path does not),
 * or "except" (the scope would match, but the URL is on one of its excepted sites).
 * null when it matches, and also when there is nothing sensible to say: not a URL, or not a valid scope.
 */
export function scopeMismatch(scope, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (scope?.type !== "host" && scope?.type !== "all") return null;

  if (scope.type === "host") {
    if (!hostMatches(scope.host, scope.subdomains, parsed.hostname)) return "domain";
    if (!pathMatches(scope.path, parsed.pathname)) return "path";
  }

  return onSiteList(parsed.hostname, scope.except) ? "except" : null;
}
