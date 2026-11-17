// Rule scope matching: does a rule apply to a given URL?
//
// scope = { type: "all" }
//       | { type: "host", host, subdomains?, path? }
//
// host: "example.com".
//   With subdomains (default true) www.example.com matches too.
// path: optional.
//   A path without wildcards matches exactly.
//   In a pattern, * matches anything except /, and ** matches anything including /.
//   A trailing slash is ignored.
//   Matching is case-sensitive and runs on the percent-decoded path.
//   Port, query and fragment are never part of the match.

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

export function matchesScope(scope, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }

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
 * Why a scope does not match a URL: "domain", or "path" (the domain matches, the path does not).
 * null when it matches, and also when there is nothing sensible to say: not a URL, or not a valid scope.
 */
export function scopeMismatch(scope, url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (scope?.type !== "host") return null;
  if (!hostMatches(scope.host, scope.subdomains, parsed.hostname)) return "domain";
  return pathMatches(scope.path, parsed.pathname) ? null : "path";
}
