// The rules and settings in storage.sync. The storage area is passed in, so this can be unit-tested.
//
// storage.sync is the only place the rules live. It works like storage.local when Firefox Sync is off,
// and the rules reach other devices when "Add-ons" is selected in Firefox Sync settings.

import { assemble, toItems, diffItems, checkLimits } from "../core/sync-layout.js";
import { readConfig } from "../core/schema.js";

/**
 * Why a write was refused. `code` is "rule-too-large" (with `ruleId`), "too-large", "too-many",
 * or "unsupported" when the stored data comes from a newer version.
 */
export class StoreError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "StoreError";
    this.code = code;
    Object.assign(this, details);
  }
}

export function createStore(area) {
  return {
    /** What is stored, as { schemaVersion, settings, rules } for readConfig. */
    async loadStored() {
      return assemble(await area.get(null));
    },

    /**
     * Stores a config. Only what changed is written.
     * Deleted rules are removed before the order is rewritten, so a failure part-way cannot bring a deleted rule back.
     * A config that does not fit, or that would overwrite data from a newer version, is refused before anything is written.
     */
    async writeConfig(config) {
      const current = await area.get(null);
      if (readConfig(assemble(current)).status !== "ok") throw new StoreError("unsupported");

      const next = toItems(config);
      const check = checkLimits(next);
      if (!check.ok) throw new StoreError(check.reason, { ruleId: check.ruleId });

      const { set, remove } = diffItems(current, next);
      if (remove.length > 0) await area.remove(remove);
      if (Object.keys(set).length > 0) await area.set(set);
    },
  };
}
