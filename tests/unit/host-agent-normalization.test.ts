import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, test } from "node:test";

// The executable is intentionally JavaScript so the host orchestrator can run
// it directly after GSD updates. Keep this fixture contract typed locally.
// @ts-expect-error executable .mjs has no generated declaration file
import { CANONICAL_EFFORT, CANONICAL_MAX_DEPTH, CANONICAL_MODEL, READ_ONLY_ROLES, SANDBOX_PARTITION, WORKSPACE_WRITE_ROLES, applyHost, checkHost } from "../../scripts/workflow/normalize-gsd-host.mjs";

type NormalizerError = { code: string };
type NormalizerResult = { ok: boolean; changedPaths: string[]; errors: NormalizerError[] };
const typedCheckHost = checkHost as (options: Record<string, string>) => Promise<NormalizerResult>;
const typedApplyHost = applyHost as (options: Record<string, string>) => Promise<NormalizerResult>;
const typedWriteRoles = WORKSPACE_WRITE_ROLES as readonly string[];
const typedReadOnlyRoles = READ_ONLY_ROLES as readonly string[];
const typedPartition = SANDBOX_PARTITION as Record<"workspace-write" | "read-only", readonly string[]>;

type Fixture = {
  root: string;
  options: Record<string, string>;
  paths: Record<string, string>;
  cleanup: () => void;
};

const globalRoles = [...typedWriteRoles, ...typedReadOnlyRoles.filter((role: string) => !role.startsWith("closeout-"))];
const closeoutRoles = typedReadOnlyRoles.filter((role: string) => role.startsWith("closeout-"));

function digest(filePath: string) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function tomlAgent(role: string, sandbox: string, model = CANONICAL_MODEL, effort = CANONICAL_EFFORT) {
  return [
    `name = "${role}"`,
    `description = "fixture ${role}"`,
    `sandbox_mode = "${sandbox}"`,
    `model = "${model}"`,
    `model_reasoning_effort = "${effort}"`,
    "developer_instructions = '''",
    `You are ${role}. Preserve this fixture instruction and its workspace-write report path.`,
    "'''",
    "",
  ].join("\n");
}

function policyText(codexHome: string, stale = true) {
  const workflowPath = stale ? "gsd-core/workflows/" : `${codexHome}/gsd-core/workflows/`;
  const agentsPath = stale ? "agents/" : `${codexHome}/agents/`;
  const toolsPath = stale ? "gsd-core/bin/gsd-tools.cjs" : `${codexHome}/gsd-core/bin/gsd-tools.cjs`;
  return [
    "<!-- fixture global policy -->",
    "# GSD Core",
    `- Workflows live in \`${workflowPath}\`.`,
    `- Agents live in \`${agentsPath}\`.`,
    `- Tools are at \`${toolsPath}\`.`,
    "- Preserve unrelated policy prose.",
    "",
  ].join("\n");
}

