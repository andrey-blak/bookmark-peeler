// Rule actions: what a rule does to the query parameters of a matching URL.
//
// Parameters come from parseQuery (see query.js).
// An action returns a new array and never modifies its input.
// Parameters it does not touch are passed through as the same objects, so their raw text is kept.
// A changed parameter name or value is re-encoded with encodeURIComponent; its unchanged counterpart keeps its raw text.
//
// remove:  { type: "remove", parameter: "pp" | "utm_*" }
// replace: { type: "replace",
//            parameter?: { find, replace? },
//            value?:     { find, replace? },
//            ignoreCase?: false }
//   find is a regular expression, run on the decoded parameter name or value; an empty or missing find is no condition.
//   A parameter qualifies when every non-empty find matches.
//   A parameter without a value ("fbclid") never matches a value find.
//   replace replaces every match; without replace the pattern only filters.
//   The replacement text supports the String.replace patterns: $1, $<name>, $&, $` (text before the match), $' (text after the match), $$.
//   "Before" and "after" mean the rest of that parameter name or value, not of the whole URL.
//   The parameter name and the value are each replaced from their original text, not from the other part's result.
//   An invalid regex disables the whole action.

/**
 * Does a parameter name match a pattern?
 * A plain pattern matches exactly; * matches any run of characters (also written **).
 * Matching is case-sensitive, like on the server.
 * An empty pattern matches nothing.
 */
export function nameMatches(pattern, name) {
  if (!pattern) return false;

  const source = pattern
    .split(/\*+/)
    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");

  return new RegExp("^" + source + "$", "s").test(name);
}

function removeParameters(action, parameters) {
  return parameters.filter(p => !nameMatches(action.parameter, p.name));
}

const INVALID = Symbol("invalid regex");

// One side (parameter or value) of a replace action: null when it has no find, INVALID when the regex is bad.
function compilePart(part, ignoreCase) {
  if (typeof part?.find !== "string" || part.find === "") return null;

  try {
    return {
      test: new RegExp(part.find, ignoreCase ? "i" : ""),
      all: new RegExp(part.find, ignoreCase ? "gi" : "g"),
      replace: typeof part.replace === "string" ? part.replace : null,
    };
  } catch {
    return INVALID;
  }
}

function replaceParameters(action, parameters) {
  const ignoreCase = action.ignoreCase === true;
  const parameter = compilePart(action.parameter, ignoreCase);
  const value = compilePart(action.value, ignoreCase);

  if (parameter === INVALID || value === INVALID) return parameters;
  if (parameter?.replace == null && value?.replace == null) return parameters;

  return parameters.map(p => {
    if (parameter && !parameter.test.test(p.name)) return p;
    if (value && (p.value === null || !value.test.test(p.value))) return p;

    let { rawName, name: newName, rawValue, value: newValue } = p;

    try {
      if (parameter?.replace != null) {
        const replaced = p.name.replace(parameter.all, parameter.replace);
        // A parameter with an empty name is never produced.
        if (replaced !== p.name && replaced !== "") {
          newName = replaced;
          rawName = encodeURIComponent(replaced);
        }
      }

      if (value?.replace != null) {
        const replaced = p.value.replace(value.all, value.replace);
        if (replaced !== p.value) {
          newValue = replaced;
          rawValue = encodeURIComponent(replaced);
        }
      }
    } catch {
      // The result cannot be encoded (a lone surrogate): leave the parameter as it was.
      return p;
    }

    if (newName === p.name && newValue === p.value) return p;
    return { rawName, rawValue, name: newName, value: newValue };
  });
}

export function applyAction(action, parameters) {
  switch (action?.type) {
    case "remove":
      return removeParameters(action, parameters);
    case "replace":
      return replaceParameters(action, parameters);
    default:
      return parameters;
  }
}
