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
  // The lines of the text box, as typed: blank lines and spaces are dropped when the rule is stored.
  keep: () => ({ type: "keep", parameters: [] }),
  // Parameter: a filter only. Value: its replacement is ticked and empty.
  replace: () => ({ type: "replace", parameter: { find: "" }, value: { find: "", replace: "" }, ignoreCase: false }),
};

export function addAction(draft, type) {
  const make = NEW_ACTIONS[type];
  if (!make) return draft;

  return { ...draft, actions: [...(draft.actions ?? []), make()] };
}

/** Moves the action at `from` to position `to` (clamped to the list), as the actions run top to bottom. */
export function moveAction(draft, from, to) {
  const actions = draft.actions;
  if (!Array.isArray(actions) || !Number.isInteger(from) || from < 0 || from >= actions.length) return draft;

  const target = Math.max(0, Math.min(to, actions.length - 1));
  const moved = [...actions];
  const [action] = moved.splice(from, 1);
  moved.splice(target, 0, action);
  return { ...draft, actions: moved };
}

/**
 * The set of touched fields after the action at `from` was moved to `to`: what was touched in the moved action
 * follows it, and the actions it passed shift by one, so messages stay with their action.
 */
export function remapTouched(touched, from, to) {
  const shift = index => {
    if (index === from) return to;
    if (from < to && index > from && index <= to) return index - 1;
    if (to < from && index >= to && index < from) return index + 1;
    return index;
  };

  return new Set([...touched].map(key => {
    const match = /^actions\.(\d+)(.*)$/.exec(key);
    return match ? `actions.${shift(Number(match[1]))}${match[2]}` : key;
  }));
}

/**
 * The set of touched fields after the action at `index` was removed: what belongs to it is dropped,
 * and the actions after it shift down by one, so messages stay with their action.
 */
export function remapTouchedAfterRemove(touched, index) {
  const result = new Set();

  for (const key of touched) {
    const match = /^actions\.(\d+)(.*)$/.exec(key);
    if (!match) {
      result.add(key);
      continue;
    }

    const position = Number(match[1]);
    if (position === index) continue;
    result.add(`actions.${position > index ? position - 1 : position}${match[2]}`);
  }

  return result;
}

/**
 * The position to give moveAction when the action at `from` is dropped on the action at `over`,
 * on its lower half (`after`) or upper half.
 */
export function actionDropIndex(from, over, after) {
  const to = over + (after ? 1 : 0);
  return from < to ? to - 1 : to;
}

// --- Validation messages ---

/**
 * The issues that may be shown now: those of fields the user has touched, or all of them when `showAll`.
 * An issue belongs to a touched field when its path is that field's path or a parent of it,
 * so typing in a field of an action also shows the issue of the whole action.
 * A touched key that ends in ".*", such as "actions.0.*", reveals everything inside that path.
 */
export function visibleIssues(issues, touched, showAll = false) {
  if (showAll) return issues;

  return issues.filter(issue => {
    const key = pathKey(issue.path);

    return [...touched].some(field => {
      if (field.endsWith(".*")) {
        const base = field.slice(0, -2);
        return key === base || key.startsWith(base + ".");
      }
      return field === key || field.startsWith(key + ".");
    });
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

/**
 * Save does something when the rule is new, so it is not stored yet, or differs from the stored one.
 * A new rule from Duplicate or a preset is unchanged but can still be saved.
 */
export function canSave(draft, baseline, isNew) {
  return isNew || isDirty(draft, baseline);
}

/** Revert does something only when the draft differs from where it started. */
export function canRevert(draft, baseline) {
  return isDirty(draft, baseline);
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

// --- Action cards ---

const isFilled = value => typeof value === "string" && value.trim() !== "";

/** One line about an action, shown on its card while it is collapsed. */
export function actionSummary(action) {
  switch (action?.type) {
    case "remove":
      return isFilled(action.parameter) ? action.parameter : "(empty)";

    case "keep": {
      const parameters = (Array.isArray(action.parameters) ? action.parameters : []).filter(isFilled);
      return parameters.length > 0 ? parameters.join(", ") : "(empty)";
    }

    case "replace": {
      const part = (label, spec) => {
        if (!isFilled(spec?.find)) return null;
        if (typeof spec.replace !== "string") return `${label}: ${spec.find}`;
        return `${label}: ${spec.find} → ${spec.replace === "" ? "(nothing)" : spec.replace}`;
      };
      const parts = [part("name", action.parameter), part("value", action.value)].filter(Boolean);
      return parts.length > 0 ? parts.join("; ") : "(empty)";
    }

    default:
      return "";
  }
}

/** Which cards of a rule start collapsed: all of them when it has several actions, none when it has one or none. */
export function startCollapsed(draft) {
  const count = Array.isArray(draft?.actions) ? draft.actions.length : 0;
  return Array.from({ length: count }, () => count > 1);
}

/** The list with the entry at `from` moved to `to` (clamped), the way moveAction moves an action. */
export function moveFlag(flags, from, to) {
  const target = Math.max(0, Math.min(to, flags.length - 1));
  const moved = [...flags];
  const [flag] = moved.splice(from, 1);
  moved.splice(target, 0, flag);
  return moved;
}

/** The positions of the actions that have an error, from the issues of a rule. */
export function cardsWithErrors(issues) {
  const found = new Set();
  for (const issue of issues) {
    if (issue.severity === "error" && issue.path[0] === "actions" && Number.isInteger(issue.path[1])) found.add(issue.path[1]);
  }
  return found;
}
