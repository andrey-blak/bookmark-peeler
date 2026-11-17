# Roadmap and decisions

## Decisions

- Firefox, Manifest V3, minimum Firefox 112 (ES modules in the background page).
- Pure logic lives in `src/core/` as ES modules without browser APIs, so it is unit-tested with `node:test`.
- Rules scope: all sites, or a domain (subdomains optional, on by default), optionally with a path. A path without wildcards matches exactly; `*` matches anything except `/`, `**` matches anything including `/`. A trailing slash is ignored, and the leading slash is optional. `/a/**` does not match `/a` itself. The domain is a plain name: wildcards and regular expressions are rejected (the Subdomains option covers subdomains); wildcards can be added later if needed. Paths are matched case-sensitively, after percent-decoding; port, query and fragment are ignored.
- Rule actions: remove a parameter (exact name or `*` wildcard, matched case-sensitively like on the server, against the decoded name), or replace in a parameter's name and/or value with a regex (the `parameter` and `value` patterns of the action).
  - The regex runs on the decoded text and replaces every match; a changed part is re-encoded, the other part keeps its raw text.
  - A parameter qualifies when every non-empty pattern matches, so an empty parameter pattern means any parameter and a pattern without `replace` only filters.
  - Case-sensitive by default (`ignoreCase: false`); an invalid regex disables the action.
  - Two different parameter name and value replacements that must apply independently need two actions.
- Query strings are parsed raw: untouched parameters keep their exact original bytes.
- The engine (`cleanUrl`) runs rules and their actions in list order, each seeing the previous result. Only `http:` and `https:` URLs are touched, and only their query: when every parameter is removed the `?` goes too, and the fragment is kept.
- Rules and settings are stored in `storage.local` as `schemaVersion`, `settings` and `rules` (see [storage.md](storage.md)). The stage-0 prototype format is not migrated: it was a draft, and it used a different add-on id, so its storage is not visible to this add-on.
  - A rule with validation errors stays in storage so it can be fixed, but is not applied until it is valid; warnings do not stop a rule.
  - Storage with a schema version newer than the code knows is never read or overwritten.
- A new bookmark is cleaned by updating its URL right after `bookmarks.onCreated`. Rules are read from storage for every bookmark; failures are logged to the add-on console, and successes are not logged.
- A bookmark is cleaned when it is created. With the setting `cleanOnEdit` (off by default) it is also cleaned when its address is edited (`bookmarks.onChanged`); a change of the title or a move is ignored. The add-on records the addresses it writes itself and ignores the edit event they cause, so a rule that changes its own output cannot loop. Import and sync are not separate options: `bookmarks.onCreated` also fires for them, to be confirmed by testing.
  - The Settings button in the header opens a panel in place of the editor; pressing the button again, or choosing a rule, goes back. It holds the checkbox "Also clean a bookmark when its address is edited" (saved at once) and "Clean existing bookmarks…".
  - Clean existing bookmarks covers all bookmarks (only `http:` and `https:` ones can change) with the enabled rules that have no errors. A preview dialog says "N of M bookmarks would change" and lists the changes in a "Show the changes (N)" list that is open at first (it can be collapsed), 50 at first, with "Show more…". Each change has its title and two columns, Before and After, with the removed or rewritten parameters marked red in Before and the new or rewritten ones green in After, in the text colour by default, not bold. "Clean N bookmarks" applies them; a bookmark edited since the scan is left as it is. The Undo message (and Ctrl+Z) and the Settings button "Restore the last cleaned bookmarks" put the old addresses back, only while the page is open, and skip bookmarks edited since. The writes are done by the background page, so that they are recorded as the add-on's own.
