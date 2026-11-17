// Selecting several rules in the list, without DOM.
// A selection is { ids, anchor }: the selected ids in the order of the list, and the rule a Shift range starts from.

const indexOfId = (rules, id) => rules.findIndex(rule => rule.id === id);

/** The ids of the rules from index `a` to index `b`, both included, in the order of the list. */
function range(rules, a, b) {
  const [from, to] = a <= b ? [a, b] : [b, a];
  return rules.slice(from, to + 1).map(rule => rule.id);
}

/**
 * The selection after a click on a rule.
 * Plain click: only that rule. Ctrl+click: adds it, or removes it when it is selected, and it becomes the anchor.
 * Shift+click: every rule from the anchor to the clicked one, replacing the selection; the anchor stays.
 */
export function clickSelection(rules, state, id, { shift = false, ctrl = false } = {}) {
  const index = indexOfId(rules, id);
  if (index < 0) return state;

  if (ctrl) {
    const selected = new Set(state.ids);
    if (selected.has(id)) selected.delete(id);
    else selected.add(id);
    return { ids: rules.map(rule => rule.id).filter(known => selected.has(known)), anchor: id };
  }

  if (shift) {
    const anchorIndex = indexOfId(rules, state.anchor);
    if (anchorIndex < 0) return { ids: [id], anchor: id };
    return { ids: range(rules, anchorIndex, index), anchor: state.anchor };
  }

  return { ids: [id], anchor: id };
}

/**
 * The selection after Shift+Up or Shift+Down on the focused rule: the range from the anchor to the rule one step
 * further. Returns the id of that rule as `focus`, where the focus should go. Stops at the ends of the list.
 */
export function extendSelection(rules, state, focusId, delta) {
  const index = indexOfId(rules, focusId);
  if (index < 0) return { ids: state.ids, anchor: state.anchor, focus: focusId };

  const anchor = indexOfId(rules, state.anchor) >= 0 ? state.anchor : focusId;
  const target = Math.max(0, Math.min(index + delta, rules.length - 1));

  return { ids: range(rules, indexOfId(rules, anchor), target), anchor, focus: rules[target].id };
}
