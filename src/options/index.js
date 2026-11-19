// Main page: the rule list and the rule editor.
// The logic is in rule-list.js and editor-model.js (unit-tested); this file connects it to the DOM and to storage.

import { readConfig, validateRule, UNDO_SECONDS_DEFAULT } from "../core/schema.js";
import {
  moveRule,
  moveRules,
  moveRulesTo,
  upsertRule,
  removeRules,
  restoreRules,
  setEnabledMany,
  ruleTitle,
  ellipsize,
  ruleSubtitle,
  ruleStatus,
  ruleInitial,
  showEmptyState,
  keyCommand,
  stepSelection,
  selectionAfterRemove,
} from "./rule-list.js";
import { newDraft, duplicateDraft, isSaveKey } from "./editor-model.js";
import { clickSelection, extendSelection } from "./selection.js";
import { createEditor } from "./editor.js";
import { exportFile, parseImport, summarizeImport, applyImport } from "./transfer.js";
import { PRESETS, presetDraft } from "./presets.js";
import { createSettings } from "./settings.js";
import { validSites } from "../core/exclusions.js";
import { createBulkClean } from "./bulk-dialog.js";
import { store } from "../storage/default.js";
import { StoreError } from "../storage/store.js";
import { getPref, setPref } from "./prefs.js";

const MESSAGE_MS = 6000;
const MESSAGE_NAME_MAX = 40; // characters of a rule's name shown in a message

const $ = id => document.getElementById(id);
const list = $("rules");

/** One rule selected and open in the editor, or none. */
function setSelected(id) {
  selectedId = id;
  selectedIds = id === null ? [] : [id];
  anchorId = id;
}

let config = null; // what was loaded; null when it cannot be edited
let selectedId = null; // the stored rule open in the editor; null for a new draft, nothing, or several rules
let selectedIds = []; // the selected rules, in list order: one when selectedId is set, several for a multiple selection
let anchorId = null; // the rule a Shift range starts from
let focusId = null; // rule whose main button gets the focus after the next render
let draggingId = null; // the row the drag started on
let draggingIds = []; // the rules that move with it: the whole selection when the row is part of one
let dropTarget = null; // { id, after }
let undo = null; // { restore }: how to take back the last delete or import, while its message is shown
let toastTimer = null;

const editor = createEditor($("editor"), {
  onSave: saveEditor,
  onChange: updateMarks,
  onDuplicate: duplicateRule,
  onCancel: closeNewRule,
  getRules: () => (config ? config.rules : []),
  getExcludedSites: () => (config ? config.settings.excludedSites : []),
});

// --- Settings panel and bulk clean ---

const bulk = createBulkClean({
  dialog: $("bulk-dialog"),
  getRules: () => (config ? config.rules : []),
  getExcludedSites: () => (config ? config.settings.excludedSites : []),
  notify: text => showMessage(text),
  notifyUndo: (text, restore) => showUndo(text, restore),
  onChange: () => updateSettings(),
});

const settings = createSettings($("settings"), {
  onCleanOnEdit: checked => setCleanOnEdit(checked),
  onUndoSeconds: seconds => setUndoSeconds(seconds),
  onExcludedSites: sites => setExcludedSites(sites),
  onClean: () => bulk.start(),
  onRestore: () => bulk.restoreLast(),
});

let view = "rules"; // what the right side shows: the rule editor or the settings

function showView(name) {
  view = name;
  $("settings-button").setAttribute("aria-pressed", String(name === "settings"));
  updatePanes();
}

/** Shows one of the editor, the settings and the invitation to add a rule. */
function updatePanes() {
  const empty = showEmptyState({
    view,
    loaded: config !== null,
    ruleCount: config ? config.rules.length : 0,
    editorOpen: editor.isOpen,
  });

  $("editor").hidden = view !== "rules" || empty;
  $("settings").hidden = view !== "settings";
  $("empty").hidden = !empty;
}

function updateSettings() {
  settings.update({
    cleanOnEdit: config ? config.settings.cleanOnEdit : false,
    undoSeconds: config ? config.settings.undoSeconds : UNDO_SECONDS_DEFAULT,
    excludedSites: config ? config.settings.excludedSites : [],
    restorable: bulk.restorable,
  });
}

/**
 * Stores the list of excluded sites when the text box is left, without the entries that are not a plain domain.
 * Nothing is written when the list did not change.
 */
