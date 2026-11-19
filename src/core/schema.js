// Stored data format: defaults, normalisation and validation.
// The format is described in docs/storage.md.
//
// Normalising fills defaults, drops unknown fields and makes sure every rule has a unique id.
// It keeps invalid values (an unknown scope type, an empty host) so that validation can report them and the user can fix them.
// Validation returns issues; it never throws.

import { normalizeHost } from "./scope.js";
import { siteIssues } from "./exclusions.js";
import { t } from "./text.js";

export const SCHEMA_VERSION = 1;

/** The longest a rule's name can be, in characters. Longer names are cut when a rule is normalised. */
export const NAME_MAX = 64;

/** How long the Undo message stays, in seconds: the default and the limits of the setting. */
export const UNDO_SECONDS_DEFAULT = 8;
export const UNDO_SECONDS_MIN = 1;
export const UNDO_SECONDS_MAX = 60;

/** Whether a value can be the number of seconds Undo stays: a whole number within the limits. */
export const validUndoSeconds = value =>
  Number.isInteger(value) && value >= UNDO_SECONDS_MIN && value <= UNDO_SECONDS_MAX;

export function defaultConfig() {
  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { cleanOnEdit: false, excludedSites: [], undoSeconds: UNDO_SECONDS_DEFAULT },
    rules: [],
  };
}

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);
const isText = value => typeof value === "string";
/** A new rule id: 8 random characters of lower-case hexadecimal. Only unique within one list, and normalising replaces a repeated id. */
export const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), byte => byte.toString(16).padStart(2, "0")).join("");

// --- Normalisation ---

// The entries of a list that are text, trimmed, without blank ones.
const cleanList = list => (Array.isArray(list) ? list : []).filter(isText).map(entry => entry.trim()).filter(entry => entry !== "");

function normalizeScope(raw) {
  if (!isObject(raw)) return {};

  const except = cleanList(raw.except);

  if (raw.type === "all") return except.length > 0 ? { type: "all", except } : { type: "all" };

  if (raw.type === "host") {
    const scope = {
      type: "host",
      host: isText(raw.host) ? raw.host.trim() : "",
      subdomains: raw.subdomains !== false,
    };
    if (isText(raw.path) && raw.path.trim() !== "") scope.path = raw.path.trim();
    if (except.length > 0) scope.except = except;
    return scope;
  }

  return isText(raw.type) ? { type: raw.type } : {};
}

function normalizePart(raw) {
  if (!isObject(raw)) return undefined;

  const part = { find: isText(raw.find) ? raw.find : "" };
  if (isText(raw.replace)) part.replace = raw.replace;
  return part;
}

function normalizeAction(raw) {
  if (!isObject(raw)) return {};

  switch (raw.type) {
    case "remove":
      return { type: "remove", parameter: isText(raw.parameter) ? raw.parameter : "" };

    case "keep":
      return {
        type: "keep",
        parameters: (Array.isArray(raw.parameters) ? raw.parameters : [])
          .filter(isText)
          .map(entry => entry.trim())
          .filter(entry => entry !== ""),
      };

    case "replace": {
      const action = { type: "replace" };
      const parameter = normalizePart(raw.parameter);
      const value = normalizePart(raw.value);
      if (parameter) action.parameter = parameter;
      if (value) action.value = value;
      action.ignoreCase = raw.ignoreCase === true;
      return action;
    }

    default:
      return isText(raw.type) ? { type: raw.type } : {};
  }
}

export function normalizeRule(raw) {
  const source = isObject(raw) ? raw : {};

  const rule = {
    id: isText(source.id) && source.id !== "" ? source.id : newId(),
    enabled: source.enabled !== false,
  };
  if (isText(source.name) && source.name.trim() !== "") {
    // Counted in characters, not UTF-16 units, so a character outside the basic alphabet is never split.
    rule.name = Array.from(source.name.trim()).slice(0, NAME_MAX).join("").trimEnd();
  }

  rule.scope = normalizeScope(source.scope);
  rule.actions = Array.isArray(source.actions) ? source.actions.map(normalizeAction) : [];
  return rule;
}

export function normalizeConfig(raw) {
  const source = isObject(raw) ? raw : {};
  const seenIds = new Set();

  const rules = (Array.isArray(source.rules) ? source.rules : [])
    .filter(isObject)
    .map(normalizeRule)
    .map(rule => {
      const unique = seenIds.has(rule.id) ? { ...rule, id: newId() } : rule;
      seenIds.add(unique.id);
      return unique;
    });

  return {
    schemaVersion: SCHEMA_VERSION,
    settings: {
      cleanOnEdit: source.settings?.cleanOnEdit === true,
      undoSeconds: validUndoSeconds(source.settings?.undoSeconds) ? source.settings.undoSeconds : UNDO_SECONDS_DEFAULT,
      // Trimmed. An entry that is not a plain domain is dropped.
      excludedSites: (Array.isArray(source.settings?.excludedSites) ? source.settings.excludedSites : [])
        .filter(isText)
        .map(entry => entry.trim())
        .filter(entry => entry !== "" && normalizeHost(entry) !== null),
    },
    rules,
  };
}

