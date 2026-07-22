#!/usr/bin/env node

/**
 * Deterministic host-side GSD normalizer.
 *
 * The repository owns this checker, but the main orchestrator owns any live
 * `apply` against ~/.codex, ~/.agents, or a real project's .planning tree.
 * The module therefore exposes pure-ish inspection helpers and keeps the CLI
 * explicit: `check` never writes and `apply` only writes preflighted files.
 */

import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const CANONICAL_MODEL = "gpt-5.6-luna";
export const CANONICAL_EFFORT = "xhigh";
export const CANONICAL_MAX_DEPTH = 2;

export const WORKSPACE_WRITE_ROLES = Object.freeze([
  "gsd-ai-researcher",
  "gsd-code-fixer",
  "gsd-code-reviewer",
  "gsd-codebase-mapper",
  "gsd-debug-session-manager",
  "gsd-debugger",
  "gsd-doc-classifier",
  "gsd-doc-synthesizer",
  "gsd-doc-verifier",
  "gsd-doc-writer",
  "gsd-domain-researcher",
  "gsd-eval-auditor",
  "gsd-eval-planner",
  "gsd-executor",
  "gsd-intel-updater",
  "gsd-mempalace-curator",
  "gsd-nyquist-auditor",
  "gsd-pattern-mapper",
  "gsd-phase-researcher",
  "gsd-planner",
  "gsd-project-researcher",
  "gsd-research-synthesizer",
  "gsd-roadmapper",
  "gsd-ui-auditor",
  "gsd-ui-researcher",
  "gsd-user-profiler",
  "gsd-verifier",
]);

export const READ_ONLY_ROLES = Object.freeze([
  "gsd-advisor-researcher",
  "gsd-assumptions-analyzer",
  "gsd-framework-selector",
  "gsd-integration-checker",
  "gsd-plan-checker",
  "gsd-security-auditor",
  "gsd-ui-checker",
  "closeout-archive-hygiene-auditor",
  "closeout-artifact-auditor",
  "closeout-github-policy-auditor",
  "closeout-open-artifact-auditor",
  "closeout-pr-body-drafter",
  "closeout-retrospective-miner",
]);

export const SANDBOX_PARTITION = Object.freeze({
  "workspace-write": WORKSPACE_WRITE_ROLES,
  "read-only": READ_ONLY_ROLES,
});

const ALL_ROLES = new Set([...WORKSPACE_WRITE_ROLES, ...READ_ONLY_ROLES]);
const AGENT_FIELD_DEFAULTS = Object.freeze({
  model: CANONICAL_MODEL,
  model_reasoning_effort: CANONICAL_EFFORT,
});
const MANAGED_SKILL_RE = /^skills\/[^/]+\/SKILL\.md$/;
const SHA256_RE = /^[a-f0-9]{64}$/i;

function safePath(value, fallback) {
  return path.resolve(typeof value === "string" && value.length > 0 ? value : fallback);
}

