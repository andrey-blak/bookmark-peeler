import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  SCHEMA_VERSION,
  NAME_MAX,
  defaultConfig,
  normalizeRule,
  normalizeConfig,
  readConfig,
  validateRule,
  hasErrors,
  usableRules,
} from "../../src/core/schema.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const goodRule = () => ({
  id: "r1",
  enabled: true,
  name: "Example visibility",
  scope: { type: "host", host: "example.com", subdomains: true, path: "/new" },
  actions: [
    { type: "remove", parameter: "utm_*" },
    {
      type: "replace",
      parameter: { find: "^visibility$" },
      value: { find: "^public$", replace: "private" },
      ignoreCase: false,
    },
  ],
});

const find = (issues, path) => issues.find(i => i.path.join(".") === path);

describe("defaultConfig", () => {
  test("is an empty, versioned config with cleanOnEdit off", () => {
    assert.deepEqual(defaultConfig(), {
      schemaVersion: SCHEMA_VERSION,
      settings: { cleanOnEdit: false, excludedSites: [] },
      rules: [],
    });
  });

  test("returns a fresh object each time", () => {
    assert.notEqual(defaultConfig(), defaultConfig());
    assert.notEqual(defaultConfig().rules, defaultConfig().rules);
  });
});

describe("normalizeRule", () => {
  test("keeps a good rule as it is", () => {
    assert.deepEqual(normalizeRule(goodRule()), goodRule());
  });

  test("fills in defaults", () => {
    const rule = normalizeRule({ scope: { type: "host", host: "a.example" }, actions: [] });
    assert.match(rule.id, UUID);
    assert.equal(rule.enabled, true);
    assert.equal(rule.scope.subdomains, true);
    assert.equal("name" in rule, false);
    assert.equal("path" in rule.scope, false);
  });

  test("only enabled: false switches a rule off", () => {
    assert.equal(normalizeRule({ enabled: false }).enabled, false);
    assert.equal(normalizeRule({ enabled: 0 }).enabled, true);
    assert.equal(normalizeRule({}).enabled, true);
  });

  test("an empty name is dropped, a real one is kept", () => {
    assert.equal("name" in normalizeRule({ name: "  " }), false);
    assert.equal(normalizeRule({ name: "Example" }).name, "Example");
    assert.equal("name" in normalizeRule({ name: 5 }), false);
  });

  test("an empty path is dropped, the host is trimmed", () => {
    const { scope } = normalizeRule({ scope: { type: "host", host: " a.example ", path: "" } });
    assert.equal(scope.host, "a.example");
    assert.equal("path" in scope, false);
  });

  test("subdomains: false is kept, anything else means true", () => {
    assert.equal(normalizeRule({ scope: { type: "host", host: "a.example", subdomains: false } }).scope.subdomains, false);
    assert.equal(normalizeRule({ scope: { type: "host", host: "a.example", subdomains: "no" } }).scope.subdomains, true);
  });

  test("unknown fields are dropped everywhere", () => {
    const rule = normalizeRule({
      ...goodRule(),
      extra: 1,
      scope: { type: "all", host: "ignored.example", extra: 1 },
      actions: [{ type: "remove", parameter: "a", extra: 1 }],
    });
    assert.equal("extra" in rule, false);
    assert.deepEqual(rule.scope, { type: "all" });
    assert.deepEqual(rule.actions, [{ type: "remove", parameter: "a" }]);
  });

  test("a replace action gets ignoreCase false and keeps only the parts it has", () => {
    const { actions } = normalizeRule({
      actions: [{ type: "replace", value: { find: "x", replace: "y" } }],
    });
    assert.deepEqual(actions, [{ type: "replace", value: { find: "x", replace: "y" }, ignoreCase: false }]);
  });

  test("a part without replace stays a filter; an empty replace is kept", () => {
    const { actions } = normalizeRule({
      actions: [{ type: "replace", parameter: { find: "a" }, value: { find: "b", replace: "" } }],
    });
    assert.equal("replace" in actions[0].parameter, false);
    assert.equal(actions[0].value.replace, "");
  });

  test("garbage does not throw and does not turn into something valid", () => {
    for (const raw of [undefined, null, 5, "x", [], { scope: 5, actions: 5 }, { actions: [null, 5, "x", {}] }]) {
      const rule = normalizeRule(raw);
      assert.equal(hasErrors(validateRule(rule)), true, JSON.stringify(raw));
    }
  });

  test("is idempotent", () => {
    const once = normalizeRule({ scope: { type: "host", host: "a.example" }, actions: [{ type: "remove", parameter: "x" }] });
    assert.deepEqual(normalizeRule(once), once);
  });
});

