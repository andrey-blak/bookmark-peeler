# Stored data

Everything the add-on keeps is in `storage.local`, under three top-level keys.
The code that reads, normalises and validates it is `src/core/schema.js`.
Types are JSON types; "default" is what normalisation fills in when the field is missing or has the wrong type.

## Top-level keys

| Key | Type | Default | Meaning |
|---|---|---|---|
| `schemaVersion` | integer ≥ 1 | `1` | Version of this format. |
| `settings` | object | see below | Global options. |
| `rules` | array of rule | `[]` | The rules, in the order they run. |

## `settings`

| Field | Type | Default | Meaning |
|---|---|---|---|
| `cleanOnEdit` | boolean | `false` | Also clean a bookmark when its URL is edited, not only when it is created. Not implemented yet (roadmap step 12). |

## Rule

| Field | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `id` | string | no | random UUID | Unique among rules. A missing, empty or duplicate id is replaced. |
| `enabled` | boolean | no | `true` | Only `false` switches the rule off. |
| `name` | string | no | none | Label shown in the UI. An empty or blank name is dropped. |
| `scope` | scope | yes | none | Which URLs the rule applies to. |
| `actions` | array of action | no | `[]` | What the rule does, in order. |

Rules run in list order and every matching rule applies; each sees the result of the previous one.

## Scope

| Field | Type | Required | Default | Meaning |
|---|---|---|---|---|
| `type` | `"all"` or `"host"` | yes | none | `all`: every site. `host`: one domain, optionally one path. |
| `host` | string | when `type` is `host` | none | Plain domain name such as `youtube.com`: no path, port, `@`, `*` or spaces. Case-insensitive; non-ASCII names are matched in their punycode form. |
| `subdomains` | boolean | no | `true` | Also match subdomains, so `youtube.com` matches `www.youtube.com`. Only `false` turns it off. |
| `path` | string | no | none (any path) | Path or path pattern, see below. Cannot contain `?` or `#`. |

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
| error | no or unknown scope `type`; missing or invalid `host`; `path` containing `?` or `#`; unknown action `type`; empty `parameter` in `remove`; `replace` with no non-empty `find`; invalid regular expression; non-text `find` or `replace` |
| warning | no actions; `replace` that replaces nothing (no pattern has `replace`); `replace` set on a pattern without `find` |

A rule with errors stays in storage so it can be fixed, but is not applied.
A rule with only warnings is applied.

## Example

```json
{
  "schemaVersion": 1,
  "settings": { "cleanOnEdit": false },
  "rules": [
    {
      "id": "0b9d6c0e-6a41-4c1e-8d52-3d3f4e0a7b11",
      "enabled": true,
      "name": "GitHub visibility",
      "scope": { "type": "host", "host": "github.com", "subdomains": true, "path": "/new" },
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

- Empty storage, or data without `schemaVersion`, gives the defaults.
- A `schemaVersion` newer than the code knows, or not a positive integer, is reported as unsupported and is never read or overwritten.
- Unknown fields are dropped, and invalid values are kept so that validation can report them.
