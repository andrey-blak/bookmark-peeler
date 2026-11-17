// The Settings panel: the checkbox for cleaning edited bookmarks and the two buttons for the bulk clean.
// It only draws and reports; what the buttons do is decided by the page (index.js).

import { el } from "./dom.js";

/**
 * @param root the element the panel lives in
 * @param handlers.onCleanOnEdit (checked) the checkbox was changed
 * @param handlers.onClean "Clean existing bookmarks…" was pressed
 * @param handlers.onRestore "Restore the last cleaned bookmarks" was pressed
 */
export function createSettings(root, { onCleanOnEdit, onClean, onRestore }) {
  const checkbox = el("input", { type: "checkbox", dataset: { cleanOnEdit: "" } });
  const restoreRow = el("div", { className: "setting-row", hidden: true },
    el("button", { type: "button", textContent: "Restore the last cleaned bookmarks", dataset: { restore: "" } }),
    el("span", { className: "hint", id: "restore-hint" }));

  root.replaceChildren(
    el("h2", { className: "settings-title" }, "Settings"),
    el("section", { className: "settings-section" },
      el("h3", {}, "Bookmarks"),
      el("label", { className: "setting-row check" },
        checkbox,
        el("span", {},
          "Also clean a bookmark when its address is edited",
          el("span", { className: "hint block" }, "Off: only new bookmarks are cleaned."))),
      el("div", { className: "setting-row" },
        el("button", { type: "button", textContent: "Clean existing bookmarks…", dataset: { clean: "" } }),
        el("span", { className: "hint" }, "Applies your enabled rules to the bookmarks you already have.")),
      restoreRow));

  root.addEventListener("click", event => {
    if (event.target.closest("[data-clean]")) onClean();
    else if (event.target.closest("[data-restore]")) onRestore();
  });

  checkbox.addEventListener("change", () => onCleanOnEdit(checkbox.checked));

  return {
    /** Shows the current state: the setting, and how many bookmarks "Restore" would put back (0 hides the button). */
    update({ cleanOnEdit, restorable }) {
      checkbox.checked = cleanOnEdit;
      restoreRow.hidden = restorable === 0;
      root.querySelector("#restore-hint").textContent =
        `${restorable} ${restorable === 1 ? "bookmark" : "bookmarks"}, until you close this page.`;
    },
  };
}
