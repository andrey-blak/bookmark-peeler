import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { validateRule } from "../../src/core/schema.js";
import { cleanUrl } from "../../src/core/engine.js";
import { PRESETS, presetDraft } from "../../src/options/presets.js";

const byId = id => PRESETS.find(preset => preset.id === id);

describe("PRESETS", () => {
  test("there are two: tracking parameters and YouTube share parameters", () => {
    assert.deepEqual(PRESETS.map(p => p.id), ["tracking", "youtube"]);
  });

  test("each has an id, a title and a description for the menu", () => {
    for (const preset of PRESETS) {
      assert.ok(preset.id && preset.title && preset.description, preset.id);
    }
  });

  test("ids are unique", () => {
    assert.equal(new Set(PRESETS.map(p => p.id)).size, PRESETS.length);
  });

  test("every preset is a valid rule, without warnings either", () => {
    for (const preset of PRESETS) {
      assert.deepEqual(validateRule(presetDraft(preset)), [], preset.id);
    }
  });
});

describe("presetDraft", () => {
  test("is an enabled, named rule with its own new id each time", () => {
    const first = presetDraft(byId("tracking"));
    const second = presetDraft(byId("tracking"));
    assert.equal(first.enabled, true);
    assert.equal(first.name, "Tracking parameters");
    assert.notEqual(first.id, second.id);
  });

  test("shares nothing with the preset or with other drafts", () => {
    const first = presetDraft(byId("youtube"));
    first.actions[0].parameter = "changed";
    first.scope.host = "changed.example";
    const second = presetDraft(byId("youtube"));
    assert.equal(second.actions[0].parameter, "si");
    assert.equal(second.scope.host, "youtube.com");
  });
});

describe("the tracking preset", () => {
  const rules = () => [presetDraft(byId("tracking"))];

  test("works on any site and removes the common tracking parameters", () => {
    const url = "https://example.com/p?a=1&utm_source=x&utm_medium=y&fbclid=1&gclid=2&dclid=3&msclkid=4&mc_cid=5&mc_eid=6&igshid=7&yclid=8&twclid=9&b=2";
    assert.equal(cleanUrl(url, rules()), "https://example.com/p?a=1&b=2");
  });

  test("leaves other parameters alone, including near matches", () => {
    const url = "https://example.com/p?utm=1&xutm_source=2&fbclid2=3&q=fbclid";
    assert.equal(cleanUrl(url, rules()), url);
  });
});

describe("the YouTube preset", () => {
  const rules = () => [presetDraft(byId("youtube"))];

  test("removes si, pp and feature on youtube.com and its subdomains", () => {
    assert.equal(
      cleanUrl("https://www.youtube.com/watch?v=KAq7MwkoFR8&si=abc&pp=ugUEEgJydQ%3D%3D&feature=share", rules()),
      "https://www.youtube.com/watch?v=KAq7MwkoFR8",
    );
    assert.equal(cleanUrl("https://youtube.com/watch?v=1&si=x", rules()), "https://youtube.com/watch?v=1");
  });

  test("does not touch other sites", () => {
    const url = "https://vimeo.com/1?si=x&pp=y&feature=z";
    assert.equal(cleanUrl(url, rules()), url);
  });
});
