import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  moveRule,
  moveRulesTo,
  upsertRule,
  removeRule,
  restoreRule,
  moveRules,
  removeRules,
  restoreRules,
  setEnabledMany,
  setEnabled,
  scopeLabel,
  ruleTitle,
  ruleSubtitle,
  ruleStatus,
  keyCommand,
  ruleInitial,
  stepSelection,
  selectionAfterRemove,
} from "../../src/options/rule-list.js";

const rule = (id, extra = {}) => ({
  id,
  enabled: true,
  scope: { type: "all" },
  actions: [{ type: "remove", parameter: "a" }],
  ...extra,
});

const ids = rules => rules.map(r => r.id);
const abcd = () => [rule("a"), rule("b"), rule("c"), rule("d")];

describe("moveRule", () => {
  test("moves a rule down and up", () => {
    assert.deepEqual(ids(moveRule(abcd(), 0, 2)), ["b", "c", "a", "d"]);
    assert.deepEqual(ids(moveRule(abcd(), 3, 1)), ["a", "d", "b", "c"]);
  });

  test("moves by one position", () => {
    assert.deepEqual(ids(moveRule(abcd(), 1, 2)), ["a", "c", "b", "d"]);
    assert.deepEqual(ids(moveRule(abcd(), 1, 0)), ["b", "a", "c", "d"]);
  });

  test("the target is clamped to the list", () => {
    assert.deepEqual(ids(moveRule(abcd(), 1, -5)), ["b", "a", "c", "d"]);
    assert.deepEqual(ids(moveRule(abcd(), 1, 99)), ["a", "c", "d", "b"]);
  });

  test("moving to the same place, or from outside the list, changes nothing", () => {
    assert.deepEqual(ids(moveRule(abcd(), 2, 2)), ["a", "b", "c", "d"]);
    assert.deepEqual(ids(moveRule(abcd(), -1, 2)), ["a", "b", "c", "d"]);
    assert.deepEqual(ids(moveRule(abcd(), 9, 2)), ["a", "b", "c", "d"]);
  });

  test("returns a new array and does not modify the input", () => {
    const rules = abcd();
    const moved = moveRule(rules, 0, 3);
    assert.notEqual(moved, rules);
    assert.deepEqual(ids(rules), ["a", "b", "c", "d"]);
  });

  test("keeps the rule objects themselves", () => {
    const rules = abcd();
    assert.equal(moveRule(rules, 0, 3)[3], rules[0]);
  });
});

describe("moveRulesTo", () => {
  const abcdef = () => ["a", "b", "c", "d", "e", "f"].map(id => rule(id));
  const dropped = (selected, over, after) => ids(moveRulesTo(abcdef(), selected, over, after)).join("");

  test("a single rule dropped before another goes just in front of it", () => {
    assert.equal(dropped(["a"], "c", false), "bacdef");
    assert.equal(dropped(["d"], "b", false), "adbcef");
    assert.equal(dropped(["d"], "a", false), "dabcef");
  });

  test("a single rule dropped after another goes just behind it", () => {
    assert.equal(dropped(["a"], "c", true), "bcadef");
    assert.equal(dropped(["d"], "a", true), "adbcef");
    assert.equal(dropped(["a"], "f", true), "bcdefa");
  });

  test("dropping a rule next to itself changes nothing", () => {
    assert.equal(dropped(["b"], "a", true), "abcdef");
    assert.equal(dropped(["b"], "c", false), "abcdef");
  });

  test("a block of selected rules is dropped as a block, in its order", () => {
    assert.equal(dropped(["b", "c"], "e", false), "adbcef");
    assert.equal(dropped(["b", "c"], "e", true), "adebcf");
    assert.equal(dropped(["d", "e"], "a", false), "deabcf");
    assert.equal(dropped(["b", "c"], "f", true), "adefbc");
  });

  test("scattered selected rules are gathered at the drop position, in their order", () => {
    assert.equal(dropped(["a", "c"], "e", true), "bdeacf");
    assert.equal(dropped(["a", "f"], "c", false), "bafcde");
  });

  test("dropping on one of the selected rules changes nothing", () => {
    assert.equal(dropped(["b", "c", "d"], "c", false), "abcdef");
    assert.equal(dropped(["b", "c", "d"], "d", true), "abcdef");
  });

  test("an unknown target or an empty selection changes nothing", () => {
    assert.equal(dropped(["b"], "zzz", false), "abcdef");
    assert.equal(dropped([], "c", false), "abcdef");
  });

  test("keeps the rule objects, returns a new array and does not modify the input", () => {
    const rules = abcdef();
    const result = moveRulesTo(rules, ["a", "b"], "e", true);
    assert.notEqual(result, rules);
    assert.equal(result.find(r => r.id === "a"), rules[0]);
    assert.equal(ids(rules).join(""), "abcdef");
  });
});

