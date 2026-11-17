// Ready-made rules offered in the Presets menu. Choosing one opens it as a new unsaved rule, to review and save.

import { normalizeRule } from "../core/schema.js";

const remove = parameter => ({ type: "remove", parameter });

export const PRESETS = [
  {
    id: "tracking",
    title: "Tracking parameters",
    description: "All sites: utm_*, fbclid, gclid, msclkid …",
    rule: {
      name: "Tracking parameters",
      scope: { type: "all" },
      actions: [
        "utm_*", "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid", "yclid", "twclid",
      ].map(remove),
    },
  },
  {
    id: "youtube",
    title: "YouTube share parameters",
    description: "youtube.com: si, pp, feature",
    rule: {
      name: "YouTube share parameters",
      scope: { type: "host", host: "youtube.com" },
      actions: ["si", "pp", "feature"].map(remove),
    },
  },
];

/** A new rule from a preset: enabled, with its own id, sharing nothing with the preset. */
export function presetDraft(preset) {
  return normalizeRule({ ...structuredClone(preset.rule), id: undefined });
}