function defaultOptions(input = {}) {
  const home = os.homedir();
  const codexHome = safePath(input.codexHome, process.env.CODEX_HOME || path.join(home, ".codex"));
  const agentsHome = safePath(input.agentsHome, process.env.GSD_AGENTS_HOME || path.join(home, ".agents"));
  const projectRoot = safePath(input.projectRoot, process.cwd());
  return {
    codexHome,
    agentsHome,
    projectRoot,
    configPath: safePath(input.configPath, path.join(codexHome, "config.toml")),
    defaultsPath: safePath(input.defaultsPath, path.join(path.dirname(codexHome), ".gsd", "defaults.json")),
    projectConfigPath: safePath(input.projectConfigPath, path.join(projectRoot, ".planning", "config.json")),
    globalAgentsPath: safePath(input.globalAgentsPath, path.join(agentsHome, "AGENTS.md")),
    codexAgentsPath: safePath(input.codexAgentsPath, path.join(codexHome, "AGENTS.md")),
    globalAgentsDir: safePath(input.globalAgentsDir, path.join(codexHome, "agents")),
    repoAgentsDir: safePath(input.repoAgentsDir, path.join(projectRoot, ".codex", "agents")),
    managedManifestPath: safePath(input.managedManifestPath, path.join(codexHome, "gsd-file-manifest.json")),
    managedSkillsRoot: safePath(input.managedSkillsRoot, path.join(agentsHome, "skills")),
  };
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function errorRecord(code, target, detail) {
  const record = { code, path: target };
  if (detail) record.detail = detail;
  return record;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

function jsonBytes(value, original) {
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  return Buffer.from(rendered, "utf8").equals(original) ? original : Buffer.from(rendered, "utf8");
}

async function readRegular(filePath, codePrefix) {
  let stat;
  try {
    stat = await fs.lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error(`${codePrefix}_missing`);
    throw new Error(`${codePrefix}_unreadable`);
  }
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`${codePrefix}_unsafe`);
  let raw;
  try {
    raw = await fs.readFile(filePath);
  } catch {
    throw new Error(`${codePrefix}_unreadable`);
  }
  return { raw, mode: stat.mode & 0o777, digest: sha256(raw) };
}

async function readJson(filePath, codePrefix) {
  const snapshot = await readRegular(filePath, codePrefix);
  let parsed;
  try {
    parsed = JSON.parse(snapshot.raw.toString("utf8"));
  } catch {
    throw new Error(`${codePrefix}_invalid_json`);
  }
  if (!isObject(parsed)) throw new Error(`${codePrefix}_invalid_shape`);
  return { ...snapshot, parsed };
}

function parseTomlScalar(raw, key) {
  const match = raw.match(new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*=\\s*([\\\"'])(.*?)\\1\\s*(?:#.*)?$`, "m"));
  return match ? match[2] : undefined;
}

function setTomlScalar(raw, key, value) {
  const escaped = String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const expression = new RegExp(`^(\\s*)${key.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*=.*?(\\s+#.*)?$`, "m");
  if (expression.test(raw)) {
    return raw.replace(expression, (_line, indentation, comment) => `${indentation}${key} = "${escaped}"${comment || ""}`);
  }
  const suffix = raw.endsWith("\n") ? "" : "\n";
  return `${raw}${suffix}${key} = "${escaped}"\n`;
}

function readSection(raw, section) {
  const lines = raw.split(/\r?\n/);
  const header = new RegExp(`^\\s*\\[${section.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\]\\s*$`);
  const start = lines.findIndex((line) => header.test(line));
  if (start < 0) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { lines, start, end };
}

function maxDepthFromToml(raw) {
  const section = readSection(raw, "agents");
  if (!section) return undefined;
  for (let index = section.start + 1; index < section.end; index += 1) {
    const match = section.lines[index].match(/^\s*max_depth\s*=\s*([0-9]+)\s*(?:#.*)?$/);
    if (match) return Number(match[1]);
  }
  return undefined;
}

function normalizeMaxDepthToml(raw) {
  const section = readSection(raw, "agents");
  if (!section) {
    const suffix = raw.endsWith("\n") ? "" : "\n";
    return `${raw}${suffix}[agents]\nmax_depth = ${CANONICAL_MAX_DEPTH}\n`;
  }
  const depthExpression = /^\s*max_depth\s*=\s*([0-9]+)(\s*(?:#.*)?)$/;
  for (let index = section.start + 1; index < section.end; index += 1) {
    const match = section.lines[index].match(depthExpression);
    if (match) {
      section.lines[index] = `max_depth = ${CANONICAL_MAX_DEPTH}${match[2] || ""}`;
      return section.lines.join("\n");
    }
  }
  section.lines.splice(section.start + 1, 0, `max_depth = ${CANONICAL_MAX_DEPTH}`);
  return section.lines.join("\n");
}

function normalizeModelProfileEntry(value) {
  if (isObject(value)) {
    return { ...value, model: CANONICAL_MODEL, reasoning_effort: CANONICAL_EFFORT };
  }
  return { model: CANONICAL_MODEL, reasoning_effort: CANONICAL_EFFORT };
}

function normalizeResolverConfig(input) {
  const config = cloneJson(input);

  if (isObject(config.model_overrides)) {
    for (const key of Object.keys(config.model_overrides)) config.model_overrides[key] = CANONICAL_MODEL;
  }

  if (isObject(config.dynamic_routing)) {
    const routing = config.dynamic_routing;
    if (isObject(routing.tier_models)) {
      for (const key of Object.keys(routing.tier_models)) routing.tier_models[key] = CANONICAL_MODEL;
    }
    if (Array.isArray(routing.provider_escalation)) {
      routing.provider_escalation = routing.provider_escalation.map((entry) =>
        typeof entry === "string" ? CANONICAL_MODEL : entry,
      );
    }
  }

  if (isObject(config.model_profile_overrides)) {
    for (const runtime of Object.keys(config.model_profile_overrides)) {
      const profile = config.model_profile_overrides[runtime];
      if (!isObject(profile)) {
        config.model_profile_overrides[runtime] = {};
        continue;
      }
      for (const tier of Object.keys(profile)) profile[tier] = normalizeModelProfileEntry(profile[tier]);
    }
  }

  if (isObject(config.effort)) {
    config.effort.default = CANONICAL_EFFORT;
    if (isObject(config.effort.routing_tier_defaults)) {
      for (const tier of Object.keys(config.effort.routing_tier_defaults)) {
        config.effort.routing_tier_defaults[tier] = CANONICAL_EFFORT;
      }
    } else {
      config.effort.routing_tier_defaults = {
        light: CANONICAL_EFFORT,
        standard: CANONICAL_EFFORT,
        heavy: CANONICAL_EFFORT,
      };
    }
    if (isObject(config.effort.agent_overrides)) {
      for (const agent of Object.keys(config.effort.agent_overrides)) {
        config.effort.agent_overrides[agent] = CANONICAL_EFFORT;
      }
    } else {
      config.effort.agent_overrides = {};
    }
  }

  // model_policy is an alternate resolver path in the installed GSD model
  // resolver. Only model-bearing policy fields are changed; provider/budget and
  // arbitrary policy metadata remain untouched.
  if (isObject(config.model_policy)) {
    for (const key of ["high", "medium", "low"]) {
      if (Object.hasOwn(config.model_policy, key)) config.model_policy[key] = CANONICAL_MODEL;
    }
    if (isObject(config.model_policy.runtime_tiers)) {
      for (const runtime of Object.keys(config.model_policy.runtime_tiers)) {
        const tiers = config.model_policy.runtime_tiers[runtime];
        if (!isObject(tiers)) continue;
        for (const tier of Object.keys(tiers)) tiers[tier] = normalizeModelProfileEntry(tiers[tier]);
      }
    }
  }

  return config;
}

function parseTomlAgent(raw) {
  return {
    name: parseTomlScalar(raw, "name"),
    model: parseTomlScalar(raw, "model"),
    modelReasoningEffort: parseTomlScalar(raw, "model_reasoning_effort"),
    sandboxMode: parseTomlScalar(raw, "sandbox_mode"),
  };
}

function normalizeAgentToml(raw, role, sandboxMode) {
  let next = setTomlScalar(raw, "name", role);
  next = setTomlScalar(next, "model", AGENT_FIELD_DEFAULTS.model);
  next = setTomlScalar(next, "model_reasoning_effort", AGENT_FIELD_DEFAULTS.model_reasoning_effort);
  next = setTomlScalar(next, "sandbox_mode", sandboxMode);
  return next;
}

function expectedSandbox(role) {
  if (WORKSPACE_WRITE_ROLES.includes(role)) return "workspace-write";
  if (READ_ONLY_ROLES.includes(role)) return "read-only";
  return undefined;
}

async function listTomlFiles(directory) {
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") throw new Error("agent_directory_missing");
    throw new Error("agent_directory_unreadable");
  }
  return entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".toml"))
    .map((entry) => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

async function inspectAgentFiles(directory, expectedRoles, label) {
  const files = await listTomlFiles(directory);
  const seen = new Map();
  const errors = [];
  const changes = [];
  for (const filePath of files) {
    let snapshot;
    try {
      snapshot = await readRegular(filePath, "agent_file");
    } catch (error) {
      errors.push(errorRecord(error.message, filePath));
      continue;
    }
    const parsed = parseTomlAgent(snapshot.raw.toString("utf8"));
    const role = parsed.name || path.basename(filePath, ".toml");
    if (!ALL_ROLES.has(role) || !expectedRoles.includes(role)) {
      errors.push(errorRecord(`${label}_role_extra`, filePath, role));
      continue;
    }
    if (seen.has(role)) {
      errors.push(errorRecord(`${label}_role_duplicate`, filePath, role));
      continue;
    }
    seen.set(role, filePath);
    const sandbox = expectedSandbox(role);
    const raw = snapshot.raw.toString("utf8");
    const normalized = normalizeAgentToml(raw, role, sandbox);
    if (parsed.model !== CANONICAL_MODEL || parsed.modelReasoningEffort !== CANONICAL_EFFORT || parsed.sandboxMode !== sandbox || parsed.name !== role) {
      changes.push({ path: filePath, raw: snapshot.raw, next: Buffer.from(normalized), mode: snapshot.mode });
    }
  }
  for (const role of expectedRoles) {
    if (!seen.has(role)) errors.push(errorRecord(`${label}_role_missing`, path.join(directory, `${role}.toml`), role));
  }
  return { files, errors, changes, roles: [...seen.keys()].sort() };
}

function normalizedPolicy(raw, codexHome) {
  const replacement = path.resolve(codexHome);
  let next = raw;
  next = next.replaceAll("$HOME/.codex", replacement);
  next = next.replaceAll("~/.codex", replacement);
  // Rewrite both relative paths and stale absolute paths. The path-component
  // prefix is deliberately narrow: prose containing the word "agents" is not
  // changed unless it is the actual `agents/` directory token.
  const componentPrefix = "(?:\\/?[^`\\s/]+/)*";
  next = next.replace(new RegExp(`${componentPrefix}gsd-core/workflows/`, "g"), `${replacement}/gsd-core/workflows/`);
  next = next.replace(new RegExp(`${componentPrefix}agents/`, "g"), `${replacement}/agents/`);
  next = next.replace(new RegExp(`${componentPrefix}gsd-core/bin/gsd-tools\\.cjs`, "g"), `${replacement}/gsd-core/bin/gsd-tools.cjs`);
  return next;
}

function manifestSkillEntries(manifest) {
  if (!isObject(manifest.files)) return null;
  const entries = Object.entries(manifest.files)
    .filter(([relativePath]) => MANAGED_SKILL_RE.test(relativePath) && (relativePath.startsWith("skills/gsd-") || relativePath.includes("/gsd-")))
    .map(([relativePath, expectedHash]) => ({ relativePath, expectedHash }))
    .sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return entries;
}

async function captureManagedSkillManifest(options) {
  let manifestSnapshot;
  try {
    manifestSnapshot = await readJson(options.managedManifestPath, "managed_manifest");
  } catch (error) {
    return { errors: [errorRecord(error.message, options.managedManifestPath)], entries: [], checked: [] };
  }
  const entries = manifestSkillEntries(manifestSnapshot.parsed);
  if (!entries) return { errors: [errorRecord("managed_manifest_invalid_shape", options.managedManifestPath)], entries: [], checked: [] };
  const errors = [];
  const checked = [];
  const expectedPaths = new Set(entries.map((entry) => entry.relativePath));
  for (const entry of entries) {
    const target = path.join(options.managedSkillsRoot, entry.relativePath.slice("skills/".length));
    checked.push(target);
    if (typeof entry.expectedHash !== "string" || !SHA256_RE.test(entry.expectedHash)) {
      errors.push(errorRecord("managed_manifest_hash_invalid", target));
      continue;
    }
    try {
      const snapshot = await readRegular(target, "managed_skill");
      if (snapshot.digest.toLowerCase() !== entry.expectedHash.toLowerCase()) {
        errors.push(errorRecord("managed_skill_drift", target));
      }
    } catch (error) {
      errors.push(errorRecord(error.message, target));
    }
  }
  let children = [];
  try {
    children = await fs.readdir(options.managedSkillsRoot, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== "ENOENT") errors.push(errorRecord("managed_skills_root_unreadable", options.managedSkillsRoot));
  }
  for (const child of children.filter((entry) => entry.isDirectory() && entry.name.startsWith("gsd-"))) {
    const relativePath = `skills/${child.name}/SKILL.md`;
    if (!expectedPaths.has(relativePath)) errors.push(errorRecord("managed_skill_extra", path.join(options.managedSkillsRoot, child.name, "SKILL.md")));
  }
  return { errors, entries, checked };
}

function resultFor(options, mode, checkedPaths, changes, errors, managed) {
  const changedPaths = changes.map((change) => change.path).sort();
  return {
    // In check mode any proposed mutation is drift. In apply mode a proposed
    // mutation is the work to perform; only preflight errors block it.
    ok: errors.length === 0 && (mode === "apply" || changes.length === 0),
    mode,
    changedPaths,
    checkedPaths: [...new Set(checkedPaths)].sort(),
    managedAdapters: {
      count: managed.entries.length,
      paths: managed.entries.map((entry) => entry.relativePath),
    },
    errors,
  };
}

async function inspectHost(rawOptions = {}) {
  const options = defaultOptions(rawOptions);
  const checkedPaths = [
    options.configPath,
    options.defaultsPath,
    options.projectConfigPath,
    options.globalAgentsPath,
    options.codexAgentsPath,
    options.managedManifestPath,
  ];
  const changes = [];
  const errors = [];

  let configSnapshot;
  try {
    configSnapshot = await readRegular(options.configPath, "codex_config");
    checkedPaths.push(...(await listTomlFiles(options.globalAgentsDir)));
  } catch (error) {
    errors.push(errorRecord(error.message, options.configPath));
  }
  if (configSnapshot) {
    const raw = configSnapshot.raw.toString("utf8");
    if (maxDepthFromToml(raw) !== CANONICAL_MAX_DEPTH) {
      changes.push({ path: options.configPath, raw: configSnapshot.raw, next: Buffer.from(normalizeMaxDepthToml(raw)), mode: configSnapshot.mode });
    }
  }

  let globalAgents;
  try {
    globalAgents = await inspectAgentFiles(options.globalAgentsDir, [...WORKSPACE_WRITE_ROLES, ...READ_ONLY_ROLES].filter((role) => !role.startsWith("closeout-")), "global_agents");
    checkedPaths.push(...globalAgents.files);
    errors.push(...globalAgents.errors);
    changes.push(...globalAgents.changes);
  } catch (error) {
    errors.push(errorRecord(error.message, options.globalAgentsDir));
  }

  let closeoutAgents;
  try {
    closeoutAgents = await inspectAgentFiles(options.repoAgentsDir, READ_ONLY_ROLES.filter((role) => role.startsWith("closeout-")), "closeout_agents");
    checkedPaths.push(...closeoutAgents.files);
    errors.push(...closeoutAgents.errors);
    changes.push(...closeoutAgents.changes);
  } catch (error) {
    errors.push(errorRecord(error.message, options.repoAgentsDir));
  }

  let defaultsSnapshot;
  try {
    defaultsSnapshot = await readJson(options.defaultsPath, "gsd_defaults");
    const next = normalizeResolverConfig(defaultsSnapshot.parsed);
    const nextBytes = jsonBytes(next, defaultsSnapshot.raw);
    if (!nextBytes.equals(defaultsSnapshot.raw)) changes.push({ path: options.defaultsPath, raw: defaultsSnapshot.raw, next: nextBytes, mode: defaultsSnapshot.mode });
  } catch (error) {
    errors.push(errorRecord(error.message, options.defaultsPath));
  }

  let projectConfigSnapshot;
  try {
    projectConfigSnapshot = await readJson(options.projectConfigPath, "project_config");
    const next = normalizeResolverConfig(projectConfigSnapshot.parsed);
    const nextBytes = jsonBytes(next, projectConfigSnapshot.raw);
    if (!nextBytes.equals(projectConfigSnapshot.raw)) changes.push({ path: options.projectConfigPath, raw: projectConfigSnapshot.raw, next: nextBytes, mode: projectConfigSnapshot.mode });
  } catch (error) {
    errors.push(errorRecord(error.message, options.projectConfigPath));
  }

  let sourceSnapshot;
  let mirrorSnapshot;
  let policyNext;
  try {
    sourceSnapshot = await readRegular(options.globalAgentsPath, "global_policy");
    const sourceRaw = sourceSnapshot.raw.toString("utf8");
    if (sourceRaw.trim().length === 0) errors.push(errorRecord("global_policy_empty", options.globalAgentsPath));
    policyNext = Buffer.from(normalizedPolicy(sourceRaw, options.codexHome));
    if (!policyNext.equals(sourceSnapshot.raw)) changes.push({ path: options.globalAgentsPath, raw: sourceSnapshot.raw, next: policyNext, mode: sourceSnapshot.mode });
  } catch (error) {
    errors.push(errorRecord(error.message, options.globalAgentsPath));
  }
  try {
    mirrorSnapshot = await readRegular(options.codexAgentsPath, "codex_policy");
    if (sourceSnapshot && policyNext && !mirrorSnapshot.raw.equals(policyNext)) {
      changes.push({ path: options.codexAgentsPath, raw: mirrorSnapshot.raw, next: policyNext, mode: mirrorSnapshot.mode });
    }
  } catch (error) {
    // A missing mirror is repairable once the canonical source is valid. An
    // unsafe path is still a fail-closed error because apply must not replace a
    // symlink or special file.
    if (error.message === "codex_policy_missing" && sourceSnapshot && policyNext && sourceSnapshot.raw.toString("utf8").trim().length > 0) {
      changes.push({ path: options.codexAgentsPath, raw: Buffer.alloc(0), next: policyNext, mode: sourceSnapshot.mode });
    } else {
      errors.push(errorRecord(error.message, options.codexAgentsPath));
    }
  }

  const managed = await captureManagedSkillManifest(options);
  checkedPaths.push(...managed.checked);
  errors.push(...managed.errors);
  return { options, ...resultFor(options, rawOptions.mode || "check", checkedPaths, changes, errors, managed), changes };
}

async function atomicApply(changes) {
  const staged = [];
  try {
    for (const change of changes) {
      const current = await readRegular(change.path, "apply_target").catch((error) => {
        if (change.raw.length === 0 && error.message === "apply_target_missing") return { raw: Buffer.alloc(0), mode: change.mode, digest: sha256(Buffer.alloc(0)) };
        throw error;
      });
      if (!current.raw.equals(change.raw)) throw new Error(`apply_target_changed:${change.path}`);
      const parent = path.dirname(change.path);
      const temp = path.join(parent, `.${path.basename(change.path)}.normalize-${process.pid}-${randomUUID()}`);
      await fs.writeFile(temp, change.next, { mode: change.mode, flag: "wx" });
      await fs.chmod(temp, change.mode);
      staged.push({ temp, target: change.path });
    }
    for (const item of staged) await fs.rename(item.temp, item.target);
  } finally {
    await Promise.all(staged.map((item) => fs.unlink(item.temp).catch(() => undefined)));
  }
}

export async function normalizeGsdHost(rawOptions = {}) {
  const mode = rawOptions.mode === "apply" ? "apply" : "check";
  const inspected = await inspectHost({ ...rawOptions, mode });
  if (mode === "apply" && inspected.ok && inspected.changes.length > 0) {
    await atomicApply(inspected.changes);
    const { changes: _changes, ...publicResult } = inspected;
    return { ...publicResult, changedPaths: inspected.changes.map((change) => change.path).sort() };
  }
  const { changes: _changes, ...publicResult } = inspected;
  return publicResult;
}

export const checkHost = (options = {}) => normalizeGsdHost({ ...options, mode: "check" });
export const applyHost = (options = {}) => normalizeGsdHost({ ...options, mode: "apply" });

function parseArgs(argv) {
  const options = {};
  let mode = "check";
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "check" || arg === "apply") {
      mode = arg;
      continue;
    }
    if (arg === "--help" || arg === "-h") return { help: true };
    const match = arg.match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!match) throw new Error("invalid_argument");
    const key = match[1].replaceAll("-", "");
    const value = match[2] ?? argv[++index];
    if (!value || value.startsWith("--")) throw new Error("missing_argument_value");
    if (match[1] === "mode") {
      if (value !== "check" && value !== "apply") throw new Error("invalid_mode");
      mode = value;
      continue;
    }
    const aliases = {
      codexhome: "codexHome",
      agentshome: "agentsHome",
      projectroot: "projectRoot",
      configpath: "configPath",
      defaultspath: "defaultsPath",
      projectconfigpath: "projectConfigPath",
      globalagentspath: "globalAgentsPath",
      codexagentspath: "codexAgentsPath",
      globalagentsdir: "globalAgentsDir",
      repoagentsdir: "repoAgentsDir",
      managedmanifestpath: "managedManifestPath",
      managedskillsroot: "managedSkillsRoot",
    };
    if (!aliases[key]) throw new Error("unknown_argument");
    options[aliases[key]] = value;
  }
  return { ...options, mode };
}

function usage() {
  return [
    "Usage: node scripts/workflow/normalize-gsd-host.mjs <check|apply> [options]",
    "",
    "Options: --codex-home PATH --agents-home PATH --project-root PATH",
    "         --config-path PATH --defaults-path PATH --project-config-path PATH",
    "         --global-agents-path PATH --codex-agents-path PATH",
    "         --global-agents-dir PATH --repo-agents-dir PATH",
    "         --managed-manifest-path PATH --managed-skills-root PATH",
  ].join("\n");
}

async function main() {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const result = await normalizeGsdHost(parsed);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ ok: false, mode: "check", changedPaths: [], checkedPaths: [], errors: [{ code: error.message || "normalizer_failed" }] }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

const entryPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entryPath === fileURLToPath(import.meta.url)) main();