describe("removeRule and restoreRule", () => {
  test("removes the rule and says what and where it was", () => {
    const rules = abcd();
    const result = removeRule(rules, 1);
    assert.deepEqual(ids(result.rules), ["a", "c", "d"]);
    assert.deepEqual(result.removed, { rule: rules[1], index: 1 });
  });

  test("an index outside the list removes nothing", () => {
    for (const index of [-1, 4, 99]) {
      const result = removeRule(abcd(), index);
      assert.deepEqual(ids(result.rules), ["a", "b", "c", "d"]);
      assert.equal(result.removed, null);
    }
  });

  test("does not modify the input", () => {
    const rules = abcd();
    removeRule(rules, 0);
    assert.equal(rules.length, 4);
  });

  test("restore puts the rule back where it was", () => {
    for (const index of [0, 1, 3]) {
      const { rules, removed } = removeRule(abcd(), index);
      assert.deepEqual(ids(restoreRule(rules, removed)), ["a", "b", "c", "d"]);
    }
  });

  test("restore puts the rule at the end when the list got shorter", () => {
    const { removed } = removeRule(abcd(), 3);
    assert.deepEqual(ids(restoreRule([rule("a")], removed)), ["a", "d"]);
  });

  test("restoring nothing changes nothing", () => {
    assert.deepEqual(ids(restoreRule(abcd(), null)), ["a", "b", "c", "d"]);
  });
});

describe("upsertRule", () => {
  test("replaces a rule with the same id, in the same place", () => {
    const { rules, index } = upsertRule(abcd(), rule("c", { name: "new" }));
    assert.deepEqual(ids(rules), ["a", "b", "c", "d"]);
    assert.equal(rules[2].name, "new");
    assert.equal(index, 2);
  });

  test("keeps the stored enabled state, which the editor does not change", () => {
    const stored = [rule("a", { enabled: false })];
    const { rules } = upsertRule(stored, rule("a", { enabled: true, name: "new" }));
    assert.equal(rules[0].enabled, false);
    assert.equal(rules[0].name, "new");
  });

  test("appends a rule with a new id", () => {
    const { rules, index } = upsertRule(abcd(), rule("e"));
    assert.deepEqual(ids(rules), ["a", "b", "c", "d", "e"]);
    assert.equal(index, 4);
  });

  test("does not modify the input", () => {
    const stored = abcd();
    upsertRule(stored, rule("a", { name: "x" }));
    upsertRule(stored, rule("z"));
    assert.equal(stored.length, 4);
    assert.equal("name" in stored[0], false);
  });
});

describe("setEnabled", () => {
  test("switches one rule and leaves the others as the same objects", () => {
    const rules = abcd();
    const result = setEnabled(rules, 1, false);
    assert.equal(result[1].enabled, false);
    assert.equal(result[0], rules[0]);
    assert.equal(result[2], rules[2]);
    assert.equal(rules[1].enabled, true);
  });

  test("switches back on", () => {
    const rules = [rule("a", { enabled: false })];
    assert.equal(setEnabled(rules, 0, true)[0].enabled, true);
  });

  test("an index outside the list changes nothing", () => {
    assert.deepEqual(setEnabled(abcd(), 7, false), abcd());
  });
});