function createFixture({
  wrong = true,
  managedDrift = false,
  missingRole = false,
  extraRole = false,
  emptyPolicy = false,
}: {
  wrong?: boolean;
  managedDrift?: boolean;
  missingRole?: boolean;
  extraRole?: boolean;
  emptyPolicy?: boolean;
} = {}): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nutrition-gsd-host-normalizer-"));
  const codexHome = path.join(root, "codex");
  const agentsHome = path.join(root, "agents");
  const projectRoot = path.join(root, "project");
  const defaultsPath = path.join(root, ".gsd", "defaults.json");
  const globalAgentsDir = path.join(codexHome, "agents");
  const repoAgentsDir = path.join(projectRoot, ".codex", "agents");
  const planningDir = path.join(projectRoot, ".planning");
  const skillsRoot = path.join(agentsHome, "skills");
  fs.mkdirSync(globalAgentsDir, { recursive: true });
  fs.mkdirSync(repoAgentsDir, { recursive: true });
  fs.mkdirSync(planningDir, { recursive: true });
  fs.mkdirSync(path.join(skillsRoot, "gsd-fixture"), { recursive: true });
  fs.mkdirSync(path.dirname(defaultsPath), { recursive: true });

  const globalConfig = [
    'approval_policy = "on-request"',
    'sandbox_mode = "workspace-write"',
    "",
    "[agents]",
    `max_depth = ${wrong ? 1 : CANONICAL_MAX_DEPTH}`,
    "",
    "[mcp_servers.fixture]",
    'command = "keep-me"',
    "",
  ].join("\n");
  fs.writeFileSync(path.join(codexHome, "config.toml"), globalConfig, { mode: 0o640 });

  for (const role of globalRoles) {
    if (missingRole && role === globalRoles[0]) continue;
    const sandbox = wrong && role === "gsd-ai-researcher" ? "read-only" : typedWriteRoles.includes(role) ? "workspace-write" : "read-only";
    fs.writeFileSync(
      path.join(globalAgentsDir, `${role}.toml`),
      tomlAgent(role, sandbox, wrong && role === "gsd-planner" ? "gpt-5.6-sol" : CANONICAL_MODEL, wrong && role === "gsd-planner" ? "high" : CANONICAL_EFFORT),
    );
  }
  if (extraRole) fs.writeFileSync(path.join(globalAgentsDir, "gsd-extra.toml"), tomlAgent("gsd-extra", "read-only"));

  for (const role of closeoutRoles) {
    fs.writeFileSync(path.join(repoAgentsDir, `${role}.toml`), tomlAgent(role, "read-only", wrong ? "gpt-5.6-sol" : CANONICAL_MODEL, wrong ? "high" : CANONICAL_EFFORT));
  }

  const skillPath = path.join(skillsRoot, "gsd-fixture", "SKILL.md");
  const skillBody = managedDrift ? "managed skill drift\n" : "managed skill immutable\n";
  fs.writeFileSync(skillPath, skillBody);
  const expectedSkillHash = crypto.createHash("sha256").update("managed skill immutable\n").digest("hex");
  fs.writeFileSync(path.join(codexHome, "gsd-file-manifest.json"), JSON.stringify({ version: "fixture", files: { "skills/gsd-fixture/SKILL.md": expectedSkillHash } }, null, 2));

  const defaults = {
    resolve_model_ids: "omit",
    model_profile: "adaptive",
    model_overrides: { "gsd-planner": wrong ? "gpt-5.6-sol" : CANONICAL_MODEL, "gsd-executor": CANONICAL_MODEL },
    model_profile_overrides: {
      codex: {
        opus: { model: wrong ? "gpt-5.6-sol" : CANONICAL_MODEL, reasoning_effort: wrong ? "high" : CANONICAL_EFFORT },
        sonnet: { model: CANONICAL_MODEL, reasoning_effort: CANONICAL_EFFORT },
      },
    },
    dynamic_routing: {
      enabled: true,
      escalate_on_failure: wrong,
      tier_models: { light: CANONICAL_MODEL, standard: CANONICAL_MODEL, heavy: wrong ? "gpt-5.6-sol" : CANONICAL_MODEL },
      provider_escalation: wrong ? ["gpt-5.6-sol"] : [CANONICAL_MODEL],
      max_escalations: wrong ? 3 : 0,
    },
    parallelization: { enabled: true, max_concurrent_agents: wrong ? 7 : 3, unrelated_parallel_key: "preserve" },
    effort: {
      default: wrong ? "high" : CANONICAL_EFFORT,
      routing_tier_defaults: { light: CANONICAL_EFFORT, standard: CANONICAL_EFFORT, heavy: wrong ? "high" : CANONICAL_EFFORT },
      agent_overrides: { "gsd-planner": wrong ? "high" : CANONICAL_EFFORT },
    },
    unknown_fixture_key: { untouched: true },
  };
  fs.writeFileSync(defaultsPath, JSON.stringify(defaults, null, 2), { mode: 0o600 });
  fs.writeFileSync(path.join(projectRoot, ".planning", "config.json"), JSON.stringify({
    runtime: "codex",
    model_profile: "balanced",
    model_overrides: { "gsd-plan-checker": wrong ? "gpt-5.6-sol" : CANONICAL_MODEL },
    model_profile_overrides: { codex: { opus: { model: wrong ? "gpt-5.6-sol" : CANONICAL_MODEL, reasoning_effort: wrong ? "high" : CANONICAL_EFFORT } } },
    dynamic_routing: { enabled: true, tier_models: { heavy: wrong ? "gpt-5.6-sol" : CANONICAL_MODEL } },
    parallelization: { enabled: true, max_concurrent_agents: wrong ? 7 : 3 },
    effort: { agent_overrides: { "gsd-plan-checker": wrong ? "high" : CANONICAL_EFFORT } },
    unknown_project_key: ["keep", { value: 7 }],
  }, null, 2));

  fs.mkdirSync(agentsHome, { recursive: true });
  fs.writeFileSync(path.join(agentsHome, "AGENTS.md"), emptyPolicy ? "" : policyText(codexHome, wrong), { mode: 0o644 });
  fs.writeFileSync(path.join(codexHome, "AGENTS.md"), "split-brain mirror\n", { mode: 0o600 });

  const options = { codexHome, agentsHome, projectRoot, defaultsPath, managedSkillsRoot: skillsRoot };
  const paths = {
    config: path.join(codexHome, "config.toml"),
    defaults: defaultsPath,
    projectConfig: path.join(projectRoot, ".planning", "config.json"),
    globalPolicy: path.join(agentsHome, "AGENTS.md"),
    codexPolicy: path.join(codexHome, "AGENTS.md"),
    skill: skillPath,
  };
  return { root, options, paths, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

const fixtures: Fixture[] = [];
afterEach(() => {
  while (fixtures.length > 0) fixtures.pop()?.cleanup();
});

describe("host GSD normalizer", () => {
  test("check fails closed for Sol/high, depth, sandbox, alternate routing, and split policy", async () => {
    const fixture = createFixture();
    fixtures.push(fixture);
    const before = Object.fromEntries(Object.values(fixture.paths).map((filePath) => [filePath, digest(filePath)]));
    const result = await typedCheckHost(fixture.options);
    assert.equal(result.ok, false);
    assert.ok(result.changedPaths.includes(fixture.paths.config));
    assert.ok(result.changedPaths.includes(fixture.paths.defaults));
    assert.ok(result.changedPaths.includes(fixture.paths.projectConfig));
    assert.ok(result.changedPaths.includes(fixture.paths.globalPolicy));
    assert.ok(result.changedPaths.includes(fixture.paths.codexPolicy));
    assert.deepEqual(Object.fromEntries(Object.values(fixture.paths).map((filePath) => [filePath, digest(filePath)])), before);
  });

  test("apply repairs only the preflighted fixture and a subsequent check passes", async () => {
    const fixture = createFixture();
    fixtures.push(fixture);
    const result = await typedApplyHost(fixture.options);
    assert.equal(result.ok, true, JSON.stringify(result.errors));
    assert.ok(result.changedPaths.length > 0);
    const checked = await typedCheckHost(fixture.options);
    assert.equal(checked.ok, true, JSON.stringify(checked.errors));
    assert.deepEqual(JSON.parse(fs.readFileSync(fixture.paths.defaults, "utf8")).unknown_fixture_key, { untouched: true });
    assert.deepEqual(JSON.parse(fs.readFileSync(fixture.paths.projectConfig, "utf8")).unknown_project_key, ["keep", { value: 7 }]);
    const defaults = JSON.parse(fs.readFileSync(fixture.paths.defaults, "utf8"));
    const project = JSON.parse(fs.readFileSync(fixture.paths.projectConfig, "utf8"));
    assert.equal(defaults.dynamic_routing.escalate_on_failure, false);
    assert.equal(defaults.dynamic_routing.max_escalations, 0);
    assert.equal(defaults.parallelization.max_concurrent_agents, 3);
    assert.equal(defaults.parallelization.unrelated_parallel_key, "preserve");
    assert.equal(project.parallelization.max_concurrent_agents, 3);
    assert.equal(fs.statSync(fixture.paths.config).mode & 0o777, 0o640);
    assert.equal(fs.statSync(fixture.paths.defaults).mode & 0o777, 0o600);
    assert.equal(fs.readFileSync(fixture.paths.globalPolicy, "utf8"), fs.readFileSync(fixture.paths.codexPolicy, "utf8"));
    assert.match(fs.readFileSync(fixture.paths.globalPolicy, "utf8"), new RegExp(`${fixture.options.codexHome}/gsd-core/workflows`));
  });

  test("empty policy and missing or extra role files fail closed", async () => {
    const empty = createFixture({ emptyPolicy: true });
    fixtures.push(empty);
    const emptyResult = await typedCheckHost(empty.options);
    assert.ok(emptyResult.errors.some((error) => error.code === "global_policy_empty"));

    const missing = createFixture({ missingRole: true });
    fixtures.push(missing);
    const missingResult = await typedCheckHost(missing.options);
    assert.ok(missingResult.errors.some((error) => error.code === "global_agents_role_missing"));

    const extra = createFixture({ extraRole: true });
    fixtures.push(extra);
    const extraResult = await typedCheckHost(extra.options);
    assert.ok(extraResult.errors.some((error) => error.code === "global_agents_role_extra"));
  });

  test("managed adapter drift is reported and apply does not touch unrelated configuration", async () => {
    const fixture = createFixture({ wrong: false, managedDrift: true });
    fixtures.push(fixture);
    const beforeConfig = digest(fixture.paths.config);
    const beforeDefaults = digest(fixture.paths.defaults);
    const result = await typedCheckHost(fixture.options);
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((error) => error.code === "managed_skill_drift"));
    const applyResult = await typedApplyHost(fixture.options);
    assert.equal(applyResult.ok, false);
    assert.equal(digest(fixture.paths.config), beforeConfig);
    assert.equal(digest(fixture.paths.defaults), beforeDefaults);
  });

  test("the fixture-only contract does not mutate real home or project planning files", async () => {
    const realHome = os.homedir();
    const realProject = process.cwd();
    const realPaths = [
      path.join(realHome, ".codex", "AGENTS.md"),
      path.join(realHome, ".codex", "config.toml"),
      path.join(realHome, ".gsd", "defaults.json"),
      path.join(realProject, ".planning", "config.json"),
    ].filter((filePath) => fs.existsSync(filePath));
    const before = new Map(realPaths.map((filePath) => [filePath, digest(filePath)]));
    const fixture = createFixture();
    fixtures.push(fixture);
    await typedApplyHost(fixture.options);
    for (const [filePath, expected] of before) assert.equal(digest(filePath), expected, filePath);
    assert.equal(fs.readFileSync(fixture.paths.globalPolicy, "utf8").includes(path.join(realHome, ".codex")), false);
  });

  test("partition constants are exact and disjoint", () => {
    const combined = [...typedPartition["workspace-write"], ...typedPartition["read-only"]];
    assert.equal(new Set(combined).size, combined.length);
    assert.equal(combined.length, 40);
    assert.equal(new Set(globalRoles).size, globalRoles.length);
    assert.equal(new Set(closeoutRoles).size, closeoutRoles.length);
    assert.equal(CANONICAL_MAX_DEPTH, 2);
    assert.equal(CANONICAL_MODEL, "gpt-5.6-luna");
    assert.equal(CANONICAL_EFFORT, "xhigh");
  });
});
