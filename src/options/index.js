// Main page: the rule list and the rule editor.
// The logic is in rule-list.js and editor-model.js (unit-tested); this file connects it to the DOM and to storage.

import { readConfig, validateRule } from "../core/schema.js";
import {
  moveRule,
  dropIndex,
  upsertRule,
  removeRule,
  restoreRule,
  setEnabled,
  ruleTitle,
  ruleSubtitle,
  ruleStatus,
  ruleInitial,
  keyCommand,
  stepSelection,
  selectionAfterRemove,
} from "./rule-list.js";
import { newDraft, duplicateDraft, isSaveKey } from "./editor-model.js";
import { createEditor } from "./editor.js";
import { exportFile, parseImport, summarizeImport, mergeImport } from "./transfer.js";
import { PRESETS, presetDraft } from "./presets.js";
import { getPref, setPref } from "./prefs.js";

const STORAGE_KEYS = ["schemaVersion", "settings", "rules"];
const UNDO_MS = 8000;
const MESSAGE_MS = 6000;

const $ = id => document.getElementById(id);
const list = $("rules");

let config = null; // what was loaded; null when it cannot be edited
let selectedId = null; // the stored rule open in the editor; null for a new draft or nothing
let focusId = null; // rule whose main button gets the focus after the next render
let draggingId = null;
let dropTarget = null; // { id, after }
let undo = null; // { restore }: how to take back the last delete or import, while its message is shown
let toastTimer = null;

const editor = createEditor($("editor"), {
  onSave: saveEditor,
  onChange: updateMarks,
  onDuplicate: duplicateRule,
  getRules: () => (config ? config.rules : []),
});

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
  const loaded = readConfig(await browser.storage.local.get(STORAGE_KEYS));

  if (loaded.status !== "ok") {
    config = null;
    selectedId = null;
    editor.close();
    showNotice("These rules were saved by a newer version of Bookmark Peeler, so they can't be shown or changed here.");
    render();
    return;
  }

  if (onlyIfChanged && config && JSON.stringify(loaded.config) === JSON.stringify(config)) return;

  config = loaded.config;
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
    selectedId = null;
    editor.close();
  }
}

/** Stores the rules, with the settings as they are. Returns whether they were stored. */
async function save(rules, options) {
  return saveConfig({ ...config, rules }, options);
}

