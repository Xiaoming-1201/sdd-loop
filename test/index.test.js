// Unit tests for the pure functions exported from index.js.
// Zero external dependencies: node:test + node:assert/strict only.

import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  deepMerge,
  configCandidates,
  loadConfig,
  buildFallbackChains,
  parseModelRef,
  isFallbackError,
  resolvePreset,
  getAgentModel,
  getAgentVariant,
  getAgentDisplayName,
  parseStatusFile,
  validateStatusFile,
} from "../index.js";

// ---------------------------------------------------------------------------
// deepMerge
// ---------------------------------------------------------------------------

test("deepMerge: merges flat objects, override wins on same key", () => {
  assert.deepEqual(deepMerge({ a: 1, b: 2 }, { b: 3, c: 4 }), { a: 1, b: 3, c: 4 });
});

test("deepMerge: recursively merges nested objects", () => {
  assert.deepEqual(
    deepMerge({ a: { x: 1, y: 2 }, b: 1 }, { a: { y: 9, z: 3 } }),
    { a: { x: 1, y: 9, z: 3 }, b: 1 }
  );
});

test("deepMerge: nested object in override replaces scalar base value", () => {
  assert.deepEqual(deepMerge({ a: 1 }, { a: { b: 2 } }), { a: { b: 2 } });
});

test("deepMerge: arrays are treated as opaque and replace wholesale", () => {
  assert.deepEqual(deepMerge({ a: [1, 2], b: "keep" }, { a: [3] }), { a: [3], b: "keep" });
});

test("deepMerge: array/primitive/falsy override returns override (or base)", () => {
  assert.deepEqual(deepMerge({}, [1, 2]), [1, 2]);
  assert.deepEqual(deepMerge({ a: 1 }, 42), 42);
  assert.deepEqual(deepMerge({ a: 1 }, null), { a: 1 });
  assert.deepEqual(deepMerge({ a: 1 }, undefined), { a: 1 });
});

test("deepMerge: does not mutate base", () => {
  const base = { a: { x: 1 } };
  const out = deepMerge(base, { a: { y: 2 } });
  assert.deepEqual(base, { a: { x: 1 } });
  assert.deepEqual(out, { a: { x: 1, y: 2 } });
});

// ---------------------------------------------------------------------------
// parseModelRef
// ---------------------------------------------------------------------------

test("parseModelRef: parses provider/model", () => {
  assert.deepEqual(parseModelRef("openai/gpt-4o"), { providerID: "openai", modelID: "gpt-4o" });
});

test("parseModelRef: keeps remaining slashes in modelID", () => {
  assert.deepEqual(parseModelRef("a/b/c"), { providerID: "a", modelID: "b/c" });
});

test("parseModelRef: rejects malformed input", () => {
  assert.equal(parseModelRef("nomodel"), null); // no slash
  assert.equal(parseModelRef("/model"), null); // slash at start
  assert.equal(parseModelRef("provider/"), null); // slash at end
  assert.equal(parseModelRef(""), null);
  assert.equal(parseModelRef(123), null); // non-string
  assert.equal(parseModelRef(null), null);
});

// ---------------------------------------------------------------------------
// isFallbackError
// ---------------------------------------------------------------------------

test("isFallbackError: triggers on known error signatures", () => {
  assert.equal(isFallbackError("rate limit exceeded"), true);
  assert.equal(isFallbackError("HTTP 429 Too Many Requests"), true);
  assert.equal(isFallbackError("token quota is not enough"), true);
  assert.equal(isFallbackError("error 401 unauthorized"), true);
  assert.equal(isFallbackError("403 forbidden"), true);
  assert.equal(isFallbackError("reasoning_content failure"), true);
});

test("isFallbackError: inspects error object message/data fields", () => {
  assert.equal(isFallbackError({ message: "ok", data: { message: "rate limit" } }), true);
  assert.equal(isFallbackError({ message: "ok", data: { responseBody: "HTTP 403" } }), true);
  assert.equal(isFallbackError({ message: "429" }), true);
});

