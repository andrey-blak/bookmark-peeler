// What happens when a bookmark is created.
// Kept free of browser APIs: the storage read and the bookmark update are passed in, so it can be unit-tested.

import { cleanUrl } from "../core/engine.js";
import { readConfig, usableRules } from "../core/schema.js";
import { isExcluded } from "../core/exclusions.js";

/**
 * Cleans the URL of a newly created bookmark.
 *
 * @param bookmark a bookmarks.BookmarkTreeNode; folders and separators have no url and are ignored
 * @param deps.loadStored async () => the stored { schemaVersion, settings, rules }
 * @param deps.updateBookmark async (id, { url }) => void
 * @param deps.selfWrites optional, see self-writes.js: the written address is recorded there
 *
 * Rules are read from storage on every call, so a change made in the options page applies to the next bookmark.
 * Errors from the dependencies are passed on to the caller.
 */
export async function handleBookmarkCreated(bookmark, { loadStored, updateBookmark, selfWrites }) {
  if (!bookmark.url) return;

  const loaded = readConfig(await loadStored());
  if (loaded.status !== "ok") return;
  if (isExcluded(bookmark.url, loaded.config.settings.excludedSites)) return;

  const cleaned = cleanUrl(bookmark.url, usableRules(loaded.config.rules));
  if (cleaned === bookmark.url) return;

  selfWrites?.add(bookmark.id, cleaned);
  await updateBookmark(bookmark.id, { url: cleaned });
}

/**
 * Cleans a bookmark whose address was edited, when the setting "clean when edited" is on.
 * Changes of anything but the address, and the add-on's own writes, are ignored.
 *
 * @param id the bookmark's id
 * @param changeInfo from bookmarks.onChanged: only the properties that changed, so `url` is there when the address did
 */
export async function handleBookmarkChanged(id, changeInfo, { loadStored, updateBookmark, selfWrites }) {
  const url = changeInfo.url;
  if (url === undefined) return;
  if (selfWrites?.consume(id, url)) return;

  const loaded = readConfig(await loadStored());
  if (loaded.status !== "ok" || !loaded.config.settings.cleanOnEdit) return;
  if (isExcluded(url, loaded.config.settings.excludedSites)) return;

  const cleaned = cleanUrl(url, usableRules(loaded.config.rules));
  if (cleaned === url) return;

  selfWrites?.add(id, cleaned);
  await updateBookmark(id, { url: cleaned });
}

/**
 * Sets the address of several bookmarks, for "Clean existing bookmarks" and its undo.
 * It runs here, not in the page, so that every write can be recorded in selfWrites.
 *
 * @param changes [{ id, url, expect? }]: with `expect` a bookmark is changed only while it still has that address
 * @param deps.getBookmark async (id) => { url } | null
 * Returns { updated, skipped, failed }: lists of bookmark ids. One failure does not stop the others.
 */
export async function applyUrlChanges(changes, { getBookmark, updateBookmark, selfWrites }) {
  const result = { updated: [], skipped: [], failed: [] };

  for (const { id, url, expect } of changes) {
    if (expect !== undefined) {
      let current = null;
      try {
        current = await getBookmark(id);
      } catch {
        // The bookmark is gone.
      }
      if (!current || current.url !== expect) {
        result.skipped.push(id);
        continue;
      }
    }

    try {
      selfWrites?.add(id, url);
      await updateBookmark(id, { url });
      result.updated.push(id);
    } catch {
      result.failed.push(id);
    }
  }

  return result;
}
