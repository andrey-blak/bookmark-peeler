// "Clean existing bookmarks": the preview dialog, the bulk update and its undo.
// The logic is in bulk.js (unit-tested); the writes go through the background page (see background/index.js).

import { flattenBookmarks, planClean, undoChanges, diffSegments } from "./bulk.js";
import { el } from "./dom.js";
import { getPref, setPref } from "./prefs.js";
import { t } from "../core/text.js";

const PAGE = 50; // changes listed at first, and added by each "Show more…"

const bookmarks = n => t("bookmarks", { count: n });

// An address with its removed or added parts marked, for the Before and After columns.
const addressEl = (segments, className) => el("div", { className: "url" },
  ...segments.map(segment => (segment.changed ? el("span", { className }, segment.text) : segment.text)));

const setUrls = changes => browser.runtime.sendMessage({ type: "set-bookmark-urls", changes });

/**
 * @param options.dialog the <dialog> with the preview (see index.html)
 * @param options.getRules returns the stored rules
 * @param options.getExcludedSites returns the list of excluded sites, whose bookmarks are left alone
 * @param options.notify (text) shows a short message
 * @param options.notifyUndo (text, restore) shows a message with an Undo button
 * @param options.onChange called when the number of bookmarks that can be restored changes
 */
export function createBulkClean({ dialog, getRules, getExcludedSites, notify, notifyUndo, onChange }) {
  let last = null; // { changes, updated }: the last clean, kept only while the page is open

  const $ = selector => dialog.querySelector(selector);

  // Two ways of marking the changed parts, to compare: the colour of the text, or a coloured background.
  const applyHighlight = mode => {
    dialog.classList.toggle("hl-text", mode === "text");
    dialog.classList.toggle("hl-background", mode === "background");
    for (const radio of dialog.querySelectorAll('input[name="bulk-highlight"]')) radio.checked = radio.value === mode;
  };
  applyHighlight(getPref("bulkHighlight", "text"));
  dialog.addEventListener("change", event => {
    if (event.target.name !== "bulk-highlight") return;
    setPref("bulkHighlight", event.target.value);
    applyHighlight(event.target.value);
  });

  function showList(changes) {
    const list = $("#bulk-list");
    const more = $("#bulk-more");
    let shown = 0;

    list.replaceChildren();

    const addPage = () => {
      for (const change of changes.slice(shown, shown + PAGE)) {
        const { before, after } = diffSegments(change);
        list.append(el("li", {},
          el("strong", {}, change.title || change.url),
          el("div", { className: "pair" }, addressEl(before, "removed"), addressEl(after, "added"))));
      }
      shown = Math.min(shown + PAGE, changes.length);

      more.hidden = shown >= changes.length;
      more.textContent = t("bulk.more", { count: changes.length - shown });
    };

    more.onclick = addPage;
    addPage();
  }

  /** Scans the bookmarks, shows what would change and, if the user agrees, cleans them. */
  async function start() {
    $("#bulk-summary").textContent = t("bulk.looking");
    $("#bulk-details").hidden = true;
    $("#bulk-details").open = true; // the list of changes is shown at once
    $("#bulk-clean").hidden = true;
    $("#bulk-close").textContent = t("button.cancel");
    dialog.returnValue = "";

    const closed = new Promise(resolve => dialog.addEventListener("close", () => resolve(dialog.returnValue), { once: true }));
    dialog.showModal();

    let plan;
    try {
      plan = planClean(flattenBookmarks(await browser.bookmarks.getTree()), getRules(), getExcludedSites());
    } catch (error) {
      console.error("Bookmark Peeler:", error);
      $("#bulk-summary").textContent = t("bulk.read-failed");
      $("#bulk-close").textContent = t("button.close");
      return;
    }

    const { total, changes } = plan;
    if (changes.length === 0) {
      $("#bulk-summary").textContent = t("bulk.none", { bookmarks: bookmarks(total) });
      $("#bulk-close").textContent = t("button.close");
      return;
    }

    $("#bulk-summary").textContent = t("bulk.summary", { changes: changes.length, bookmarks: bookmarks(total) });
    $("#bulk-details-summary").textContent = t("bulk.details", { count: changes.length });
    $("#bulk-details").hidden = false;
    showList(changes);
    $("#bulk-clean").textContent = t("bulk.clean", { bookmarks: bookmarks(changes.length) });
    $("#bulk-clean").hidden = false;

    if ((await closed) === "clean") await apply(changes);
  }

  async function apply(changes) {
    notify(t("bulk.cleaning", { bookmarks: bookmarks(changes.length) }));

    let result;
    try {
      // `expect` leaves out a bookmark that has been edited since the scan.
      result = await setUrls(changes.map(({ id, url, newUrl }) => ({ id, url: newUrl, expect: url })));
    } catch (error) {
      console.error("Bookmark Peeler:", error);
      notify(t("bulk.clean-failed"));
      return;
    }

    last = result.updated.length > 0 ? { changes, updated: result.updated } : last;
    onChange();

    const left = result.skipped.length + result.failed.length;
    const updated = bookmarks(result.updated.length);
    const text = left > 0 ? t("bulk.cleaned-left", { updated, count: left }) : t("bulk.cleaned", { updated });

    if (result.updated.length > 0) notifyUndo(text, restoreLast);
    else notify(text);
  }

  /** Puts the old addresses back, except for bookmarks that have been edited since. */
  async function restoreLast() {
    if (!last) return;

    const { changes, updated } = last;
    let result;
    try {
      result = await setUrls(undoChanges(changes, updated));
    } catch (error) {
      console.error("Bookmark Peeler:", error);
      notify(t("bulk.restore-failed"));
      return;
    }

    last = null;
    onChange();

    const left = result.skipped.length + result.failed.length;
    const restored = bookmarks(result.updated.length);
    notify(left > 0 ? t("bulk.restored-left", { updated: restored, count: left }) : t("bulk.restored", { updated: restored }));
  }

  return {
    start,
    restoreLast,
    get restorable() {
      return last ? last.updated.length : 0;
    },
  };
}
