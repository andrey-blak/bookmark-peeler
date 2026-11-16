// What happens when a bookmark is created.
// Kept free of browser APIs: the storage read and the bookmark update are passed in, so it can be unit-tested.

import { cleanUrl } from "../core/engine.js";
import { readConfig, usableRules } from "../core/schema.js";

/**
 * Cleans the URL of a newly created bookmark.
 *
 * @param bookmark a bookmarks.BookmarkTreeNode; folders and separators have no url and are ignored
 * @param deps.loadStored async () => the stored { schemaVersion, settings, rules }
 * @param deps.updateBookmark async (id, { url }) => void
 *
 * Rules are read from storage on every call, so a change made in the options page applies to the next bookmark.
 * Errors from the dependencies are passed on to the caller.
 */
export async function handleBookmarkCreated(bookmark, { loadStored, updateBookmark }) {
  if (!bookmark.url) return;

  const loaded = readConfig(await loadStored());
  if (loaded.status !== "ok") return;

  const cleaned = cleanUrl(bookmark.url, usableRules(loaded.config.rules));
  if (cleaned === bookmark.url) return;

  await updateBookmark(bookmark.id, { url: cleaned });
}