- The main page (the rules; not to be confused with settings) opens in its own tab, from the toolbar button and from the add-ons manager. In the code it is still the manifest's `options_ui` and `src/options/`. Two-column layout: rule list and rule editor, the list should be collapsible so regex editing has room. System colours and fonts, no custom theme.
  - The list's switch, reorder and delete save at once. Deleting shows an Undo for the last deleted rule, for 8 seconds.
  - The editor works on a copy with Save and Revert, so a rule can be tried before it is saved.
  - Keyboard: Up and Down select a rule, Ctrl+Up and Ctrl+Down move it, Delete deletes it, Enter and Space switch it on or off, Ctrl+Z undoes the last delete (not while typing in a field). Dragging a rule also reorders. The page does not print these shortcuts; they are documented in [tests.md](tests.md).
  - Several rules can be selected: Shift+click selects the range from the starting rule, Ctrl+click adds or removes one rule, and Shift+Up and Shift+Down extend the selection from the starting rule. The editor then says "N rules selected" (asking Save, Discard or Cancel first when it has unsaved changes). Delete, Ctrl+Up, Ctrl+Down, Enter and Space act on all selected rules when the focused rule is one of them; Enter and Space give every selected rule the opposite of the focused rule's state. Selected rules move as a block, one place at a time, and stop at the end of the list. One Undo restores all deleted rules at their old positions. Dragging one of the selected rules moves all of them, as a block in their order, to where it is dropped; dropping on one of the selected rules does nothing. The × button and the switch of a row still act on that row only.
  - A new rule starts as an unsaved draft: scope Domain, empty domain, no actions. Errors and warnings are shown only after the user has typed something.
  - In the replace action the pattern fields are labelled "Parameter" and "Value", and there is one "Case sensitive" checkbox, on by default.
  - Presets, Import and Export are buttons in the page header, outside the rule list. The label is just "Export"; it exports the rules and the settings.
  - Export saves the stored format (see [storage.md](storage.md)) as `bookmark-peeler-rules.json`. Import opens a file chooser filtered to JSON, refuses files that are not JSON, not a rules file or from a newer version (with a short message at the bottom of the page that goes away by itself after a few seconds, like a toast), and otherwise shows how many rules the file holds, how many have errors and how many ids already exist. "Add to my rules" appends them (clashing ids get new ones) and keeps the current settings; "Replace my rules" replaces the rules and the settings with the file's. Both show the Undo message, so Undo (Ctrl+Z) restores the previous rules and settings.
  - The Presets menu offers "Tracking parameters" (all sites: `utm_*`, `fbclid`, `gclid`, `dclid`, `msclkid`, `mc_cid`, `mc_eid`, `igshid`, `yclid`, `twclid`) and "YouTube share parameters" (`si`, `pp`, `feature`). A preset opens as a new unsaved rule, to review and Save.
  - Ctrl+S saves the rule in the editor (also while typing in a field).
  - Selecting another rule, adding one or duplicating while the editor has unsaved changes asks "Save", "Discard" or "Cancel". Closing the tab with unsaved changes shows the browser's warning.
  - Save always works: a rule with errors is stored but not applied, and the editor says so. Revert goes back to the stored version; for a new rule it clears the form.
  - Duplicate creates an unsaved draft named "<name> copy".
  - "Try it" sits in the editor above Save. The URL field is remembered between visits without any Save. A switch "All rules" (the default) | "Current rule" chooses what is run: the unsaved draft alone, or the stored rules in order with the draft in place of its stored version (after them when it is new). The cleaned URL is shown with the changed parameters highlighted, and notes say why the rule did nothing: it has errors, it is switched off in the list, or the domain or path does not match.
  - Under the result, a "What changed (N)" list, collapsed by default: a green ✓ before "Changed" and a red ✕ before "Removed", with no coloured background so they do not look like warnings or errors; in "All rules" each line names the rule that made the change.
  - The rule list collapses to a narrow strip with the initial of each rule, with the « button or the `[` key (not while typing in a field). The state is remembered.
  - Add action is a menu with "Remove parameter" and "Replace in parameter or value". Actions are not reorderable yet.
  - The Domain field's placeholder is `example.com`.

## Steps

0. Skeleton: layout, build script, local Node, test runner, docs. (done)
1. Raw query parser with byte-preserving round trip. (done)
2. Scope matching: all, domain, domain + path or path pattern. (done)
3. Remove-parameter action. (done)
4. Regex replace action (parameter and value). (done)
5. `cleanUrl` engine: rule order, several rules per URL. (done)
6. Storage schema and validation. (done)
7. Background wiring on `bookmarks.onCreated`. (done)
8. Main page: rule list (enable, delete with undo, reorder by drag and keyboard), toolbar button opens the page. Rules cannot be added yet, so they are put into storage by hand, see [tests.md](tests.md). (done; checked manually in Firefox)
9. Main page: rule editor with the Add rule button, Save (Ctrl+S) and Revert, Duplicate, validation messages, and the unsaved changes prompt. (done; checked manually in Firefox, except the two fixes made after the check: the Add action menu and the messages shown on opening a stored rule)
9a. Refactoring: the replace action's `name` field and the remove action's `param` field are now both `parameter`, and `param`/`params` in the code are `parameter`/`parameters`, so a rule's own `name` is not confused with a parameter. Rules saved with the old fields lose their parameter filter or their remove action and have to be created again; nothing has been released yet, so there is no migration.
10. Main page: live URL tester, collapsible rule list.
11. Import / export (placed outside the rule list), presets. (done)
12. Option to clean edited bookmarks; bulk clean of existing bookmarks and undo. (done)
13. Optional: sync rules between devices with `storage.sync`.
    - Limits: 100 KiB in total, 8 KiB per item, 512 items, so store one key per rule.
    - On conflict the server's value wins per key, so changes from `onChanged` have to be merged.
14. Optional: empty state on first run, a short invitation with an Add rule button (and the presets once they exist).
15. Optional: settings for the keyboard shortcuts (now Ctrl+Up, Ctrl+Down, Delete, Ctrl+Z, Ctrl+S, `[`) and for how long Undo stays available, in seconds (now 8).
16. Optional proper icons: delete, add.
17. Optional: reorder the actions of a rule.
18. Optional: keep only the specified parameters (an allowlist), removing all the others.
19. Optional: choose folders for the bulk clean of existing bookmarks (now: all bookmarks).
