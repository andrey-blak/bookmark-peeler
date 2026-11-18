// Logic of the "Try it" panel in the rule editor, without DOM or browser APIs.

import { cleanUrlTraced, isWebUrl } from "../core/engine.js";
import { scopeMismatch } from "../core/scope.js";
import { isExcluded } from "../core/exclusions.js";
import { splitUrl } from "../core/query.js";
import { validateRule, hasErrors, usableRules } from "../core/schema.js";

/**
 * Runs a URL through the rules the way the add-on would, with the draft from the editor.
 *
 * @param input the text of the URL field
 * @param draft the rule in the editor, with its unsaved changes
 * @param rules the stored rules
 * @param excludedSites the list of excluded sites: in "All rules" mode nothing is cleaned on them, and in both modes a note says so
 * @param mode "current": only the draft. Anything else: all stored rules, in order, with the draft in place of its
 *   stored version (or after them when it is new).
 *
 * Returns { status: "empty" | "invalid" } or
 *   { status: "ok", url, segments, changes, notes }
 * where changes are those of cleanUrlTraced, segments mark the changed parts of the resulting URL, and notes
 * are sentences saying why the draft did nothing (errors, switched off, scope).
 */
export function testRules(input, { draft, rules, mode, excludedSites = [] }) {
  const url = input.trim();
  if (url === "") return { status: "empty" };
  if (!isWebUrl(url)) return { status: "invalid" };

  const notes = [];
  const excluded = isExcluded(url, excludedSites);
  const usable = !hasErrors(validateRule(draft));
  const stored = Array.isArray(rules) ? rules : [];
  let toRun;

  if (mode === "current") {
    toRun = usable ? [{ ...draft, enabled: true }] : [];
  } else {
    const exists = stored.some(rule => rule.id === draft.id);
    const merged = exists
      ? stored.map(rule => (rule.id === draft.id ? { ...draft, enabled: rule.enabled } : rule))
      : [...stored, draft];
    const candidates = usableRules(merged);

    if (usable && candidates.find(rule => rule.id === draft.id)?.enabled === false) {
      notes.push("This rule is switched off in the list, so it isn't applied.");
    }

    // On an excluded site the add-on does nothing, so no rule runs.
    toRun = excluded ? [] : candidates;
  }

  if (!usable) {
    notes.push("This rule has errors, so it isn't applied.");
  } else if (!notes.length) {
    const mismatch = scopeMismatch(draft.scope, url);
    if (mismatch === "except") notes.push("This rule doesn't apply to this URL: the site is in its exceptions.");
    else if (mismatch) notes.push(`This rule doesn't apply to this URL: the ${mismatch} doesn't match.`);
  }

  // In "Current rule" mode the rule's own change is still shown, with the note that the add-on would not make it.
  if (excluded) notes.push("This site is in the Excluded sites list, so nothing would be cleaned.");

  const { url: result, changes } = cleanUrlTraced(url, toRun);
  return { status: "ok", url: result, segments: highlightSegments(result, url), changes: mergeStrayRemovals(changes), notes };
}

const isStray = change => change.kind === "removed" && change.before.name === "" && change.before.value === null;

/**
 * Shows the empty parts of a query that a rule removed, the stray & signs of a URL like ?a=1&&b=2, as one change.
 * There is one for each rule that removed some, at the place of the first, however many were removed.
 */
export function mergeStrayRemovals(changes) {
  const seen = new Set();

  return changes.filter(change => {
    if (!isStray(change)) return true;
    if (seen.has(change.ruleId)) return false;

    seen.add(change.ruleId);
    return true;
  });
}

const showValue = value => (value === null ? "(no value)" : value);
// An empty part of the query, a stray &, has no name and no value.
const token = ({ name, value }) => (name === "" && value === null ? "&" : value === null ? name : `${name}=${value}`);

/** One line for a change: { kind, text }. */
export function describeChange({ kind, before, after }) {
  if (kind === "removed") return { kind, text: token(before) };

  if (before.name === after.name) {
    return { kind, text: `${before.name}: ${showValue(before.value)} → ${showValue(after.value)}` };
  }
  if (before.value === after.value) {
    const value = before.value === null ? "" : ` (value ${before.value})`;
    return { kind, text: `${before.name} → ${after.name}${value}` };
  }
  return { kind, text: `${token(before)} → ${token(after)}` };
}

/**
 * Splits the resulting URL into pieces, marking the parameters that are not in the original URL.
 * The pieces add up to `result`; neighbouring unmarked pieces are merged.
 */
export function highlightSegments(result, original) {
  const { base, query, fragment } = splitUrl(result);
  if (!query) return [{ text: result, changed: false }];

  const available = new Map();
  for (const piece of (splitUrl(original).query ?? "").split("&")) {
    available.set(piece, (available.get(piece) ?? 0) + 1);
  }

  const segments = [];
  const add = (text, changed) => {
    const last = segments[segments.length - 1];
    if (last && last.changed === changed) last.text += text;
    else segments.push({ text, changed });
  };

  add(base + "?", false);
  query.split("&").forEach((piece, index) => {
    if (index > 0) add("&", false);

    const left = available.get(piece) ?? 0;
    if (left > 0) available.set(piece, left - 1);
    add(piece, left === 0);
  });
  if (fragment !== null) add("#" + fragment, false);

  return segments;
}
