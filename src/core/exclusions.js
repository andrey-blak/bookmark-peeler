// Excluded sites: domains where the add-on does nothing, whatever the rules say. No browser API here.
// An entry is a plain domain name, written the same way as a rule's domain, and it covers the subdomains too.

import { hostMatches, normalizeHost } from "./scope.js";

const isText = value => typeof value === "string";

// The entries that can be used, trimmed. Entries that are not a plain domain match nothing.
const usable = sites => (Array.isArray(sites) ? sites : []).filter(isText).map(entry => entry.trim()).filter(entry => entry !== "");

/** Whether the URL is on one of the excluded sites, or on a subdomain of one. */
export function isExcluded(url, sites) {
  let hostname;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return false;
  }

  return usable(sites).some(entry => hostMatches(entry, true, hostname));
}

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
      issues.push({ index, entry: text, message: "Wildcards aren't supported. Subdomains are included automatically." });
    } else if (text === null || normalizeHost(text) === null) {
      issues.push({ index, entry: text ?? String(entry), message: "Enter just the domain, without a path, port or spaces." });
    }
  });

  return issues;
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
