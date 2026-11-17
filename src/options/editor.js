// The rule editor: draws the form for one draft and reports what the user does.
// The logic is in editor-model.js (unit-tested); this file only builds the DOM and connects the events.
// Text inputs update the draft in place, so typing keeps the focus; changes of structure redraw the form.

import { validateRule, normalizeRule } from "../core/schema.js";
import {
  pathKey,
  setIn,
  unsetIn,
  scopeMode,
  setScopeMode,
  addAction,
  visibleIssues,
  summaryText,
  isDirty,
} from "./editor-model.js";
import { ruleTitle } from "./rule-list.js";
import { testRules, describeChange } from "./tester.js";
import { getPref, setPref } from "./prefs.js";
import { el } from "./dom.js";

const DEFAULT_PLACEHOLDER = "Select a rule to edit it, or add a new one.";

const parsePath = key => key.split(".").map(part => (/^\d+$/.test(part) ? Number(part) : part));
const clone = value => structuredClone(value);

/**
 * @param root the element the editor lives in
 * @param handlers.onSave called when the user asks to save (Save button)
 * @param handlers.onChange called after every change of the draft
 * @param handlers.onDuplicate called when the user presses Duplicate
 * @param handlers.getRules returns the stored rules, for the "All rules" mode of the tester
 */
