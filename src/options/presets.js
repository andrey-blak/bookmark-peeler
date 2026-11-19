// Ready-made rules offered in the Presets menu. Choosing one opens it as a new unsaved rule, to review and save.

import { normalizeRule } from "../core/schema.js";
import { t } from "../core/text.js";

const remove = parameter => ({ type: "remove", parameter });

export const PRESETS = [
  {
    id: "tracking",
    title: t("preset.tracking.title"),
    description: t("preset.tracking.description"),
    rule: {
      name: t("preset.tracking.title"),
      scope: { type: "all" },
      actions: [
        "utm_*", "fbclid", "gclid", "dclid", "msclkid", "mc_cid", "mc_eid", "igshid", "yclid", "twclid",
      ].map(remove),
    },
  },
  {
    id: "youtube",
    title: t("preset.youtube.title"),
    description: t("preset.youtube.description"),
    rule: {
      name: t("preset.youtube.title"),
      scope: { type: "host", host: "youtube.com" },
      actions: ["si", "pp", "feature"].map(remove),
    },
  },
];

/** A new rule from a preset: enabled, with its own id, sharing nothing with the preset. */
export function presetDraft(preset) {
  return normalizeRule({ ...structuredClone(preset.rule), id: undefined });
}
