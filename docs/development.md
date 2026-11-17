# Development

## Layout

```
src/            the add-on itself (this folder is what gets packed)
src/core/       pure logic, no browser APIs: query parsing, scope, actions, engine, schema
src/background/ the background page and its event handlers
src/options/    the main page (the manifest calls it options_ui); rule-list.js, editor-model.js and tester.js are its logic without DOM, the rest is DOM and storage glue
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
What the tests cover, and the manual tests in Firefox, are in [tests.md](tests.md).

## Packaging

```bash
scripts/build.sh            # validates src/manifest.json, writes dist/bookmark-peeler.zip
scripts/build.sh --dry-run  # validates and lists the files that would be packed, writes nothing
```

## Trying the add-on in Firefox

Open `about:debugging#/runtime/this-firefox`, choose "Load Temporary Add-on" and select `src/manifest.json`.
A temporary add-on, and its stored rules, are gone after Firefox restarts.
