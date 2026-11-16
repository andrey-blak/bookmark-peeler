// Rule actions: what a rule does to the query parameters of a matching URL.
//
// Parameters come from parseQuery (see query.js). An action returns a new array and never modifies its input;
// parameters it does not touch are passed through as the same objects, so their raw text is kept.
//
// remove: { type: "remove", param: "pp" | "utm_*" }

/**
 * Does a parameter name match a pattern? A plain pattern matches exactly; * matches any run of characters
 * (also written **). Matching is case-sensitive, like on the server. An empty pattern matches nothing.
 */
export function nameMatches(pattern, name) {
  if (!pattern) return false;

  const source = pattern
    .split(/\*+/)
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp("^" + source + "$", "s").test(name);
}

function removeParams(action, params) {
  return params.filter(p => !nameMatches(action.param, p.name));
}

export function applyAction(action, params) {
  switch (action?.type) {
    case "remove":
      return removeParams(action, params);
    default:
      return params;
  }
}
