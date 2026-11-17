import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateRule, normalizeRule } from "../../src/core/schema.js";
import { cleanUrl } from "../../src/core/engine.js";
import {
  newDraft,
  setIn,
  unsetIn,
  pathKey,
  scopeMode,
  setScopeMode,
  addAction,
  moveAction,
  remapTouched,
  actionDropIndex,
  visibleIssues,
  summaryText,
  isDirty,
  canSave,
  canRevert,
  duplicateDraft,
  isSaveKey,
} from "../../src/options/editor-model.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const paths = issues => issues.map(i => pathKey(i.path));

describe("newDraft", () => {
  test("starts as an enabled rule for a domain, with an empty domain and no actions", () => {
    const draft = newDraft();
    assert.match(draft.id, UUID);
    assert.equal(draft.enabled, true);
    assert.equal("name" in draft, false);
    assert.deepEqual(draft.scope, { type: "host", host: "", subdomains: true });
    assert.deepEqual(draft.actions, []);
  });

  test("each draft has its own id", () => {
    assert.notEqual(newDraft().id, newDraft().id);
  });

  test("an untouched draft has an error for the domain and a warning for the actions", () => {
    const issues = validateRule(newDraft());
    assert.deepEqual(paths(issues), ["scope.host", "actions"]);
  });
});

describe("setIn and unsetIn", () => {
  const draft = () => ({ name: "A", scope: { host: "a.example" }, actions: [{ parameter: "x" }, { parameter: "y" }] });

  test("setIn sets a nested value without modifying the input", () => {
    const before = draft();
    const after = setIn(before, ["scope", "host"], "b.example");
    assert.equal(after.scope.host, "b.example");
    assert.equal(before.scope.host, "a.example");
  });

  test("setIn reaches into arrays and keeps everything else", () => {
    const after = setIn(draft(), ["actions", 1, "parameter"], "z");
    assert.deepEqual(after.actions, [{ parameter: "x" }, { parameter: "z" }]);
    assert.equal(after.name, "A");
    assert.ok(Array.isArray(after.actions));
  });

  test("setIn creates missing objects on the way", () => {
    assert.deepEqual(setIn({}, ["a", "b"], 1), { a: { b: 1 } });
  });

  test("unsetIn removes an object key", () => {
    const after = unsetIn({ a: { b: 1, c: 2 } }, ["a", "b"]);
    assert.deepEqual(after, { a: { c: 2 } });
  });

  test("unsetIn removes an array element and keeps the order of the rest", () => {
    const after = unsetIn({ actions: ["a", "b", "c"] }, ["actions", 1]);
    assert.deepEqual(after.actions, ["a", "c"]);
  });

  test("unsetIn on a path that does not exist changes nothing", () => {
    assert.deepEqual(unsetIn({ a: 1 }, ["x", "y"]), { a: 1 });
  });

  test("pathKey joins a path with dots", () => {
    assert.equal(pathKey(["actions", 0, "value", "find"]), "actions.0.value.find");
  });
});

describe("scopeMode and setScopeMode", () => {
  test("tells all sites, domain and domain + path apart", () => {
    assert.equal(scopeMode({ type: "all" }), "all");
    assert.equal(scopeMode({ type: "host", host: "a.example" }), "host");
    assert.equal(scopeMode({ type: "host", host: "a.example", path: "/x" }), "path");
    assert.equal(scopeMode({ type: "host", host: "a.example", path: "" }), "path");
  });

  test("choosing Domain + path adds an empty path, choosing Domain removes it", () => {
    const host = { type: "host", host: "a.example", subdomains: true };
    const path = setScopeMode(host, "path");
    assert.deepEqual(path, { type: "host", host: "a.example", subdomains: true, path: "" });
    assert.deepEqual(setScopeMode({ ...path, path: "/x" }, "host"), host);
  });

  test("going to All sites and back restores the domain and the path", () => {
    const scope = { type: "host", host: "a.example", subdomains: false, path: "/x" };
    const all = setScopeMode(scope, "all");
    assert.equal(all.type, "all");
    assert.deepEqual(setScopeMode(all, "path"), scope);
  });

  test("choosing a domain scope from All sites on a fresh scope gives an empty domain", () => {
    assert.deepEqual(setScopeMode({ type: "all" }, "host"), { type: "host", host: "", subdomains: true });
  });

  test("leftovers behind All sites do not count as errors and are not stored", () => {
    const rule = { scope: setScopeMode({ type: "host", host: "", path: "?" }, "all"), actions: [{ type: "remove", parameter: "a" }] };
    assert.deepEqual(validateRule(rule), []);
    assert.deepEqual(normalizeRule(rule).scope, { type: "all" });
  });

  test("does not modify its input", () => {
    const scope = { type: "host", host: "a.example" };
    setScopeMode(scope, "path");
    assert.deepEqual(scope, { type: "host", host: "a.example" });
  });
});