async function setExcludedSites(typed) {
  const sites = validSites(typed);
  if (!config || JSON.stringify(sites) === JSON.stringify(config.settings.excludedSites)) return;

  const saved = await saveConfig({ ...config, settings: { ...config.settings, excludedSites: sites } });
  if (!saved) updateSettings(); // put the text back
}

async function setUndoSeconds(seconds) {
  if (!config || seconds === config.settings.undoSeconds) return;

  const saved = await saveConfig({ ...config, settings: { ...config.settings, undoSeconds: seconds } }, { rerender: false });
  if (!saved) updateSettings(); // put the number back
}

async function setCleanOnEdit(checked) {
  if (!config) return;

  const saved = await saveConfig({ ...config, settings: { ...config.settings, cleanOnEdit: checked } }, { rerender: false });
  if (!saved) updateSettings(); // put the checkbox back
}

// --- Collapsing the list ---

let collapsed = getPref("listCollapsed", false);

function applyCollapsed() {
  document.body.classList.toggle("collapsed", collapsed);

  const button = $("collapse");
  button.textContent = collapsed ? "»" : "«";
  button.setAttribute("aria-expanded", String(!collapsed));
  button.setAttribute("aria-label", collapsed ? "Show the rule list" : "Hide the rule list");
  button.title = `${collapsed ? "Show" : "Hide"} the rule list ([)`;
}

function toggleCollapsed() {
  collapsed = !collapsed;
  setPref("listCollapsed", collapsed);
  applyCollapsed();
}

// --- Storage ---

async function load({ onlyIfChanged = false } = {}) {
  const loaded = readConfig(await store.loadStored());

  if (loaded.status !== "ok") {
    config = null;
    setSelected(null);
    editor.close();
    showNotice("These rules were saved by a newer version of Bookmark Peeler, so they can't be shown or changed here.");
    render();
    return;
  }

  if (onlyIfChanged && config && JSON.stringify(loaded.config) === JSON.stringify(config)) return;

  config = loaded.config;
  selectedIds = selectedIds.filter(id => config.rules.some(rule => rule.id === id));
  showNotice("");
  syncEditor();
  render();
}

/** The rules changed (maybe in another tab): bring the open rule up to date, unless it has unsaved changes. */
function syncEditor() {
  if (!editor.isOpen || editor.isNew) return;

  const rule = config.rules.find(r => r.id === editor.id);
  if (rule) {
    editor.reload(rule);
  } else if (!editor.isDirty()) {
    setSelected(null);
    editor.close();
  }
}

/** Stores the rules, with the settings as they are. Returns whether they were stored. */
async function save(rules, options) {
  return saveConfig({ ...config, rules }, options);
}

/** The message for a write that the store refused, or null when the error is something else. */
function storeProblem(error) {
  if (!(error instanceof StoreError)) return null;

  switch (error.code) {
    case "settings-too-large":
      return "The settings are too large to be saved. Shorten the list of excluded sites.";
    case "unsupported":
      return "These rules were saved by a newer version of Bookmark Peeler, so they can't be changed here.";
    default:
      return null;
  }
}

/** Stores a whole config (rules and settings). Returns whether it was stored. */
async function saveConfig(next, { rerender = true } = {}) {
  try {
    await store.writeConfig(next);
  } catch (error) {
    console.error("Bookmark Peeler:", error);
    showMessage(storeProblem(error) ?? "Couldn't save your changes. Reload the page and try again.");
    return false;
  }

  config = next;
  if (rerender) render();
  return true;
}

function showNotice(text) {
  const notice = $("notice");
  notice.textContent = text;
  notice.hidden = text === "";
}

// --- Rendering the list ---

function indexOfId(id) {
  return config ? config.rules.findIndex(rule => rule.id === id) : -1;
}

function statusMessage(rule, status) {
  const issues = validateRule(rule);
  const issue = issues.find(i => i.severity === status);
  return status === "error" ? `Not applied until fixed: ${issue.message}` : issue.message;
}