test("isFallbackError: returns false for normal errors and empty input", () => {
  assert.equal(isFallbackError("normal processing error"), false);
  assert.equal(isFallbackError({ message: "just a bug" }), false);
  assert.equal(isFallbackError(null), false);
  assert.equal(isFallbackError(undefined), false);
});

// ---------------------------------------------------------------------------
// resolvePreset
// ---------------------------------------------------------------------------

test("resolvePreset: resolves active preset", () => {
  const preset = { "sdd-loop": { model: "x/y" } };
  assert.deepEqual(resolvePreset({ preset: "p", presets: { p: preset } }), {
    active: "p",
    preset,
  });
});

test("resolvePreset: degrades to empty preset when active is missing", () => {
  assert.deepEqual(resolvePreset({ preset: "nope", presets: { p: {} } }), {
    active: "nope",
    preset: {},
  });
  assert.deepEqual(resolvePreset({ preset: "p" }), { active: "p", preset: {} });
  assert.deepEqual(resolvePreset({}), { active: undefined, preset: {} });
});

// ---------------------------------------------------------------------------
// getAgentModel / getAgentVariant / getAgentDisplayName
// ---------------------------------------------------------------------------

test("getAgentModel: resolves string, first-of-array, and object-with-id models", () => {
  assert.equal(getAgentModel("a", { a: { model: "prov/m" } }), "prov/m");
  assert.equal(getAgentModel("a", { a: { model: ["prov/m1", "prov/m2"] } }), "prov/m1");
  assert.equal(getAgentModel("a", { a: { model: [{ id: "prov/obj" }, { id: "x/y" }] } }), "prov/obj");
});

test("getAgentModel: returns undefined for missing/empty/non-string", () => {
  assert.equal(getAgentModel("a", {}), undefined);
  assert.equal(getAgentModel("nope", { a: { model: "prov/m" } }), undefined);
  assert.equal(getAgentModel("a", { a: {} }), undefined);
  assert.equal(getAgentModel("a", { a: { model: [] } }), undefined);
  assert.equal(getAgentModel("a", { a: { model: 123 } }), undefined);
});

test("getAgentVariant: returns string variant only", () => {
  assert.equal(getAgentVariant("a", { a: { variant: "high" } }), "high");
  assert.equal(getAgentVariant("a", { a: {} }), undefined);
  assert.equal(getAgentVariant("a", {}), undefined);
  assert.equal(getAgentVariant("a", { a: { variant: 42 } }), undefined);
});

test("getAgentDisplayName: returns string displayName only", () => {
  assert.equal(getAgentDisplayName("a", { a: { displayName: "Primary" } }), "Primary");
  assert.equal(getAgentDisplayName("a", { a: {} }), undefined);
  assert.equal(getAgentDisplayName("a", {}), undefined);
});

// ---------------------------------------------------------------------------
// buildFallbackChains
// ---------------------------------------------------------------------------

test("buildFallbackChains: builds deterministic chains (same-provider then cross-provider)", () => {
  const config = {
    preset: "p",
    presets: {
      p: {
        a: { model: "prov/m1" },
        b: { model: "prov/m2" },
        c: { model: "other/x" },
      },
    },
  };
  const chains = buildFallbackChains(config);
  assert.deepEqual(chains["a"], ["prov/m1", "prov/m2", "other/x"]);
  assert.deepEqual(chains["b"], ["prov/m2", "prov/m1", "other/x"]);
  assert.deepEqual(chains["c"], ["other/x", "prov/m1", "prov/m2"]);
});

test("buildFallbackChains: sdd-loop registers orchestrator alias", () => {
  const config = {
    preset: "p",
    presets: { p: { "sdd-loop": { model: "prov/m1" }, b: { model: "prov/m2" } } },
  };
  const chains = buildFallbackChains(config);
  assert.ok(chains["sdd-loop"]);
  assert.deepEqual(chains["orchestrator"], chains["sdd-loop"]);
});

test("buildFallbackChains: handles array/object model shapes", () => {
  const config = {
    preset: "p",
    presets: { p: { a: { model: [{ id: "prov/m1" }] }, b: { model: ["prov/m2"] } } },
  };
  const chains = buildFallbackChains(config);
  assert.deepEqual(chains["a"], ["prov/m1", "prov/m2"]);
  assert.deepEqual(chains["b"], ["prov/m2", "prov/m1"]);
});

