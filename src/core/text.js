// Looks up a text of the add-on in src/strings.js and fills in its values. No browser API here.
//
// A text is a string, or an object with the plural forms of the language: { one, other }.
// {name} in a text is replaced by the value of the same name; for a plural, the value "count" picks the form.

import { STRINGS } from "../strings.js";

const LANGUAGE = "en";
const plurals = new Intl.PluralRules(LANGUAGE);

/** The text for a key. An unknown key is returned as it is, so that a missing text is visible and nothing breaks. */
export function t(key, values = {}) {
  const entry = STRINGS[key];
  if (entry === undefined) return key;

  const text = typeof entry === "string" ? entry : (entry[plurals.select(values.count)] ?? entry.other);
  return text.replace(/\{(\w+)\}/g, (placeholder, name) => (name in values ? typeof values[name] === "number" ? values[name].toLocaleString() : String(values[name]) : placeholder));
}