function renderRule(rule) {
  const title = ruleTitle(rule);
  const subtitle = ruleSubtitle(rule);
  const status = ruleStatus(rule);

  const item = document.createElement("li");
  item.className = "rule";
  item.dataset.id = rule.id;
  item.draggable = true;
  item.classList.toggle("selected", selectedIds.includes(rule.id));
  item.classList.toggle("disabled", rule.enabled === false);

  const grip = document.createElement("span");
  grip.className = "grip";
  grip.setAttribute("aria-hidden", "true");
  grip.textContent = "⋮⋮";

  const toggle = document.createElement("input");
  toggle.type = "checkbox";
  toggle.setAttribute("role", "switch");
  toggle.checked = rule.enabled !== false;
  toggle.setAttribute("aria-label", `Enable ${title}`);

  const main = document.createElement("button");
  main.type = "button";
  main.className = "main";
  main.dataset.initial = ruleInitial(rule);
  main.title = title;
  main.setAttribute("aria-label", subtitle ? `${title}, ${subtitle}` : title);
  if (rule.id === selectedId) main.setAttribute("aria-current", "true");
  else if (selectedIds.length > 1 && selectedIds.includes(rule.id)) main.setAttribute("aria-pressed", "true");

  const titleEl = document.createElement("span");
  titleEl.className = "title";
  titleEl.textContent = title;
  main.append(titleEl);

  if (subtitle) {
    const subtitleEl = document.createElement("span");
    subtitleEl.className = "subtitle";
    subtitleEl.textContent = subtitle;
    main.append(subtitleEl);
  }

  item.append(grip, toggle, main);

  if (status) {
    item.dataset.status = status;

    const mark = document.createElement("span");
    mark.className = "status";
    mark.dataset.status = status;
    mark.setAttribute("role", "img");
    const message = statusMessage(rule, status);
    mark.title = message;
    mark.setAttribute("aria-label", message);
    item.append(mark);
  }

  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "delete";
  remove.textContent = "×";
  remove.title = "Delete rule";
  remove.setAttribute("aria-label", `Delete ${title}`);
  item.append(remove);

  return item;
}

/** The row for a rule that has not been saved yet. */
function renderDraftRow() {
  const item = document.createElement("li");
  item.className = "rule draft selected";
  item.dataset.draft = "";

  const main = document.createElement("button");
  main.type = "button";
  main.className = "main";
  main.dataset.initial = Array.from(editor.title)[0].toUpperCase();
  main.title = editor.title;
  main.setAttribute("aria-current", "true");

  const titleEl = document.createElement("span");
  titleEl.className = "title";
  titleEl.textContent = editor.title;
  main.append(titleEl);

  item.append(main);
  return item;
}

function render() {
  const items = config ? config.rules.map(renderRule) : [];
  if (config && editor.isOpen && editor.isNew) items.push(renderDraftRow());
  list.replaceChildren(...items);
  updateMarks();
  editor.refreshTester();
  updateSettings();
  updatePanes();

  if (focusId !== null) {
    list.querySelector(`[data-id="${CSS.escape(focusId)}"] .main`)?.focus();
    focusId = null;
  }
}

/** Marks the row of the open rule when it has unsaved changes, and keeps the draft row's title current. */
function updateMarks() {
  const dirty = editor.isDirty();

  for (const item of list.querySelectorAll(".rule")) {
    const isOpen = item.dataset.draft !== undefined ? editor.isNew : item.dataset.id === selectedId;
    item.classList.toggle("unsaved", isOpen && dirty);
  }

  const draftMain = list.querySelector(".draft .main");
  if (draftMain) {
    draftMain.querySelector(".title").textContent = editor.title;
    draftMain.dataset.initial = Array.from(editor.title)[0].toUpperCase();
    draftMain.title = editor.title;
  }
}

// --- Opening, saving and leaving the editor ---

function askUnsaved() {
  const dialog = $("unsaved");

  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue || "cancel"), { once: true });
    dialog.returnValue = "";
    dialog.showModal();
  });
}

/** Returns true when it is fine to replace what is in the editor: nothing unsaved, or the user chose Save or Discard. */
async function confirmLeave() {
  if (!editor.isDirty()) return true;

  const choice = await askUnsaved();
  if (choice === "save") {
    await saveEditor();
    return true;
  }
  return choice === "discard";
}

async function saveEditor() {
  if (!config || !editor.isOpen) return;

  const rule = editor.toRule();
  const { rules } = upsertRule(config.rules, rule);
  if (!(await save(rules, { rerender: false }))) return;

  setSelected(rule.id);
  editor.markSaved(config.rules.find(r => r.id === rule.id));
  render();
}

