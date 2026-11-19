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
  moveAction,
  remapTouched,
  remapTouchedAfterRemove,
  actionDropIndex,
  visibleIssues,
  summaryText,
  isDirty,
  canSave,
  canRevert,
  actionSummary,
  startCollapsed,
  moveFlag,
  cardsWithErrors,
} from "./editor-model.js";
import { ruleTitle } from "./rule-list.js";
import { testRules, describeChange } from "./tester.js";
import { getPref, setPref } from "./prefs.js";
import { el, autosize } from "./dom.js";
import { NAME_MAX } from "../core/schema.js";

const DEFAULT_PLACEHOLDER = "Select a rule to edit it, or add a new one.";

const parsePath = key => key.split(".").map(part => (/^\d+$/.test(part) ? Number(part) : part));
const clone = value => structuredClone(value);

/**
 * @param root the element the editor lives in
 * @param handlers.onSave called when the user asks to save (Save button)
 * @param handlers.onChange called after every change of the draft
 * @param handlers.onDuplicate called when the user presses Duplicate
 * @param handlers.onCancel called when the user presses Cancel, which a new rule has
 * @param handlers.getRules returns the stored rules, for the "All rules" mode of the tester
 * @param handlers.getExcludedSites returns the list of excluded sites, which the tester takes into account
 */
