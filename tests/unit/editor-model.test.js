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
  visibleIssues,
  summaryText,
  isDirty,
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