/**
 * Makes `state` ({ ids, anchor }) the selection. One rule is opened in the editor; none or several close it,
 * after the usual Save, Discard or Cancel question when the editor has unsaved changes.
 */
async function applySelection(state, focusOn = null) {
  if (!config) return;
  showView("rules");

  const single = state.ids.length === 1 ? state.ids[0] : null;

  if (single !== null && single === selectedId && editor.isOpen) {
    selectedIds = state.ids;
    anchorId = state.anchor;
    if (focusOn) focusId = focusOn;
    render();
    return;
  }

  if (!(await confirmLeave())) return;

  if (single !== null) {
    const rule = config.rules.find(r => r.id === single);
    if (!rule) return;

    setSelected(single);
    anchorId = state.anchor;
    editor.open(rule);
  } else {
    selectedId = null;
    selectedIds = state.ids;
    anchorId = state.anchor;
    editor.close(state.ids.length > 1 ? `${state.ids.length} rules selected.` : undefined);
  }

  if (focusOn) focusId = focusOn;
  render();
}

async function openRule(id, { focus = false } = {}) {
  await applySelection({ ids: [id], anchor: id }, focus ? id : null);
}

/** A click on a rule: plain selects it, Ctrl+click adds or removes it, Shift+click selects a range. */
function selectWithMouse(id, event) {
  if (!config) return;

  const state = clickSelection(config.rules, { ids: selectedIds, anchor: anchorId }, id, {
    shift: event.shiftKey,
    ctrl: event.ctrlKey || event.metaKey,
  });
  applySelection(state, id);
}

async function addRule() {
  if (!config || !(await confirmLeave())) return;

  showView("rules");
  setSelected(null);
  editor.open(newDraft(), { isNew: true });
  render();
  editor.focus("name");
}

/** Closes a new rule that has not been saved. Changes in it are asked about first, an untouched one just closes. */
async function closeNewRule() {
  if (!editor.isNew || !(await confirmLeave())) return;

  setSelected(null);
  editor.close();
  render();
}

async function duplicateRule() {
  const snapshot = editor.snapshot();
  if (!config || !snapshot || !(await confirmLeave())) return;

  showView("rules");
  setSelected(null);
  editor.open(duplicateDraft(snapshot), { isNew: true });
  render();
  editor.focus("name");
}

// --- List actions ---

async function toggleRules(ids, enabled) {
  const known = ids.filter(id => indexOfId(id) >= 0);
  if (known.length === 0) return;

  await save(setEnabledMany(config.rules, known, enabled), { rerender: false });

  for (const id of known) {
    const item = list.querySelector(`[data-id="${CSS.escape(id)}"]`);
    item?.classList.toggle("disabled", !enabled);
    const checkbox = item?.querySelector('input[type="checkbox"]');
    if (checkbox) checkbox.checked = enabled;
  }

  // Try it in "All rules" mode depends on which rules are switched on.
  editor.refreshTester();
}

async function deleteRules(ids) {
  const { rules, removed } = removeRules(config.rules, ids);
  if (removed.length === 0) return;

  // Deleting selected rules drops their unsaved changes and opens the rule that takes their place.
  if (removed.some(({ rule }) => selectedIds.includes(rule.id))) {
    const next = selectionAfterRemove(removed[0].index, rules.length);
    if (next < 0) {
      setSelected(null);
      editor.close();
    } else {
      setSelected(rules[next].id);
      editor.open(rules[next]);
    }
  }
  focusId = selectedId;

  await save(rules);

  const text = removed.length === 1
    ? `Deleted “${ellipsize(ruleTitle(removed[0].rule), MESSAGE_NAME_MAX)}”.`
    : `Deleted ${removed.length} rules.`;
  showUndo(text, () => restoreDeleted(removed));
}

async function restoreDeleted(removed) {
  // The restored rules are selected only when that does not throw away what is in the editor.
  const select = !editor.isDirty() && !editor.isNew;
  if (!(await save(restoreRules(config.rules, removed)))) return;
  if (!select) return;

  const ids = removed.map(({ rule }) => rule.id);
  if (ids.length === 1) {
    setSelected(ids[0]);
    editor.open(config.rules.find(r => r.id === ids[0]));
  } else {
    selectedId = null;
    selectedIds = ids;
    anchorId = ids[0];
    editor.close(`${ids.length} rules selected.`);
  }
  focusId = ids[0];
  render();
}

