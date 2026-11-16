// The cleaning engine: applies a list of rules to a URL.
//
// rule = { enabled?: true, scope, actions: [...] }  (see scope.js and actions.js)
//
// Rules run in list order, and the actions of a rule run in order.
// Each action sees the result of the previous one.
// Only the query changes; everything else in the URL stays byte-identical.
// The original string is returned when nothing changes.

import { splitUrl, joinUrl, parseQuery, serializeQuery } from "./query.js";
import { matchesScope } from "./scope.js";
import { applyAction } from "./actions.js";

function isWebUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

export function cleanUrl(url, rules) {
  if (!Array.isArray(rules) || !isWebUrl(url)) return url;

  const { base, query, fragment } = splitUrl(url);
  // No query, or an empty one: nothing to clean.
  if (!query) return url;

  let parameters = parseQuery(query);

  for (const rule of rules) {
    if (!rule || rule.enabled === false || !Array.isArray(rule.actions)) continue;
    if (!matchesScope(rule.scope, url)) continue;

    for (const action of rule.actions) {
      parameters = applyAction(action, parameters);
    }
  }

  const cleaned = serializeQuery(parameters);
  if (cleaned === query) return url;

  // Every parameter removed: drop the "?" as well.
  return joinUrl({ base, query: cleaned === "" ? null : cleaned, fragment });
}