describe("addAction", () => {
  test("adds a remove action with an empty parameter", () => {
    const draft = addAction(newDraft(), "remove");
    assert.deepEqual(draft.actions, [{ type: "remove", parameter: "" }]);
  });

  test("adds a replace action: parameter filter only, value replacement ticked and empty, case-sensitive", () => {
    const draft = addAction(newDraft(), "replace");
    assert.deepEqual(draft.actions, [{
      type: "replace",
      parameter: { find: "" },
      value: { find: "", replace: "" },
      ignoreCase: false,
    }]);
  });

  test("appends after the existing actions", () => {
    const draft = addAction(addAction(newDraft(), "remove"), "replace");
    assert.deepEqual(draft.actions.map(a => a.type), ["remove", "replace"]);
  });

  test("an unknown type adds nothing", () => {
    assert.deepEqual(addAction(newDraft(), "explode").actions, []);
  });

  test("a fresh action is invalid until it is filled in", () => {
    const remove = validateRule({ scope: { type: "all" }, actions: addAction(newDraft(), "remove").actions });
    const replace = validateRule({ scope: { type: "all" }, actions: addAction(newDraft(), "replace").actions });
    assert.deepEqual(paths(remove), ["actions.0.parameter"]);
    assert.deepEqual(paths(replace), ["actions.0"]);
  });

  test("does not modify the draft it was given", () => {
    const draft = newDraft();
    addAction(draft, "remove");
    assert.deepEqual(draft.actions, []);
  });
});

describe("keep actions in the editor", () => {
  test("a new keep action has an empty list", () => {
    assert.deepEqual(addAction(newDraft(), "keep").actions, [{ type: "keep", parameters: [] }]);
  });

  test("a fresh keep action is invalid until a parameter is typed", () => {
    const rule = { scope: { type: "all" }, actions: addAction(newDraft(), "keep").actions };
    assert.deepEqual(paths(validateRule(rule)), ["actions.0.parameters"]);
  });

  test("the lines of the text box are kept as typed, including a line still being typed", () => {
    let draft = addAction(newDraft(), "keep");
    draft = setIn(draft, ["actions", 0, "parameters"], "v\nt\n".split("\n"));
    assert.deepEqual(draft.actions[0].parameters, ["v", "t", ""]);
    assert.equal(draft.actions[0].parameters.join("\n"), "v\nt\n");
  });

  test("blank lines and spaces are not unsaved changes", () => {
    const base = { id: "r", scope: { type: "all" }, actions: [{ type: "keep", parameters: ["v", "t"] }] };
    const typed = setIn(base, ["actions", 0, "parameters"], [" v ", "", "t", ""]);
    assert.equal(isDirty(typed, base), false);
    assert.equal(isDirty(setIn(base, ["actions", 0, "parameters"], ["v", "t", "x"]), base), true);
  });

  test("it can be moved like any other action", () => {
    const draft = addAction(addAction(newDraft(), "remove"), "keep");
    assert.deepEqual(moveAction(draft, 1, 0).actions.map(a => a.type), ["keep", "remove"]);
  });
});

describe("visibleIssues", () => {
  const issues = [
    { path: ["scope", "host"], severity: "error", message: "Enter a domain." },
    { path: ["actions"], severity: "warning", message: "No actions." },
    { path: ["actions", 0], severity: "error", message: "Enter a pattern." },
    { path: ["actions", 0, "value", "find"], severity: "error", message: "Bad regex." },
    { path: ["actions", 1, "parameter"], severity: "error", message: "Enter a name." },
  ];
  const shown = (touched, all = false) => paths(visibleIssues(issues, new Set(touched), all));

  test("nothing is shown before anything is touched", () => {
    assert.deepEqual(shown([]), []);
  });

  test("an issue is shown once its own field is touched", () => {
    assert.deepEqual(shown(["scope.host"]), ["scope.host"]);
  });

  test("touching a field inside an action also shows the issues of the whole action and of the list", () => {
    assert.deepEqual(shown(["actions.0.value.find"]), ["actions", "actions.0", "actions.0.value.find"]);
  });

  test("touching another action shows nothing of this one", () => {
    assert.deepEqual(shown(["actions.1.parameter"]), ["actions", "actions.1.parameter"]);
  });

  test("adding an action touches only the list, so its fresh errors stay hidden", () => {
    assert.deepEqual(shown(["actions"]), ["actions"]);
  });

  test("showAll shows everything, for example after Save", () => {
    assert.equal(shown([], true).length, 5);
  });
});

