// The store over storage.sync and the migrator from storage.local, for the pages and the background page.
// Each context (the background page, the main page) has its own instances.

import { createStore } from "./store.js";
import { createMigrator } from "./migrate.js";

export const store = createStore(browser.storage.sync);
export const migrator = createMigrator({ local: browser.storage.local, store });