describe("rule names are at most NAME_MAX characters", () => {
  test("the limit is 64", () => {
    assert.equal(NAME_MAX, 64);
  });

  test("a name of exactly the limit is kept", () => {
    const name = "x".repeat(NAME_MAX);
    assert.equal(normalizeRule({ name }).name, name);
  });

  test("a longer name is cut to the limit", () => {
    const rule = normalizeRule({ name: "x".repeat(NAME_MAX + 50) });
    assert.equal(rule.name, "x".repeat(NAME_MAX));
  });

  test("a name is trimmed first, then cut, and the cut does not leave a space at the end", () => {
    assert.equal(normalizeRule({ name: `   ${"x".repeat(NAME_MAX)}   ` }).name, "x".repeat(NAME_MAX));
    assert.equal(normalizeRule({ name: `${"x".repeat(NAME_MAX - 1)} yyy` }).name, "x".repeat(NAME_MAX - 1));
  });

  test("characters outside the basic alphabet are counted as one and never split", () => {
    const rule = normalizeRule({ name: "😀".repeat(NAME_MAX + 10) });
    assert.equal(Array.from(rule.name).length, NAME_MAX);
    assert.equal(rule.name, "😀".repeat(NAME_MAX));
  });

  test("loading cuts the names of stored or imported rules", () => {
    const { rules } = normalizeConfig({ rules: [{ id: "a", name: "n".repeat(500) }, { id: "b", name: "short" }] });
    assert.equal(rules[0].name.length, NAME_MAX);
    assert.equal(rules[1].name, "short");
  });

  test("normalising again changes nothing", () => {
    const once = normalizeRule({ name: "x".repeat(200) });
    assert.deepEqual(normalizeRule(once), once);
  });
});

describe("keep actions", () => {
  const withKeep = parameters => ({ scope: { type: "all" }, actions: [{ type: "keep", parameters }] });

  test("normalising keeps the list, trimmed, without blank entries", () => {
    const { actions } = normalizeRule(withKeep([" v ", "", "  ", "t", "utm_*"]));
    assert.deepEqual(actions, [{ type: "keep", parameters: ["v", "t", "utm_*"] }]);
  });

  test("entries that are not text are dropped, and a list that is not a list is empty", () => {
    assert.deepEqual(normalizeRule(withKeep([1, null, "a", {}])).actions[0].parameters, ["a"]);
    assert.deepEqual(normalizeRule(withKeep("a")).actions[0].parameters, []);
    assert.deepEqual(normalizeRule({ actions: [{ type: "keep" }] }).actions[0].parameters, []);
  });

  test("a valid list has no issues", () => {
    assert.deepEqual(validateRule(withKeep(["v", "t"])), []);
  });

  test("an empty list, a list of blanks, and a missing list are errors on the list", () => {
    for (const parameters of [[], ["", "  "], undefined, "a"]) {
      const issues = validateRule(withKeep(parameters));
      assert.equal(find(issues, "actions.0.parameters")?.severity, "error", JSON.stringify(parameters));
      assert.match(find(issues, "actions.0.parameters").message, /at least one parameter/i);
    }
  });

  test("an entry that is not text is an error", () => {
    assert.equal(find(validateRule(withKeep(["a", 5])), "actions.0.parameters")?.severity, "error");
  });

  test("blank lines among real entries are fine", () => {
    assert.deepEqual(validateRule(withKeep(["a", "", "  ", "b"])), []);
  });
});