export function createEditor(root, { onSave, onChange, onDuplicate, onCancel, getRules, getExcludedSites }) {
  let draft = null;
  let baseline = null;
  let isNew = false;
  let touched = new Set(); // keys of the fields the user has changed; issues are shown only for these
  let showAll = false; // after Save, or once a URL is in Try it, every issue is shown, and it stays shown
  let justSaved = false;
  let placeholder = DEFAULT_PLACEHOLDER; // what the empty editor says
  let collapsedCards = []; // for each action of the draft, whether its card is collapsed; only shown, never stored

  // The tested URL is kept while the page is open, so it is still there when another rule is opened, but it is not stored.
  // The mode is remembered between visits. The list of changes starts collapsed.
  const tester = { url: "", mode: getPref("testMode", "all"), open: false };

  // --- Drawing ---

  let growing = []; // fits the text boxes that grow with their text, for the editor drawn now

  function slot(key) {
    return el("div", { className: "msg", id: `msg-${key}`, dataset: { path: key } });
  }

  // hideLabel: the label is still there for screen readers, but the layout already shows what the field is.
  function textInput(path, placeholder, { mono = false, disabled = false, maxLength = null } = {}) {
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
    if (maxLength !== null) input.maxLength = maxLength;
    input.setAttribute("aria-describedby", `msg-${key}`);
    return input;
  }

  function textField(label, path, placeholder, options = {}) {
    return el("label", { className: "field" }, el("span", { className: "label" }, label), textInput(path, placeholder, options));
  }

  /**
   * A text box with one entry per line; the draft holds the lines as a list.
   * With `grow` it starts `grow.minRows` lines high and grows with its text up to `grow.maxRows` lines.
   */
  function linesField(label, path, placeholder, { rows = 4, grow = null } = {}) {
    const key = pathKey(path);
    const value = path.reduce((node, part) => node?.[part], draft);
    const area = el("textarea", {
      rows,
      value: Array.isArray(value) ? value.join("\n") : "",
      placeholder,
      spellcheck: false,
      autocomplete: "off",
      className: "mono",
      dataset: { path: key },
    });
    area.setAttribute("aria-describedby", `msg-${key}`);
    if (grow) growing.push(autosize(area, grow));
    return el("label", { className: "field" }, el("span", { className: "label" }, label), area);
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

    // One column, every field with its label above it: the scope, then the domain, whether subdomains count, and the path.
    const stack = el("div", { className: "stack" },
      el("div", { className: "group" },
        el("label", { className: "field" }, el("span", { className: "label" }, "Scope"), select),
        slot("scope.type")));

    if (mode !== "all") {
      stack.append(
        el("div", { className: "group" }, textField("Domain", ["scope", "host"], "example.com"), slot("scope.host")),
        checkbox("Include subdomains", draft.scope.subdomains !== false, { path: "scope.subdomains" }));
    }
    if (mode === "path") {
      stack.append(el("div", { className: "group" },
        textField("Path", ["scope", "path"], "video"),
        el("p", { className: "hint" }, "Use * for one level and ** for any depth, for example albums/* or a/**."),
        slot("scope.path")));
    }

    const section = el("section", {}, el("h3", {}, "Applies to"), stack);

    // Sites where the rule does nothing, for every scope.
    // Drawn like the same list in Settings: a heading, the box labelled "Domains, one per line", and the hint.
    section.append(el("div", { className: "excluded-sites" },
      el("h3", {}, "Excluded sites"),
      linesField("Domains, one per line", ["scope", "except"], "example.com", { rows: 2, grow: { minRows: 2, maxRows: 10 } }),
      el("p", { className: "hint" }, "The rule does nothing on these sites. Subdomains are included."),
      slot("scope.except")));
    return section;
  }

  // The name or the value of a parameter: what to find, and optionally what to put in its place.
  // The label of the second box is the checkbox that switches the replacement on.
  function replaceGroup(index, part, title, description, placeholders) {
    const base = ["actions", index, part];
    const key = pathKey(base);
    const ticked = typeof draft.actions[index]?.[part]?.replace === "string";

    const replacement = textInput([...base, "replace"], placeholders.replace, { mono: true, disabled: !ticked });
    replacement.setAttribute("aria-label", `${title} replacement`);

    return el("div", { className: "group" },
      el("div", { className: "group-title" }, el("strong", {}, title), el("span", { className: "desc" }, description)),
      el("div", { className: "find-pair" },
        textField("Find", [...base, "find"], placeholders.find, { mono: true }),
        el("span", { className: "arrow", "aria-hidden": "true" }, "→"),
        el("div", { className: "field" }, checkbox("Replace with", ticked, { replacePath: key }), replacement)),
      slot(`${key}.find`),
      slot(`${key}.replace`));
  }

  const ACTIONS = {
    remove: { title: "Remove parameter", description: "Removes matching query parameters." },
    replace: { title: "Replace", description: "Replaces matching parameter names or values." },
    keep: { title: "Keep only these parameters", description: "Removes all parameters not listed." },
  };

  function actionCard(action, index) {
    const info = ACTIONS[action?.type] ?? { title: "Unknown action", description: "" };
    const isCollapsed = collapsedCards[index] === true;

    const count = draft.actions.length;
    const mover = (direction, disabled) => {
      const button = el("button", {
        type: "button",
        textContent: direction === "up" ? "↑" : "↓",
        title: `Move ${direction} (Ctrl+Alt+${direction === "up" ? "Up" : "Down"})`,
        disabled,
        dataset: { moveAction: direction, actionIndex: String(index) },
      });
      button.setAttribute("aria-label", `Move action ${index + 1} ${direction}`);
      return button;
    };

    const remove = el("button", { type: "button", className: "delete icon-btn", title: "Delete action", dataset: { removeAction: String(index) } },
      el("span", { className: "icon icon-delete", "aria-hidden": "true" }));
    remove.setAttribute("aria-label", `Delete action ${index + 1}`);

    const grip = el("span", { className: "grip", draggable: true, title: "Drag to reorder", dataset: { actionGrip: String(index) } }, "⋮⋮");
    grip.setAttribute("aria-hidden", "true");

    const toggle = el("button", { type: "button", className: "icon-btn", dataset: { toggleCard: String(index) } },
      el("span", { className: "icon", "aria-hidden": "true" }));
    toggle.setAttribute("aria-label", `Action ${index + 1}, ${info.title}`);

    const flag = el("span", { className: "status card-flag", title: "This action has an error", dataset: { status: "error" } });
    flag.setAttribute("role", "img");
    flag.setAttribute("aria-label", "This action has an error");

    const body = el("div", { className: "card-body" });
    const card = el("div", { className: "card", dataset: { actionIndex: String(index) } },
      el("div", { className: "card-head" },
        grip,
        toggle,
        el("strong", {}, info.title),
        el("span", { className: "card-summary mono" }),
        flag,
        mover("up", index === 0),
        mover("down", index === count - 1),
        remove),
      el("p", { className: "desc" }, info.description),
      body);

    if (action?.type === "remove") {
      body.append(el("div", { className: "group" },
        textField("Parameter", ["actions", index, "parameter"], "utm_*", { mono: true }),
        el("p", { className: "hint" }, "* = any characters"),
        slot(`actions.${index}.parameter`)));
    } else if (action?.type === "keep") {
      body.append(el("div", { className: "group" },
        linesField("Parameters", ["actions", index, "parameters"], "list\nutm_*"),
        el("p", { className: "hint" }, "One per line. * = any characters"),
        slot(`actions.${index}.parameters`)));
    } else if (action?.type === "replace") {
      body.append(
        replaceGroup(index, "parameter", "Parameter name", "Rename a parameter.", { find: "^visibility$", replace: "" }),
        replaceGroup(index, "value", "Parameter value", "Replace a value.", { find: "^public$", replace: "private" }),
        el("div", { className: "group" },
          checkbox("Case sensitive", action.ignoreCase !== true, { path: `actions.${index}.ignoreCase`, invert: "true" }),
          el("p", { className: "hint" }, "Empty = any parameter. Supports regex. Use ^ and $ for exact matches.")));
    } else {
      body.append(slot(`actions.${index}.type`));
    }

    body.append(slot(`actions.${index}`));
    showCardState(card, isCollapsed);
    return card;
  }

  /** Collapses or expands a card in place: the body is hidden, and the summary and the arrow follow. */
  function showCardState(card, isCollapsed) {
    const index = Number(card.dataset.actionIndex);
    const toggle = card.querySelector("[data-toggle-card]");

    card.classList.toggle("collapsed", isCollapsed);
    card.querySelector(".card-body").hidden = isCollapsed;
    card.querySelector(":scope > .desc").hidden = isCollapsed;
    toggle.firstElementChild.className = `icon ${isCollapsed ? "icon-expand" : "icon-collapse"}`;
    toggle.setAttribute("aria-expanded", String(!isCollapsed));
    toggle.title = isCollapsed ? "Expand" : "Collapse";
    card.querySelector(".card-summary").textContent = isCollapsed ? actionSummary(draft.actions[index]) : "";
  }

  function actionsSection() {
    const addMenu = el("select", { dataset: { addAction: "" } },
      // Shown while closed, but not offered in the list.
      el("option", { value: "", textContent: "Add action…", hidden: true, disabled: true, selected: true }),
      el("option", { value: "remove", textContent: "Remove parameter" }),
      el("option", { value: "replace", textContent: "Replace" }),
      el("option", { value: "keep", textContent: "Keep only these parameters" }));

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

    const outcome = testRules(tester.url, { draft, rules: getRules(), mode: tester.mode, excludedSites: getExcludedSites() });
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
        el("span", { className: kind === "removed" ? "mark rm" : "mark ch", "aria-hidden": "true" }, kind === "removed" ? "✕" : "↔"),
        el("div", { className: "what" },
          el("div", {},
            el("span", { className: "kind" }, kind === "removed" ? "Removed:" : "Changed:"),
            " ",
            el("span", { className: "mono" }, text)),
          ...(by ? [el("div", { className: "by" }, `Rule: ${by}`)] : [])));
    }));
  }

  function draw() {
    if (draft === null) {
      root.replaceChildren(el("p", { className: "placeholder" }, placeholder));
      return;
    }

    const duplicate = el("button", { type: "button", textContent: "Duplicate", dataset: { duplicate: "" } });
    const header = el("div", { className: "row" }, textField("Name (optional)", ["name"], "Example visibility", { maxLength: NAME_MAX }), duplicate);

    const footer = el("div", { className: "footer" },
      el("button", { type: "button", className: "primary", textContent: "Save", dataset: { save: "" } }),
      el("button", { type: "button", textContent: "Revert", dataset: { revert: "" } }),
      // A rule that is not stored yet can be closed without saving it.
      ...(isNew ? [el("button", { type: "button", textContent: "Cancel", dataset: { cancel: "" } })] : []),
      el("span", { className: "summary", id: "summary", role: "status" }));

    if (collapsedCards.length !== draft.actions.length) collapsedCards = startCollapsed(draft);
    growing = [];
    const form = el("form", { className: "editor-form", noValidate: true }, header, scopeSection(), actionsSection(), testerSection(), footer);
    root.replaceChildren(form);
    for (const fit of growing) fit(); // they can only be measured once they are on the page
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

    for (const input of root.querySelectorAll("input[data-path], textarea[data-path]")) {
      const invalid = visible.some(i => i.severity === "error" && pathKey(i.path) === input.dataset.path);
      input.classList.toggle("invalid", invalid);
      input.setAttribute("aria-invalid", String(invalid));
    }

    // A collapsed card shows its summary, and a mark when something in it is wrong.
    const bad = cardsWithErrors(visible);
    for (const card of root.querySelectorAll(".card[data-action-index]")) {
      const index = Number(card.dataset.actionIndex);
      card.classList.toggle("has-error", bad.has(index));
      if (collapsedCards[index]) card.querySelector(".card-summary").textContent = actionSummary(draft.actions[index]);
    }

    const summary = root.querySelector("#summary");
    if (summary) summary.textContent = summaryText(visible) || (justSaved ? "Saved." : "");

    // Each button is active only when it would do something.
    const save = root.querySelector("[data-save]");
    const revert = root.querySelector("[data-revert]");
    if (save) save.disabled = !canSave(draft, baseline, isNew);
    if (revert) revert.disabled = !canRevert(draft, baseline);

    refreshTester();
  }

  // --- Keeping the focus when the form is drawn again ---

  function focusSelector(node) {
    const { path, replacePath, scopeMode: mode, addAction: add, testUrl, testMode } = node.dataset;
    if (path !== undefined) return `input[data-path="${path}"], textarea[data-path="${path}"]`;
    if (testUrl !== undefined) return "input[data-test-url]";
    if (testMode !== undefined) return `input[data-test-mode="${testMode}"]`;
    if (replacePath !== undefined) return `input[data-replace-path="${replacePath}"]`;
    if (mode !== undefined) return "select[data-scope-mode]";
    if (add !== undefined) return "select[data-add-action]";
    return null;
  }

  /**
   * Draws the form again and puts the focus back: on `focusSelectorOverride` if given, else on the field that had it.
   * `options.caret` is [start, end] for a text field, `options.fallback` a selector to use when the first one is disabled.
   */
  function redraw(focusSelectorOverride = null, { caret: caretOverride = null, fallback = null } = {}) {
    const active = document.activeElement;
    const selector = focusSelectorOverride ?? (root.contains(active) ? focusSelector(active) : null);
    const hasCaret = typeof active?.selectionStart === "number" && !focusSelectorOverride;
    const caret = caretOverride ?? (hasCaret ? [active.selectionStart, active.selectionEnd] : null);

    draw();

    let target = selector ? root.querySelector(selector) : null;
    if (target?.disabled && fallback) target = root.querySelector(fallback);
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
    if (draft === null) return;

    // A text box with one entry per line: the lines are what is stored.
    if (field.tagName === "TEXTAREA") {
      apply(parsePath(field.dataset.path), field.value.split("\n"));
      refreshFeedback();
      return;
    }

    if (field.type !== "text") return;

    if (field.dataset.testUrl !== undefined) {
      tester.url = field.value;
      // With a URL in Try it every message shows, so the note "This rule has errors" has something to point at.
      // An error that has been shown stays while the rule is invalid, so clearing the URL does not hide it again.
      if (field.value.trim() !== "") showAll = true;
      refreshFeedback();
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
      collapsedCards = [...collapsedCards, false];
      touched.add("actions");
      // The actions above the new one are done with, so their messages show.
      for (let i = 0; i < draft.actions.length - 1; i++) touched.add(`actions.${i}.*`);
      changed();
      const index = draft.actions.length - 1;
      const first = { remove: "parameter", replace: "parameter.find", keep: "parameters" }[field.value];
      redraw(`input[data-path="actions.${index}.${first}"], textarea[data-path="actions.${index}.${first}"]`);
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

    const move = event.target.closest("[data-move-action]");
    if (move) {
      const from = Number(move.dataset.actionIndex);
      moveCard(from, from + (move.dataset.moveAction === "up" ? -1 : 1));
      return;
    }

    const toggle = event.target.closest("[data-toggle-card]");
    if (toggle) {
      const index = Number(toggle.dataset.toggleCard);
      collapsedCards = collapsedCards.map((value, i) => (i === index ? !value : value));
      showCardState(toggle.closest(".card"), collapsedCards[index]);
      return;
    }

    // A collapsed card opens when it is clicked anywhere. Its buttons and its drag handle keep their own meaning.
    const collapsedCard = event.target.closest(".card.collapsed");
    if (collapsedCard && !event.target.closest("button, .grip")) {
      const card = collapsedCard;
      const index = Number(card.dataset.actionIndex);
      collapsedCards = collapsedCards.map((value, i) => (i === index ? false : value));
      showCardState(card, false);
      return;
    }

    const remove = event.target.closest("[data-remove-action]");
    if (remove) {
      draft = unsetIn(draft, ["actions", Number(remove.dataset.removeAction)]);
      collapsedCards = collapsedCards.filter((_, i) => i !== Number(remove.dataset.removeAction));
      // What was touched in the actions after this one moves with them.
      touched = remapTouchedAfterRemove(touched, Number(remove.dataset.removeAction));
      touched.add("actions");
      changed();
      redraw("select[data-add-action]");
    } else if (event.target.closest("[data-save]")) {
      onSave();
    } else if (event.target.closest("[data-revert]")) {
      revert();
    } else if (event.target.closest("[data-cancel]")) {
      onCancel();
    } else if (event.target.closest("[data-duplicate]")) {
      onDuplicate();
    }
  });

  root.addEventListener("submit", event => event.preventDefault());

  // The toggle event does not bubble, so it is caught on the way down.
  root.addEventListener("toggle", event => {
    if (event.target.matches("details.changes")) tester.open = event.target.open;
  }, true);

  /** Where the focus goes when the action at `from` moves to `to`: the same control of the moved card. */
  function movedFocus(active, from, to) {
    const { path, replacePath, moveAction: direction, removeAction } = active.dataset;
    const reindex = key => key.replace(new RegExp(`^actions\\.${from}(?=\\.|$)`), `actions.${to}`);

    if (path !== undefined && path.startsWith(`actions.${from}.`)) {
      return { selector: `input[data-path="${reindex(path)}"], textarea[data-path="${reindex(path)}"]` };
    }
    if (replacePath !== undefined && replacePath.startsWith(`actions.${from}.`)) {
      return { selector: `input[data-replace-path="${reindex(replacePath)}"]` };
    }
    if (direction !== undefined) {
      const other = direction === "up" ? "down" : "up";
      return {
        selector: `button[data-move-action="${direction}"][data-action-index="${to}"]`,
        fallback: `button[data-move-action="${other}"][data-action-index="${to}"]`,
      };
    }
    if (removeAction !== undefined && Number(removeAction) === from) {
      return { selector: `button[data-remove-action="${to}"]` };
    }
    return { selector: null };
  }

  /** Moves an action to another place. The focus stays on the same control of that card, and its messages go with it. */
  function moveCard(from, to) {
    const target = Math.max(0, Math.min(to, draft.actions.length - 1));
    if (from < 0 || from >= draft.actions.length || target === from) return;

    const active = document.activeElement;
    const focus = root.contains(active) ? movedFocus(active, from, target) : { selector: null };
    const caret = typeof active?.selectionStart === "number" ? [active.selectionStart, active.selectionEnd] : null;

    draft = moveAction(draft, from, target);
    collapsedCards = moveFlag(collapsedCards, from, target);
    touched = remapTouched(touched, from, target);
    changed();
    redraw(focus.selector, { caret, fallback: focus.fallback });
  }

  // Ctrl+Alt+Up and Ctrl+Alt+Down move the action that has the focus.
  // Only inside an action card, so the Scope and Add action menus are not touched.
  root.addEventListener("keydown", event => {
    if (draft === null || !event.altKey || !event.ctrlKey || event.shiftKey || event.metaKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;

    const card = event.target.closest(".card[data-action-index]");
    if (!card || event.target.closest("select")) return;

    event.preventDefault();
    const from = Number(card.dataset.actionIndex);
    moveCard(from, from + (event.key === "ArrowUp" ? -1 : 1));
  });

  // Dragging an action by its handle.
  let dragFrom = null;
  let dropTarget = null; // { over, after }

  const clearDropLine = () => {
    for (const card of root.querySelectorAll(".card.drop-before, .card.drop-after")) {
      card.classList.remove("drop-before", "drop-after");
    }
  };

  const endDrag = () => {
    dragFrom = null;
    dropTarget = null;
    clearDropLine();
    for (const card of root.querySelectorAll(".card.dragging")) card.classList.remove("dragging");
  };

  root.addEventListener("dragstart", event => {
    const grip = event.target.closest?.("[data-action-grip]");
    if (!grip || draft === null) return;

    dragFrom = Number(grip.dataset.actionGrip);
    const card = grip.closest(".card");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(dragFrom));
    event.dataTransfer.setDragImage(card, 16, 16);
    card.classList.add("dragging");
  });

  root.addEventListener("dragover", event => {
    if (dragFrom === null) return;

    const card = event.target.closest?.(".card[data-action-index]");
    clearDropLine();

    // Dropping on the card that is being dragged does nothing, so it is not offered.
    if (!card || Number(card.dataset.actionIndex) === dragFrom) {
      dropTarget = null;
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";

    const box = card.getBoundingClientRect();
    const after = event.clientY > box.top + box.height / 2;
    dropTarget = { over: Number(card.dataset.actionIndex), after };
    card.classList.add(after ? "drop-after" : "drop-before");
  });

  root.addEventListener("drop", event => {
    if (dragFrom === null || dropTarget === null) return;

    event.preventDefault();
    const from = dragFrom;
    const to = actionDropIndex(from, dropTarget.over, dropTarget.after);
    endDrag();
    moveCard(from, to);
  });

  root.addEventListener("dragend", endDrag);

  function revert() {
    draft = clone(baseline);
    collapsedCards = startCollapsed(draft);
    touched = new Set();
    showAll = !isNew || tester.url.trim() !== "";
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
      collapsedCards = startCollapsed(draft);
      isNew = opened;
      touched = new Set();
      // A stored rule shows all its errors and warnings at once; a new one only after the user has typed.
      showAll = !opened || tester.url.trim() !== "";
      justSaved = false;
      draw();
      onChange();
    },

    /** Empties the editor; `message` is what it says instead of the usual invitation, for example "3 rules selected." */
    close(message = DEFAULT_PLACEHOLDER) {
      draft = null;
      baseline = null;
      collapsedCards = [];
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
      collapsedCards = startCollapsed(draft);
      redraw();
    },

    /** The draft was stored as `rule`: it becomes the starting point, and all issues are shown. */
    markSaved(rule) {
      draft = clone(rule);
      baseline = clone(rule);
      isNew = false;
      showAll = true;
      justSaved = true;
      // After Save every error is shown, so a collapsed card with one opens.
      const bad = cardsWithErrors(validateRule(draft));
      collapsedCards = draft.actions.map((_, i) => (collapsedCards[i] === true && !bad.has(i)));
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
    canSave: () => draft !== null && canSave(draft, baseline, isNew),
    snapshot: () => (draft === null ? null : clone(draft)),
    toRule: () => normalizeRule(draft),
  };
}