describe("summaryText", () => {
  const error = { path: ["a"], severity: "error", message: "x" };
  const warning = { path: ["b"], severity: "warning", message: "y" };

  test("no issues, no text", () => {
    assert.equal(summaryText([]), "");
  });

  test("errors say the rule is not applied", () => {
    assert.equal(summaryText([error]), "1 error. The rule isn't applied until the error is fixed.");
    assert.equal(summaryText([error, error]), "2 errors. The rule isn't applied until the errors are fixed.");
  });

  test("errors and warnings together", () => {
    assert.equal(
      summaryText([error, warning, warning]),
      "1 error and 2 warnings. The rule isn't applied until the error is fixed.",
    );
  });

  test("warnings alone", () => {
    assert.equal(summaryText([warning]), "1 warning.");
    assert.equal(summaryText([warning, warning]), "2 warnings.");
  });
});

describe("isDirty", () => {
  const base = () => ({ id: "r", enabled: true, name: "A", scope: { type: "host", host: "a.example", subdomains: true }, actions: [{ type: "remove", parameter: "x" }] });

  test("a copy is not dirty", () => {
    assert.equal(isDirty(base(), base()), false);
  });

  test("any change in the name, scope or actions is dirty", () => {
    assert.equal(isDirty({ ...base(), name: "B" }, base()), true);
    assert.equal(isDirty(setIn(base(), ["scope", "host"], "b.example"), base()), true);
    assert.equal(isDirty(setIn(base(), ["actions", 0, "parameter"], "y"), base()), true);
    assert.equal(isDirty(addAction(base(), "remove"), base()), true);
  });

  test("the enabled switch belongs to the list, not to the editor", () => {
    assert.equal(isDirty({ ...base(), enabled: false }, base()), false);
  });

  test("differences that are not stored do not count", () => {
    assert.equal(isDirty({ ...base(), name: "  A " }, base()), false);
    assert.equal(isDirty(setScopeMode(base(), "path"), base()), false);
    assert.equal(isDirty({ ...base(), extra: 1 }, base()), false);
  });

  test("a new draft is clean until something is typed", () => {
    const draft = newDraft();
    assert.equal(isDirty(draft, draft), false);
    assert.equal(isDirty(setIn(draft, ["scope", "host"], "a"), draft), true);
  });
});

describe("canSave and canRevert", () => {
  const stored = () => ({ id: "r", enabled: true, name: "A", scope: { type: "host", host: "example.com", subdomains: true }, actions: [{ type: "remove", parameter: "x" }] });

  test("a stored rule without changes: nothing to save, nothing to revert", () => {
    assert.equal(canSave(stored(), stored(), false), false);
    assert.equal(canRevert(stored(), stored()), false);
  });

  test("a stored rule with a change: both are possible", () => {
    const changed = setIn(stored(), ["scope", "host"], "example.org");
    assert.equal(canSave(changed, stored(), false), true);
    assert.equal(canRevert(changed, stored()), true);
  });

  test("changing something and changing it back leaves nothing to save", () => {
    const back = setIn(setIn(stored(), ["name"], "B"), ["name"], "A");
    assert.equal(canSave(back, stored(), false), false);
    assert.equal(canRevert(back, stored()), false);
  });

  test("a new rule can always be saved, even when nothing was changed (a duplicate or a preset)", () => {
    const fresh = newDraft();
    assert.equal(canSave(fresh, fresh, true), true);
  });

  test("a new rule has something to revert only after a change", () => {
    const fresh = newDraft();
    assert.equal(canRevert(fresh, fresh), false);
    assert.equal(canRevert(setIn(fresh, ["scope", "host"], "example.com"), fresh), true);
  });

  test("the switch in the list is not part of the editor, so it does not make anything to save", () => {
    assert.equal(canSave({ ...stored(), enabled: false }, stored(), false), false);
    assert.equal(canRevert({ ...stored(), enabled: false }, stored()), false);
  });

  test("a difference that is not stored does not count", () => {
    assert.equal(canSave({ ...stored(), name: "  A " }, stored(), false), false);
  });
});

