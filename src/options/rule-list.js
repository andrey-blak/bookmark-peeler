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
 * Drops the selected rules on the rule `overId`, on its lower half (`after`) or upper half.
 * They land together, in their order, just before or behind it. Dropping on one of the selected rules, or on an
 * unknown rule, changes nothing.
 */
export function moveRulesTo(rules, selectedIds, overId, after) {
  const selected = new Set(selectedIds);
  const block = rules.filter(rule => selected.has(rule.id));
  const rest = rules.filter(rule => !selected.has(rule.id));

  const over = rest.findIndex(rule => rule.id === overId);
  if (block.length === 0 || over < 0) return [...rules];

  rest.splice(over + (after ? 1 : 0), 0, ...block);
  return rest;
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

/**
 * Moves the selected rules up (delta < 0) or down by one place, keeping their order.
 * A selected rule that cannot move (at the edge, or behind another selected rule that cannot) stays, so a block
 * of selected rules moves as a block and stops at the end of the list.
 */
export function moveRules(rules, selectedIds, delta) {
  const result = [...rules];
  const selected = new Set(selectedIds);
  const flags = result.map(rule => selected.has(rule.id));

  const swap = (i, j) => {
    [result[i], result[j]] = [result[j], result[i]];
    [flags[i], flags[j]] = [flags[j], flags[i]];
  };

  if (delta < 0) {
    for (let i = 1; i < result.length; i++) {
      if (flags[i] && !flags[i - 1]) swap(i, i - 1);
    }
  } else {
    for (let i = result.length - 2; i >= 0; i--) {
      if (flags[i] && !flags[i + 1]) swap(i, i + 1);
    }
  }

  return result;
}

/** Removes the selected rules. Returns the rest and what was removed, [{ rule, index }] in list order, for restoreRules. */
export function removeRules(rules, selectedIds) {
  const selected = new Set(selectedIds);
  const kept = [];
  const removed = [];

  rules.forEach((rule, index) => {
    if (selected.has(rule.id)) removed.push({ rule, index });
    else kept.push(rule);
  });

  return { rules: kept, removed };
}

/** Puts removed rules back at their old positions, or at the end when the list has got shorter. */
export function restoreRules(rules, removed) {
  const result = [...rules];

  for (const { rule, index } of [...removed].sort((a, b) => a.index - b.index)) {
    result.splice(Math.min(index, result.length), 0, rule);
  }

  return result;
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

export function setEnabledMany(rules, selectedIds, enabled) {
  const selected = new Set(selectedIds);
  return rules.map(rule => (selected.has(rule.id) ? { ...rule, enabled } : rule));
}

export function setEnabled(rules, index, enabled) {
  return rules.map((rule, i) => (i === index ? { ...rule, enabled } : rule));
}

/** Short text for where a rule applies: "All sites", "example.com/video". Empty when the scope is incomplete. */
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
 * Up and Down select a rule, Shift+Up and Shift+Down extend the selection, Ctrl+Up and Ctrl+Down move it.
 * Delete deletes it, Enter and Space switch it on or off, Ctrl+Z undoes the last delete.
 * [ collapses or expands the list.
 */
export function keyCommand({ key, ctrlKey, shiftKey, altKey, metaKey }) {
  if (altKey || metaKey) return null;

  if (key === "ArrowUp" || key === "ArrowDown") {
    const delta = key === "ArrowUp" ? -1 : 1;
    if (shiftKey) return ctrlKey ? null : { type: "extend", delta };
    return { type: ctrlKey ? "move" : "select", delta };
  }

  if (shiftKey) return null;

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
