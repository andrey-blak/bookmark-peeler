// The cleaning engine: applies a list of rules to a URL.
//
// rule = { id?, enabled?: true, scope, actions: [...] }  (see scope.js and actions.js)
//
// Rules run in list order, and the actions of a rule run in order.
// Each action sees the result of the previous one.
// Only the query changes; everything else in the URL stays byte-identical.
// The original string is returned when nothing changes.

import { splitUrl, joinUrl, parseQuery, serializeQuery } from "./query.js";
import { matchesScope } from "./scope.js";
import { applyAction } from "./actions.js";

export function isWebUrl(url) {
  try {
    const { protocol } = new URL(url);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

const describe = parameter => ({ name: parameter.name, value: parameter.value });

/**
 * Like cleanUrl, but also says what happened to each parameter of the original URL:
 *   { url, changes: [{ kind: "removed" | "changed", ruleId, before: { name, value }, after: { name, value } | null }] }
 * changes are in the order of the original URL; ruleId is the id of the first rule that touched the parameter
 * (null for a rule without an id). A parameter that ends up as it started is not a change.
 */
export function cleanUrlTraced(url, rules) {
  const unchanged = { url, changes: [] };
  if (!Array.isArray(rules) || !isWebUrl(url)) return unchanged;

  const { base, query, fragment } = splitUrl(url);
  // No query, or an empty one: nothing to clean.
  if (!query) return unchanged;

  const original = parseQuery(query);
  let parameters = original;
  let origins = original.map((_, index) => index); // for each current parameter, its index in the original
  const causes = new Array(original.length).fill(undefined); // the first rule to touch each original parameter

  for (const rule of rules) {
    if (!rule || rule.enabled === false || !Array.isArray(rule.actions)) continue;
    if (!matchesScope(rule.scope, url)) continue;

    for (const action of rule.actions) {
      const after = applyAction(action, parameters);

      if (after.length === parameters.length) {
        // A replace keeps the position of every parameter; a changed one is a new object.
        after.forEach((parameter, index) => {
          if (parameter !== parameters[index]) causes[origins[index]] ??= rule.id ?? null;
        });
      } else {
        // A remove keeps the objects it did not remove.
        const kept = after.map(parameter => parameters.indexOf(parameter));
        parameters.forEach((_, index) => {
          if (!kept.includes(index)) causes[origins[index]] ??= rule.id ?? null;
        });
        origins = kept.map(index => origins[index]);
      }

      parameters = after;
    }
  }

  const cleaned = serializeQuery(parameters);
  if (cleaned === query) return unchanged;

  const changes = [];
  original.forEach((before, index) => {
    const position = origins.indexOf(index);
    if (position < 0) {
      changes.push({ kind: "removed", ruleId: causes[index] ?? null, before: describe(before), after: null });
      return;
    }

    const after = parameters[position];
    if (serializeQuery([after]) !== serializeQuery([before])) {
      changes.push({ kind: "changed", ruleId: causes[index] ?? null, before: describe(before), after: describe(after) });
    }
  });

  // Every parameter removed: drop the "?" as well.
  return { url: joinUrl({ base, query: cleaned === "" ? null : cleaned, fragment }), changes };
}

export function cleanUrl(url, rules) {
  return cleanUrlTraced(url, rules).url;
}