test("buildFallbackChains: empty/missing preset yields no chains", () => {
  assert.deepEqual(buildFallbackChains({}), {});
  assert.deepEqual(buildFallbackChains({ preset: "p" }), {});
  assert.deepEqual(buildFallbackChains({ preset: "p", presets: { p: { a: {} } } }), {});
});

test("buildFallbackChains: chains contain no duplicate models", () => {
  const config = {
    preset: "p",
    presets: {
      p: {
        a: { model: "prov/m1" },
        b: { model: "prov/m1" },
        c: { model: "prov/m2" },
      },
    },
  };
  const chains = buildFallbackChains(config);
  assert.equal(new Set(chains["a"]).size, chains["a"].length);
});

// ---------------------------------------------------------------------------
// configCandidates
// ---------------------------------------------------------------------------

test("configCandidates: respects OPENCODE_CONFIG_DIR override", () => {
  const prev = process.env.OPENCODE_CONFIG_DIR;
  try {
    process.env.OPENCODE_CONFIG_DIR = "C:/custom/config";
    const list = configCandidates();
    assert.equal(list[0], join("C:/custom/config", "sdd-loop.json"));
  } finally {
    if (prev === undefined) delete process.env.OPENCODE_CONFIG_DIR;
    else process.env.OPENCODE_CONFIG_DIR = prev;
  }
});

test("configCandidates: default candidates include home, project and plugin dir", () => {
  const prev = process.env.OPENCODE_CONFIG_DIR;
  try {
    delete process.env.OPENCODE_CONFIG_DIR;
    const list = configCandidates();
    // Without env override: home + project + plugin dir.
    assert.equal(list.length, 3);
    assert.ok(list.some((p) => p.includes(join(".config", "opencode"))));
    assert.ok(list.includes(join(process.cwd(), ".opencode", "sdd-loop.json")));
    // Last candidate is always the plugin-dir default.
    assert.ok(list[list.length - 1].endsWith("sdd-loop.json"));
  } finally {
    if (prev !== undefined) process.env.OPENCODE_CONFIG_DIR = prev;
  }
});

// ---------------------------------------------------------------------------
// loadConfig (real plugin sdd-loop.json)
// ---------------------------------------------------------------------------

test("loadConfig: loads real plugin config with preset structure", () => {
  const { configPath, config } = loadConfig();
  assert.ok(configPath === null || typeof configPath === "string");
  assert.equal(typeof config, "object");
  assert.equal(config.preset, "volcengine");
  assert.ok(config.presets && config.presets.volcengine);
  assert.equal(
    config.presets.volcengine["sdd-loop"].model,
    "volcengine-plan/deepseek-v4-pro"
  );
  assert.ok(config.presets.deepseek);
  assert.equal(
    config.presets.deepseek["sdd-loop"].model,
    "deepseek-official/deepseek-v4-pro"
  );
});

test("loadConfig + buildFallbackChains integration: plugin default produces sdd-loop chain", () => {
  const { config } = loadConfig();
  const chains = buildFallbackChains(config);
  assert.equal(chains["sdd-loop"][0], "volcengine-plan/deepseek-v4-pro");
  assert.ok(chains["sdd-loop"].length > 1, "expected fallback alternatives");
  assert.equal(new Set(chains["sdd-loop"]).size, chains["sdd-loop"].length);
});

// ---------------------------------------------------------------------------
// parseStatusFile / validateStatusFile (temp files)
// ---------------------------------------------------------------------------

