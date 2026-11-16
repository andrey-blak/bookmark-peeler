# Roadmap and decisions

## Decisions

- Firefox, Manifest V3, minimum Firefox 112 (ES modules in the background page).
- Pure logic lives in `src/core/` as ES modules without browser APIs, so it is unit-tested with `node:test`.
- Rules scope: all sites, or a domain (subdomains optional, on by default), optionally with a path. A path without wildcards matches exactly; `*` matches anything except `/`, `**` matches anything including `/`. A trailing slash is ignored. `/a/**` does not match `/a` itself. Paths are matched case-sensitively, after percent-decoding; port, query and fragment are ignored.
- Rule actions: remove a parameter (exact name or `*` wildcard, matched case-sensitively like on the server, against the decoded name), or replace in a parameter's name and/or value with a regex.
  - The regex runs on the decoded text and replaces every match; a changed part is re-encoded, the other part keeps its raw text.
  - A parameter qualifies when every non-empty pattern matches, so an empty name pattern means any parameter and a pattern without `replace` only filters.
  - Case-sensitive by default (`ignoreCase: false`); an invalid regex disables the action.
  - Two different name and value replacements that must apply independently need two actions.
- Query strings are parsed raw: untouched parameters keep their exact original bytes.
- The engine (`cleanUrl`) runs rules and their actions in list order, each seeing the previous result. Only `http:` and `https:` URLs are touched, and only their query: when every parameter is removed the `?` goes too, and the fragment is kept.
- Rules and settings are stored in `storage.local` as `schemaVersion`, `settings` and `rules` (see [storage.md](storage.md)). The stage-0 prototype format is not migrated: it was a draft, and it used a different add-on id, so its storage is not visible to this add-on.
  - A rule with validation errors stays in storage so it can be fixed, but is not applied until it is valid; warnings do not stop a rule.
  - Storage with a schema version newer than the code knows is never read or overwritten.
- A new bookmark is cleaned by updating its URL right after `bookmarks.onCreated`. Rules are read from storage for every bookmark; failures are logged to the add-on console, and successes are not logged.
- Only newly created bookmarks are cleaned at first. Later: optional cleaning on edit. Import and sync are not separate options: `bookmarks.onCreated` also fires for them, to be confirmed by testing.
- The main page (the rules; not to be confused with settings) opens in its own tab, from the toolbar button and from the add-ons manager. In the code it is still the manifest's `options_ui` and `src/options/`. Two-column layout: rule list and rule editor, the list should be collapsible so regex editing has room. System colours and fonts, no custom theme.
  - The list's switch, reorder and delete save at once. Deleting shows an Undo for the last deleted rule, for 8 seconds.
  - The editor works on a copy with Save and Revert, so a rule can be tried before it is saved.
  - Keyboard: Up and Down select a rule, Ctrl+Up and Ctrl+Down move it, Delete deletes it, Enter and Space switch it on or off, Ctrl+Z undoes the last delete (not while typing in a field). Dragging a rule also reorders. The page does not print these shortcuts; they are documented in [development.md](development.md).
  - A new rule starts as an unsaved draft: scope Domain, empty domain, no actions. Errors and warnings are shown only after the user has typed something.
  - In the replace action the pattern fields are labelled "Parameter" and "Value", and there is one "Case sensitive" checkbox, on by default.
  - Import and export buttons do not go into the rule list's sidebar; their place is decided in step 11.

## Steps

0. Skeleton: layout, build script, local Node, test runner, docs. (done)
1. Raw query parser with byte-preserving round trip. (done)
2. Scope matching: all, domain, domain + path or path pattern. (done)
3. Remove-parameter action. (done)
4. Regex replace action (name and value). (done)
5. `cleanUrl` engine: rule order, several rules per URL. (done)
6. Storage schema and validation. (done)
7. Background wiring on `bookmarks.onCreated`. (done)
8. Main page: rule list (enable, delete with undo, reorder by drag and keyboard), toolbar button opens the page. Rules cannot be added yet, so they are put into storage by hand, see [development.md](development.md). (done; checked manually in Firefox)
9. Main page: rule editor with the Add rule button, Save and Revert.
10. Main page: live URL tester.
11. Import / export (placed outside the rule list), presets.
12. Option to clean edited bookmarks; optional bulk clean of existing bookmarks and undo.
13. Optional: sync rules between devices with `storage.sync`.
    - Limits: 100 KiB in total, 8 KiB per item, 512 items, so store one key per rule.
    - On conflict the server's value wins per key, so changes from `onChanged` have to be merged.
14. Optional: empty state on first run, a short invitation with an Add rule button (and the presets once they exist).
15. Optional: settings for the keyboard shortcuts (now Ctrl+Up, Ctrl+Down, Delete, Ctrl+Z) and for how long Undo stays available, in seconds (now 8).
16. Optional proper icons: delete button.
