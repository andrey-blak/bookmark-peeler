# Decisions

The decisions behind the add-on.

## Platform and structure

- Firefox, Manifest V3, minimum Firefox 112 (ES modules in the background page). Desktop only.
- The logic is in `src/core/` as ES modules without browser APIs, so it is unit-tested with `node:test`. The pages and the background page are thin glue around it.
- The main page (the rules) opens in its own tab, from the toolbar button and from the add-ons manager. 
- System colours and fonts, light and dark, no custom theme.

## Cleaning URLs

- Query strings are parsed raw: parameters nobody touched keep their exact original bytes. Only the query changes; only `http:` and `https:` URLs are touched.
- Matching follows the server: parameter names and paths are case-sensitive. The domain is a plain name; wildcards and regular expressions in it are rejected (the Include subdomains option covers subdomains) and can be added later if needed.
- Rules and their actions run in list order, each seeing the previous result. A rule's actions and patterns work on decoded text, and only the part that changes is re-encoded.

## Storage

- The settings are in `storage.sync` and the rules are in `storage.local`, each with a `schemaVersion`. There is no addon setting for it.
- The settings are one item of `storage.sync`. When they do not fit in it (a very long list of excluded sites), the save is refused with a message.
- There is no migration from earlier storage layouts: the add-on has no users of them.
- A rule with errors stays in storage so it can be fixed, but is not applied.
- Storage with a newer schema version than the code knows is never read or overwritten.

## When bookmarks are cleaned

- When a bookmark is created, and, with the setting `cleanOnEdit` (off by default), when its URL is edited. A change of the title or a move is ignored.
- The add-on records the URLs it writes itself and ignores the edit event they cause, so a rule that changes its own output cannot loop.
- Import and sync are not separate events: `bookmarks.onCreated` fires for them too.
- Excluded sites: a list in Settings of domains (subdomains included) where the add-on does nothing, whatever the rules say. A new bookmark, an edited one and the bulk clean all skip them. The list is stored with the settings.
- A rule can have its own list of excluded sites, with the same kind of entries, under "Applies to" for every scope type. A bad entry there is an error, so the rule is not applied instead of running on a site that was meant to be left alone.
- Rules are read from storage for every bookmark, so a change made on the page applies at once. Failures are logged to the add-on console; successes are not logged.

## Clean existing bookmarks

- It covers all bookmarks, with a preview of what would change before anything is written.
- The writes are done by the background page, so that they are recorded as the add-on's own and not mistaken for edits by the user.
- Undo works only while the page is open, and skips bookmarks edited since.
- The Undo message stays for the number of seconds in the setting `undoSeconds` (8 by default, 1 to 60). A value outside the range is not saved.

## The main page

- The list's switch, reordering and deleting save at once, with an Undo for the last delete or import. The editor works on a copy with Save and Revert, so a rule can be tried before it is saved. Unsaved changes are never dropped silently.
- A new rule can always be saved. A rule with errors can be saved; the editor says it is not applied. A new rule shows errors and warnings only after the user has typed.
- "Try it" runs the unsaved rule, alone or with all rules.

## Import, export and presets

- There is one file format. Export lets the user choose the rules, the settings, or both; Import reads the file through the same loading code as storage, so every file is validated, and works out from the file what it has, so there is no file type to choose.
- The import dialog has the checkboxes "Settings" and "Rules", and "Replace my rules" or "Add to my rules" only while "Rules" is ticked. The settings are always replaced as a whole, the list of excluded sites included. A file with only settings is imported without a dialog.
- Rule ids are 8 random hexadecimal characters. They only need to be unique within one list: a repeated id is replaced when a file is imported.
- A preset opens as a new unsaved rule, to review and Save.
