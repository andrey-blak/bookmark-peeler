# Tests

## Automated tests

```bash
scripts/test.sh
```

They run with the project-local Node (see [development.md](development.md)) and use Node's built-in runner.
The tests are in `tests/unit/`, one file per module:

- `src/core/`: query parsing, scope matching, actions, the cleaning engine, the stored schema and its validation.
- `src/background/`: what happens when a bookmark is created or edited (including the guard against the add-on's own writes) and the bulk URL changes, with a fake browser.
- `src/options/`: the logic of the rule list and of selecting several rules, the rule editor, the "Try it" panel, import and export, the presets, and the scan and undo of "Clean existing bookmarks", without DOM.
- The manifest: permissions, background page, options page and icons.

Not covered by them: the pages as drawn in Firefox (layout, focus, drag and drop, dialogs) and the real bookmark events.
Those are checked by the manual tests below.

## Manual tests

Load the add-on first, as described in [development.md](development.md#trying-the-add-on-in-firefox).
Repeat the tests after a change in the area they cover.
A temporary add-on, and its stored rules, are gone after Firefox restarts.

### Background wiring

The unit tests cover the logic with a fake browser; this checks it in Firefox.
To try this without the editor, put a rule into storage from the add-on's own console:

1. In `about:debugging#/runtime/this-firefox` click "Inspect" next to Bookmark Peeler and open the Console.
2. Run:

   ```js
   await browser.storage.local.set({
     schemaVersion: 1,
     settings: { cleanOnEdit: false },
     rules: [{
       scope: { type: "host", host: "example.com" },
       actions: [{ type: "remove", parameter: "pp" }]
     }]
   })
   ```

3. Bookmark `https://www.example.com/video?v=Hn4xT9sBq2L&pp=qvRtLd8aWk%3D%3D` in each of these ways:
   - Ctrl+D, and the star button in the address bar.
   - Dragging the page icon from the address bar onto the bookmarks toolbar.
   - Dragging a link to that URL onto the bookmarks toolbar, and onto a folder in the Library window.
   - "Bookmark All Tabs".
4. Open the Library (Ctrl+Shift+O), select each bookmark and check its Location: `pp` must be gone and `v=Hn4xT9sBq2L` must stay.
5. Errors, if any, show in the add-on's Console as `Bookmark Peeler: ...`.

### Main page: the rule list

To get several rules quickly, put them into storage from the add-on's console, as in the test above (the editor can add them too, see the next section):

```js
await browser.storage.local.set({
  schemaVersion: 1,
  settings: { cleanOnEdit: false },
  rules: [
    { name: "Tracking parameters", scope: { type: "all" }, actions: [{ type: "remove", parameter: "utm_*" }] },
    { name: "Example", scope: { type: "host", host: "example.com", path: "/video" }, actions: [{ type: "remove", parameter: "pp" }] },
    { name: "Has an error", scope: { type: "host", host: "" }, actions: [{ type: "remove", parameter: "x" }] },
    { name: "Switched off", enabled: false, scope: { type: "host", host: "example.org", subdomains: false }, actions: [] },
    { scope: { type: "host", host: "news.example.com" }, actions: [{ type: "remove", parameter: "ref" }] }
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

The shortcuts, for reference: Up and Down select a rule, Ctrl+Up and Ctrl+Down move it, Delete deletes it, Enter and Space switch it on or off, Ctrl+Z undoes the last delete, `[` collapses or expands the list.

### Main page: the rule editor

Start with the rules from the previous section, or an empty list.

1. Add rule: the editor opens with an empty Name, Scope "Domain" and an empty Domain showing the `example.com` placeholder. The list gets an italic "New rule" row. No error or warning is visible yet.
2. Type `example.com` in Domain: the row gets a • (unsaved changes). Open the "Add action…" menu: it offers only "Remove parameter" and "Replace in parameter or value", and nothing that does nothing. Choose the replace action: a card appears with the focus in its Parameter field, and no message yet.
3. Fill in Parameter `^visibility$`, leave "Replace with" unticked there, Value `^public$`, and in the Value replacement `private`. Then type `(` in the Value pattern: a red message about the regular expression appears under it, the field is outlined, and the line next to Save says "1 error. The rule isn't applied until the error is fixed." Fix the pattern.
4. Untick "Replace with" on the Value line: a warning "Nothing is replaced..." appears; tick it again: the replacement field is enabled and empty.
5. Press Save (and, in another rule, Ctrl+S while typing in a field: Firefox's "Save page" must not open). The row gets the name, or the domain when the name is empty, the • goes, and "Saved." is shown. Reload the page: the rule is there and opens with the same values.
6. With a saved rule open, change a field and press Revert: the stored values come back. On a new rule, Revert clears the form.
7. Scope: "All sites" hides Domain, Subdomains and Path; going back to "Domain" brings the domain back; "Domain + path" shows Path and a hint about `*` and `**`. Enter `/new` and save.
8. Add a "Remove parameter" action with `utm_*`, then delete it with ×; the focus moves to the Add action menu. Delete an action that is not the last one: the actions after it move up and keep their values.
9. Unsaved changes: change a field of a rule, then click another rule. A dialog offers Save, Discard and Cancel. Cancel (or Esc) stays; Discard switches and drops the changes; Save stores them and then switches. The same happens for Add rule and Duplicate, and with Up and Down in the list.
10. Duplicate: a new unsaved row appears, the Name is "<name> copy" (empty when the rule had none), and the scope and actions are the same. Changing the copy does not change the original.
11. With unsaved changes, reload the page or close the tab: Firefox asks for confirmation.
12. Delete the open rule from the list: the next rule opens in the editor (or the editor empties when it was the last). Ctrl+Z brings it back.
13. Switch a rule off in the list while it is open in the editor, then Save an edit: the rule stays off.
14. Open the page in two tabs: save a change in one; the other tab, if it has no unsaved changes, shows it.
15. Messages on opening a stored rule: a rule without actions shows "This rule has no actions, so it does nothing." under "Actions" as soon as it is opened. Save a new rule without actions, select another rule and come back: the warning is still there. "Has an error" shows "Enter a domain." under Domain at once. After changing a field of a stored rule and pressing Revert, the messages are still shown. A new rule shows no message until you type in it.
16. Domain and path fields: the Path placeholder is `video` and its hint shows `albums/*` and `a/**`, with no leading slash. Typing `*.example.com` in Domain shows "Wildcards aren't supported in the domain. The Subdomains option includes subdomains." A path without the leading slash (`new`) still matches `/new`.
17. End to end: create "Remove pp" for `example.com`, action Remove parameter `pp`, and Save. Bookmark an example.com URL with `&pp=...`: the saved bookmark has no `pp`.
18. A stored rule that you have just opened has both greyed out. Change a field: both become active, and Ctrl+S saves. Change it back to what it was: both are greyed out again. Save: Save and Revert are greyed out, and "Saved." is shown. With Save greyed out, Ctrl+S does nothing, and the browser's own "Save page" dialog does not open either.
19. A new rule from Add rule, Duplicate or a preset has Save active at once, so a preset or a copy can be saved as it is. Revert is greyed out until you change something, and then clears the form. After Save, the rule is stored and both buttons are greyed out. Switching a rule on or off in the list does not make Save active.

### Main page: "Try it"

Have a few rules, for example "Tracking" (all sites, remove `utm_*`) and the Example visibility rule from the editor test, and open one of them.
If the page looks unstyled or shows an old version after a change, reload the add-on in `about:debugging` and reload the page with Ctrl+Shift+R, so Firefox does not use a cached stylesheet.

1. "Try it" is at the bottom of the editor, above Save, with clear space above it. Before anything is typed it says "Paste a URL to see what the rule does."
2. Paste `https://example.com/new?owner=me&visibility=public&utm_source=x`. With "All rules" selected (the default) the result is `https://example.com/new?owner=me&visibility=private`, with `visibility=private` in bold green. There is space between the URL field and the result, and the first character of the result is directly under the first character typed in the URL field.
3. "What changed (2)" is collapsed, with space above it. Open it: `✓ Changed: visibility: public → private  by **Example visibility**` with a green ✓, and `✕ Removed: utm_source=x  by **Tracking**` with a red ✕, each part separated by a space, the rule name in bold, and no coloured background. Reload the page: the list is collapsed again.
4. Choose "Current rule": the result keeps `utm_source=x`, only the open rule's change is listed, and the lines no longer name a rule.
5. The result follows what you type, in the URL field and in the rule's fields, without saving. Change the replacement to `internal`: the result changes at once, and Revert brings the old result back.
6. Open another rule in the list: the URL you typed is still in the URL field, and the result is for that rule. Choose "Current rule", then reload the page: the "Current rule" choice is kept.
7. Notes: test `https://example.net/new?visibility=public` with the Example rule: "This rule doesn't apply to this URL: the domain doesn't match." Give the rule a path `/settings` and test the Example URL: "...the path doesn't match." Put an invalid regex in a pattern: "This rule has errors, so it isn't applied." Switch the rule off in the list and use "All rules": "This rule is switched off in the list, so it isn't applied."
8. A URL that is not http or https (`example.com/new`, `ftp://...`) shows "Enter a full URL starting with http:// or https://." A URL with no matching parameters shows the URL and "No changes."

### Main page: the collapsible rule list

1. Collapse the list with the « button: it becomes a narrow strip with one square per rule showing its initial, with a "+" for Add rule at the top and » to expand. The selected rule is highlighted, a rule with an error has a red border, and clicking a square opens that rule. Reload: it stays collapsed.
2. Press `[` with the focus on a rule or on the page: the list expands again. Typing `[` in a text field (for example in a regex) must not collapse it.
3. In the collapsed list, Up and Down, Ctrl+Up and Ctrl+Down, Delete, Enter and Space still work on the focused square.

### Main page: Import, Export and Presets

Have two or three rules, for example "Tracking parameters" and the Example visibility rule, and one rule with an error.

1. The header has Presets, Import… and Export buttons on the right, and the rule list has no import or export buttons.
2. Export: a file `bookmark-peeler-rules.json` is downloaded. Open it: it holds `schemaVersion`, `settings` and all the rules, indented.
3. Import…: the file chooser shows JSON files by default. Choose the exported file: a dialog says how many rules it holds, how many have errors, and how many already exist.
4. "Add to my rules": the imported rules are appended, the existing ones stay, and none has the id of another (open the exported file and the stored data to compare if you wish). An Undo message appears; Undo (or Ctrl+Z) removes the added rules again.
5. Change the settings in the console (`await browser.storage.local.set({ settings: { cleanOnEdit: true } })`), then choose "Add to my rules" again: the settings stay as they were. Choose "Replace my rules" with a file that has `"cleanOnEdit": false`: the rules and the settings are those of the file, and Undo brings back the previous rules and the previous settings.
6. Cancel, or Esc, in the dialog imports nothing. With unsaved changes in the editor, choosing Add or Replace asks Save, Discard or Cancel first.
7. Files that must be refused, each with a short message at the bottom of the page that disappears by itself after a few seconds, nothing left above the list, and no change: a text file, a file with `{ broken`, a JSON file such as `[]` or `{}`, and a rules file with `"schemaVersion": 2`.
8. Presets opens a menu with "Tracking parameters" and "YouTube share parameters", each with a one-line description. It closes with Esc and with a click elsewhere. Choosing one opens it in the editor as a new unsaved rule, named like the preset, with its actions; Save stores it. With unsaved changes in the editor, the usual Save, Discard or Cancel prompt appears.
9. Try the tracking preset in "Try it" with `https://example.com/?a=1&utm_source=x&fbclid=y`: the result is `https://example.com/?a=1`.

### Clean when edited

1. In the add-on's console, switch the setting on and add the Example rule from "Background wiring":
   `await browser.storage.local.set({ schemaVersion: 1, settings: { cleanOnEdit: true }, rules: [{ scope: { type: "host", host: "example.com" }, actions: [{ type: "remove", parameter: "pp" }] }] })`
2. Make a bookmark of any other page. Open its Properties (Library, or right-click, Edit Bookmark…), and set its Location to `https://www.example.com/video?v=Hn4xT9sBq2L&pp=qvRtLd8aWk%3D%3D`. After saving, the Location shows no `pp`.
3. Change only the title of a bookmark that has such an URL: the URL is not touched (the rule is applied to edited URLs only).
4. Switch the setting off (`cleanOnEdit: false`) and repeat step 2: the URL keeps its `pp`.
5. No loop: switch the setting on, make a rule that changes its own output (all sites, Replace, Value pattern `$`, replacement `x`), and edit a bookmark's URL to `https://example.com/?a=1`. The URL ends as `https://example.com/?a=1x`, once, not `1xxxx…`, and the Library does not flicker.

### Settings and "Clean existing bookmarks"

Have some bookmarks with tracking parameters (for example `https://example.com/?a=1&utm_source=x`) and the "Tracking parameters" preset saved.

1. The header has a Settings button. It opens a panel in place of the editor, titled "Settings", without a back button; pressing the Settings button again, clicking a rule in the list, or Add rule goes back to the editor. The button looks pressed while the panel is open.
2. The checkbox "Also clean a bookmark when its URL is edited" is off by default. Tick it, reload the page: it stays ticked, and `await browser.storage.local.get("settings")` shows `cleanOnEdit: true`. Untick it again.
3. "Clean existing bookmarks…" opens a dialog: first "Looking at your bookmarks…", then "N of M bookmarks would change." The changes are in a "Show the changes (N)" list that is open when the dialog appears (click its arrow to collapse it): each shows the title, and under it two columns, Before and After, with the old and the new URL. Parameters that were removed or rewritten are marked red in Before, and the new or rewritten ones green in After, in the text colour and not bold. A switch above the list, "Text colour" | "Background", changes how they are marked (the choice is remembered; it is there to compare the two). With more than 50 changes the list shows 50 and a "Show more… (K left)" button that adds the next 50.
4. Cancel (or Esc) changes nothing. With no matching bookmark the dialog says "No bookmark would change" and has only Close.
5. "Clean N bookmarks": a message "Cleaning…", then "Cleaned N bookmarks." with Undo. Check a few bookmarks in the Library: the tracking parameters are gone. Folders, separators and non-web bookmarks (for example `place:` queries) are untouched.
6. Undo, or Ctrl+Z while the message is shown: the old URLs are back. Clean again, wait until the message has gone, and open Settings: "Restore the last cleaned bookmarks" with "N bookmarks, until you close this page." Press it: they are restored, and the button goes away.
7. Clean, then edit one cleaned bookmark's URL by hand, then restore: that bookmark is left as you edited it, and the message says how many were left.
8. With "Also clean when edited" ticked, clean existing bookmarks with a rule that changes its own output (see "Clean when edited" step 5): each bookmark is changed once.
9. Reload the page after a clean: the "Restore" button is gone (it only lasts while the page is open).

### Main page: selecting several rules

Have six rules, A to F, in that order, some enabled and some switched off.

1. Click B, then Shift+click D: B, C and D are highlighted and the editor says "3 rules selected." Text in the list is not selected by Shift+click.
2. Ctrl+click F: it is added. Ctrl+click C: it is removed, leaving B, D and F. Ctrl+click D and F again until only B is left: the editor opens B. Ctrl+click B: nothing is selected, and the editor shows the usual invitation.
3. Click C, then Shift+Down twice: C, D and E are selected and the focus is on E. Shift+Up once: C and D. Shift+Up three more times: the selection crosses over C and grows upwards to A and B, and stops at the top. A plain Up or Down selects a single rule again.
4. With C, D and E selected: Ctrl+Up moves all three up by one, as a block, and the focus stays on the rule it was on. Ctrl+Down twice moves them down. At the top or the bottom of the list the block stops, and pressing again changes nothing.
5. With A and D selected (Ctrl+click): Ctrl+Up leaves A at the top and moves D up one place at a time until it is next to A; then nothing moves.
6. With rules selected, Delete removes them all. The next rule after the first deleted one is opened, and the message says "Deleted 3 rules." Undo, or Ctrl+Z, restores all of them at their old positions, including rules that were not next to each other.
7. With several rules selected, Enter or Space on the focused one gives all of them the opposite of its state: if it was on, all are switched off. Click the switch of one rule in the selection: only that rule changes.
8. The × button of a selected rule deletes only that rule, and the switch of a row changes only that row. Dragging a rule that is not part of the selection moves only that rule.
9. With unsaved changes in the editor, Ctrl+click or Shift+click on another rule asks Save, Discard or Cancel. Cancel keeps the selection and the editor as they were.
10. In the collapsed list the same clicks and keys work on the squares.
11. Dragging several rules: select B and C (or B and E with Ctrl+click) and drag one of them over the list. All selected rules are shown as being dragged, and a line shows where they will land. Drop them between D and E: they land together in their order (B, C, or B, E). Dropping them on one of the selected rules, or on themselves, does nothing and shows no line. The selection stays after the drop. Reload: the order stays.

### Main page: reordering the actions of a rule

Open a rule with three actions, for example Remove `a`, Replace (Parameter `^b$` renamed to `c`), and Remove `c`, and put a URL such as `https://example.com/?a=1&b=2` in "Try it".

1. Each action card has a drag handle (⋮⋮), Move up (↑), Move down (↓) and Delete (×) in its header. On the first card Move up is greyed out, and on the last card Move down is.
2. Press Move down on the first card: it goes to second place and the card keeps its fields. The focus stays on the Move down button of that card, now at its new place. The result in "Try it" changes at once, because actions run top to bottom. The row in the list shows the unsaved mark.
3. Move the last card up with its Move up button until it is first: when it reaches the end, the focus jumps to the other move button of that card, which is still enabled.
4. Ctrl+Alt+Up and Ctrl+Alt+Down with the focus in a field of a card move that card, and the focus and the text cursor stay in the same field. On the first card Ctrl+Alt+Up, and on the last Ctrl+Alt+Down, does nothing.
5. Drag a card by its handle over another: a line shows where it will land (above or below, by the half of the card you are over). Drop it: the cards are reordered. Dropping on the dragged card itself shows no line and changes nothing. Drag the whole card by a text field: nothing moves (only the handle drags).
6. Messages follow the card: give the card with the invalid regex an error, move it, and the red message and the outlined field are on the moved card, not on the card that took its place.
7. Revert brings the old order back; Save stores the new order, and after a reload the actions are in it.