describe("duplicateDraft", () => {
  const rule = () => ({
    id: "r",
    enabled: false,
    name: "Example",
    scope: { type: "host", host: "example.com", subdomains: true, path: "/video" },
    actions: [{ type: "remove", parameter: "pp" }],
  });

  test("is a new rule with a new id and the name plus copy", () => {
    const copy = duplicateDraft(rule());
    assert.match(copy.id, UUID);
    assert.notEqual(copy.id, "r");
    assert.equal(copy.name, "Example copy");
  });

  test("keeps the scope, the actions and the enabled state", () => {
    const copy = duplicateDraft(rule());
    assert.deepEqual(copy.scope, rule().scope);
    assert.deepEqual(copy.actions, rule().actions);
    assert.equal(copy.enabled, false);
  });

  test("a rule without a name gets none", () => {
    const { name, ...unnamed } = rule();
    assert.equal("name" in duplicateDraft(unnamed), false);
  });

  test("shares nothing with the original", () => {
    const original = rule();
    const copy = duplicateDraft(original);
    copy.actions[0].parameter = "changed";
    assert.equal(original.actions[0].parameter, "pp");
  });
});

describe("isSaveKey", () => {
  test("Ctrl+S in either letter case", () => {
    assert.equal(isSaveKey({ key: "s", ctrlKey: true }), true);
    assert.equal(isSaveKey({ key: "S", ctrlKey: true }), true);
  });

  test("nothing else", () => {
    assert.equal(isSaveKey({ key: "s" }), false);
    assert.equal(isSaveKey({ key: "s", ctrlKey: true, shiftKey: true }), false);
    assert.equal(isSaveKey({ key: "s", ctrlKey: true, altKey: true }), false);
    assert.equal(isSaveKey({ key: "s", metaKey: true }), false);
    assert.equal(isSaveKey({ key: "a", ctrlKey: true }), false);
  });
});

describe("building the Example visibility rule step by step", () => {
  function build() {
    let draft = newDraft();
    draft = setIn(draft, ["name"], "Example visibility");
    draft = setIn(draft, ["scope", "host"], "example.com");
    draft = addAction(draft, "replace");
    draft = setIn(draft, ["actions", 0, "parameter", "find"], "^visibility$");
    draft = setIn(draft, ["actions", 0, "value", "find"], "^public$");
    return setIn(draft, ["actions", 0, "value", "replace"], "private");
  }

  test("ends up valid", () => {
    assert.deepEqual(validateRule(build()), []);
  });

  test("and works on a URL", () => {
    const rule = normalizeRule(build());
    assert.equal(
      cleanUrl("https://example.com/new?owner=me&visibility=public", [rule]),
      "https://example.com/new?owner=me&visibility=private",
    );
  });

  test("unticking the replacement leaves a filter that replaces nothing, and says so", () => {
    const draft = unsetIn(build(), ["actions", 0, "value", "replace"]);
    const issues = validateRule(draft);
    assert.deepEqual(issues.map(i => i.severity), ["warning"]);
    assert.equal(pathKey(issues[0].path), "actions.0");
  });

  test("ticking it again gives an empty replacement", () => {
    const draft = setIn(unsetIn(build(), ["actions", 0, "value", "replace"]), ["actions", 0, "value", "replace"], "");
    assert.equal(draft.actions[0].value.replace, "");
  });
});

