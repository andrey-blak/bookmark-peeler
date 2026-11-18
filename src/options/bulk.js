// Logic of "Clean existing bookmarks", without DOM or browser APIs.

import { cleanUrl } from "../core/engine.js";
import { usableRules } from "../core/schema.js";
import { highlightSegments } from "./tester.js";
import { isExcluded } from "../core/exclusions.js";

/** The bookmarks of a bookmarks.getTree() result, in tree order, as { id, title, url }. Folders and separators are skipped. */
export function flattenBookmarks(nodes) {
  const found = [];

  const visit = node => {
    if (node.type === "bookmark" && node.url) found.push({ id: node.id, title: node.title, url: node.url });
    for (const child of node.children ?? []) visit(child);
  };
  nodes.forEach(visit);

  return found;
}

/**
 * What cleaning would do: { total, changes: [{ id, title, url, newUrl }] } with only the bookmarks that change.
 * It uses the same rules as the add-on does for a new bookmark: enabled ones without errors, and not on an excluded site.
 */
export function planClean(bookmarks, rules, excludedSites = []) {
  const usable = usableRules(rules);
  const changes = [];

  for (const { id, title, url } of bookmarks) {
    // Bookmarks on an excluded site are left alone, but still counted in the total.
    if (isExcluded(url, excludedSites)) continue;

    const newUrl = cleanUrl(url, usable);
    if (newUrl !== url) changes.push({ id, title, url, newUrl });
  }

  return { total: bookmarks.length, changes };
}

/**
 * The changes that put the old addresses back, for the bookmarks that were really updated.
 * `expect` makes the background page skip a bookmark whose address has been changed since.
 */
export function undoChanges(changes, updatedIds) {
  const updated = new Set(updatedIds);

  return changes
    .filter(change => updated.has(change.id))
    .map(change => ({ id: change.id, url: change.url, expect: change.newUrl }));
}

/**
 * The old and the new address of a change as segments for display: { before, after }, each a list of { text, changed }.
 * In `before` the changed pieces are the parameters that are gone or were rewritten, in `after` the ones that are new.
 */
export function diffSegments({ url, newUrl }) {
  return { before: highlightSegments(url, newUrl), after: highlightSegments(newUrl, url) };
}