async function move(id, to) {
  const from = indexOfId(id);
  if (from < 0 || from === to) return;

  focusId = id;
  await save(moveRule(config.rules, from, to));
}

/** Ctrl+Up and Ctrl+Down with several rules selected: they all move by one, and the focus stays on `id`. */
async function moveSelected(ids, delta, id) {
  focusId = id;
  await save(moveRules(config.rules, ids, delta));
}

// --- Messages at the bottom of the page ---

/**
 * Shows a short message that goes away by itself.
 * With `restore` it has an Undo button, and Ctrl+Z calls `restore` while the message is shown.
 */
function showToast(text, { restore = null, ms = MESSAGE_MS } = {}) {
  clearTimeout(toastTimer);

  const toast = $("toast");
  $("toast-text").textContent = text;
  $("toast-undo").hidden = restore === null;
  toast.setAttribute("role", restore === null ? "alert" : "status");
  toast.hidden = false;

  undo = restore === null ? null : { restore };
  toastTimer = setTimeout(hideToast, ms);
}

const showMessage = text => showToast(text);
const showUndo = (text, restore) => showToast(text, { restore, ms: (config ? config.settings.undoSeconds : UNDO_SECONDS_DEFAULT) * 1000 });

function hideToast() {
  clearTimeout(toastTimer);
  undo = null;
  $("toast").hidden = true;
}

async function runUndo() {
  if (!undo) return;

  const { restore } = undo;
  hideToast();
  await restore();
}

// --- Export, import and presets ---