describe("normalizeConfig", () => {
  test("always carries the current schema version", () => {
    assert.equal(normalizeConfig({ schemaVersion: 99 }).schemaVersion, SCHEMA_VERSION);
  });

  test("keeps good settings and rules", () => {
    const config = { schemaVersion: SCHEMA_VERSION, settings: { cleanOnEdit: true, excludedSites: [] }, rules: [goodRule()] };
    assert.deepEqual(normalizeConfig(config), config);
  });

  test("settings default to off and unknown settings are dropped", () => {
    assert.deepEqual(normalizeConfig({ settings: { cleanOnEdit: "yes", other: 1 } }).settings, { cleanOnEdit: false, excludedSites: [] });
    assert.deepEqual(normalizeConfig({}).settings, { cleanOnEdit: false, excludedSites: [] });
  });

  test("rules that are not objects are dropped, and a missing list is empty", () => {
    assert.deepEqual(normalizeConfig({ rules: [null, 5, "x"] }).rules, []);
    assert.deepEqual(normalizeConfig({ rules: "nope" }).rules, []);
    assert.deepEqual(normalizeConfig(undefined).rules, []);
  });

  test("duplicate rule ids get new ones", () => {
    const { rules } = normalizeConfig({ rules: [goodRule(), goodRule()] });
    assert.equal(rules[0].id, "r1");
    assert.notEqual(rules[1].id, "r1");
    assert.match(rules[1].id, UUID);
  });

  test("is idempotent", () => {
    const once = normalizeConfig({ rules: [goodRule(), { scope: { type: "all" }, actions: [] }] });
    assert.deepEqual(normalizeConfig(once), once);
  });

  test("survives a JSON round trip", () => {
    const config = normalizeConfig({ rules: [goodRule()] });
    assert.deepEqual(JSON.parse(JSON.stringify(config)), config);
  });
});

describe("readConfig", () => {
  test("empty storage gives the defaults", () => {
    for (const stored of [undefined, null, {}]) {
      assert.deepEqual(readConfig(stored), { status: "ok", config: defaultConfig() });
    }
  });

  test("reads a stored config", () => {
    const stored = { schemaVersion: 1, settings: { cleanOnEdit: true, excludedSites: [] }, rules: [goodRule()] };
    assert.deepEqual(readConfig(stored), { status: "ok", config: stored });
  });

  test("data without a schema version is treated as a fresh install", () => {
    assert.deepEqual(readConfig({ rules: [goodRule()] }).config, defaultConfig());
  });

  test("a newer schema version is reported and not read", () => {
    assert.deepEqual(readConfig({ schemaVersion: SCHEMA_VERSION + 1, rules: [goodRule()] }), {
      status: "unsupported",
      version: SCHEMA_VERSION + 1,
    });
  });

  test("an invalid schema version is reported and not read", () => {
    for (const version of ["1", 0, -1, 1.5, NaN, null, {}]) {
      const result = readConfig({ schemaVersion: version });
      assert.equal(result.status, "unsupported", String(version));
    }
  });
});

