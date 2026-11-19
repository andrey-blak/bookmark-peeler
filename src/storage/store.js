// The settings in storage.sync and the rules in storage.local. The two storage areas are passed in, so this can be unit-tested.
//
// The settings follow the user between devices when "Add-ons" is selected in Firefox Sync settings, and sync works like local without it.
// The rules stay on the device, so they are not limited by the size of storage.sync.

import { readConfig } from "../core/schema.js";

/** The size of one item of storage.sync in Firefox, in bytes: the length of the key plus the length of the JSON of the value. */
const SYNC_ITEM_BYTES = 8_192;

/**
 * Why a write was refused. `code` is "settings-too-large" (the settings do not fit in one item of storage.sync),
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

// A schema version is "known" when it is missing or a supported number. Of two versions, an unknown one wins, so it is reported.
const pickVersion = (a, b) => {
  const isKnown = version => version === undefined || version === 1;
  if (!isKnown(a)) return a;
  if (!isKnown(b)) return b;
  return a ?? b;
};

function assemble(syncItems, localItems) {
  const schemaVersion = pickVersion(syncItems.schemaVersion, localItems.schemaVersion);
  if (schemaVersion === undefined) return {};
  return { schemaVersion, settings: syncItems.settings, rules: localItems.rules };
}

// Compared field by field: the order of the keys in what storage returns is not guaranteed.
const same = (stored, next) => Object.keys(next).every(key => JSON.stringify(stored[key]) === JSON.stringify(next[key]));

/**
 * @param areas.sync the storage.sync area, for the settings
 * @param areas.local the storage.local area, for the rules
 */
export function createStore({ sync, local }) {
  const readItems = async () => ({
    syncItems: await sync.get(["schemaVersion", "settings"]),
    localItems: await local.get(["schemaVersion", "rules"]),
  });

  return {
    /** What is stored, as { schemaVersion, settings, rules } for readConfig. */
    async loadStored() {
      const { syncItems, localItems } = await readItems();
      return assemble(syncItems, localItems);
    },

    /**
     * Stores a config. Only what changed is written, each part to its own area.
     * Settings that do not fit, or a write over data from a newer version, are refused before anything is written.
     */
    async writeConfig(config) {
      const { syncItems, localItems } = await readItems();
      if (readConfig(assemble(syncItems, localItems)).status !== "ok") throw new StoreError("unsupported");

      const settingsItem = { schemaVersion: config.schemaVersion, settings: config.settings };
      if ("settings".length + JSON.stringify(config.settings).length > SYNC_ITEM_BYTES) throw new StoreError("settings-too-large");

      const rulesItem = { schemaVersion: config.schemaVersion, rules: config.rules };

      if (!same(syncItems, settingsItem)) await sync.set(settingsItem);
      if (!same(localItems, rulesItem)) await local.set(rulesItem);
    },
  };
}
