// Raw URL query handling.
//
// URL and URLSearchParams re-encode the whole query when it is serialised (%20 becomes +, ~ becomes %7E, ...).
// Here the URL is split by plain string operations and every parameter keeps its original text,
// so a parameter nobody touched comes back byte-for-byte identical.

/**
 * Splits a URL string into base, query and fragment without normalising anything.
 * query and fragment are null when absent and "" when present but empty
 * (so "https://example.com/?" and "https://example.com/" are told apart).
 */
export function splitUrl(url) {
  const hash = url.indexOf("#");
  const fragment = hash < 0 ? null : url.slice(hash + 1);
  const rest = hash < 0 ? url : url.slice(0, hash);

  const mark = rest.indexOf("?");
  const query = mark < 0 ? null : rest.slice(mark + 1);
  const base = mark < 0 ? rest : rest.slice(0, mark);

  return { base, query, fragment };
}

/** Inverse of splitUrl. */
export function joinUrl({ base, query, fragment }) {
  return base
    + (query === null ? "" : "?" + query)
    + (fragment === null ? "" : "#" + fragment);
}

function decode(text) {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    // Malformed escape such as %zz: matching works on the raw text instead.
    return text;
  }
}

/**
 * Parses a query string (without the leading "?") into parameters:
 *   { rawName, rawValue, name, value }
 * rawName / rawValue are the original text; name / value are decoded, for matching.
 * rawValue and value are null when there is no "=" ("a"), and "" when it is empty ("a=").
 * Empty segments ("a=1&&b=2") are kept as parameters with an empty name.
 */
export function parseQuery(query) {
  if (query === null || query === "") return [];

  return query.split("&").map(segment => {
    const eq = segment.indexOf("=");
    const rawName = eq < 0 ? segment : segment.slice(0, eq);
    const rawValue = eq < 0 ? null : segment.slice(eq + 1);

    return {
      rawName,
      rawValue,
      name: decode(rawName),
      value: rawValue === null ? null : decode(rawValue),
    };
  });
}

/** Inverse of parseQuery; uses the raw text of each parameter. */
export function serializeQuery(parameters) {
  return parameters
    .map(p => p.rawName + (p.rawValue === null ? "" : "=" + p.rawValue))
    .join("&");
}
