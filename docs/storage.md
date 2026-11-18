# Stored data

Everything the add-on keeps is in `storage.sync`, as a few kinds of items.
The code that lays them out is `src/core/sync-layout.js`, and the code that reads, normalises and validates a config is `src/core/schema.js`.
Types are JSON types; "default" is what normalisation fills in when the field is missing or has the wrong type.

## Items in storage.sync

| Item | Value | Meaning |
|---|---|---|
| `schemaVersion` | integer ≥ 1 | Version of this format. |
| `settings` | object | Global options, see below. |
| `order` | array of string | The ids of the rules, in the order they run. |
| `rule:<id>` | rule | One item per rule, so a change to one rule never overwrites another when devices sync. |

The rest of this page describes a config, `{ schemaVersion, settings, rules }`: what the add-on works with after reading the items, and what the export file holds.

| Key | Type | Default | Meaning |
|---|---|---|---|
| `schemaVersion` | integer ≥ 1 | `1` | Version of this format. |
| `settings` | object | see below | Global options. |
| `rules` | array of rule | `[]` | The rules, in the order they run. |

## `settings`

| Field | Type | Default | Meaning |
|---|---|---|---|
| `cleanOnEdit` | boolean | `false` | Also clean a bookmark when its URL is edited, not only when it is created. |
| `excludedSites` | array of string | `[]` | Domains where the add-on does nothing. An entry is a plain domain name, written like a rule's domain (no path, port, `*` or spaces), and covers its subdomains. Entries are trimmed and blank ones are dropped. An entry that is not a plain domain is dropped when the settings are read, and the Settings page leaves it out when it saves the list. |

## Rule

| Field | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `id` | string | no | random UUID | Unique among rules. A missing, empty or duplicate id is replaced. |
| `enabled` | boolean | no | `true` | Only `false` switches the rule off. |
| `name` | string | no | none | Label shown in the UI. An empty or blank name is dropped, and a name longer than 64 characters is cut to 64 when the rule is read. |
| `scope` | scope | yes | none | Which URLs the rule applies to. |
| `actions` | array of action | no | `[]` | What the rule does, in order. |

Rules run in list order and every matching rule applies; each sees the result of the previous one.

## Scope

| Field | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `type` | `"all"` or `"host"` | yes | none | `all`: every site. `host`: one domain, optionally one path. |
| `host` | string | when `type` is `host` | none | Plain domain name such as `example.com`: no path, port, `@`, `*` or spaces. Case-insensitive; non-ASCII names are matched in their punycode form. |
| `subdomains` | boolean | no | `true` | Also match subdomains, so `example.com` matches `www.example.com`. Only `false` turns it off. |
| `path` | string | no | none (any path) | Path or path pattern, see below. Cannot contain `?` or `#`. |
| `except` | array of string | no | none | Domains where the rule does nothing, on every scope type. An entry is a plain domain name, written like `host` (no path, port, `*` or spaces), and covers its subdomains. Entries are trimmed, and blank ones are dropped; an empty list is left out. |

`host` and `subdomains` and `path` are used only when `type` is `host`.

### Path matching

- Without wildcards the path must match exactly.
- `*` matches any characters except `/`.
- `**` matches any characters including `/`.
- `/a/**` does not match `/a` itself.
- A trailing slash is ignored on both sides, and the leading slash of the pattern is optional.
- Matching is case-sensitive and runs on the percent-decoded path.
- The port, query and fragment are never part of the match.

## Action

Every action has a `type`.

### `remove`

| Field | Type | Required | Meaning |
|---|---|---|---|
| `type` | `"remove"` | yes | |
| `parameter` | string | yes, not empty | Parameter name. A plain name matches exactly; `*` matches any characters. Case-sensitive, compared with the decoded name. |

### `keep`

An allowlist: removes every parameter that is not on the list.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `type` | `"keep"` | yes | |
| `parameters` | array of string | yes, with at least one name | Parameter names to keep. A plain name matches exactly; `*` matches any characters. Case-sensitive, compared with the decoded name. Spaces around a name are trimmed and blank entries are dropped. |

- A part of the query without a name, as in a stray `&&`, is not on the list, so it is dropped.
- Without any name the action is an error, so a rule is never applied as "remove everything" by mistake. To remove all parameters use `remove` with `*`.
- Actions after a `keep` work on the parameters that are left.

