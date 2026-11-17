// Import and export of the rules, without DOM or browser APIs.
// The file is the stored format of docs/storage.md: schemaVersion, settings and rules.

import { normalizeConfig, readConfig, validateRule, hasErrors } from "../core/schema.js";

/** The file to download for the current config. */
export function exportFile(config) {
  return {
    filename: "bookmark-peeler-rules.json",
    mime: "application/json",
    text: JSON.stringify(normalizeConfig(config), null, 2) + "\n",
  };
}

/**
 * Reads the text of a file chosen for import.
 * Returns { ok: true, config } with the config normalised like stored data (unknown fields dropped, rules with
 * errors kept), or { ok: false, reason } where reason is
 *   "not-json"    the text is not JSON
 *   "not-config"  it is JSON but not a rules file
 *   "unsupported" the schema version is newer than this code knows (or not a version); `version` is returned too
 */
export function parseImport(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "not-json" };
  }

  const isConfig = data !== null && typeof data === "object" && !Array.isArray(data)
    && data.schemaVersion !== undefined && Array.isArray(data.rules);
  if (!isConfig) return { ok: false, reason: "not-config" };

  const loaded = readConfig(data);
  if (loaded.status !== "ok") return { ok: false, reason: "unsupported", version: loaded.version };

  return { ok: true, config: loaded.config };
}

/** What the import dialog tells the user: how many rules, how many have errors, how many ids already exist. */
export function summarizeImport(imported, existingRules) {
  const taken = new Set(existingRules.map(rule => rule.id));

  return {
    total: imported.rules.length,
    withErrors: imported.rules.filter(rule => hasErrors(validateRule(rule))).length,
    clashes: imported.rules.filter(rule => taken.has(rule.id)).length,
  };
}

/** The existing rules followed by the imported ones; an imported rule whose id is taken gets a new id. */
export function mergeImport(existingRules, importedRules) {
  const taken = new Set(existingRules.map(rule => rule.id));

  const added = importedRules.map(rule => {
    const unique = taken.has(rule.id) ? { ...rule, id: crypto.randomUUID() } : rule;
    taken.add(unique.id);
    return unique;
  });

  return [...existingRules, ...added];
}
