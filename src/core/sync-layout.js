// How the rules are laid out in storage.sync, without any browser API.
// The format is described in docs/storage.md.
//
// Every rule is its own item, "rule:<id>", so a change to one rule never overwrites another when devices sync.
// An "order" item lists the ids, and "schemaVersion" and "settings" are items too.
// When items come back from another device, the order can be out of date.
// Reading it is therefore forgiving: rules missing from the order are added at the end, and ids without a rule are dropped.

const RULE_PREFIX = "rule:";

/** The limits of storage.sync in Firefox. Sizes are the length of the key plus the length of the JSON of the value. */
export const LIMITS = { totalBytes: 102_400, itemBytes: 8_192, items: 512 };

const isObject = value => value !== null && typeof value === "object" && !Array.isArray(value);

/** The items to store for a config, { schemaVersion, settings, rules }. */
export function toItems(config) {
  const items = {
    schemaVersion: config.schemaVersion,
    settings: config.settings,
    order: config.rules.map(rule => rule.id),
  };
  for (const rule of config.rules) items[RULE_PREFIX + rule.id] = rule;
  return items;
}

/**
 * The stored items put back together as { schemaVersion, settings, rules }, the shape that readConfig reads.
 * Nothing stored, or no schema version, gives {}, which reads as the defaults.
 */
export function assemble(items) {
  if (!isObject(items) || items.schemaVersion === undefined) return {};

  const byId = new Map();
  for (const key of Object.keys(items).sort()) {
    const value = items[key];
    if (!key.startsWith(RULE_PREFIX) || !isObject(value)) continue;

    const id = key.slice(RULE_PREFIX.length);
    byId.set(id, { ...value, id: typeof value.id === "string" && value.id !== "" ? value.id : id });
  }

  const order = Array.isArray(items.order) ? items.order : [];
  const ids = [...new Set(order.filter(id => byId.has(id)))];
  for (const id of byId.keys()) if (!ids.includes(id)) ids.push(id);

  return { schemaVersion: items.schemaVersion, settings: items.settings, rules: ids.map(id => byId.get(id)) };
}

/** What to write to go from the current items to the next ones: { set, remove }. Items that are not rules are never removed. */
export function diffItems(current, next) {
  const before = current ?? {};
  const set = {};

  for (const [key, value] of Object.entries(next)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(value)) set[key] = value;
  }

  const remove = Object.keys(before).filter(key => key.startsWith(RULE_PREFIX) && !(key in next));
  return { set, remove };
}

const sizeOf = (key, value) => key.length + JSON.stringify(value).length;

/**
 * Whether the items fit in storage.sync: { ok: true }, or { ok: false, reason } where reason is
 *   "rule-too-large"  one rule is over the size of an item (ruleId says which)
 *   "too-many"        more items than allowed, or an order list too long for one item, so too many rules
 *   "too-large"       the total is too large
 */
export function checkLimits(items) {
  const keys = Object.keys(items);
  if (keys.length > LIMITS.items) return { ok: false, reason: "too-many" };

  let total = 0;
  for (const key of keys) {
    const size = sizeOf(key, items[key]);

    if (size > LIMITS.itemBytes) {
      if (key.startsWith(RULE_PREFIX)) return { ok: false, reason: "rule-too-large", ruleId: key.slice(RULE_PREFIX.length) };
      return { ok: false, reason: key === "order" ? "too-many" : "too-large" };
    }
    total += size;
  }

  return total > LIMITS.totalBytes ? { ok: false, reason: "too-large" } : { ok: true };
}
