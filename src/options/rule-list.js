// Logic of the rule list on the options page, without any DOM or browser API.
// Every function returns a new array or object and leaves its input alone.

import { validateRule, hasErrors } from "../core/schema.js";

const inRange = (index, length) => Number.isInteger(index) && index >= 0 && index < length;

/** Moves the rule at `from` to position `to`; `to` is clamped to the list. */
export function moveRule(rules, from, to) {
  const result = [...rules];
  if (!inRange(from, result.length)) return result;

  const target = Math.max(0, Math.min(to, result.length - 1));
  const [moved] = result.splice(from, 1);
  result.splice(target, 0, moved);
  return result;
}

/**
 * The position to give moveRule when the rule at `from` is dropped on the rule at `over`,
 * on its lower half (`after`) or upper half.
 */
export function dropIndex(from, over, after) {
  const to = over + (after ? 1 : 0);
  return from < to ? to - 1 : to;
}

/**
 * Saves a rule from the editor: replaces the rule with the same id, or appends a new one.
 * The stored `enabled` state is kept, because the editor does not change it.
 */
export function upsertRule(rules, rule) {
  const index = rules.findIndex(existing => existing.id === rule.id);
  if (index < 0) return { rules: [...rules, rule], index: rules.length };

  const result = [...rules];
  result[index] = { ...rule, enabled: rules[index].enabled };
  return { rules: result, index };
}

/** Returns the remaining rules and what was removed ({ rule, index }, or null), for restoreRule. */
export function removeRule(rules, index) {
  const result = [...rules];
  if (!inRange(index, result.length)) return { rules: result, removed: null };

  const [rule] = result.splice(index, 1);
  return { rules: result, removed: { rule, index } };
}

/** Puts a removed rule back at its old position, or at the end when the list has got shorter. */
export function restoreRule(rules, removed) {
  const result = [...rules];
  if (!removed) return result;

  result.splice(Math.min(removed.index, result.length), 0, removed.rule);
  return result;
}

export function setEnabled(rules, index, enabled) {
  return rules.map((rule, i) => (i === index ? { ...rule, enabled } : rule));
}

/** Short text for where a rule applies: "All sites", "youtube.com/watch". Empty when the scope is incomplete. */
export function scopeLabel(scope) {
  if (scope?.type === "all") return "All sites";

  const host = typeof scope?.host === "string" ? scope.host.trim() : "";
  if (scope?.type !== "host" || host === "") return "";

  let label = host;
  if (typeof scope.path === "string" && scope.path !== "") {
    label += scope.path.startsWith("/") ? scope.path : "/" + scope.path;
  }
  if (scope.subdomains === false) label += " (no subdomains)";
  return label;
}

/** The name of the rule, else where it applies, else a placeholder. */
export function ruleTitle(rule) {
  return rule.name || scopeLabel(rule.scope) || "Untitled rule";
}

/** Where the rule applies, shown under the name. Empty when the title already says it. */
export function ruleSubtitle(rule) {
  return rule.name ? scopeLabel(rule.scope) : "";
}

/** The capital letter shown for a rule when the list is collapsed. */
export function ruleInitial(rule) {
  return Array.from(ruleTitle(rule))[0].toUpperCase();
}

/** "error" (not applied), "warning" (applied, but probably not what was meant), or null. */
export function ruleStatus(rule) {
  const issues = validateRule(rule);
  if (hasErrors(issues)) return "error";
  return issues.length > 0 ? "warning" : null;
}

/**
 * What a key press means for the rule list; anything else is not ours (null).
 * Up and Down select a rule, Ctrl+Up and Ctrl+Down move it.
 * Delete deletes it, Enter and Space switch it on or off, Ctrl+Z undoes the last delete.
 * [ collapses or expands the list.
 */
export function keyCommand({ key, ctrlKey, shiftKey, altKey, metaKey }) {
  if (shiftKey || altKey || metaKey) return null;

  if (key === "ArrowUp" || key === "ArrowDown") {
    const delta = key === "ArrowUp" ? -1 : 1;
    return { type: ctrlKey ? "move" : "select", delta };
  }

  if (key.toLowerCase() === "z") return ctrlKey ? { type: "undo" } : null;
  if (key === "[") return ctrlKey ? null : { type: "collapse" };

  if (ctrlKey) return null;
  if (key === "Delete") return { type: "delete" };
  if (key === "Enter" || key === " ") return { type: "toggle" };
  return null;
}

/** The index selected after pressing Up or Down; -1 means nothing. Stops at the ends. */
export function stepSelection(current, delta, count) {
  if (count === 0) return -1;
  if (current < 0) return delta > 0 ? 0 : count - 1;
  return Math.max(0, Math.min(current + delta, count - 1));
}

/** The index to select after the rule at `index` was removed, when `remaining` rules are left. */
export function selectionAfterRemove(index, remaining) {
  return remaining === 0 ? -1 : Math.min(index, remaining - 1);
}