describe("scopeLabel, ruleTitle and ruleSubtitle", () => {
  test("describes each scope", () => {
    assert.equal(scopeLabel({ type: "all" }), "All sites");
    assert.equal(scopeLabel({ type: "host", host: "youtube.com" }), "youtube.com");
    assert.equal(scopeLabel({ type: "host", host: "youtube.com", path: "/watch" }), "youtube.com/watch");
    assert.equal(scopeLabel({ type: "host", host: "youtube.com", path: "watch" }), "youtube.com/watch");
    assert.equal(scopeLabel({ type: "host", host: "youtube.com", path: "/playlist/*" }), "youtube.com/playlist/*");
  });

  test("mentions when subdomains are off", () => {
    assert.equal(scopeLabel({ type: "host", host: "youtube.com", subdomains: false }), "youtube.com (no subdomains)");
  });

  test("an incomplete scope has no label", () => {
    assert.equal(scopeLabel({ type: "host", host: "" }), "");
    assert.equal(scopeLabel({}), "");
    assert.equal(scopeLabel(undefined), "");
  });

  test("the title is the name, else the scope, else a placeholder", () => {
    assert.equal(ruleTitle(rule("a", { name: "Tracking" })), "Tracking");
    assert.equal(ruleTitle(rule("a", { scope: { type: "host", host: "a.com" } })), "a.com");
    assert.equal(ruleTitle(rule("a", { scope: { type: "host", host: "" } })), "Untitled rule");
  });

  test("the subtitle is the scope, shown only under a name", () => {
    assert.equal(ruleSubtitle(rule("a", { name: "Tracking" })), "All sites");
    assert.equal(ruleSubtitle(rule("a")), "");
  });
});

describe("ruleStatus", () => {
  test("a valid rule has no status", () => {
    assert.equal(ruleStatus(rule("a")), null);
  });

  test("a rule with a warning only", () => {
    assert.equal(ruleStatus(rule("a", { actions: [] })), "warning");
  });

  test("a rule with an error", () => {
    assert.equal(ruleStatus(rule("a", { scope: { type: "host", host: "" } })), "error");
  });

  test("an error wins over a warning", () => {
    const status = ruleStatus(rule("a", {
      scope: { type: "host", host: "" },
      actions: [],
    }));
    assert.equal(status, "error");
  });
});