describe("validateRule: scope", () => {
  test("a good rule has no issues", () => {
    assert.deepEqual(validateRule(goodRule()), []);
  });

  test("all sites needs nothing else", () => {
    assert.deepEqual(validateRule({ scope: { type: "all" }, actions: [{ type: "remove", parameter: "a" }] }), []);
  });

  test("the scope type must be known", () => {
    const rule = { ...goodRule(), scope: { type: "regex" } };
    assert.equal(find(validateRule(rule), "scope.type").severity, "error");
    assert.equal(find(validateRule({ ...goodRule(), scope: undefined }), "scope.type").severity, "error");
  });

  test("a domain is required", () => {
    const rule = { ...goodRule(), scope: { type: "host", host: "" } };
    assert.equal(find(validateRule(rule), "scope.host").severity, "error");
  });

  test("a domain must be a plain host name", () => {
    for (const host of ["example.com/video", "example.com:8080", "exam ple.com", "a@b.example", "a.example?x=1", "a.example#x"]) {
      const rule = { ...goodRule(), scope: { type: "host", host } };
      assert.equal(find(validateRule(rule), "scope.host")?.severity, "error", host);
    }
  });

  test("good domains pass, including IP addresses, localhost and non-ASCII names", () => {
    for (const host of ["example.com", "WWW.Example.org", "127.0.0.1", "localhost", "пример.example"]) {
      const rule = { ...goodRule(), scope: { type: "host", host } };
      assert.equal(find(validateRule(rule), "scope.host"), undefined, host);
    }
  });

  test("wildcards in the domain are rejected, with a message that points to the Subdomains option", () => {
    for (const host of ["*.example.com", "example.*", "*"]) {
      const rule = { ...goodRule(), scope: { type: "host", host } };
      const issue = find(validateRule(rule), "scope.host");
      assert.equal(issue?.severity, "error", host);
      assert.match(issue.message, /wildcard/i);
      assert.match(issue.message, /subdomains/i);
    }
  });

  test("a path cannot contain ? or #", () => {
    for (const path of ["/a?b=1", "/a#b"]) {
      const rule = { ...goodRule(), scope: { type: "host", host: "a.example", path } };
      assert.equal(find(validateRule(rule), "scope.path").severity, "error", path);
    }
  });

  test("paths with wildcards and without a leading slash are fine", () => {
    for (const path of ["/a/*", "/a/**", "video", "/"]) {
      const rule = { ...goodRule(), scope: { type: "host", host: "a.example", path } };
      assert.equal(find(validateRule(rule), "scope.path"), undefined, path);
    }
  });
});

describe("validateRule: actions", () => {
  const withAction = action => ({ scope: { type: "all" }, actions: [action] });

  test("a rule with no actions only gets a warning", () => {
    const issues = validateRule({ scope: { type: "all" }, actions: [] });
    assert.equal(find(issues, "actions").severity, "warning");
    assert.equal(hasErrors(issues), false);
  });

  test("an action type must be known", () => {
    assert.equal(find(validateRule(withAction({ type: "explode" })), "actions.0.type").severity, "error");
    assert.equal(find(validateRule(withAction({})), "actions.0.type").severity, "error");
    assert.equal(find(validateRule(withAction(null)), "actions.0.type").severity, "error");
  });

  test("remove needs a parameter name", () => {
    assert.equal(find(validateRule(withAction({ type: "remove", parameter: "" })), "actions.0.parameter").severity, "error");
    assert.equal(find(validateRule(withAction({ type: "remove" })), "actions.0.parameter").severity, "error");
    assert.deepEqual(validateRule(withAction({ type: "remove", parameter: "utm_*" })), []);
  });

  test("replace needs a name or value pattern", () => {
    const issues = validateRule(withAction({ type: "replace" }));
    assert.equal(find(issues, "actions.0").severity, "error");
    assert.equal(find(validateRule(withAction({ type: "replace", parameter: { find: "" }, value: { find: "" } })), "actions.0").severity, "error");
  });

  test("an invalid regex is an error on that field and names the problem", () => {
    const parameter = validateRule(withAction({ type: "replace", parameter: { find: "[", replace: "x" } }));
    const value = validateRule(withAction({ type: "replace", value: { find: "(", replace: "x" } }));
    assert.equal(find(parameter, "actions.0.parameter.find").severity, "error");
    assert.equal(find(value, "actions.0.value.find").severity, "error");
    assert.match(find(value, "actions.0.value.find").message, /regular expression/i);
  });

  test("patterns that only filter, with nothing to replace, give a warning", () => {
    const issues = validateRule(withAction({ type: "replace", parameter: { find: "^a$" }, value: { find: "^1$" } }));
    assert.equal(find(issues, "actions.0").severity, "warning");
    assert.equal(hasErrors(issues), false);
  });

  test("a replacement without a pattern gives a warning on that pattern", () => {
    const issues = validateRule(withAction({
      type: "replace",
      parameter: { find: "", replace: "x" },
      value: { find: "^1$", replace: "2" },
    }));
    assert.equal(find(issues, "actions.0.parameter.find").severity, "warning");
    assert.equal(hasErrors(issues), false);
  });

  test("a good replace action has no issues", () => {
    assert.deepEqual(validateRule(withAction({ type: "replace", value: { find: "^a$", replace: "" } })), []);
  });

  test("issues carry a message", () => {
    const issues = validateRule({ scope: { type: "host", host: "" }, actions: [{ type: "remove", parameter: "" }] });
    assert.equal(issues.length, 2);
    for (const issue of issues) assert.ok(issue.message.length > 0);
  });

  test("every action is checked, not only the first", () => {
    const issues = validateRule({
      scope: { type: "all" },
      actions: [{ type: "remove", parameter: "a" }, { type: "remove", parameter: "" }, { type: "explode" }],
    });
    assert.ok(find(issues, "actions.1.parameter"));
    assert.ok(find(issues, "actions.2.type"));
  });
});

