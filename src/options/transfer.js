// Export and Import of the rules and the settings, without DOM or browser APIs.
// The file is the stored format of docs/storage.md: schemaVersion, and the settings and the rules, either of which may be left out.

import { newId, normalizeConfig, readConfig, validateRule, hasErrors } from "../core/schema.js";

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

/**
 * The file to download for the current config.
 * @param parts which parts to put in: { rules, settings }, both by default. At least one is needed.
 */
export function exportFile(config, { rules = true, settings = true } = {}) {
  if (!rules && !settings) throw new Error("Nothing to export");

  const normalized = normalizeConfig(config);
  const data = { schemaVersion: normalized.schemaVersion };
  if (settings) data.settings = normalized.settings;
  if (rules) data.rules = normalized.rules;

  const kind = rules && settings ? "" : rules ? "-rules" : "-settings";
  return {
    filename: `bookmark-peeler${kind}.json`,
    mime: "application/json",
    text: JSON.stringify(data, null, 2) + "\n",
  };
}

/**
 * Reads the text of a file chosen for import.
 * Returns { ok: true, rules, settings } with each part normalised like stored data (unknown fields dropped, rules with
 * errors kept), and null for a part the file does not have, or { ok: false, reason } where reason is
 *   "not-json"    the text is not JSON
 *   "not-config"  it is JSON but not a Bookmark Peeler file: no version, or neither rules nor settings
 *   "unsupported" the schema version is newer than this code knows (or not a version); `version` is returned too
 */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-json" };
  }

  const hasRules = isObject(data) && Array.isArray(data.rules);
  const hasSettings = isObject(data) && isObject(data.settings);
  if (!isObject(data) || data.schemaVersion === undefined || (!hasRules && !hasSettings)) {
    return { ok: false, reason: "not-config" };
  }

  const loaded = readConfig(data);
  if (loaded.status !== "ok") return { ok: false, reason: "unsupported", version: loaded.version };

  return {
    ok: true,
    rules: hasRules ? loaded.config.rules : null,
    settings: hasSettings ? loaded.config.settings : null,
  };
}

/**
 * What the import dialog tells the user: for the rules, how many, how many have errors and how many ids already exist
 * (null when the file has none), and whether the file has settings.
 */
export function summarizeImport(parsed, existingRules) {
  const taken = new Set(existingRules.map(rule => rule.id));

  return {
    rules: parsed.rules === null ? null : {
      total: parsed.rules.length,
      withErrors: parsed.rules.filter(rule => hasErrors(validateRule(rule))).length,
      clashes: parsed.rules.filter(rule => taken.has(rule.id)).length,
    },
    settings: parsed.settings !== null,
  };
}

/**
 * The config after an import.
 * @param choice.rules "add" (after the current ones), "replace" or "none"
 * @param choice.settings whether to replace the settings, all of them, the excluded sites included
 * A part the file does not have is never applied.
 */
export function applyImport(current, parsed, { rules, settings }) {
  return {
    ...current,
    rules: parsed.rules === null || rules === "none" ? current.rules
      : rules === "add" ? mergeImport(current.rules, parsed.rules)
      : parsed.rules,
    settings: parsed.settings !== null && settings ? parsed.settings : current.settings,
  };
}

/** The existing rules followed by the imported ones; an imported rule whose id is taken gets a new id. */
export function mergeImport(existingRules, importedRules) {
  const taken = new Set(existingRules.map(rule => rule.id));

  const added = importedRules.map(rule => {
    const unique = taken.has(rule.id) ? { ...rule, id: newId() } : rule;
    taken.add(unique.id);
    return unique;
  });

  return [...existingRules, ...added];
}