function download(file) {
  const url = URL.createObjectURL(new Blob([file.text], { type: file.mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = file.filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const IMPORT_PROBLEMS = {
  "not-json": "That file isn't valid JSON, so it can't be imported.",
  "not-config": "That file isn't a Bookmark Peeler file.",
  unsupported: "That file was saved by a newer version of Bookmark Peeler, so it can't be imported.",
};

const count = (n, singular, plural) => `${n} ${n === 1 ? singular : plural}`;

/**
 * Shows what the file holds and returns what to import: { rules: "add" | "replace" | "none", settings: boolean },
 * or null when the dialog was cancelled. A file with only settings needs no question, so the dialog is not shown.
 */
function askImport(filename, summary) {
  if (!summary.rules) return Promise.resolve({ rules: "none", settings: true });

  const lines = [`${filename}: ${count(summary.rules.total, "rule", "rules")}${summary.settings ? " and settings" : ""}.`];
  if (summary.rules.withErrors > 0) {
    lines.push(`${count(summary.rules.withErrors, "has errors and isn't", "have errors and aren't")} applied until fixed.`);
  }
  if (summary.rules.clashes > 0) {
    lines.push(`${count(summary.rules.clashes, "rule already exists", "rules already exist")}; when added, they get new ids.`);
  }

  $("import-lines").replaceChildren(...lines.map(text => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }));

  const dialog = $("import-dialog");
  const form = dialog.querySelector("form");
  const settingsChoice = () => summary.settings && $("import-settings").checked;
  const rulesChoice = () => ($("import-rules").checked ? form.elements["import-how"].value : "none");
  const update = () => {
    // Hidden, not removed, so that the dialog keeps its size.
    $("import-how").classList.toggle("concealed", !$("import-rules").checked);
    $("import-go").disabled = rulesChoice() === "none" && !settingsChoice();
  };

  $("import-rules-row").hidden = false;
  $("import-settings-row").hidden = !summary.settings;
  $("import-rules").checked = true;
  $("import-settings").checked = true;
  form.elements["import-how"].value = "add";
  update();
  form.onchange = update;

  return new Promise(resolve => {
    dialog.addEventListener("close", () => {
      resolve(dialog.returnValue === "import" ? { rules: rulesChoice(), settings: settingsChoice() } : null);
    }, { once: true });
    dialog.returnValue = "";
    dialog.showModal();
  });
}

/** Shows what can be exported and downloads the file. */
function exportData() {
  if (!config) return;

  const dialog = $("export-dialog");
  const go = $("export-go");
  const update = () => { go.disabled = !$("export-rules").checked && !$("export-settings").checked; };

  update();
  dialog.querySelector("form").onchange = update;
  dialog.addEventListener("close", () => {
    if (dialog.returnValue !== "export") return;
    download(exportFile(config, { rules: $("export-rules").checked, settings: $("export-settings").checked }));
  }, { once: true });
  dialog.returnValue = "";
  dialog.showModal();
}

async function importFile(file) {
  if (!config) return;

  const parsed = parseImport(await file.text());
  if (!parsed.ok) {
    showMessage(IMPORT_PROBLEMS[parsed.reason]);
    return;
  }

  const choice = await askImport(file.name, summarizeImport(parsed, config.rules));
  if (choice === null) return;
  if (!(await confirmLeave())) return;

  const previous = config;
  const next = applyImport(config, parsed, choice);
  if (!(await saveConfig(next, { rerender: false }))) return;

  setSelected(null);
  editor.close();
  render();

  const parts = [];
  if (choice.rules !== "none" && parsed.rules) parts.push(count(parsed.rules.length, "rule", "rules"));
  if (choice.settings && parsed.settings) parts.push("the settings");
  showUndo(`Imported ${parts.join(" and ")}.`, () => restoreConfig(previous));
}

async function restoreConfig(previous) {
  if (!(await saveConfig(previous, { rerender: false }))) return;

  setSelected(null);
  editor.close();
  render();
}

async function openPreset(id) {
  const preset = PRESETS.find(p => p.id === id);
  if (!config || !preset || !(await confirmLeave())) return;

  showView("rules");
  setSelected(null);
  editor.open(presetDraft(preset), { isNew: true });
  render();
  editor.focus("name");
}

/** Fills the Presets menus, the one in the header and the one in the invitation to add a rule. */
function renderPresets() {
  for (const menu of [$("presets-list"), $("empty-presets-list")]) {
    menu.replaceChildren(...PRESETS.map(preset => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "menu-item";
      button.dataset.preset = preset.id;

      const title = document.createElement("span");
      title.textContent = preset.title;
      const description = document.createElement("small");
      description.textContent = preset.description;

      button.append(title, description);
      return button;
    }));
  }
}

function closeMenus() {
  for (const menu of document.querySelectorAll(".menu[open]")) menu.open = false;
}

// --- Events ---

const itemOf = element => element.closest(".rule");

list.addEventListener("click", event => {
  const item = itemOf(event.target);
  if (!item || item.dataset.draft !== undefined) return;

  if (event.target.closest(".delete")) {
    deleteRules([item.dataset.id]);
  } else if (event.target.closest(".main")) {
    selectWithMouse(item.dataset.id, event);
  }
});

list.addEventListener("change", event => {
  const item = itemOf(event.target);
  if (item && event.target.matches('input[type="checkbox"]')) {
    toggleRules([item.dataset.id], event.target.checked);
  }
});

// Fields where Ctrl+Z belongs to the field itself.
const EDITABLE = 'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable]';

document.addEventListener("keydown", event => {
  if (isSaveKey(event)) {
    if (editor.isOpen && view === "rules") {
      // The browser's own "Save page" is always blocked here, and the rule is saved only when the Save button is active.
      event.preventDefault();
      if (editor.canSave()) saveEditor();
    }
    return;
  }

  const command = keyCommand(event);
  if (!command) return;

  if (command.type === "collapse") {
    if (!event.target.closest(EDITABLE)) {
      event.preventDefault();
      toggleCollapsed();
    }
    return;
  }

  if (!config) return;

  if (command.type === "undo") {
    if (undo && !event.target.closest(EDITABLE)) {
      event.preventDefault();
      runUndo();
    }
    return;
  }

  const item = itemOf(event.target);
  if (!item) return;

  // The row of an unsaved new rule only takes part in selecting.
  const isDraftRow = item.dataset.draft !== undefined;
  if (isDraftRow && command.type !== "select") return;

  const id = item.dataset.id;
  const index = isDraftRow ? config.rules.length : indexOfId(id);
  const onDeleteButton = event.target.closest(".delete") !== null;
  const onSwitch = event.target.matches('input[type="checkbox"]');

  // With several rules selected, Ctrl+Up, Ctrl+Down, Delete, Enter and Space act on all of them, if the focused one is among them.
  const group = selectedIds.length > 1 && selectedIds.includes(id) ? selectedIds : null;

  switch (command.type) {
    case "select": {
      event.preventDefault();
      const target = stepSelection(index, command.delta, config.rules.length);
      if (target >= 0) openRule(config.rules[target].id, { focus: true });
      break;
    }

    case "extend": {
      event.preventDefault();
      const base = selectedIds.includes(id) ? { ids: selectedIds, anchor: anchorId } : { ids: [id], anchor: id };
      const next = extendSelection(config.rules, base, id, command.delta);
      applySelection({ ids: next.ids, anchor: next.anchor }, next.focus);
      break;
    }

    case "move":
      event.preventDefault();
      if (group) moveSelected(group, command.delta, id);
      else move(id, Math.max(0, Math.min(index + command.delta, config.rules.length - 1)));
      break;

    case "delete":
      event.preventDefault();
      deleteRules(group ?? [id]);
      break;

    case "toggle":
      // The delete button keeps its own Enter and Space, and a switch already toggles itself on Space.
      if (onDeleteButton || (onSwitch && event.key === " ")) return;
      event.preventDefault();
      // Every selected rule gets the opposite of the state of the focused one.
      toggleRules(group ?? [id], config.rules[index].enabled === false);
      break;
  }
});

function clearDropMarks() {
  for (const item of list.querySelectorAll(".drop-before, .drop-after, .dragging")) {
    item.classList.remove("drop-before", "drop-after", "dragging");
  }
}

list.addEventListener("dragstart", event => {
  const item = itemOf(event.target);
  if (!item || item.dataset.draft !== undefined) return;

  const id = item.dataset.id;
  draggingId = id;
  draggingIds = selectedIds.length > 1 && selectedIds.includes(id) ? [...selectedIds] : [id];

  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", id);
  for (const draggedId of draggingIds) {
    list.querySelector(`[data-id="${CSS.escape(draggedId)}"]`)?.classList.add("dragging");
  }
});

function clearDropLine() {
  for (const other of list.querySelectorAll(".drop-before, .drop-after")) {
    other.classList.remove("drop-before", "drop-after");
  }
}

list.addEventListener("dragover", event => {
  const item = itemOf(event.target);
  if (!item || item.dataset.draft !== undefined || draggingId === null) return;

  // Dropping on one of the rules that are being dragged does nothing, so it is not offered.
  if (draggingIds.includes(item.dataset.id)) {
    dropTarget = null;
    clearDropLine();
    return;
  }

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";

  const box = item.getBoundingClientRect();
  const after = event.clientY > box.top + box.height / 2;
  dropTarget = { id: item.dataset.id, after };

  clearDropLine();
  item.classList.add(after ? "drop-after" : "drop-before");
});

list.addEventListener("drop", event => {
  event.preventDefault();
  if (draggingId === null || dropTarget === null) return;

  focusId = draggingId;
  save(moveRulesTo(config.rules, draggingIds, dropTarget.id, dropTarget.after));
});

list.addEventListener("dragend", () => {
  draggingId = null;
  draggingIds = [];
  dropTarget = null;
  clearDropMarks();
});

$("add").addEventListener("click", addRule);
$("empty-add").addEventListener("click", addRule);
$("settings-button").addEventListener("click", () => showView(view === "settings" ? "rules" : "settings"));

$("export").addEventListener("click", exportData);

$("import").addEventListener("click", () => {
  if (config) $("import-file").click();
});

$("import-file").addEventListener("change", event => {
  const [file] = event.target.files;
  event.target.value = ""; // so that the same file can be chosen again
  if (file) importFile(file);
});

document.addEventListener("click", event => {
  const button = event.target.closest("[data-preset]");
  if (button) {
    closeMenus();
    openPreset(button.dataset.preset);
    return;
  }

  // A Presets menu closes on a click elsewhere, and on Escape.
  for (const menu of document.querySelectorAll(".menu[open]")) {
    if (!menu.contains(event.target)) menu.open = false;
  }
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") closeMenus();
});
$("collapse").addEventListener("click", toggleCollapsed);
$("toast-undo").addEventListener("click", runUndo);

window.addEventListener("beforeunload", event => {
  if (editor.isDirty()) event.preventDefault();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" || area === "local") load({ onlyIfChanged: true });
});

applyCollapsed();
renderPresets();
editor.close();
load()
  .catch(error => {
    console.error("Bookmark Peeler:", error);
    showNotice("Couldn't load your rules.");
  });
