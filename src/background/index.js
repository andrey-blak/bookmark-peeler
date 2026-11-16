// Background page: connects the browser events to the handlers.
// Listeners must be registered synchronously at the top level, so that Firefox can wake the page for an event.

import { handleBookmarkCreated } from "./handler.js";

const deps = {
  loadStored: () => browser.storage.local.get(["schemaVersion", "settings", "rules"]),
  updateBookmark: (id, changes) => browser.bookmarks.update(id, changes),
};

browser.action.onClicked.addListener(() => {
  browser.runtime.openOptionsPage();
});

browser.bookmarks.onCreated.addListener((id, bookmark) => {
  handleBookmarkCreated(bookmark, deps).catch(error => {
    console.error("Bookmark Peeler:", error);
  });
});