export function createEditor(root, { onSave, onChange, onDuplicate, getRules }) {
  let draft = null;
  let baseline = null;
  let isNew = false;
  let touched = new Set(); // keys of the fields the user has changed; issues are shown only for these
  let showAll = false; // after Save every issue is shown
  let justSaved = false;
  let placeholder = DEFAULT_PLACEHOLDER; // what the empty editor says

  // The tester's URL and mode are remembered between visits without any Save; the list of changes starts collapsed.
  const tester = { url: getPref("testUrl", ""), mode: getPref("testMode", "all"), open: false };

  // --- Drawing ---

  function slot(key) {
    return el("div", { className: "msg", id: `msg-${key}`, dataset: { path: key } });
  }

  // hideLabel: the label is still there for screen readers, but the layout already shows what the field is.
  function textField(label, path, placeholder, { mono = false, disabled = false, hideLabel = false } = {}) {
    const key = pathKey(path);
    const value = path.reduce((node, part) => node?.[part], draft);
    const input = el("input", {
      type: "text",
      value: typeof value === "string" ? value : "",
      placeholder,
      disabled,
      spellcheck: false,
      autocomplete: "off",
      className: mono ? "mono" : "",
      dataset: { path: key },
    });
    input.setAttribute("aria-describedby", `msg-${key}`);
    return el("label", { className: "field" }, el("span", { className: hideLabel ? "label sr-only" : "label" }, label), input);
  }

  function checkbox(label, checked, dataset) {
    const input = el("input", { type: "checkbox", checked, dataset });
    return el("label", { className: "check" }, input, label);
  }

  function scopeSection() {
    const mode = scopeMode(draft.scope);

    const select = el("select", { dataset: { scopeMode: "" } },
      el("option", { value: "all", textContent: "All sites" }),
      el("option", { value: "host", textContent: "Domain" }),
      el("option", { value: "path", textContent: "Domain + path" }));
    select.value = mode;

    const row = el("div", { className: "row" },
      el("label", { className: "field" }, el("span", { className: "label" }, "Scope"), select));

    if (mode !== "all") {
      row.append(textField("Domain", ["scope", "host"], "example.com"));
      row.append(checkbox("Subdomains", draft.scope.subdomains !== false, { path: "scope.subdomains" }));
    }
    if (mode === "path") {
      row.append(textField("Path", ["scope", "path"], "video"));
    }

    const section = el("section", {}, el("h3", {}, "Applies to"), row, slot("scope.type"), slot("scope.host"), slot("scope.path"));
    if (mode === "path") {
      section.append(el("p", { className: "hint" }, "Use * for one level and ** for any depth, for example albums/* or a/**."));
    }
    return section;
  }

  function replaceLine(index, part, label, placeholders) {
    const base = ["actions", index, part];
    const key = pathKey(base);
    const ticked = typeof draft.actions[index]?.[part]?.replace === "string";

    return el("div", { className: "line" },
      el("span", { className: "k" }, label),
      textField(`${label} pattern`, [...base, "find"], placeholders.find, { mono: true, hideLabel: true }),
      checkbox("Replace with", ticked, { replacePath: key }),
      textField(`${label} replacement`, [...base, "replace"], placeholders.replace, { mono: true, disabled: !ticked, hideLabel: true }),
      slot(`${key}.find`),
      slot(`${key}.replace`));
  }

  function actionCard(action, index) {
    const heading = { remove: "Remove parameter", replace: "Replace in parameter or value" }[action?.type] ?? "Unknown action";

    const card = el("div", { className: "card" },
      el("div", { className: "card-head" },
        el("strong", {}, heading),
        el("button", { type: "button", textContent: "×", title: "Delete action", dataset: { removeAction: String(index) } })));
    card.querySelector("button").setAttribute("aria-label", `Delete action ${index + 1}`);

    if (action?.type === "remove") {
      card.append(textField("Parameter", ["actions", index, "parameter"], "utm_*", { mono: true }));
      card.append(el("p", { className: "hint" }, "* matches any characters."));
      card.append(slot(`actions.${index}.parameter`));
    } else if (action?.type === "replace") {
      card.append(replaceLine(index, "parameter", "Parameter", { find: "^visibility$", replace: "" }));
      card.append(replaceLine(index, "value", "Value", { find: "^public$", replace: "private" }));
      card.append(checkbox("Case sensitive", action.ignoreCase !== true, { path: `actions.${index}.ignoreCase`, invert: "true" }));
      card.append(el("p", { className: "hint" }, "Empty Parameter means any parameter. Patterns are regular expressions; use ^ and $ for an exact match."));
    } else {
      card.append(slot(`actions.${index}.type`));
    }

    card.append(slot(`actions.${index}`));
    return card;
  }

  function actionsSection() {
    const addMenu = el("select", { dataset: { addAction: "" } },
      // Shown while closed, but not offered in the list.
      el("option", { value: "", textContent: "Add action…", hidden: true, disabled: true, selected: true }),
      el("option", { value: "remove", textContent: "Remove parameter" }),
      el("option", { value: "replace", textContent: "Replace in parameter or value" }));

    return el("section", {},
      el("h3", {}, "Actions, run top to bottom"),
      slot("actions"),
      ...draft.actions.map(actionCard),
      addMenu);
  }

  function testerSection() {
    const radio = (value, label) => {
      const input = el("input", { type: "radio", name: "test-mode", value, checked: tester.mode === value, dataset: { testMode: value } });
      return el("label", {}, input, el("span", {}, label));
    };

    const url = el("input", {
      type: "text",
      value: tester.url,
      placeholder: "https://www.example.com/video?v=Hn4xT9sBq2L&pp=…",
      spellcheck: false,
      autocomplete: "off",
      className: "mono",
      dataset: { testUrl: "" },
    });

    const changes = el("details", { className: "changes", open: tester.open },
      el("summary", {}),
      el("ul", {}));

    return el("section", { className: "tester" },
      el("div", { className: "tester-head" },
        el("h3", {}, "Try it"),
        el("div", { className: "segmented", role: "radiogroup" }, radio("all", "All rules"), radio("current", "Current rule"))),
      el("label", { className: "field" }, el("span", { className: "label" }, "URL to test"), url),
      el("div", { className: "result", role: "status" }),
      changes);
  }

  /** Runs the URL of the tester through the rules and shows the result, in place, so typing keeps the focus. */
  function refreshTester() {
    const result = root.querySelector(".tester .result");
    if (draft === null || !result) return;

    const outcome = testRules(tester.url, { draft, rules: getRules(), mode: tester.mode });
    const changes = root.querySelector(".tester details.changes");
    const note = text => el("p", { className: "note" }, text);

    result.replaceChildren();
    changes.hidden = true;

    if (outcome.status === "empty") {
      result.append(note("Paste a URL to see what the rule does."));
      return;
    }
    if (outcome.status === "invalid") {
      result.append(note("Enter a full URL starting with http:// or https://."));
      return;
    }

    result.append(el("div", { className: "result-url" },
      ...outcome.segments.map(segment => (segment.changed ? el("span", { className: "changed" }, segment.text) : segment.text))));

    for (const text of outcome.notes) result.append(note(text));
    if (outcome.changes.length === 0 && outcome.notes.length === 0) result.append(note("No changes."));
    if (outcome.changes.length === 0) return;

    const titleOf = ruleId => {
      if (ruleId === draft.id) return ruleTitle(draft);
      const rule = getRules().find(r => r.id === ruleId);
      return rule ? ruleTitle(rule) : null;
    };

    changes.hidden = false;
    changes.querySelector("summary").textContent = `What changed (${outcome.changes.length})`;
    changes.querySelector("ul").replaceChildren(...outcome.changes.map(change => {
      const { kind, text } = describeChange(change);
      const by = tester.mode === "all" ? titleOf(change.ruleId) : null;

      // Plain spaces between the parts, so the line reads right whatever the layout does.
      return el("li", {},
        el("span", { className: kind === "removed" ? "mark rm" : "mark ok", "aria-hidden": "true" }, kind === "removed" ? "✕" : "✓"),
        " ",
        el("span", { className: "kind" }, kind === "removed" ? "Removed:" : "Changed:"),
        " ",
        el("span", { className: "mono" }, text),
        ...(by ? [" ", el("span", { className: "by" }, "by ", el("strong", {}, by))] : []));
    }));
  }

  function draw() {
    if (draft === null) {
      root.replaceChildren(el("p", { className: "placeholder" }, placeholder));
      return;
    }

    const duplicate = el("button", { type: "button", textContent: "Duplicate", dataset: { duplicate: "" } });
    const header = el("div", { className: "row" }, textField("Name (optional)", ["name"], "Example visibility"), duplicate);

    const footer = el("div", { className: "footer" },
      el("button", { type: "button", className: "primary", textContent: "Save", dataset: { save: "" } }),
      el("button", { type: "button", textContent: "Revert", dataset: { revert: "" } }),
      el("span", { className: "summary", id: "summary", role: "status" }));

    root.replaceChildren(el("form", { className: "editor-form", noValidate: true }, header, scopeSection(), actionsSection(), testerSection(), footer));
    refreshFeedback();
  }

  /** Shows the messages that may be shown now, under their fields, and the summary next to Save. */
  function refreshFeedback() {
    if (draft === null) return;

    const visible = visibleIssues(validateRule(draft), touched, showAll);

    for (const slotEl of root.querySelectorAll(".msg")) {
      const here = visible.filter(issue => pathKey(issue.path) === slotEl.dataset.path);
      const issue = here.find(i => i.severity === "error") ?? here[0];
      slotEl.textContent = issue ? issue.message : "";
      slotEl.className = issue ? `msg ${issue.severity}` : "msg";
    }

    for (const input of root.querySelectorAll("input[data-path]")) {
      const invalid = visible.some(i => i.severity === "error" && pathKey(i.path) === input.dataset.path);
      input.classList.toggle("invalid", invalid);
      input.setAttribute("aria-invalid", String(invalid));
    }

    const summary = root.querySelector("#summary");
    if (summary) summary.textContent = summaryText(visible) || (justSaved ? "Saved." : "");

    refreshTester();
  }

  // --- Keeping the focus when the form is drawn again ---

  function focusSelector(node) {
    const { path, replacePath, scopeMode: mode, addAction: add, testUrl, testMode } = node.dataset;
    if (path !== undefined) return `input[data-path="${path}"]`;
    if (testUrl !== undefined) return "input[data-test-url]";
    if (testMode !== undefined) return `input[data-test-mode="${testMode}"]`;
    if (replacePath !== undefined) return `input[data-replace-path="${replacePath}"]`;
    if (mode !== undefined) return "select[data-scope-mode]";
    if (add !== undefined) return "select[data-add-action]";
    return null;
  }

  function redraw(focusSelectorOverride = null) {
    const active = document.activeElement;
    const selector = focusSelectorOverride ?? (root.contains(active) ? focusSelector(active) : null);
    const caret = active?.selectionStart !== undefined && !focusSelectorOverride ? [active.selectionStart, active.selectionEnd] : null;

    draw();

    const target = selector ? root.querySelector(selector) : null;
    if (target) {
      target.focus();
      if (caret && target.setSelectionRange) target.setSelectionRange(...caret);
    }
  }

  // --- Changes ---

  function changed(key) {
    if (key) touched.add(key);
    justSaved = false;
    onChange();
  }

  function apply(path, value) {
    draft = setIn(draft, path, value);
    changed(pathKey(path));
  }

  root.addEventListener("input", event => {
    const field = event.target;
    if (draft === null || field.type !== "text") return;

    if (field.dataset.testUrl !== undefined) {
      tester.url = field.value;
      setPref("testUrl", tester.url);
      refreshTester();
      return;
    }

    apply(parsePath(field.dataset.path), field.value);
    refreshFeedback();
  });

  root.addEventListener("change", event => {
    const field = event.target;
    if (draft === null) return;

    if (field.dataset.testMode !== undefined) {
      tester.mode = field.value;
      setPref("testMode", tester.mode);
      refreshTester();
    } else if (field.dataset.scopeMode !== undefined) {
      draft = { ...draft, scope: setScopeMode(draft.scope, field.value) };
      changed("scope.type");
      redraw();
    } else if (field.dataset.addAction !== undefined) {
      if (field.value === "") return;
      draft = addAction(draft, field.value);
      touched.add("actions");
      changed();
      const index = draft.actions.length - 1;
      redraw(field.value === "remove" ? `input[data-path="actions.${index}.parameter"]` : `input[data-path="actions.${index}.parameter.find"]`);
    } else if (field.dataset.replacePath !== undefined) {
      const path = [...parsePath(field.dataset.replacePath), "replace"];
      draft = field.checked ? setIn(draft, path, "") : unsetIn(draft, path);
      changed(pathKey(path));
      redraw(field.checked ? `input[data-path="${pathKey(path)}"]` : `input[data-replace-path="${field.dataset.replacePath}"]`);
    } else if (field.dataset.path !== undefined && field.type === "checkbox") {
      apply(parsePath(field.dataset.path), field.dataset.invert ? !field.checked : field.checked);
      refreshFeedback();
    }
  });

  root.addEventListener("click", event => {
    if (draft === null) return;

    const remove = event.target.closest("[data-remove-action]");
    if (remove) {
      draft = unsetIn(draft, ["actions", Number(remove.dataset.removeAction)]);
      // The fields of the actions after this one have moved, so what was touched there no longer applies.
      touched = new Set([...touched].filter(key => !key.startsWith("actions.")));
      touched.add("actions");
      changed();
      redraw("select[data-add-action]");
    } else if (event.target.closest("[data-save]")) {
      onSave();
    } else if (event.target.closest("[data-revert]")) {
      revert();
    } else if (event.target.closest("[data-duplicate]")) {
      onDuplicate();
    }
  });

  root.addEventListener("submit", event => event.preventDefault());

  // The toggle event does not bubble, so it is caught on the way down.
  root.addEventListener("toggle", event => {
    if (event.target.matches("details.changes")) tester.open = event.target.open;
  }, true);

  function revert() {
    draft = clone(baseline);
    touched = new Set();
    showAll = !isNew;
    justSaved = false;
    onChange();
    redraw();
  }

  // --- What the page can ask of the editor ---

  return {
    /** Opens a rule, or a new draft (`isNew`), discarding whatever was open. */
    open(rule, { isNew: opened = false } = {}) {
      draft = clone(rule);
      baseline = clone(rule);
      isNew = opened;
      touched = new Set();
      // A stored rule shows all its errors and warnings at once; a new one only after the user has typed.
      showAll = !opened;
      justSaved = false;
      draw();
      onChange();
    },

    /** Empties the editor; `message` is what it says instead of the usual invitation, for example "3 rules selected." */
    close(message = DEFAULT_PLACEHOLDER) {
      draft = null;
      baseline = null;
      isNew = false;
      placeholder = message;
      draw();
      onChange();
    },

    /** The stored rule changed elsewhere: show the new version, unless the user has unsaved changes. */
    reload(rule) {
      if (draft === null || isNew || isDirty(draft, baseline)) return;
      if (JSON.stringify(rule) === JSON.stringify(baseline)) return;

      draft = clone(rule);
      baseline = clone(rule);
      redraw();
    },

    /** The draft was stored as `rule`: it becomes the starting point, and all issues are shown. */
    markSaved(rule) {
      draft = clone(rule);
      baseline = clone(rule);
      isNew = false;
      showAll = true;
      justSaved = true;
      redraw();
      onChange();
    },

    /** The stored rules changed: the result of the tester may have changed too. */
    refreshTester,

    focus(key) {
      root.querySelector(`input[data-path="${key}"]`)?.focus();
    },

    get isOpen() { return draft !== null; },
    get isNew() { return isNew; },
    get id() { return draft?.id ?? null; },
    get title() { return draft?.name?.trim() || "New rule"; },
    isDirty: () => draft !== null && isDirty(draft, baseline),
    snapshot: () => (draft === null ? null : clone(draft)),
    toRule: () => normalizeRule(draft),
  };
}
