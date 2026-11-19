// Background page: connects the browser events to the handlers.
// Listeners must be registered synchronously at the top level, so that Firefox can wake the page for an event.

import { createSelfWrites } from "./self-writes.js";
import { store } from "../storage/default.js";
import { handleBookmarkCreated, handleBookmarkChanged, applyUrlChanges } from "./handler.js";

const deps = {
  loadStored: () => store.loadStored(),
  updateBookmark: (id, changes) => browser.bookmarks.update(id, changes),
  getBookmark: async id => {
    const [bookmark] = await browser.bookmarks.get(id);
    return bookmark ?? null;
  },
  selfWrites: createSelfWrites(),
};

const logError = error => console.error("Bookmark Peeler:", error);

browser.action.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});

browser.bookmarks.onCreated.addListener((id, bookmark) => {
  handleBookmarkCreated(bookmark, deps).catch(logError);
});

browser.bookmarks.onChanged.addListener((id, changeInfo) => {
  handleBookmarkChanged(id, changeInfo, deps).catch(logError);
});

// The main page asks for bulk changes here, so that every write is recorded and not mistaken for an edit by the user.
browser.runtime.onMessage.addListener(message => {
  if (message?.type === "set-bookmark-urls" && Array.isArray(message.changes)) {
    return applyUrlChanges(message.changes, deps);
  }
});
