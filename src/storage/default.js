// The store over storage.sync (settings) and storage.local (rules), for the pages and the background page.
// Each context (the background page, the main page) has its own instance.

import { createStore } from "./store.js";

export const store = createStore({ sync: browser.storage.sync, local: browser.storage.local });
