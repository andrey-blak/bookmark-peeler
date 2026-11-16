// Logic of the rule editor, without DOM or browser APIs.
//
// The editor works on a draft: a copy of the rule that is changed freely and saved or thrown away as a whole.
// Every function here returns a new object and leaves its input alone.
// A field is addressed by its path, an array such as ["actions", 0, "value", "find"]; pathKey() turns it into
// "actions.0.value.find" for use as an id in the DOM and in the set of fields the user has touched.

import { normalizeRule } from "../core/schema.js";

export const pathKey = path => path.join(".");

/** A new rule: enabled, scope Domain with an empty domain, no actions. */
export function newDraft() {
  return normalizeRule({ scope: { type: "host", host: "", subdomains: true }, actions: [] });
}

/** Returns a copy of `target` with the value at `path` set; missing objects on the way are created. */
export function setIn(target, path, value) {
  if (path.length === 0) return value;

  const [key, ...rest] = path;
  const copy = Array.isArray(target) ? [...target] : { ...(target ?? {}) };
  copy[key] = setIn(target?.[key], rest, value);
  return copy;
}

/** Returns a copy of `target` without the key or array element at `path`. A path that does not exist changes nothing. */
export function unsetIn(target, path) {
  if (target === null || typeof target !== "object") return target;

  const [key, ...rest] = path;
  if (!(key in target)) return target;

  if (rest.length > 0) {
    const copy = Array.isArray(target) ? [...target] : { ...target };
    copy[key] = unsetIn(target[key], rest);
    return copy;
  }

  if (Array.isArray(target)) return target.filter((_, index) => index !== Number(key));

  const { [key]: removed, ...others } = target;
  return others;
}

// --- Scope ---

/** The three choices of the Scope select: "all", "host" (domain) and "path" (domain + path). */
export function scopeMode(scope) {
  if (scope?.type === "all") return "all";
  return typeof scope?.path === "string" ? "path" : "host";
}

/**
 * Switches the Scope select. The fields of the other modes are kept, so going to All sites and back
 * brings the domain and the path back; they are dropped when the rule is stored.
 */
export function setScopeMode(scope, mode) {
  if (mode === "all") return { ...scope, type: "all" };

  const host = { ...scope, type: "host", host: scope.host ?? "", subdomains: scope.subdomains ?? true };

  if (mode === "path") return { ...host, path: scope.path ?? "" };

  const { path, ...withoutPath } = host;
  return withoutPath;
}

// --- Actions ---

const NEW_ACTIONS = {
  remove: () => ({ type: "remove", parameter: "" }),
  // Parameter: a filter only. Value: its replacement is ticked and empty.
  replace: () => ({ type: "replace", parameter: { find: "" }, value: { find: "", replace: "" }, ignoreCase: false }),
};

export function addAction(draft, type) {
  const make = NEW_ACTIONS[type];
  if (!make) return draft;

  return { ...draft, actions: [...(draft.actions ?? []), make()] };
}

// --- Validation messages ---

/**
 * The issues that may be shown now: those of fields the user has touched, or all of them when `showAll`.
 * An issue belongs to a touched field when its path is that field's path or a parent of it,
 * so typing in a field of an action also shows the issue of the whole action.
 */
export function visibleIssues(issues, touched, showAll = false) {
  if (showAll) return issues;

  return issues.filter(issue => {
    const key = pathKey(issue.path);
    return [...touched].some(field => field === key || field.startsWith(key + "."));
  });
}

const count = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** The line next to the Save button; empty when there is nothing to say. */
export function summaryText(issues) {
  const errors = issues.filter(issue => issue.severity === "error").length;
  const warnings = issues.length - errors;

  if (errors > 0) {
    const found = warnings > 0 ? `${count(errors, "error")} and ${count(warnings, "warning")}` : count(errors, "error");
    return `${found}. The rule isn't applied until the ${errors === 1 ? "error is" : "errors are"} fixed.`;
  }

  return warnings > 0 ? `${count(warnings, "warning")}.` : "";
}

// --- Drafts ---

const stored = rule => {
  // The switch in the list owns `enabled`, so it is not part of what the editor changes.
  const { enabled, ...rest } = normalizeRule(rule);
  return JSON.stringify(rest);
};

/** Does the draft differ from the rule it started from, in anything that would be stored? */
export function isDirty(draft, baseline) {
  return stored(draft) !== stored(baseline);
}

/** An unsaved copy of a rule with its own id; a named rule gets "<name> copy". */
export function duplicateDraft(rule) {
  const copy = structuredClone(rule);
  delete copy.id;

  if (typeof copy.name === "string" && copy.name.trim() !== "") copy.name = `${copy.name.trim()} copy`;
  return normalizeRule(copy);
}

/** Ctrl+S. */
export function isSaveKey({ key, ctrlKey, shiftKey, altKey, metaKey }) {
  return ctrlKey === true && !shiftKey && !altKey && !metaKey && key.toLowerCase() === "s";
}
