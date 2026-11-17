// Moves the rules from storage.local to storage.sync once, for people who had rules before they were kept in storage.sync.
// The local copy is left where it is. The logic is in core/migration.js; this connects it to the storage areas.

import { planMigration, mergeConfigs } from "../core/migration.js";

const LOCAL_KEYS = ["schemaVersion", "settings", "rules", "syncMigrated"];

/**
 * @param options.local the storage.local area
 * @param options.store a store over storage.sync, see store.js
 */
export function createMigrator({ local, store }) {
  let running = null;

  const markDone = () => local.set({ syncMigrated: true });

  async function runOnce() {
    const localRaw = await local.get(LOCAL_KEYS);
    const plan = planMigration({
      local: localRaw,
      sync: await store.loadStored(),
      done: localRaw.syncMigrated === true,
    });

    switch (plan.action) {
      case "mark":
        await markDone();
        return { status: "done" };

      case "copy":
        try {
          await store.writeConfig(plan.local);
        } catch (error) {
          return { status: "failed", error };
        }
        await markDone();
        return { status: "done" };

      case "ask":
        return { status: "ask", local: plan.local, sync: plan.sync };

      default:
        return { status: "done" };
    }
  }

  return {
    /**
     * Does what needs no answer. Returns { status: "done" }, { status: "failed", error } when the copy did not fit,
     * or { status: "ask", local, sync } when the user has to choose. The work is done once per migrator.
     */
    run() {
      running ??= runOnce();
      return running;
    },

    /** Applies the user's choice for a pending { local, sync }: "merge", "local" (this device's rules) or "sync". */
    async resolve(choice, pending) {
      if (choice === "merge") await store.writeConfig(mergeConfigs(pending.local, pending.sync));
      else if (choice === "local") await store.writeConfig(pending.local);
      else if (choice !== "sync") return { status: "ask", ...pending };

      await markDone();
      running = Promise.resolve({ status: "done" });
      return { status: "done" };
    },
  };
}
