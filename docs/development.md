# Development

## Layout

```
src/            the add-on itself (this folder is what gets packed)
src/core/       pure logic, no browser APIs: query parsing, scope, actions, engine, schema
src/background/ the background page and its event handlers
src/options/    the main page (the manifest calls it options_ui); rule-list.js is its logic without DOM, the rest is DOM and storage glue
tests/          unit tests (node:test), tests/unit/*.test.js
scripts/    build.sh, setup-node.sh, test.sh
docs/       documentation
dist/       build output (git-ignored)
.tools/     project-local Node (git-ignored)
```

## Tooling

No global installs. Node is installed into the project:

```bash
scripts/setup-node.sh   # downloads the version from .node-version into .tools/node, verifies its SHA-256
scripts/test.sh         # runs all tests with that Node
```

The tests use Node's built-in runner, so there are no npm dependencies. Requirements for the scripts: `bash`, `curl`, `tar` with `xz`, `python3`, `zip`.

## Packaging

```bash
scripts/build.sh            # validates src/manifest.json, writes dist/bookmark-peeler.zip
scripts/build.sh --dry-run  # validates and lists the files that would be packed, writes nothing
```

## Trying the add-on in Firefox

Open `about:debugging#/runtime/this-firefox`, choose "Load Temporary Add-on" and select `src/manifest.json`.
A temporary add-on, and its stored rules, are gone after Firefox restarts.

## Manual test of the background wiring

The unit tests cover the logic with a fake browser; this checks it in Firefox.
There is editor yet, so put a rule into storage from the add-on's own console:

1. In `about:debugging#/runtime/this-firefox` click "Inspect" next to Bookmark Peeler and open the Console.
2. Run:

   ```js
   await browser.storage.local.set({
     schemaVersion: 1,
     settings: { cleanOnEdit: false },
     rules: [{
       scope: { type: "host", host: "youtube.com" },
       actions: [{ type: "remove", param: "pp" }]
     }]
   })
   ```

3. Bookmark `https://www.youtube.com/watch?v=KAq7MwkoFR8&pp=ugUEEgJydQ%3D%3D` in each of these ways:
   - Ctrl+D, and the star button in the address bar.
   - Dragging the page icon from the address bar onto the bookmarks toolbar.
   - Dragging a link to that URL onto the bookmarks toolbar, and onto a folder in the Library window.
   - "Bookmark All Tabs".
4. Open the Library (Ctrl+Shift+O), select each bookmark and check its Location: `pp` must be gone and `v=KAq7MwkoFR8` must stay.
5. Errors, if any, show in the add-on's Console as `Bookmark Peeler: ...`.

## Manual test of the main page

The logic of the list is unit-tested; the page itself is checked by hand.
Rules cannot be added in the page yet (the editor comes in a later step), so put a few into storage from the add-on's console, as in the test above:

```js
await browser.storage.local.set({
  schemaVersion: 1,
  settings: { cleanOnEdit: false },
  rules: [
    { name: "Tracking parameters", scope: { type: "all" }, actions: [{ type: "remove", param: "utm_*" }] },
    { name: "YouTube", scope: { type: "host", host: "youtube.com", path: "/watch" }, actions: [{ type: "remove", param: "pp" }] },
    { name: "Has an error", scope: { type: "host", host: "" }, actions: [{ type: "remove", param: "x" }] },
    { name: "Switched off", enabled: false, scope: { type: "host", host: "example.org", subdomains: false }, actions: [] },
    { scope: { type: "host", host: "news.example.com" }, actions: [{ type: "remove", param: "ref" }] }
  ]
})
```

Click the toolbar button: the main page must open in its own tab. Then check:

1. The list shows the five rules. The rule without a name is titled with its domain. "Has an error" has a red mark and "Switched off" a yellow one; hovering a mark shows the reason.
2. The switch of a rule saves at once: reload the page, the state stays.
3. Click a rule: it is highlighted. Up and Down select the previous and next rule, and stop at the ends. Ctrl+Up and Ctrl+Down move the selected rule and keep the focus on it. Reload: the order stays.
4. Drag a rule by its handle (or anywhere on the row) between two others: a line shows where it lands. Reload: the order stays.
5. Delete a rule with the × button: an Undo message appears for a few seconds, and the next rule is selected. Undo puts the rule back at its old position; after the message goes away the rule stays deleted.
6. Open the main page in two tabs and change the list in one: the other tab follows.
7. Switch the system between light and dark: colours follow, and fonts are the system's.
8. Keyboard, with the focus on a rule (click it or use Up and Down):
   - Enter and Space switch the rule on or off, whether the focus is on its name or on its switch (Space on the switch must not toggle twice). On the × button they delete instead.
   - Delete deletes the rule and moves the focus to the next one.
   - Ctrl+Z, while the Undo message is visible, restores the last deleted rule at its old position and focuses it. After the message has gone, Ctrl+Z does nothing.
9. The page does not print the shortcuts anywhere.

The shortcuts, for reference: Up and Down select a rule, Ctrl+Up and Ctrl+Down move it, Delete deletes it, Enter and Space switch it on or off, Ctrl+Z undoes the last delete.
