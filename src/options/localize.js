// Fills in the texts of index.html from src/strings.js.
// An element names its text in the attribute data-text; its title and aria-label are named in data-title and data-aria-label.

import { t } from "../core/text.js";

const ATTRIBUTES = { title: "title", ariaLabel: "aria-label" };

export function localizePage(root = document) {
  for (const node of root.querySelectorAll("[data-text]")) node.textContent = t(node.dataset.text);

  for (const [name, attribute] of Object.entries(ATTRIBUTES)) {
    for (const node of root.querySelectorAll(`[data-${attribute}]`)) node.setAttribute(attribute, t(node.dataset[name]));
  }
}