describe("moveAction", () => {
  const withActions = (...params) => ({
    id: "r",
    scope: { type: "all" },
    actions: params.map(parameter => ({ type: "remove", parameter })),
  });
  const order = draft => draft.actions.map(a => a.parameter).join("");

  test("moves an action down and up", () => {
    assert.equal(order(moveAction(withActions("a", "b", "c", "d"), 0, 2)), "bcad");
    assert.equal(order(moveAction(withActions("a", "b", "c", "d"), 3, 1)), "adbc");
  });

  test("moves by one place", () => {
    assert.equal(order(moveAction(withActions("a", "b", "c"), 1, 2)), "acb");
    assert.equal(order(moveAction(withActions("a", "b", "c"), 1, 0)), "bac");
  });

  test("the target is clamped to the list", () => {
    assert.equal(order(moveAction(withActions("a", "b", "c"), 1, -5)), "bac");
    assert.equal(order(moveAction(withActions("a", "b", "c"), 1, 99)), "acb");
  });

  test("moving to the same place, or from outside the list, changes nothing", () => {
    assert.equal(order(moveAction(withActions("a", "b", "c"), 1, 1)), "abc");
    assert.equal(order(moveAction(withActions("a", "b", "c"), -1, 1)), "abc");
    assert.equal(order(moveAction(withActions("a", "b", "c"), 7, 1)), "abc");
  });

  test("keeps the action objects and everything else in the draft, and does not modify the input", () => {
    const draft = withActions("a", "b", "c");
    const moved = moveAction(draft, 0, 2);
    assert.notEqual(moved, draft);
    assert.equal(moved.actions[2], draft.actions[0]);
    assert.equal(moved.id, "r");
    assert.deepEqual(moved.scope, { type: "all" });
    assert.equal(order(draft), "abc");
  });

  test("a draft without actions is returned as it is", () => {
    const draft = { id: "r", scope: { type: "all" } };
    assert.deepEqual(moveAction(draft, 0, 1), draft);
  });

  test("the order changes what the rule does", () => {
    const rule = {
      scope: { type: "all" },
      actions: [
        { type: "replace", parameter: { find: "^a$", replace: "b" } },
        { type: "remove", parameter: "b" },
      ],
    };
    assert.equal(cleanUrl("https://example.org/?a=1&c=2", [rule]), "https://example.org/?c=2");
    assert.equal(cleanUrl("https://example.org/?a=1&c=2", [moveAction(rule, 0, 1)]), "https://example.org/?b=1&c=2");
  });
});

describe("remapTouched", () => {
  const touched = keys => new Set(keys);
  const sorted = set => [...set].sort();

  test("the touched fields of the moved action follow it", () => {
    const result = remapTouched(touched(["actions.0.parameter", "actions.0.value.find"]), 0, 2);
    assert.deepEqual(sorted(result), ["actions.2.parameter", "actions.2.value.find"]);
  });

  test("the actions it passes shift by one, down or up", () => {
    assert.deepEqual(sorted(remapTouched(touched(["actions.1.parameter", "actions.2.parameter"]), 0, 2)), ["actions.0.parameter", "actions.1.parameter"]);
    assert.deepEqual(sorted(remapTouched(touched(["actions.0.parameter", "actions.1.parameter"]), 2, 0)), ["actions.1.parameter", "actions.2.parameter"]);
  });

  test("actions outside the moved range, and fields that are not actions, stay", () => {
    const result = remapTouched(touched(["name", "scope.host", "actions", "actions.0.parameter", "actions.5.parameter"]), 1, 3);
    assert.deepEqual(sorted(result), ["actions", "actions.0.parameter", "actions.5.parameter", "name", "scope.host"]);
  });

  test("an action key without a field behind it is moved too", () => {
    assert.deepEqual(sorted(remapTouched(touched(["actions.1"]), 1, 0)), ["actions.0"]);
  });

  test("does not modify the set it is given", () => {
    const original = touched(["actions.0.parameter"]);
    remapTouched(original, 0, 1);
    assert.deepEqual(sorted(original), ["actions.0.parameter"]);
  });
});

describe("actionDropIndex", () => {
  const dropped = (from, over, after) => {
    const list = ["a", "b", "c", "d"].map(parameter => ({ type: "remove", parameter }));
    return moveAction({ actions: list }, from, actionDropIndex(from, over, after)).actions.map(a => a.parameter).join("");
  };

  test("dropping before a card puts the dragged one just in front of it", () => {
    assert.equal(dropped(0, 2, false), "bacd");
    assert.equal(dropped(3, 1, false), "adbc");
    assert.equal(dropped(3, 0, false), "dabc");
  });

  test("dropping after a card puts the dragged one just behind it", () => {
    assert.equal(dropped(0, 2, true), "bcad");
    assert.equal(dropped(3, 0, true), "adbc");
    assert.equal(dropped(0, 3, true), "bcda");
  });

  test("dropping next to itself changes nothing", () => {
    assert.equal(dropped(1, 1, false), "abcd");
    assert.equal(dropped(1, 1, true), "abcd");
    assert.equal(dropped(1, 0, true), "abcd");
    assert.equal(dropped(1, 2, false), "abcd");
  });
});
