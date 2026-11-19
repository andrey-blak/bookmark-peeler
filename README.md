# Bookmark Peeler

A Firefox add-on that removes or rewrites URL parameters when a bookmark is saved, using rules you configure.

## Features

- Cleans a bookmark's URL when the bookmark is created, and optionally when edited.
- Rules apply to all sites, to a domain (subdomains optional), or to a domain and path, with a list of excluded sites per rule.
- A rule has one or more actions: remove parameters, replace parameter names or values, or keep only the parameters you list.
- "Try it" in the rule editor shows what a rule does to a URL and lists every change, before you save.
- Presets for common cases, such as tracking parameters and YouTube share links.
- Option to clean existing bookmarks.
- Excluded sites that are never touched, whatever the rules say.
- Export and import of settings and rules.
- Settings sync between your Firefox devices. Rules stay on the device.

## Usage

1. Open the add-on's page from the toolbar button or the add-ons manager.
1. Add a rule, or pick one under Presets.
1. Choose where it applies, add actions, and check the result with "Try it".
1. Save the rule.
1. Bookmark a page. Its URL is cleaned as it is saved.

Settings allow to:
* configure excluded sites;
* clean bookmarks when their URL is edited;
* clean existing bookmarks.

## Documentation

[docs/decisions.md](docs/decisions.md) for the decisions,  
[docs/roadmap.md](docs/roadmap.md) for what is still planned,  
[docs/development.md](docs/development.md) for setup and packaging,  
[docs/tests.md](docs/tests.md) for the automated and manual tests.
