import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { clickSelection, extendSelection } from "../../src/options/selection.js";

const rules = ids => ids.split("").map(id => ({ id }));
const abcde = () => rules("abcde");
const state = (ids, anchor = ids[ids.length - 1] ?? null) => ({ ids: ids.split(""), anchor });

describe("clickSelection: plain click", () => {
  test("selects only the clicked rule and makes it the anchor", () => {
    assert.deepEqual(clickSelection(abcde(), state("bc"), "d", {}), { ids: ["d"], anchor: "d" });
  });

  test("works with no previous selection and with no modifiers given", () => {
    assert.deepEqual(clickSelection(abcde(), { ids: [], anchor: null }, "a"), { ids: ["a"], anchor: "a" });
  });

  test("an unknown id changes nothing", () => {
    const before = state("bc");
    assert.deepEqual(clickSelection(abcde(), before, "zzz", {}), before);
  });
});

describe("clickSelection: Ctrl+click", () => {
  test("adds a rule to the selection and makes it the anchor", () => {
    assert.deepEqual(clickSelection(abcde(), state("b"), "d", { ctrl: true }), { ids: ["b", "d"], anchor: "d" });
  });

  test("removes a rule that is already selected", () => {
    assert.deepEqual(clickSelection(abcde(), state("bcd", "d"), "c", { ctrl: true }), { ids: ["b", "d"], anchor: "c" });
  });

  test("keeps the ids in the order of the list, whatever the order of clicking", () => {
    const first = clickSelection(abcde(), state("d"), "a", { ctrl: true });
    assert.deepEqual(first.ids, ["a", "d"]);
    assert.deepEqual(clickSelection(abcde(), first, "c", { ctrl: true }).ids, ["a", "c", "d"]);
  });

  test("can remove the last selected rule, leaving nothing selected", () => {
    assert.deepEqual(clickSelection(abcde(), state("b", "b"), "b", { ctrl: true }).ids, []);
  });
});

describe("clickSelection: Shift+click", () => {
  test("selects the range from the anchor to the clicked rule, both ends included", () => {
    assert.deepEqual(clickSelection(abcde(), state("b", "b"), "d", { shift: true }), { ids: ["b", "c", "d"], anchor: "b" });
  });

  test("works upwards too", () => {
    assert.deepEqual(clickSelection(abcde(), state("d", "d"), "b", { shift: true }), { ids: ["b", "c", "d"], anchor: "d" });
  });

  test("replaces an earlier selection, but the anchor stays", () => {
    const next = clickSelection(abcde(), state("bcd", "b"), "e", { shift: true });
    assert.deepEqual(next, { ids: ["b", "c", "d", "e"], anchor: "b" });
    assert.deepEqual(clickSelection(abcde(), next, "a", { shift: true }), { ids: ["a", "b"], anchor: "b" });
  });

  test("with no anchor, the clicked rule alone is selected and becomes the anchor", () => {
    assert.deepEqual(clickSelection(abcde(), { ids: [], anchor: null }, "c", { shift: true }), { ids: ["c"], anchor: "c" });
  });

  test("an anchor that is no longer in the list is replaced by the clicked rule", () => {
    assert.deepEqual(clickSelection(abcde(), { ids: ["x"], anchor: "x" }, "c", { shift: true }), { ids: ["c"], anchor: "c" });
  });

  test("after a Ctrl+click the range starts from that rule", () => {
    const ctrl = clickSelection(abcde(), state("a", "a"), "c", { ctrl: true });
    assert.deepEqual(clickSelection(abcde(), ctrl, "e", { shift: true }), { ids: ["c", "d", "e"], anchor: "c" });
  });
});

describe("extendSelection (Shift+Up and Shift+Down)", () => {
  test("extends from the anchor by one rule and reports the new end", () => {
    assert.deepEqual(extendSelection(abcde(), state("c", "c"), "c", 1), { ids: ["c", "d"], anchor: "c", focus: "d" });
    assert.deepEqual(extendSelection(abcde(), state("c", "c"), "c", -1), { ids: ["b", "c"], anchor: "c", focus: "b" });
  });

  test("pressing again goes on, and the opposite direction shrinks the selection back", () => {
    const one = extendSelection(abcde(), state("b", "b"), "b", 1);
    const two = extendSelection(abcde(), one, one.focus, 1);
    assert.deepEqual(two.ids, ["b", "c", "d"]);
    const back = extendSelection(abcde(), two, two.focus, -1);
    assert.deepEqual(back.ids, ["b", "c"]);
    const single = extendSelection(abcde(), back, back.focus, -1);
    assert.deepEqual(single.ids, ["b"]);
  });

  test("crossing over the anchor flips the range", () => {
    const up = extendSelection(abcde(), { ids: ["c"], anchor: "c" }, "c", -1);
    const upMore = extendSelection(abcde(), up, up.focus, -1);
    assert.deepEqual(upMore.ids, ["a", "b", "c"]);
    const down = extendSelection(abcde(), upMore, "a", 1);
    assert.deepEqual(down.ids, ["b", "c"]);
  });

  test("stops at the ends of the list", () => {
    assert.deepEqual(extendSelection(abcde(), state("e", "e"), "e", 1), { ids: ["e"], anchor: "e", focus: "e" });
    assert.deepEqual(extendSelection(abcde(), state("a", "a"), "a", -1), { ids: ["a"], anchor: "a", focus: "a" });
  });

  test("with no anchor the focused rule becomes the anchor", () => {
    assert.deepEqual(extendSelection(abcde(), { ids: [], anchor: null }, "b", 1), { ids: ["b", "c"], anchor: "b", focus: "c" });
  });

  test("a focused id that is not in the list changes nothing", () => {
    assert.deepEqual(extendSelection(abcde(), state("b", "b"), "zzz", 1), { ids: ["b"], anchor: "b", focus: "zzz" });
  });
});
