// Excluded sites: domains where the add-on does nothing, whatever the rules say. No browser API here.
// An entry is a plain domain name, written the same way as a rule's domain, and it covers the subdomains too.

import { normalizeHost } from "./scope.js";
import { t } from "./text.js";

// Whether a URL is on one of the sites is decided in scope.js, which a rule's exceptions use too.
export { isExcluded } from "./scope.js";

const isText = value => typeof value === "string";

/**
 * What is wrong with the entries of a list: [{ index, entry, message }] for the ones that are not a plain domain.
 * Blank entries are not reported, since they are ignored.
 */
export function siteIssues(sites) {
  if (!Array.isArray(sites)) return [];

  const issues = [];
  sites.forEach((entry, index) => {
    const text = isText(entry) ? entry.trim() : null;
    if (text === "") return;

    if (text !== null && text.includes("*")) {
      issues.push({ index, entry: text, message: t("site.wildcard") });
    } else if (text === null || normalizeHost(text) === null) {
      issues.push({ index, entry: text ?? String(entry), message: t("site.invalid") });
    }
  });

  return issues;
}

/**
 * The entries that repeat an earlier one: [{ index, entry, message }].
 * Entries are compared as domains, so case, spaces and the punycode form do not hide a repeat.
 * Blank and bad entries are not repeats, and a subdomain of a listed domain is not either.
 */
export function siteDuplicates(sites) {
  if (!Array.isArray(sites)) return [];

  const seen = new Set();
  const duplicates = [];
  sites.forEach((entry, index) => {
    const text = isText(entry) ? entry.trim() : "";
    const host = normalizeHost(text);
    if (host === null) return;

    if (seen.has(host)) duplicates.push({ index, entry: text, message: t("site.duplicate") });
    seen.add(host);
  });

  return duplicates;
}

/** The entries of a list that are plain domains, in order. */
export function validSites(sites) {
  const bad = new Set(siteIssues(sites).map(issue => issue.index));
  return sites.filter((_, index) => !bad.has(index));
}

/** The text of a text box, one site per line, as a list: trimmed, blank lines dropped. */
export function parseSites(text) {
  return text.split(/\r?\n/).map(line => line.trim()).filter(line => line !== "");
}

/** A list as the text of a text box, one site per line. */
export function sitesText(sites) {
  return sites.join("\n");
}
