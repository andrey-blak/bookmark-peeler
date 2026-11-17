// Moving the rules from storage.local, where earlier versions kept them, to storage.sync. No browser API here.
// What to do depends on what is on each side; only different rules on both sides need the user's answer.

import { readConfig } from "./schema.js";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/**
 * @param local the raw data of storage.local
 * @param sync the raw data of storage.sync, assembled as { schemaVersion, settings, rules }
 * @param done whether the migration has been done already
 * Returns { action }, where action is
 *   "none"  nothing to do (done already, or a side has data from a newer version, which is left alone)
 *   "mark"  nothing to copy: no rules here, or the same rules on both sides
 *   "copy"  rules here and none synced: copy them (with local and sync, the normalised configs)
 *   "ask"   different rules on both sides: ask the user (with local and sync)
 */
export function planMigration({ local, sync, done }) {
  if (done) return { action: "none" };

  const localRead = readConfig(local);
  const syncRead = readConfig(sync);
  if (localRead.status !== "ok" || syncRead.status !== "ok") return { action: "none" };

  const { config: localConfig } = localRead;
  const { config: syncConfig } = syncRead;

  if (localConfig.rules.length === 0) return { action: "mark" };
  if (syncConfig.rules.length === 0) return { action: "copy", local: localConfig, sync: syncConfig };
  if (same(localConfig.rules, syncConfig.rules)) return { action: "mark" };

  return { action: "ask", local: localConfig, sync: syncConfig };
}

/**
 * Both sets of rules: the synced rules first, in their order, then the ones that only exist here.
 * A rule on both sides comes from the synced side, and so do the settings.
 */
export function mergeConfigs(local, sync) {
  const synced = new Set(sync.rules.map(rule => rule.id));

  return {
    schemaVersion: sync.schemaVersion,
    settings: sync.settings,
    rules: [...sync.rules, ...local.rules.filter(rule => !synced.has(rule.id))],
  };
}
