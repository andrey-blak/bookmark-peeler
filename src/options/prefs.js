// Small preferences of the page, kept per browser in localStorage: the last tested URL, the tester mode,
// whether the rule list is collapsed. Storage can be unavailable or blocked, so every access is guarded.

const PREFIX = "bookmark-peeler.";

export function getPref(key, fallback) {
  try {
    const stored = localStorage.getItem(PREFIX + key);
    return stored === null ? fallback : JSON.parse(stored);
  } catch {
    return fallback;
  }
}

export function setPref(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // The preference is simply not remembered.
  }
}
