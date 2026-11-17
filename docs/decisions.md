# Decisions

The decisions behind the add-on.

## Platform and structure

- Firefox, Manifest V3, minimum Firefox 112 (ES modules in the background page). Desktop only.
- The logic is in `src/core/` as ES modules without browser APIs, so it is unit-tested with `node:test`. The pages and the background page are thin glue around it.
- The main page (the rules) opens in its own tab, from the toolbar button and from the add-ons manager. 
- System colours and fonts, light and dark, no custom theme.

## Cleaning URLs

- Query strings are parsed raw: parameters nobody touched keep their exact original bytes. Only the query changes; only `http:` and `https:` URLs are touched.
- Matching follows the server: parameter names and paths are case-sensitive. The domain is a plain name; wildcards and regular expressions in it are rejected (the Subdomains option covers subdomains) and can be added later if needed.
- Rules and their actions run in list order, each seeing the previous result. A rule's actions and patterns work on decoded text, and only the part that changes is re-encoded.

## Storage

- Rules and settings are in `storage.sync`, with a `schemaVersion`. There is no addon setting for it.
- Everything syncs, settings included.
- Every rule is its own item, so a change to one rule does not overwrite another when devices sync.
- A rule or total size over the limits of `storage.sync` is refused with a message.
- If only one side has rules, they are used without asking. If this device and the synced storage have different rules, a dialog appears: "Merge" (all rules from both sides, a rule on both sides from the synced side), "Use this device's rules" or "Use the synced rules".
- A rule with errors stays in storage so it can be fixed, but is not applied. Warnings do not stop a rule.
- Storage with a newer schema version than the code knows is never read or overwritten.

## When bookmarks are cleaned

- When a bookmark is created, and, with the setting `cleanOnEdit` (off by default), when its URL is edited. A change of the title or a move is ignored.
- The add-on records the URLs it writes itself and ignores the edit event they cause, so a rule that changes its own output cannot loop.
- Import and sync are not separate events: `bookmarks.onCreated` fires for them too.
- Rules are read from storage for every bookmark, so a change made on the page applies at once. Failures are logged to the add-on console; successes are not logged.

## Clean existing bookmarks

- It covers all bookmarks, with a preview of what would change before anything is written.
- The writes are done by the background page, so that they are recorded as the add-on's own and not mistaken for edits by the user.
- Undo works only while the page is open, and skips bookmarks edited since.

## The main page

- The list's switch, reordering and deleting save at once, with an Undo for the last delete or import. The editor works on a copy with Save and Revert, so a rule can be tried before it is saved. Unsaved changes are never dropped silently.
- A new rule can always be saved. A rule with errors can be saved; the editor says it is not applied. A new rule shows errors and warnings only after the user has typed.
- "Try it" runs the unsaved rule, alone or with all rules.

## Import, export and presets

- Export saves the stored format as a JSON file; Import reads it through the same loading code as storage, so every file is validated.
- "Add to my rules" keeps the current settings; "Replace my rules" replaces the rules and the settings with the file's.
- A preset opens as a new unsaved rule, to review and Save.