describe("usableRules", () => {
  test("keeps rules without errors, including ones with only warnings", () => {
    const warned = { id: "w", scope: { type: "all" }, actions: [] };
    assert.deepEqual(usableRules([goodRule(), warned]).map(r => r.id), ["r1", "w"]);
  });

  test("drops every rule that has an error", () => {
    const broken = { ...goodRule(), id: "bad", scope: { type: "host", host: "" } };
    assert.deepEqual(usableRules([broken, goodRule()]).map(r => r.id), ["r1"]);
  });

  test("keeps disabled rules (the engine skips them)", () => {
    assert.equal(usableRules([{ ...goodRule(), enabled: false }]).length, 1);
  });

  test("anything that is not a list gives an empty list", () => {
    assert.deepEqual(usableRules(undefined), []);
  });
});

describe("the settings: excluded sites", () => {
  test("the default is an empty list, next to cleanOnEdit", () => {
    assert.deepEqual(defaultConfig().settings, { cleanOnEdit: false, excludedSites: [] });
    assert.deepEqual(normalizeConfig({}).settings, { cleanOnEdit: false, excludedSites: [] });
  });

  test("the list is kept, trimmed, without blank entries", () => {
    const { settings } = normalizeConfig({ settings: { excludedSites: [" example.com ", "", "  ", "example.org"] } });
    assert.deepEqual(settings.excludedSites, ["example.com", "example.org"]);
  });

  test("entries that are not text are dropped, and anything but a list is an empty list", () => {
    assert.deepEqual(normalizeConfig({ settings: { excludedSites: [1, null, "example.com", {}] } }).settings.excludedSites, ["example.com"]);
    assert.deepEqual(normalizeConfig({ settings: { excludedSites: "example.com" } }).settings.excludedSites, []);
    assert.deepEqual(normalizeConfig({ settings: { excludedSites: null } }).settings.excludedSites, []);
  });

  test("an entry that is not a plain domain is dropped, and the valid ones stay", () => {
    const { settings } = normalizeConfig({ settings: { excludedSites: ["*.example.com", "example.com/path", "example.com:8080", "a b.com", "example.org"] } });
    assert.deepEqual(settings.excludedSites, ["example.org"]);
  });

  test("reads back from storage with the list", () => {
    const stored = { schemaVersion: 1, settings: { cleanOnEdit: true, excludedSites: ["example.com"] }, rules: [] };
    assert.deepEqual(readConfig(stored).config.settings, { cleanOnEdit: true, excludedSites: ["example.com"] });
  });

  test("normalising again changes nothing", () => {
    const once = normalizeConfig({ settings: { excludedSites: [" a.example ", "", "b.example"] } });
    assert.deepEqual(normalizeConfig(once), once);
  });
});
