import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const srcDir = new URL("../../src/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", srcDir), "utf8"));

test("manifest is Manifest V3 with the agreed add-on id", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(
    manifest.browser_specific_settings.gecko.id,
    "bookmark-peeler@andrey.blak"
  );
});

test("manifest requires Firefox 112+ (ES modules in background)", () => {
  const min = manifest.browser_specific_settings.gecko.strict_min_version;
  assert.ok(parseInt(min, 10) >= 112, `strict_min_version is ${min}`);
});

test("manifest has the basic required keys", () => {
  for (const key of ["name", "version", "description"]) {
    assert.ok(manifest[key], `missing ${key}`);
  }
});

test("the add-on asks for the bookmarks and storage permissions and nothing else", () => {
  assert.deepEqual([...manifest.permissions].sort(), ["bookmarks", "storage"]);
});

test("the background page is an ES module script that exists", () => {
  assert.equal(manifest.background.type, "module");
  assert.ok(manifest.background.scripts.length > 0);
  for (const path of manifest.background.scripts) {
    assert.ok(existsSync(new URL(path, srcDir)), `missing background script ${path}`);
  }
});

test("the options page opens in its own tab and exists", () => {
  assert.equal(manifest.options_ui.open_in_tab, true);
  assert.ok(existsSync(new URL(manifest.options_ui.page, srcDir)), `missing ${manifest.options_ui.page}`);
});

test("the toolbar button exists and has no popup, so a click can open the options page", () => {
  assert.ok(manifest.action, "missing action");
  assert.equal(manifest.action.default_popup, undefined);
});

test("every icon referenced by the manifest exists", () => {
  for (const path of Object.values(manifest.icons ?? {})) {
    assert.ok(existsSync(new URL(path, srcDir)), `missing icon ${path}`);
  }
});
