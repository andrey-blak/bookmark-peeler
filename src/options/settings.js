// The Settings panel: the checkbox for cleaning edited bookmarks and the two buttons for the bulk clean.
// It only draws and reports; what the buttons do is decided by the page (index.js).

import { el, autosize } from "./dom.js";
import { t } from "../core/text.js";
import { siteIssues, siteDuplicates, parseSites, sitesText } from "../core/exclusions.js";
import { UNDO_SECONDS_MIN, UNDO_SECONDS_MAX, validUndoSeconds } from "../core/schema.js";

/**
 * @param root the element the panel lives in
 * @param handlers.onCleanOnEdit (checked) the checkbox was changed
 * @param handlers.onUndoSeconds (seconds) the number box was left with a valid whole number
 * @param handlers.onExcludedSites (sites) the text box of excluded sites was left, with the list in it
 * @param handlers.onClean "Clean existing bookmarks…" was pressed
 * @param handlers.onRestore "Restore the last cleaned bookmarks" was pressed
 */
export function createSettings(root, { onCleanOnEdit, onUndoSeconds, onExcludedSites, onClean, onRestore }) {
  const checkbox = el("input", { type: "checkbox", dataset: { cleanOnEdit: "" } });
  const seconds = el("input", {
    type: "number",
    min: UNDO_SECONDS_MIN,
    max: UNDO_SECONDS_MAX,
    step: 1,
    className: "seconds",
    dataset: { undoSeconds: "" },
  });
  const restoreRow = el("div", { className: "setting-row", hidden: true },
    el("button", { type: "button", textContent: t("settings.restore"), dataset: { restore: "" } }),
    el("span", { className: "hint", id: "restore-hint" }));

  const sites = el("textarea", {
    rows: 2,
    placeholder: "example.com",
    spellcheck: false,
    autocomplete: "off",
    className: "mono",
    dataset: { excludedSites: "" },
  });
  const fitSites = autosize(sites, { minRows: 2, maxRows: 10 });
  const siteMessages = el("ul", { className: "site-messages", id: "excluded-sites-messages" });
  sites.setAttribute("aria-describedby", "excluded-sites-messages");

  const showSiteMessages = list => {
    const problems = [...siteIssues(list), ...siteDuplicates(list)].sort((a, b) => a.index - b.index);
    siteMessages.replaceChildren(...problems.map(issue => el("li", {}, t("issue.except-entry", { entry: issue.entry, message: issue.message }))));
  };

  root.replaceChildren(
    el("h2", { className: "settings-title" }, t("settings.title")),
    el("section", { className: "settings-section" },
      el("h3", {}, t("settings.bookmarks")),
      el("label", { className: "setting-row check" },
        checkbox,
        el("span", {},
          t("settings.clean-on-edit"),
          el("span", { className: "hint block" }, t("settings.clean-on-edit-hint")))),
      el("label", { className: "setting-row" },
        t("settings.undo-before"),
        seconds,
        t("settings.undo-after")),
      el("div", { className: "setting-row" },
        el("button", { type: "button", textContent: t("settings.clean"), dataset: { clean: "" } }),
        el("span", { className: "hint" }, t("settings.clean-hint"))),
      restoreRow),
    el("section", { className: "settings-section" },
      el("h3", {}, t("settings.excluded")),
      el("label", { className: "field" }, el("span", { className: "label" }, t("settings.excluded-label")), sites),
      el("p", { className: "hint" }, t("settings.excluded-hint")),
      siteMessages));

  root.addEventListener("click", event => {
    if (event.target.closest("[data-clean]")) onClean();
    else if (event.target.closest("[data-restore]")) onRestore();
  });

  checkbox.addEventListener("change", () => onCleanOnEdit(checkbox.checked));

  // A number that is not a whole number of seconds within the limits is not stored, and the box goes back to the stored one.
  seconds.addEventListener("change", () => {
    const value = seconds.value.trim() === "" ? NaN : Number(seconds.value);
    if (validUndoSeconds(value)) {
      shownSeconds = String(value);
      onUndoSeconds(value);
    }
    else seconds.value = shownSeconds;
  });

  // The messages follow what is typed; the list is stored when the text box is left.
  sites.addEventListener("input", () => showSiteMessages(parseSites(sites.value)));
  sites.addEventListener("change", () => onExcludedSites(parseSites(sites.value)));

  let shownSeconds = "";

  return {
    /**
     * Shows the current state: the settings, and how many bookmarks "Restore" would put back (0 hides the button).
     * The text box is not touched while it has the focus, so what is being typed is not replaced.
     */
    /** Fits the list of excluded sites to its text, for when the panel is shown. */
    fit: fitSites,

    update({ cleanOnEdit, undoSeconds, excludedSites, restorable }) {
      checkbox.checked = cleanOnEdit;
      shownSeconds = String(undoSeconds);
      if (document.activeElement !== seconds) seconds.value = shownSeconds;
      if (document.activeElement !== sites) sites.value = sitesText(excludedSites);
      fitSites();
      showSiteMessages(excludedSites);
      restoreRow.hidden = restorable === 0;
      root.querySelector("#restore-hint").textContent =
        t("settings.restore-hint", { count: restorable });
    },
  };
}