describe("keyCommand", () => {
  test("Up and Down select the previous and next rule", () => {
    assert.deepEqual(keyCommand({ key: "ArrowUp" }), { type: "select", delta: -1 });
    assert.deepEqual(keyCommand({ key: "ArrowDown" }), { type: "select", delta: 1 });
  });

  test("Ctrl+Up and Ctrl+Down move the rule", () => {
    assert.deepEqual(keyCommand({ key: "ArrowUp", ctrlKey: true }), { type: "move", delta: -1 });
    assert.deepEqual(keyCommand({ key: "ArrowDown", ctrlKey: true }), { type: "move", delta: 1 });
  });

  test("Shift+Up and Shift+Down extend the selection", () => {
    assert.deepEqual(keyCommand({ key: "ArrowUp", shiftKey: true }), { type: "extend", delta: -1 });
    assert.deepEqual(keyCommand({ key: "ArrowDown", shiftKey: true }), { type: "extend", delta: 1 });
  });

  test("Delete deletes the rule", () => {
    assert.deepEqual(keyCommand({ key: "Delete" }), { type: "delete" });
  });

  test("Enter and Space switch the rule on or off", () => {
    assert.deepEqual(keyCommand({ key: "Enter" }), { type: "toggle" });
    assert.deepEqual(keyCommand({ key: " " }), { type: "toggle" });
  });

  test("Ctrl+Z undoes the last delete, with either letter case", () => {
    assert.deepEqual(keyCommand({ key: "z", ctrlKey: true }), { type: "undo" });
    assert.deepEqual(keyCommand({ key: "Z", ctrlKey: true }), { type: "undo" });
  });

  test("[ collapses or expands the list", () => {
    assert.deepEqual(keyCommand({ key: "[" }), { type: "collapse" });
  });

  test("[ with a modifier does nothing", () => {
    assert.equal(keyCommand({ key: "[", ctrlKey: true }), null);
    assert.equal(keyCommand({ key: "[", altKey: true }), null);
    assert.equal(keyCommand({ key: "[", metaKey: true }), null);
  });

  test("other modifiers and other keys do nothing", () => {
    assert.equal(keyCommand({ key: "ArrowUp", ctrlKey: true, shiftKey: true }), null);
    assert.equal(keyCommand({ key: "ArrowUp", altKey: true }), null);
    assert.equal(keyCommand({ key: "ArrowDown", metaKey: true }), null);
    assert.equal(keyCommand({ key: "ArrowDown", ctrlKey: true, shiftKey: true }), null);
    assert.equal(keyCommand({ key: "Delete", ctrlKey: true }), null);
    assert.equal(keyCommand({ key: "Delete", shiftKey: true }), null);
    assert.equal(keyCommand({ key: "Enter", ctrlKey: true }), null);
    assert.equal(keyCommand({ key: " ", shiftKey: true }), null);
    assert.equal(keyCommand({ key: "z" }), null);
    assert.equal(keyCommand({ key: "z", ctrlKey: true, shiftKey: true }), null);
    assert.equal(keyCommand({ key: "z", metaKey: true }), null);
    assert.equal(keyCommand({ key: "a", ctrlKey: true }), null);
    assert.equal(keyCommand({ key: "Tab" }), null);
  });
});

describe("stepSelection and selectionAfterRemove", () => {
  test("steps through the list and stops at the ends", () => {
    assert.equal(stepSelection(1, 1, 4), 2);
    assert.equal(stepSelection(1, -1, 4), 0);
    assert.equal(stepSelection(0, -1, 4), 0);
    assert.equal(stepSelection(3, 1, 4), 3);
  });

  test("with nothing selected Down picks the first rule and Up the last", () => {
    assert.equal(stepSelection(-1, 1, 4), 0);
    assert.equal(stepSelection(-1, -1, 4), 3);
  });

  test("an empty list selects nothing", () => {
    assert.equal(stepSelection(-1, 1, 0), -1);
    assert.equal(stepSelection(0, 1, 0), -1);
  });

  test("after a removal the next rule is selected, or the last one", () => {
    assert.equal(selectionAfterRemove(1, 3), 1);
    assert.equal(selectionAfterRemove(3, 3), 2);
    assert.equal(selectionAfterRemove(0, 0), -1);
  });
});

describe("ruleInitial", () => {
  test("is the first letter of the title, in capitals", () => {
    assert.equal(ruleInitial(rule("a", { name: "tracking" })), "T");
    assert.equal(ruleInitial(rule("a", { name: "YouTube" })), "Y");
  });

  test("without a name it comes from the domain, or all sites", () => {
    assert.equal(ruleInitial(rule("a", { scope: { type: "host", host: "news.example.com" } })), "N");
    assert.equal(ruleInitial(rule("a")), "A");
  });

  test("a rule with nothing to show gets U for untitled", () => {
    assert.equal(ruleInitial(rule("a", { scope: { type: "host", host: "" } })), "U");
  });

  test("works with letters outside the basic alphabet", () => {
    assert.equal(ruleInitial(rule("a", { name: "ёж" })), "Ё");
    assert.equal(ruleInitial(rule("a", { name: "😀 smile" })), "😀");
  });
});