function withStatusFile(content, fn) {
  const dir = mkdtempSync(join(tmpdir(), "sdd-loop-test-"));
  const path = join(dir, "STATUS.md");
  writeFileSync(path, content, "utf8");
  try {
    return fn(path);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const VALID_STATUS = `# Active
<!-- comment block -->
- [in-progress] task one (current focus)
- [blocked] task two

## Completed
- done one
- done two
`;

test("parseStatusFile: parses active/completed sections and ignores comments", () => {
  withStatusFile(VALID_STATUS, (path) => {
    const res = parseStatusFile(path);
    assert.equal(res.foundActive, true);
    assert.equal(res.foundCompleted, true);
    assert.deepEqual(res.entries.active, [
      "- [in-progress] task one (current focus)",
      "- [blocked] task two",
    ]);
    assert.deepEqual(res.entries.completed, ["- done one", "- done two"]);
  });
});

test("parseStatusFile: handles missing sections and unrelated headings", () => {
  withStatusFile("# Other\n- [in-progress] stray", (path) => {
    const res = parseStatusFile(path);
    assert.equal(res.foundActive, false);
    assert.equal(res.foundCompleted, false);
    assert.deepEqual(res.entries, { active: [], completed: [] });
  });
});

test("parseStatusFile: unrelated headings do not reset the current section", () => {
  const content = "# Active\n- [in-progress] a\n# Completed\n- done\n# Notes\n- [in-progress] not captured";
  withStatusFile(content, (path) => {
    const res = parseStatusFile(path);
    assert.deepEqual(res.entries.active, ["- [in-progress] a"]);
    // Section only switches on Active/Completed headings; other headings keep
    // the current section, so this line is captured under completed.
    assert.deepEqual(res.entries.completed, ["- done", "- [in-progress] not captured"]);
  });
});

test("validateStatusFile: valid file with matching focus", () => {
  withStatusFile(VALID_STATUS, (path) => {
    const res = validateStatusFile(path, "task one");
    assert.equal(res.valid, true);
    assert.deepEqual(res.issues, []);
    assert.deepEqual(res.activeTasks, ["[in-progress] task one (current focus)", "[blocked] task two"]);
    assert.deepEqual(res.completedTasks, ["done one", "done two"]);
  });
});

test("validateStatusFile: missing file reports 缺失", () => {
  const res = validateStatusFile(join(tmpdir(), "definitely-not-here.md"), undefined);
  assert.equal(res.valid, false);
  assert.deepEqual(res.issues, ["STATUS.md 缺失"]);
  assert.deepEqual(res.activeTasks, []);
  assert.deepEqual(res.completedTasks, []);
});

test("validateStatusFile: flags missing sections", () => {
  withStatusFile("# Active\n- [in-progress] a", (path) => {
    const res = validateStatusFile(path, undefined);
    assert.equal(res.valid, false);
    assert.ok(res.issues.includes("缺少 Active 分区") === false);
    assert.ok(res.issues.includes("缺少 Completed 分区"));
  });
});

test("validateStatusFile: flags invalid status values and missing markers", () => {
  const content = "# Active\n- [done] weird status\n- task without marker\n# Completed\n- done";
  withStatusFile(content, (path) => {
    const res = validateStatusFile(path, undefined);
    assert.equal(res.valid, false);
    assert.ok(res.issues.some((i) => i.startsWith("非法状态值: [done]")));
    assert.ok(res.issues.some((i) => i.startsWith("Active 条目缺少状态标记")));
  });
});

test("validateStatusFile: flags duplicate current focus", () => {
  const content = "# Active\n- [in-progress] a (current focus)\n- [in-progress] b (current focus)\n# Completed\n- done";
  withStatusFile(content, (path) => {
    const res = validateStatusFile(path, undefined);
    assert.ok(res.issues.some((i) => /2 个 current focus 条目/.test(i)));
  });
});

test("validateStatusFile: expectedFocus mismatch is reported", () => {
  withStatusFile(VALID_STATUS, (path) => {
    const res = validateStatusFile(path, "different-task");
    assert.equal(res.valid, false);
    assert.ok(res.issues.some((i) => i.includes("expectedFocus")));
  });
});

test("validateStatusFile: expectedFocus missing entirely is reported", () => {
  const content = "# Active\n- [in-progress] a\n# Completed\n- done";
  withStatusFile(content, (path) => {
    const res = validateStatusFile(path, "some-focus");
    assert.ok(res.issues.some((i) => /无 current focus 条目/.test(i)));
  });
});
