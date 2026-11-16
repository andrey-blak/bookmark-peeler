# Development

## Layout

```
src/            the add-on itself (this folder is what gets packed)
src/core/       pure logic, no browser APIs: query parsing, scope, actions, engine, schema
src/background/ the background page and its event handlers
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
There is no options page yet, so put a rule into storage from the add-on's own console:

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