describe("moveRules", () => {
  const abcdef = () => ["a", "b", "c", "d", "e", "f"].map(id => rule(id));
  const moved = (selected, delta) => ids(moveRules(abcdef(), selected, delta)).join("");

  test("moves a block of selected rules up by one", () => {
    assert.equal(moved(["c", "d"], -1), "acdbef");
  });

  test("moves a block of selected rules down by one", () => {
    assert.equal(moved(["c", "d"], 1), "abecdf");
  });

  test("a block at the top or at the bottom stays where it is", () => {
    assert.equal(moved(["a", "b"], -1), "abcdef");
    assert.equal(moved(["e", "f"], 1), "abcdef");
  });

  test("scattered rules each move by one and keep their order", () => {
    assert.equal(moved(["b", "e"], -1), "bacedf");
    assert.equal(moved(["b", "e"], 1), "acbdfe");
  });

  test("a selected rule that is blocked at the edge stays, the others move up until they are next to it", () => {
    assert.equal(moved(["a", "c"], -1), "acbdef");
    assert.equal(moved(["d", "f"], 1), "abcedf");
  });

  test("selecting everything changes nothing", () => {
    assert.equal(moved(["a", "b", "c", "d", "e", "f"], -1), "abcdef");
    assert.equal(moved(["a", "b", "c", "d", "e", "f"], 1), "abcdef");
  });

  test("ids that are not in the list are ignored, and an empty selection changes nothing", () => {
    assert.equal(moved(["zzz"], -1), "abcdef");
    assert.equal(moved([], 1), "abcdef");
  });

  test("keeps the rule objects, returns a new array and does not modify the input", () => {
    const rules = abcdef();
    const result = moveRules(rules, ["c"], -1);
    assert.notEqual(result, rules);
    assert.equal(result[1], rules[2]);
    assert.equal(ids(rules).join(""), "abcdef");
  });
});

describe("removeRules and restoreRules", () => {
  const abcdef = () => ["a", "b", "c", "d", "e", "f"].map(id => rule(id));

  test("removes the selected rules and says what was removed and where, in list order", () => {
    const rules = abcdef();
    const result = removeRules(rules, ["e", "b"]);
    assert.equal(ids(result.rules).join(""), "acdf");
    assert.deepEqual(result.removed, [{ rule: rules[1], index: 1 }, { rule: rules[4], index: 4 }]);
  });

  test("unknown ids and an empty selection remove nothing", () => {
    assert.deepEqual(removeRules(abcdef(), ["zzz"]).removed, []);
    assert.deepEqual(removeRules(abcdef(), []).removed, []);
    assert.equal(ids(removeRules(abcdef(), ["zzz"]).rules).join(""), "abcdef");
  });

  test("does not modify the input", () => {
    const rules = abcdef();
    removeRules(rules, ["a", "b"]);
    assert.equal(rules.length, 6);
  });

  test("restoring puts every rule back at its old position", () => {
    for (const selected of [["a"], ["f"], ["b", "c"], ["a", "c", "e"], ["a", "b", "c", "d", "e", "f"], ["b", "f"]]) {
      const { rules, removed } = removeRules(abcdef(), selected);
      assert.equal(ids(restoreRules(rules, removed)).join(""), "abcdef", selected.join(""));
    }
  });

  test("restoring into a shorter list puts the rules at the end, in order", () => {
    const { removed } = removeRules(abcdef(), ["d", "f"]);
    assert.equal(ids(restoreRules([rule("a")], removed)).join(""), "adf");
  });

  test("restoring nothing changes nothing", () => {
    assert.equal(ids(restoreRules(abcdef(), [])).join(""), "abcdef");
  });
});

describe("setEnabledMany", () => {
  test("switches the selected rules, leaving the others as the same objects", () => {
    const rules = [rule("a"), rule("b"), rule("c")];
    const result = setEnabledMany(rules, ["a", "c"], false);
    assert.deepEqual(result.map(r => r.enabled), [false, true, false]);
    assert.equal(result[1], rules[1]);
    assert.equal(rules[0].enabled, true);
  });
});