/** Stores a whole config (rules and settings). Returns whether it was stored. */
async function saveConfig(next, { rerender = true } = {}) {
  try {
    await browser.storage.local.set(next);
  } catch (error) {
    console.error("Bookmark Peeler:", error);
    showMessage("Couldn't save your changes. Reload the page and try again.");
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
  item.classList.toggle("selected", rule.id === selectedId);
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

  selectedId = rule.id;
  editor.markSaved(config.rules.find(r => r.id === rule.id));
  render();
}

async function openRule(id, { focus = false } = {}) {
  if (!config) return;

  if (id === selectedId && editor.isOpen) {
    if (focus) {
      focusId = id;
      render();
    }
    return;
  }

  if (!(await confirmLeave())) return;

  const rule = config.rules.find(r => r.id === id);
  if (!rule) return;

  selectedId = id;
  editor.open(rule);
  if (focus) focusId = id;
  render();
}

async function addRule() {
  if (!config || !(await confirmLeave())) return;

  selectedId = null;
  editor.open(newDraft(), { isNew: true });
  render();
  editor.focus("name");
}

async function duplicateRule() {
  const snapshot = editor.snapshot();
  if (!config || !snapshot || !(await confirmLeave())) return;

  selectedId = null;
  editor.open(duplicateDraft(snapshot), { isNew: true });
  render();
  editor.focus("name");
}

// --- List actions ---

async function toggleRule(id, enabled) {
  const index = indexOfId(id);
  if (index < 0) return;

  await save(setEnabled(config.rules, index, enabled), { rerender: false });

  const item = list.querySelector(`[data-id="${CSS.escape(id)}"]`);
  item?.classList.toggle("disabled", !enabled);
  const checkbox = item?.querySelector('input[type="checkbox"]');
  if (checkbox) checkbox.checked = enabled;
}

async function deleteRule(id) {
  const index = indexOfId(id);
  if (index < 0) return;

  const { rules, removed } = removeRule(config.rules, index);

  // Deleting the open rule drops its unsaved changes and opens the next rule.
  if (id === selectedId) {
    const next = selectionAfterRemove(index, rules.length);
    selectedId = next < 0 ? null : rules[next].id;
    if (next < 0) editor.close();
    else editor.open(rules[next]);
  }
  focusId = selectedId;

  await save(rules);
  showUndo(`Deleted “${ruleTitle(removed.rule)}”.`, () => restoreDeleted(removed));
}

async function restoreDeleted(removed) {
  // The restored rule is opened only when that does not throw away what is in the editor.
  const open = !editor.isDirty() && !editor.isNew;
  if (!(await save(restoreRule(config.rules, removed)))) return;

  if (open) {
    selectedId = removed.rule.id;
    focusId = selectedId;
    editor.open(config.rules.find(r => r.id === selectedId));
    render();
  }
}

async function move(id, to) {
  const from = indexOfId(id);
  if (from < 0 || from === to) return;

  focusId = id;
  await save(moveRule(config.rules, from, to));
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
const showUndo = (text, restore) => showToast(text, { restore, ms: UNDO_MS });

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
  "not-config": "That file isn't a Bookmark Peeler rules file.",
  unsupported: "That file was saved by a newer version of Bookmark Peeler, so it can't be imported.",
};

const count = (n, singular, plural) => `${n} ${n === 1 ? singular : plural}`;

/** Shows what the file holds and returns the choice: "add", "replace" or "cancel". */
function askImport(filename, summary) {
  const lines = [`${filename}: ${count(summary.total, "rule", "rules")}.`];
  if (summary.withErrors > 0) {
    lines.push(`${count(summary.withErrors, "has errors and isn't", "have errors and aren't")} applied until fixed.`);
  }
  if (summary.clashes > 0) {
    lines.push(`${count(summary.clashes, "rule already exists", "rules already exist")}; when added, they get new ids.`);
  }

  $("import-lines").replaceChildren(...lines.map(text => {
    const item = document.createElement("li");
    item.textContent = text;
    return item;
  }));

  const dialog = $("import-dialog");
  return new Promise(resolve => {
    dialog.addEventListener("close", () => resolve(dialog.returnValue || "cancel"), { once: true });
    dialog.returnValue = "";
    dialog.showModal();
  });
}

async function importRules(file) {
  if (!config) return;

  const parsed = parseImport(await file.text());
  if (!parsed.ok) {
    showMessage(IMPORT_PROBLEMS[parsed.reason]);
    return;
  }

  const choice = await askImport(file.name, summarizeImport(parsed.config, config.rules));
  if (choice !== "add" && choice !== "replace") return;
  if (!(await confirmLeave())) return;

  const previous = config;
  const next = choice === "add"
    ? { ...config, rules: mergeImport(config.rules, parsed.config.rules) }
    : parsed.config; // Replace takes the settings of the file too; Add keeps the current ones.
  if (!(await saveConfig(next, { rerender: false }))) return;

  selectedId = null;
  editor.close();
  render();
  showUndo(`Imported ${count(parsed.config.rules.length, "rule", "rules")}.`, () => restoreConfig(previous));
}

async function restoreConfig(previous) {
  if (!(await saveConfig(previous, { rerender: false }))) return;

  selectedId = null;
  editor.close();
  render();
}

async function openPreset(id) {
  const preset = PRESETS.find(p => p.id === id);
  if (!config || !preset || !(await confirmLeave())) return;

  selectedId = null;
  editor.open(presetDraft(preset), { isNew: true });
  render();
  editor.focus("name");
}

function renderPresets() {
  $("presets-list").replaceChildren(...PRESETS.map(preset => {
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

// --- Events ---

const itemOf = element => element.closest(".rule");

list.addEventListener("click", event => {
  const item = itemOf(event.target);
  if (!item || item.dataset.draft !== undefined) return;

  if (event.target.closest(".delete")) {
    deleteRule(item.dataset.id);
  } else if (event.target.closest(".main")) {
    openRule(item.dataset.id, { focus: true });
  }
});

list.addEventListener("change", event => {
  const item = itemOf(event.target);
  if (item && event.target.matches('input[type="checkbox"]')) {
    toggleRule(item.dataset.id, event.target.checked);
  }
});

// Fields where Ctrl+Z belongs to the field itself.
const EDITABLE = 'input:not([type="checkbox"]):not([type="radio"]), textarea, select, [contenteditable]';

document.addEventListener("keydown", event => {
  if (isSaveKey(event)) {
    if (editor.isOpen) {
      event.preventDefault();
      saveEditor();
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

  switch (command.type) {
    case "select": {
      event.preventDefault();
      const target = stepSelection(index, command.delta, config.rules.length);
      if (target >= 0) openRule(config.rules[target].id, { focus: true });
      break;
    }

    case "move":
      event.preventDefault();
      move(id, Math.max(0, Math.min(index + command.delta, config.rules.length - 1)));
      break;

    case "delete":
      event.preventDefault();
      deleteRule(id);
      break;

    case "toggle":
      // The delete button keeps its own Enter and Space, and a switch already toggles itself on Space.
      if (onDeleteButton || (onSwitch && event.key === " ")) return;
      event.preventDefault();
      toggleRule(id, config.rules[index].enabled === false);
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

  draggingId = item.dataset.id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggingId);
  item.classList.add("dragging");
});

list.addEventListener("dragover", event => {
  const item = itemOf(event.target);
  if (!item || item.dataset.draft !== undefined || draggingId === null) return;

  event.preventDefault();
  event.dataTransfer.dropEffect = "move";

  const box = item.getBoundingClientRect();
  const after = event.clientY > box.top + box.height / 2;
  dropTarget = { id: item.dataset.id, after };

  for (const other of list.querySelectorAll(".drop-before, .drop-after")) {
    other.classList.remove("drop-before", "drop-after");
  }
  item.classList.add(after ? "drop-after" : "drop-before");
});

list.addEventListener("drop", event => {
  event.preventDefault();
  if (draggingId === null || dropTarget === null) return;

  const from = indexOfId(draggingId);
  const over = indexOfId(dropTarget.id);
  if (from >= 0 && over >= 0) move(draggingId, dropIndex(from, over, dropTarget.after));
});

list.addEventListener("dragend", () => {
  draggingId = null;
  dropTarget = null;
  clearDropMarks();
});

$("add").addEventListener("click", addRule);

$("export").addEventListener("click", () => {
  if (config) download(exportFile(config));
});

$("import").addEventListener("click", () => {
  if (config) $("import-file").click();
});

$("import-file").addEventListener("change", event => {
  const [file] = event.target.files;
  event.target.value = ""; // so that the same file can be chosen again
  if (file) importRules(file);
});

$("presets-list").addEventListener("click", event => {
  const button = event.target.closest("[data-preset]");
  if (!button) return;

  $("presets").open = false;
  openPreset(button.dataset.preset);
});

// The presets menu closes on a click elsewhere and on Escape.
document.addEventListener("click", event => {
  if (!event.target.closest("#presets")) $("presets").open = false;
});
document.addEventListener("keydown", event => {
  if (event.key === "Escape") $("presets").open = false;
});
$("collapse").addEventListener("click", toggleCollapsed);
$("toast-undo").addEventListener("click", runUndo);

window.addEventListener("beforeunload", event => {
  if (editor.isDirty()) event.preventDefault();
});

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local") load({ onlyIfChanged: true });
});

applyCollapsed();
renderPresets();
editor.close();
load().catch(error => {
  console.error("Bookmark Peeler:", error);
  showNotice("Couldn't load your rules.");
});
