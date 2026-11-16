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
- Only newly created bookmarks are cleaned at first. Later: optional cleaning on edit. Import and sync are not separate options: `bookmarks.onCreated` also fires for them, to be confirmed by testing.
- Options page opens in its own tab (toolbar button and the add-ons manager). Two-column layout: rule list and rule editor, the list should be collapsible so regex editing has room. System colours and fonts, no custom theme.

## Steps

0. Skeleton: layout, build script, local Node, test runner, docs. (done)
1. Raw query parser with byte-preserving round trip. (done)
2. Scope matching: all, domain, domain + path or path pattern. (done)
3. Remove-parameter action. (done)
4. Regex replace action (name and value). (done)
5. `cleanUrl` engine: rule order, several rules per URL. (done)
6. Storage schema, validation, migration of the prototype format.
7. Background wiring on `bookmarks.onCreated`.
8. Options: rule list (enable, delete, reorder), toolbar button opens the page.
9. Options: rule editor.
10. Options: live URL tester.
11. Import / export, presets.
12. Option to clean edited bookmarks; optional bulk clean of existing bookmarks and undo.