### `replace`

| Field | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `type` | `"replace"` | yes | | |
| `parameter` | pattern | no | none | Condition on, and optional replacement in, the parameter name. |
| `value` | pattern | no | none | The same for the parameter value. |
| `ignoreCase` | boolean | no | `false` | Make the regular expressions case-insensitive. Only `true` turns it on. |

At least one of `parameter` and `value` needs a non-empty `find`.

### Pattern (`parameter` and `value` of `replace`)

| Field | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `find` | string | no | `""` | JavaScript regular expression, run on the decoded parameter name or value. It is not anchored, so use `^` and `$` for an exact match. Empty means no condition. |
| `replace` | string | no | none | Replacement text for every match, with the `String.replace` patterns (`$1`, `$<name>`, `$&`, `` $` ``, `$'`, `$$`). Without `replace` the pattern only filters. An empty string deletes the matched text. |

### How `replace` works

- A parameter is changed only when every non-empty `find` matches. An empty or missing `parameter` pattern therefore means any parameter.
- A parameter without a value (`fbclid`) never matches a value pattern.
- The parameter name and the value are each replaced from their original text, not from each other's result. For independent parameter name and value replacements use two actions.
- A rename that would give an empty name is ignored.
- A changed parameter name or value is re-encoded; everything else in the URL keeps its original bytes.
- An invalid regular expression disables the whole action.

## Validation

`validateRule` returns issues, each with `path` (array, for example `["actions", 1, "value", "find"]`), `severity` (`"error"` or `"warning"`) and `message`.

| Severity | Cases |
|---|---|
| error | no or unknown scope `type`; missing or invalid `host`; `path` containing `?` or `#`; an entry of `except` that is not a plain domain, or an `except` that is not a list; unknown action `type`; empty `parameter` in `remove`; no parameter names, or a name that is not text, in `keep`; `replace` with no non-empty `find`; invalid regular expression; non-text `find` or `replace` |
| warning | no actions; `replace` that replaces nothing (no pattern has `replace`); `replace` set on a pattern without `find` |

A rule with errors stays in storage so it can be fixed, but is not applied.
A rule with only warnings is applied.

## Example of a config

```json
{
  "schemaVersion": 1,
  "settings": { "cleanOnEdit": false, "excludedSites": ["example.org"] },
  "rules": [
    {
      "id": "0b9d6c0e-6a41-4c1e-8d52-3d3f4e0a7b11",
      "enabled": true,
      "name": "Example visibility",
      "scope": { "type": "host", "host": "example.com", "subdomains": true, "path": "/new" },
      "actions": [
        { "type": "remove", "parameter": "utm_*" },
        {
          "type": "replace",
          "parameter": { "find": "^visibility$" },
          "value": { "find": "^public$", "replace": "private" },
          "ignoreCase": false
        }
      ]
    }
  ]
}
```

## Loading

- The `rule:<id>` items become the rules, in the order of the `order` item. A rule missing from the order is added at the end, in the order of its key. An id in the order without a rule, and an id listed twice, are dropped. This makes a list that another device changed at the same time readable.
- Empty storage, or data without `schemaVersion`, gives the defaults.
- A `schemaVersion` newer than the code knows, or not a positive integer, is reported as unsupported and is never read or overwritten.
- Unknown fields are dropped, and invalid values are kept so that validation can report them.

## Writing

Only the items that changed are written. Deleted rules are removed before the order is rewritten.
A write that would break a limit of `storage.sync` is refused before anything is written. The size of an item is the length of its key plus the length of the JSON of its value.

| Limit | Value | Refused as |
|---|---|---|
| One item | 8 KiB (8192 bytes) | a rule that is too large; for the `order` item, too many rules |
| All items together | 100 KiB (102400 bytes) | too large in total |
| Number of items | 512 | too many rules |

## Moving from storage.local

Earlier versions kept the rules in `storage.local`, as `schemaVersion`, `settings` and `rules`. They are moved to `storage.sync` once, and the local copy is left where it is. A flag `syncMigrated` in `storage.local` marks it done.

## Export file

Export writes the same three keys as above (`schemaVersion`, `settings`, `rules`) as indented JSON, to `bookmark-peeler-rules.json`.
Import reads a file the way storage is loaded, and refuses a file that is not JSON, has no `schemaVersion` or `rules`, or has an unsupported `schemaVersion`.
