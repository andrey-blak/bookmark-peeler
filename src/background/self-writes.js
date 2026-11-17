// Remembers the addresses this add-on has just written to bookmarks.
//
// Writing an address makes Firefox fire an edit event for the bookmark, which looks like an edit by the user.
// The edit handler asks here first, and ignores the event when it is the add-on's own write.
// Without this a rule that changes its own output (a replacement like a -> aa) would be applied again and again.
// A record is used up by the first matching event and expires after a few seconds.

export function createSelfWrites({ ttlMs = 10_000, now = () => Date.now() } = {}) {
  const entries = new Map(); // bookmark id -> { url, at }; only the latest write of a bookmark counts

  return {
    add(id, url) {
      entries.set(id, { url, at: now() });
    },

    /** True when this change of the bookmark's address is the add-on's own write. */
    consume(id, url) {
      const entry = entries.get(id);
      if (!entry) return false;

      entries.delete(id);
      return entry.url === url && now() - entry.at <= ttlMs;
    },
  };
}