/**
 * Reads what the store returned.
 * Empty storage and data without a schema version give the defaults.
 * A schema version this code does not know (newer, or not a positive integer) is reported as "unsupported"
 * and must not be overwritten.
 */
export function readConfig(stored) {
  const version = stored?.schemaVersion;

  if (version === undefined) return { status: "ok", config: defaultConfig() };

  if (!Number.isInteger(version) || version < 1 || version > SCHEMA_VERSION) {
    return { status: "unsupported", version };
  }

  return { status: "ok", config: normalizeConfig(stored) };
}

// --- Validation ---

const error = (path, message) => ({ path, severity: "error", message });
const warning = (path, message) => ({ path, severity: "warning", message });

// The sites where the rule does nothing must be plain domains. A bad entry is an error, so the rule is not applied
// instead of running on a site that was meant to be left alone.
function validateExceptions(except) {
  if (except === undefined) return [];
  if (!Array.isArray(except)) return [error(["scope", "except"], t("issue.except-not-list"))];

  const issues = siteIssues(except);
  if (issues.length === 0) return [];

  return [error(["scope", "except"], issues.map(issue => t("issue.except-entry", { entry: issue.entry, message: issue.message })).join(" "))];
}

function validateScope(scope) {
  if (scope?.type === "all") return validateExceptions(scope.except);

  if (scope?.type !== "host") return [error(["scope", "type"], t("issue.scope-type"))];

  const issues = [];

  if (!isText(scope.host) || scope.host.trim() === "") {
    issues.push(error(["scope", "host"], t("issue.host-empty")));
  } else if (scope.host.includes("*")) {
    issues.push(error(["scope", "host"], t("issue.host-wildcard")));
  } else if (normalizeHost(scope.host.trim()) === null) {
    issues.push(error(["scope", "host"], t("site.invalid")));
  }

  if (scope.path !== undefined) {
    if (!isText(scope.path)) {
      issues.push(error(["scope", "path"], t("issue.path-text")));
    } else if (/[?#]/.test(scope.path)) {
      issues.push(error(["scope", "path"], t("issue.path-chars")));
    }
  }

  issues.push(...validateExceptions(scope.except));
  return issues;
}

function regexProblem(find) {
  try {
    new RegExp(find);
    return null;
  } catch (e) {
    return e.message;
  }
}

function validateReplace(action, path) {
  const issues = [];
  const parts = ["parameter", "value"].filter(key => isObject(action[key]));
  const hasPattern = key => isText(action[key]?.find) && action[key].find !== "";

  for (const key of parts) {
    const part = action[key];

    if (part.find !== undefined && !isText(part.find)) {
      issues.push(error([...path, key, "find"], t("issue.pattern-text")));
    } else if (hasPattern(key)) {
      const problem = regexProblem(part.find);
      if (problem) issues.push(error([...path, key, "find"], t("issue.regex-invalid", { problem })));
    } else if (part.replace !== undefined && (hasPattern("parameter") || hasPattern("value"))) {
      // Without any pattern the error for the whole action says it already.
      issues.push(warning([...path, key, "find"], t(key === "parameter" ? "issue.pattern-missing-parameter" : "issue.pattern-missing-value")));
    }

    if (part.replace !== undefined && !isText(part.replace)) {
      issues.push(error([...path, key, "replace"], t("issue.replacement-text")));
    }
  }

  if (!hasPattern("parameter") && !hasPattern("value")) {
    issues.push(error(path, t("issue.pattern-none")));
  } else if (!parts.some(key => isText(action[key].replace))) {
    issues.push(warning(path, t("issue.replace-nothing")));
  }

  return issues;
}

function validateAction(action, index) {
  const path = ["actions", index];

  switch (action?.type) {
    case "remove":
      return isText(action.parameter) && action.parameter !== ""
        ? []
        : [error([...path, "parameter"], t("issue.remove-parameter"))];

    case "replace":
      return validateReplace(action, path);

    case "keep": {
      const list = action.parameters;
      const at = [...path, "parameters"];

      if (!Array.isArray(list)) return [error(at, t("issue.keep-empty"))];
      if (!list.every(isText)) return [error(at, t("issue.keep-text"))];
      if (!list.some(entry => entry.trim() !== "")) return [error(at, t("issue.keep-empty"))];
      return [];
    }

    default:
      return [error([...path, "type"], t("issue.action-unknown"))];
  }
}

/** Returns a list of { path, severity: "error" | "warning", message }. Empty when the rule is fine. */
export function validateRule(rule) {
  const source = isObject(rule) ? rule : {};
  const issues = validateScope(source.scope);

  if (!Array.isArray(source.actions) || source.actions.length === 0) {
    issues.push(warning(["actions"], t("issue.no-actions")));
  } else {
    source.actions.forEach((action, index) => issues.push(...validateAction(action, index)));
  }

  return issues;
}

export function hasErrors(issues) {
  return issues.some(issue => issue.severity === "error");
}

/** The rules that may be applied: those without errors. Rules with only warnings are kept. */
export function usableRules(rules) {
  return Array.isArray(rules) ? rules.filter(rule => !hasErrors(validateRule(rule))) : [];
}
