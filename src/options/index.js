// Options page: the rule list.
// The list logic is in rule-list.js (unit-tested); this file only connects it to the DOM and to storage.

import { readConfig, validateRule } from "../core/schema.js";
import {
  moveRule,
  dropIndex,
  removeRule,
  restoreRule,
  setEnabled,
  ruleTitle,
  ruleSubtitle,
  ruleStatus,
  keyCommand,
  stepSelection,
  selectionAfterRemove,
} from "./rule-list.js";

const STORAGE_KEYS = ["schemaVersion", "settings", "rules"];
const UNDO_MS = 8000;

const $ = id => document.getElementById(id);
const list = $("rules");

let config = null; // what was loaded; null when it cannot be edited
let selectedId = null;
let focusId = null; // rule whose main button gets the focus after the next render
let draggingId = null;
let dropTarget = null; // { id, after }
let undo = null; // { removed, timer }

// --- Storage ---

async function load({ onlyIfChanged = false } = {}) {
  const loaded = readConfig(await browser.storage.local.get(STORAGE_KEYS));

  if (loaded.status !== "ok") {
    config = null;
    showNotice("These rules were saved by a newer version of Bookmark Peeler, so they can't be shown or changed here.");
    render();
    return;
  }

  if (onlyIfChanged && config && JSON.stringify(loaded.config) === JSON.stringify(config)) return;

  config = loaded.config;
  showNotice("");
  render();
}

async function save(rules, { rerender = true } = {}) {
  const next = { ...config, rules };

  try {
    await browser.storage.local.set(next);
    config = next;
    if (rerender) render();
  } catch (error) {
    console.error("Bookmark Peeler:", error);
    showNotice("Couldn't save your changes. Reload the page and try again.");
  }
}

function showNotice(text) {
  const notice = $("notice");
  notice.textContent = text;
  notice.hidden = text === "";
}

// --- Rendering ---

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

function render() {
  list.replaceChildren(...(config ? config.rules.map(renderRule) : []));

  if (focusId !== null) {
    list.querySelector(`[data-id="${CSS.escape(focusId)}"] .main`)?.focus();
    focusId = null;
  }
}

// --- Actions ---

function select(id, { focus = false } = {}) {
  selectedId = id;
  if (focus) focusId = id;
  render();
}

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
  const next = selectionAfterRemove(index, rules.length);
  selectedId = next < 0 ? null : rules[next].id;
  focusId = selectedId;

  await save(rules);
  showUndo(removed);
}

async function undoDelete() {
  if (!undo) return;

  const { removed } = undo;
  hideUndo();
  selectedId = removed.rule.id;
  focusId = selectedId;
  await save(restoreRule(config.rules, removed));
}

async function move(id, to) {
  const from = indexOfId(id);
  if (from < 0 || from === to) return;

  focusId = id;
  await save(moveRule(config.rules, from, to));
}

// --- Undo message ---

function showUndo(removed) {
  hideUndo();
  $("toast-text").textContent = `Deleted “${ruleTitle(removed.rule)}”.`;
  $("toast").hidden = false;
  undo = { removed, timer: setTimeout(hideUndo, UNDO_MS) };
}

function hideUndo() {
  if (undo) clearTimeout(undo.timer);
  undo = null;
  $("toast").hidden = true;
}

// --- Events ---

const itemOf = element => element.closest(".rule");

list.addEventListener("click", event => {
  const item = itemOf(event.target);
  if (!item) return;

  if (event.target.closest(".delete")) {
    deleteRule(item.dataset.id);
  } else if (event.target.closest(".main")) {
    select(item.dataset.id, { focus: true });
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
  const command = keyCommand(event);
  if (!command || !config) return;

  if (command.type === "undo") {
    if (undo && !event.target.closest(EDITABLE)) {
      event.preventDefault();
      undoDelete();
    }
    return;
  }

  const item = itemOf(event.target);
  if (!item) return;

  const id = item.dataset.id;
  const index = indexOfId(id);
  const onDeleteButton = event.target.closest(".delete") !== null;
  const onSwitch = event.target.matches('input[type="checkbox"]');

  switch (command.type) {
    case "select": {
      event.preventDefault();
      const target = stepSelection(index, command.delta, config.rules.length);
      if (target >= 0) select(config.rules[target].id, { focus: true });
      break;
    }

    case "move":
      event.preventDefault();
      selectedId = id;
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
  if (!item) return;

  draggingId = item.dataset.id;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", draggingId);
  item.classList.add("dragging");
});

list.addEventListener("dragover", event => {
  const item = itemOf(event.target);
  if (!item || draggingId === null) return;

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
  if (from >= 0 && over >= 0) {
    selectedId = draggingId;
    move(draggingId, dropIndex(from, over, dropTarget.after));
  }
});

list.addEventListener("dragend", () => {
  draggingId = null;
  dropTarget = null;
  clearDropMarks();
});

$("toast-undo").addEventListener("click", undoDelete);

browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local") load({ onlyIfChanged: true });
});

load().catch(error => {
  console.error("Bookmark Peeler:", error);
  showNotice("Couldn't load your rules.");
});
