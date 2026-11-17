# Roadmap

What is still to do, all of it optional.

1. Empty state on first run: a short invitation with an Add rule button, and the presets.
1. Sync rules between devices with `storage.sync`.
   - The extension cannot switch Firefox Sync on or off; the user needs "Add-ons" ticked in the Sync settings.
   - Limits: 100 KiB in total, 8 KiB per item, 512 items, so store one key per rule.
   - On conflict the server's value wins per key, so changes from `onChanged` have to be merged.
1. Keep only the specified parameters (an allowlist), removing all the others.
1. Settings for the keyboard shortcuts (now Ctrl+Up, Ctrl+Down, Delete, Ctrl+Z, Ctrl+S, `[`, Alt+Up, Alt+Down) and for how long Undo stays available, in seconds (now 8).
1. Proper icons for delete and add.
1. Choose folders for the bulk clean of existing bookmarks (now: all bookmarks).
