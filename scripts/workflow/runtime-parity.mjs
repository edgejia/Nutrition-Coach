#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import { userInfo } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkGsdHardeningWiring } from "./gsd-wiring.mjs";
import { lintPlanProof } from "./plan-proof-lint.mjs";
import { resolveCanonicalPlanningConfig } from "./project-scope.mjs";
import { resolveWorkflowProjectScope } from "./workflow-lease.mjs";

const MATRIX_KIND = "nutrition_runtime_parity_matrix";
const STATUSES = new Set(["equivalent", "intentional_difference", "blocking", "deferred"]);
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const PLANNING_PROOF_SKILL = ".codex/skills/nutrition-planning-proof";
const CORE_FILES = [
  "VERSION",
  "bin/gsd-tools.cjs",
  "bin/lib/capability-registry.cjs",
  "bin/shared/config-schema.manifest.json",
  "bin/shared/model-catalog.json",
].sort();
const PROJECT_VERIFIER_FILES = [
  "package.json",
  "scripts/workflow/gsd-wiring.mjs",
  "scripts/workflow/plan-proof-lint.mjs",
  "scripts/workflow/project-scope.mjs",
  "scripts/workflow/runtime-parity.mjs",
  "scripts/workflow/state-check.mjs",
  "scripts/workflow/workflow-lease.mjs",
].sort();
const REQUIRED_ROWS = [
  "core_identity",
  "skill_surface",
  "project_instruction_bootstrap",
  "shared_runtime_resolution",
  "host_embedding_dispatch",
  "planner_checker_skill_wiring",
  "artifact_writer_provenance",
  "single_writer_entrypoint",
  "deterministic_tool_smoke",
  "model_effort_propagation",
  "workflow_telemetry_sample",
];

export class RuntimeParityError extends Error {
  constructor(code) {
    super(code);
    this.name = "RuntimeParityError";
    this.code = code;
  }
}

function fail(code) {
  throw new RuntimeParityError(code);
}

function requireCondition(condition, code) {
  if (!condition) fail(code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function exactKeys(value, expected, code = "runtime_parity_matrix_invalid") {
  requireCondition(value && typeof value === "object" && !Array.isArray(value), code);
  requireCondition(JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()), code);
}

function statIdentity(stat) {
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    nlink: stat.nlink.toString(),
    mode: stat.mode.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  };
}

async function readPlainFileSnapshot(filePath, code) {
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    fail(code);
  }
  try {
    const before = await handle.stat({ bigint: true });
    requireCondition(before.isFile() && before.nlink === 1n && before.size <= 8n * 1024n * 1024n, code);
    const raw = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await fs.lstat(filePath, { bigint: true }).catch(() => null);
    requireCondition(
      JSON.stringify(statIdentity(before)) === JSON.stringify(statIdentity(after)) &&
        current?.isFile() && !current.isSymbolicLink() &&
        JSON.stringify(statIdentity(current)) === JSON.stringify(statIdentity(after)),
      code,
    );
    return { raw, sha256: sha256(raw), identity: statIdentity(after) };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function readPlainFile(filePath, code) {
  return (await readPlainFileSnapshot(filePath, code)).raw;
}

export async function captureRuntimeParityFileEvidence(filePath, code = "runtime_parity_file_missing_or_unsafe") {
  const snapshot = await readPlainFileSnapshot(filePath, code);
  return { sha256: snapshot.sha256, identity: snapshot.identity };
}

async function directoryTreeDigest(root, code) {
  const entries = [];
  async function visit(current, relativeBase) {
    const children = (await fs.readdir(current, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name, "en"),
    );
    for (const child of children) {
      const absolute = path.join(current, child.name);
      const relative = relativeBase ? path.posix.join(relativeBase, child.name) : child.name;
      const stat = await fs.lstat(absolute).catch(() => null);
      requireCondition(stat && !stat.isSymbolicLink(), code);
      if (stat.isDirectory()) {
        entries.push({ path: relative, type: "directory", mode: stat.mode & 0o777 });
        await visit(absolute, relative);
      } else if (stat.isFile()) {
        const raw = await readPlainFile(absolute, code);
        entries.push({ path: relative, type: "file", mode: stat.mode & 0o777, size: raw.length, sha256: sha256(raw) });
      } else {
        fail(code);
      }
    }
  }
  await visit(root, "");
  return sha256(Buffer.from(JSON.stringify(entries), "utf8"));
}

async function directoryTreeFreshnessDigest(root, code) {
  const entries = [];
  async function visit(current, relativeBase) {
    const currentStat = await fs.lstat(current, { bigint: true }).catch(() => null);
    requireCondition(currentStat?.isDirectory() && !currentStat.isSymbolicLink(), code);
    entries.push({ path: relativeBase || ".", type: "directory", identity: statIdentity(currentStat) });
    const children = (await fs.readdir(current, { withFileTypes: true })).sort((left, right) =>
      left.name.localeCompare(right.name, "en"),
    );
    for (const child of children) {
      const absolute = path.join(current, child.name);
      const relative = relativeBase ? path.posix.join(relativeBase, child.name) : child.name;
      requireCondition(!child.isSymbolicLink(), code);
      if (child.isDirectory()) {
        await visit(absolute, relative);
      } else if (child.isFile()) {
        const snapshot = await readPlainFileSnapshot(absolute, code);
        entries.push({ path: relative, type: "file", sha256: snapshot.sha256, identity: snapshot.identity });
      } else {
        fail(code);
      }
    }
    const after = await fs.lstat(current, { bigint: true }).catch(() => null);
    requireCondition(
      after?.isDirectory() && !after.isSymbolicLink() &&
        JSON.stringify(statIdentity(after)) === JSON.stringify(statIdentity(currentStat)),
      code,
    );
  }
  await visit(root, "");
  return sha256(Buffer.from(JSON.stringify(entries), "utf8"));
}

async function skillManifest(root) {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const names = entries
    .filter((entry) => entry.name.startsWith("gsd-"))
    .map((entry) => {
      requireCondition(entry.isDirectory() && !entry.isSymbolicLink(), "runtime_parity_skill_surface_unreadable");
      return entry.name;
    })
    .sort((left, right) => left.localeCompare(right, "en"));
  const manifest = {};
  for (const name of names) {
    manifest[name] = await directoryTreeDigest(path.join(root, name), "runtime_parity_skill_surface_unreadable");
  }
  return manifest;
}

async function skillSurfaceEvidence(root) {
  const manifest = await skillManifest(root);
  const freshness = {};
  for (const name of Object.keys(manifest)) {
    freshness[name] = await directoryTreeFreshnessDigest(
      path.join(root, name),
      "runtime_parity_skill_surface_unreadable",
    );
  }
  return {
    manifestSha256: sha256(Buffer.from(JSON.stringify(manifest), "utf8")),
    freshnessSha256: sha256(Buffer.from(JSON.stringify(freshness), "utf8")),
  };
}

export function validateRuntimeParityMatrix(matrix) {
  exactKeys(matrix, [
    "schemaVersion",
    "kind",
    "observedAt",
    "gsdVersion",
    "coreFiles",
    "projectVerifierFiles",
    "expectedWiringFindings",
    "skillSurface",
    "projectInstructionFiles",
    "sharedConfig",
    "hostProfiles",
    "rows",
  ]);
  requireCondition(matrix?.schemaVersion === 1 && matrix?.kind === MATRIX_KIND, "runtime_parity_matrix_invalid");
  requireCondition(typeof matrix.observedAt === "string" && /^\d{4}-\d{2}-\d{2}T/.test(matrix.observedAt), "runtime_parity_matrix_invalid");
  requireCondition(/^\d+\.\d+\.\d+$/.test(matrix.gsdVersion ?? ""), "runtime_parity_matrix_invalid");
  requireCondition(matrix.coreFiles && typeof matrix.coreFiles === "object", "runtime_parity_matrix_invalid");
  requireCondition(JSON.stringify(Object.keys(matrix.coreFiles).sort()) === JSON.stringify(CORE_FILES), "runtime_parity_matrix_invalid");
  for (const digest of Object.values(matrix.coreFiles)) {
    requireCondition(typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest), "runtime_parity_matrix_invalid");
  }
  requireCondition(
    matrix.projectVerifierFiles && typeof matrix.projectVerifierFiles === "object" && !Array.isArray(matrix.projectVerifierFiles),
    "runtime_parity_matrix_invalid",
  );
  requireCondition(
    JSON.stringify(Object.keys(matrix.projectVerifierFiles).sort()) === JSON.stringify(PROJECT_VERIFIER_FILES),
    "runtime_parity_matrix_invalid",
  );
  requireCondition(
    Object.values(matrix.projectVerifierFiles).every((digest) => typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest)),
    "runtime_parity_matrix_invalid",
  );
  requireCondition(Array.isArray(matrix.expectedWiringFindings), "runtime_parity_matrix_invalid");
  for (const finding of matrix.expectedWiringFindings) {
    exactKeys(finding, ["code", "role", "skill"]);
    requireCondition(
      finding.code === "wiring_role_binding_missing" &&
        (finding.role === "gsd-plan-checker" || finding.role === "gsd-planner") &&
        finding.skill === PLANNING_PROOF_SKILL,
      "runtime_parity_matrix_invalid",
    );
  }
  requireCondition(
    JSON.stringify(matrix.expectedWiringFindings) ===
      JSON.stringify([...matrix.expectedWiringFindings].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"))) &&
      (
        matrix.expectedWiringFindings.length === 0 ||
        JSON.stringify(matrix.expectedWiringFindings.map((finding) => finding.role).sort()) ===
          JSON.stringify(["gsd-plan-checker", "gsd-planner"])
      ),
    "runtime_parity_matrix_invalid",
  );
  requireCondition(Array.isArray(matrix.rows), "runtime_parity_matrix_invalid");
  exactKeys(matrix.skillSurface, ["expectedGsdSkillCount", "codexRoot", "claudeRoot", "manifests"]);
  requireCondition(
    Number.isInteger(matrix.skillSurface.expectedGsdSkillCount) &&
      matrix.skillSurface.expectedGsdSkillCount > 0 &&
      matrix.skillSurface.codexRoot === "~/.agents/skills" &&
      matrix.skillSurface.claudeRoot === "~/.claude/skills",
    "runtime_parity_matrix_invalid",
  );
  requireCondition(
    matrix.skillSurface.manifests && typeof matrix.skillSurface.manifests === "object" && !Array.isArray(matrix.skillSurface.manifests),
    "runtime_parity_matrix_invalid",
  );
  exactKeys(matrix.skillSurface.manifests, ["codex", "claude"]);
  for (const manifest of Object.values(matrix.skillSurface.manifests)) {
    requireCondition(
      manifest && typeof manifest === "object" && !Array.isArray(manifest) &&
        Object.keys(manifest).length === matrix.skillSurface.expectedGsdSkillCount &&
        Object.keys(manifest).every((name) => /^gsd-[a-z0-9-]+$/.test(name)) &&
        Object.values(manifest).every((value) => /^[0-9a-f]{64}$/.test(value)),
      "runtime_parity_matrix_invalid",
    );
  }
  requireCondition(
    JSON.stringify(Object.keys(matrix.skillSurface.manifests.codex)) ===
      JSON.stringify(Object.keys(matrix.skillSurface.manifests.claude)),
    "runtime_parity_matrix_invalid",
  );
  exactKeys(matrix.projectInstructionFiles, ["codex", "claude"]);
  exactKeys(matrix.projectInstructionFiles.codex, ["path", "sha256"]);
  exactKeys(matrix.projectInstructionFiles.claude, ["path", "sha256"]);
  requireCondition(
    matrix.projectInstructionFiles.codex.path === "AGENTS.md" &&
      matrix.projectInstructionFiles.claude.path === ".claude/CLAUDE.md" &&
      /^[0-9a-f]{64}$/.test(matrix.projectInstructionFiles.codex.sha256) &&
      /^[0-9a-f]{64}$/.test(matrix.projectInstructionFiles.claude.sha256),
    "runtime_parity_matrix_invalid",
  );
  exactKeys(matrix.sharedConfig, ["sha256", "runtime", "hostIdentityAuthoritative"]);
  requireCondition(
    /^[0-9a-f]{64}$/.test(matrix.sharedConfig.sha256 ?? "") &&
      matrix.sharedConfig.runtime === "codex" &&
      matrix.sharedConfig.hostIdentityAuthoritative === false,
    "runtime_parity_matrix_invalid",
  );
  exactKeys(matrix.hostProfiles, ["codex", "claude"]);
  const hostProfileKeys = ["embeddingMode", "maxDepth", "backgroundDispatch", "sandboxTier", "configFormat", "writesSharedSettings"];
  exactKeys(matrix.hostProfiles.codex, hostProfileKeys);
  exactKeys(matrix.hostProfiles.claude, hostProfileKeys);
  const ids = matrix.rows.map((row) => row.id);
  requireCondition(new Set(ids).size === ids.length, "runtime_parity_matrix_duplicate_row");
  requireCondition(
    JSON.stringify([...ids].sort()) === JSON.stringify([...REQUIRED_ROWS].sort()),
    "runtime_parity_matrix_row_set_mismatch",
  );
  for (const row of matrix.rows) {
    requireCondition(STATUSES.has(row.status), "runtime_parity_matrix_status_invalid");
    requireCondition(typeof row.proof === "string" && row.proof.length > 0, "runtime_parity_matrix_proof_missing");
    requireCondition(typeof row.codex === "string" && typeof row.claude === "string", "runtime_parity_matrix_observation_missing");
    requireCondition(typeof row.residualRisk === "string" && row.residualRisk.length > 0, "runtime_parity_matrix_residual_missing");
    if (row.status === "intentional_difference") {
      requireCondition(
        typeof row.acceptedRationale === "string" && row.acceptedRationale.length >= 20,
        "runtime_parity_matrix_rationale_missing",
      );
    }
    exactKeys(
      row,
      row.status === "intentional_difference"
        ? ["id", "status", "proof", "codex", "claude", "acceptedRationale", "residualRisk"]
        : ["id", "status", "proof", "codex", "claude", "residualRisk"],
    );
  }
  const wiringStatus = matrix.rows.find((row) => row.id === "planner_checker_skill_wiring")?.status;
  requireCondition(
    wiringStatus === (matrix.expectedWiringFindings.length === 0 ? "equivalent" : "blocking"),
    "runtime_parity_matrix_invalid",
  );
  return matrix;
}

async function loadMatrix(matrixPath) {
  const raw = await readPlainFile(matrixPath, "runtime_parity_matrix_missing_or_unsafe");
  let matrix;
  try {
    matrix = JSON.parse(raw.toString("utf8"));
  } catch {
    fail("runtime_parity_matrix_invalid_json");
  }
  return { matrix: validateRuntimeParityMatrix(matrix), raw };
}

export function parseGeneratedRegistryRuntimes(raw) {
  const source = Buffer.isBuffer(raw) ? raw.toString("utf8") : String(raw);
  const prefix = "const runtimes = ";
  const suffix = "\n\nconst commandFamilies = ";
  const start = source.indexOf(prefix);
  requireCondition(start >= 0 && source.indexOf(prefix, start + prefix.length) === -1, "runtime_parity_core_registry_data_invalid");
  const end = source.indexOf(suffix, start + prefix.length);
  requireCondition(end > start, "runtime_parity_core_registry_data_invalid");
  const literal = source.slice(start + prefix.length, end).trim();
  requireCondition(literal.endsWith(";"), "runtime_parity_core_registry_data_invalid");
  let runtimes;
  try {
    runtimes = JSON.parse(literal.slice(0, -1));
  } catch {
    fail("runtime_parity_core_registry_data_invalid");
  }
  requireCondition(
    runtimes && typeof runtimes === "object" && !Array.isArray(runtimes) &&
      runtimes.codex?.runtime && runtimes.claude?.runtime,
    "runtime_parity_core_registry_data_invalid",
  );
  return runtimes;
}

function projectInstructionFromRegistry(runtimes, runtime) {
  if (runtime === "claude") return ".claude/CLAUDE.md";
  if (runtime === "copilot") return ".github/copilot-instructions.md";
  const declared = runtimes[runtime]?.runtime?.hostBehaviors?.projectInstructionFile;
  return typeof declared === "string" && declared.length > 0 ? declared : "AGENTS.md";
}

export async function inspectRuntimeCoreRoot(root, expectedCoreFiles, expectedVersion) {
  requireCondition(
    expectedCoreFiles && typeof expectedCoreFiles === "object" && !Array.isArray(expectedCoreFiles) &&
      JSON.stringify(Object.keys(expectedCoreFiles).sort()) === JSON.stringify(CORE_FILES) &&
      Object.values(expectedCoreFiles).every((digest) => typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest)),
    "runtime_parity_matrix_invalid",
  );
  const observed = {};
  const snapshots = {};
  const findings = [];
  for (const relative of CORE_FILES) {
    try {
      const raw = await readPlainFile(path.join(root, relative), "runtime_parity_core_file_missing");
      const digest = sha256(raw);
      observed[relative] = digest;
      snapshots[relative] = raw;
      if (digest !== expectedCoreFiles[relative]) addFinding(findings, "runtime_parity_core_digest_drift", { file: relative });
    } catch (error) {
      addFinding(findings, error instanceof RuntimeParityError ? error.code : "runtime_parity_core_read_failed", { file: relative });
    }
  }
  const version = snapshots.VERSION?.toString("utf8").trim() ?? null;
  if (version !== null && version !== expectedVersion) {
    addFinding(findings, "runtime_parity_version_drift", { observed: version });
  }
  let registryRuntimes = null;
  if (findings.length === 0) {
    try {
      registryRuntimes = parseGeneratedRegistryRuntimes(snapshots["bin/lib/capability-registry.cjs"]);
    } catch (error) {
      addFinding(
        findings,
        error instanceof RuntimeParityError ? error.code : "runtime_parity_core_registry_data_invalid",
      );
    }
  }
  findings.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  return {
    status: findings.length === 0 ? "pass" : "fail",
    version,
    observed,
    registryRuntimes,
    findings,
  };
}

function selectedHostProfile(runtimeDescriptor) {
  return {
    embeddingMode: runtimeDescriptor.runtime.hostIntegration.embeddingMode,
    maxDepth: runtimeDescriptor.runtime.hostIntegration.dispatch.maxDepth,
    backgroundDispatch: runtimeDescriptor.runtime.hostIntegration.dispatch.backgroundDispatch,
    sandboxTier: runtimeDescriptor.runtime.sandboxTier,
    configFormat: runtimeDescriptor.runtime.configFormat,
    writesSharedSettings: runtimeDescriptor.runtime.writesSharedSettings,
  };
}

export async function runDeterministicParitySmoke(projectRoot) {
  const good = await fs.readFile(path.join(projectRoot, "tests/fixtures/workflow/plan-proof-lint/good-exact-negative-control.md"), "utf8");
  const bad = await fs.readFile(path.join(projectRoot, "tests/fixtures/workflow/plan-proof-lint/bad-all-of-or.md"), "utf8");
  const codex = { good: lintPlanProof(good), bad: lintPlanProof(bad) };
  const claude = { good: lintPlanProof(good), bad: lintPlanProof(bad) };
  return {
    equivalent: JSON.stringify(codex) === JSON.stringify(claude),
    goodStatus: codex.good.status,
    badStatus: codex.bad.status,
    badRuleIds: codex.bad.findings.map((finding) => finding.ruleId),
  };
}

function addFinding(findings, code, details = {}) {
  findings.push({ code, ...details });
}

export function compareRuntimeWiringFindings(observed, expected) {
  if (
    !Array.isArray(observed) ||
    !Array.isArray(expected) ||
    !observed.every((finding) => finding && typeof finding === "object" && !Array.isArray(finding) && typeof finding.code === "string")
  ) {
    return {
      exact: false,
      findings: [{ code: "runtime_parity_wiring_result_invalid" }],
    };
  }
  const observedSorted = [...observed].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  const expectedSorted = [...expected].sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  if (JSON.stringify(observedSorted) === JSON.stringify(expectedSorted)) {
    return { exact: true, findings: [] };
  }
  const unmatchedExpected = [...expectedSorted];
  const findings = [];
  for (const finding of observedSorted) {
    const encoded = JSON.stringify(finding);
    const index = unmatchedExpected.findIndex((candidate) => JSON.stringify(candidate) === encoded);
    if (index >= 0) unmatchedExpected.splice(index, 1);
    else addFinding(findings, "runtime_parity_wiring_unexpected_finding", { wiringFinding: finding });
  }
  for (const finding of unmatchedExpected) {
    addFinding(findings, "runtime_parity_wiring_expected_finding_missing", { wiringFinding: finding });
  }
  addFinding(findings, "runtime_parity_wiring_matrix_stale", {
    observedCount: observedSorted.length,
    expectedCount: expectedSorted.length,
    observedSha256: sha256(Buffer.from(JSON.stringify(observedSorted), "utf8")),
    expectedSha256: sha256(Buffer.from(JSON.stringify(expectedSorted), "utf8")),
  });
  findings.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  return { exact: false, findings };
}

export async function verifyProjectVerifierFiles(projectRoot, expected) {
  requireCondition(
    expected && typeof expected === "object" && !Array.isArray(expected) &&
      JSON.stringify(Object.keys(expected).sort()) === JSON.stringify(PROJECT_VERIFIER_FILES) &&
      Object.values(expected).every((digest) => typeof digest === "string" && /^[0-9a-f]{64}$/.test(digest)),
    "runtime_parity_matrix_invalid",
  );
  const observed = {};
  const findings = [];
  for (const relative of PROJECT_VERIFIER_FILES) {
    try {
      const digest = sha256(await readPlainFile(path.join(projectRoot, relative), "runtime_parity_project_verifier_missing"));
      observed[relative] = digest;
      if (digest !== expected[relative]) addFinding(findings, "runtime_parity_project_verifier_drift", { file: relative });
    } catch (error) {
      addFinding(
        findings,
        error instanceof RuntimeParityError ? error.code : "runtime_parity_project_verifier_unreadable",
        { file: relative },
      );
    }
  }
  return {
    status: findings.length === 0 ? "pass" : "fail",
    observed,
    bundleSha256: sha256(Buffer.from(JSON.stringify(observed), "utf8")),
    findings,
  };
}

export function deriveRuntimeParityReadiness(status, rowCounts) {
  return status === "pass" && rowCounts.blocking === 0 && rowCounts.deferred === 0 ? "ready" : "not_ready";
}

async function captureRuntimeEvidence({
  projectRoot,
  matrixPath,
  planningConfigPath,
  codexRoot,
  claudeRoot,
  codexSkillsRoot,
  claudeSkillsRoot,
  instructionFiles,
  projectVerifierFiles,
}) {
  const evidence = {};
  async function capture(label, callback) {
    try {
      evidence[label] = await callback();
    } catch (error) {
      evidence[label] = `!${error instanceof RuntimeParityError ? error.code : "unreadable"}`;
    }
  }
  await capture("sourceSha", async () =>
    execFileSync("git", ["--no-replace-objects", "rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim(),
  );
  await capture("matrix", async () =>
    captureRuntimeParityFileEvidence(matrixPath, "runtime_parity_matrix_missing_or_unsafe"),
  );
  await capture("planningConfig", async () =>
    captureRuntimeParityFileEvidence(planningConfigPath, "runtime_parity_shared_config_missing"),
  );
  for (const relative of Object.keys(projectVerifierFiles).sort((left, right) => left.localeCompare(right, "en"))) {
    await capture(
      `projectVerifier:${relative}`,
      async () => captureRuntimeParityFileEvidence(path.join(projectRoot, relative), "runtime_parity_project_verifier_missing"),
    );
  }
  for (const [runtime, root] of [["codex", codexRoot], ["claude", claudeRoot]]) {
    for (const relative of CORE_FILES) {
      await capture(`core:${runtime}:${relative}`, async () =>
        captureRuntimeParityFileEvidence(path.join(root, relative), "runtime_parity_core_file_missing"),
      );
    }
  }
  await capture("skills:codex", async () => skillSurfaceEvidence(codexSkillsRoot));
  await capture("skills:claude", async () => skillSurfaceEvidence(claudeSkillsRoot));
  for (const [runtime, instruction] of Object.entries(instructionFiles)) {
    await capture(`instruction:${runtime}`, async () =>
      captureRuntimeParityFileEvidence(path.join(projectRoot, instruction.path), "runtime_parity_instruction_file_missing"),
    );
  }
  for (const relative of [
    "tests/fixtures/workflow/plan-proof-lint/good-exact-negative-control.md",
    "tests/fixtures/workflow/plan-proof-lint/bad-all-of-or.md",
  ]) {
    await capture(`smoke:${relative}`, async () =>
      captureRuntimeParityFileEvidence(path.join(projectRoot, relative), "runtime_parity_smoke_fixture_missing"),
    );
  }
  return evidence;
}

export async function checkLiveRuntimeParity(options) {
  exactKeys(options, options.testCheckpoint === undefined ? ["projectRoot"] : ["projectRoot", "testCheckpoint"], "runtime_parity_scope_override_forbidden");
  requireCondition(options.testCheckpoint === undefined || typeof options.testCheckpoint === "function", "runtime_parity_scope_override_forbidden");
  const scope = resolveWorkflowProjectScope({ projectRoot: options.projectRoot });
  const projectRoot = scope.projectRoot;
  const sourceShaBefore = execFileSync("git", ["--no-replace-objects", "rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
  }).trim();
  requireCondition(SOURCE_SHA_PATTERN.test(sourceShaBefore), "runtime_parity_source_sha_invalid");
  const matrixPath = path.join(projectRoot, "docs/workflow/runtime-parity.json");
  const loadedMatrix = await loadMatrix(matrixPath);
  const matrix = loadedMatrix.matrix;
  const matrixSha256 = sha256(loadedMatrix.raw);
  const home = userInfo().homedir;
  requireCondition(typeof home === "string" && path.isAbsolute(home), "runtime_parity_home_invalid");
  const codexRoot = path.join(home, ".codex/gsd-core");
  const claudeRoot = path.join(home, ".claude/gsd-core");
  const codexSkillsRoot = path.join(home, ".agents/skills");
  const claudeSkillsRoot = path.join(home, ".claude/skills");
  const planningScope = resolveCanonicalPlanningConfig({
    projectRoot,
    configPath: path.join(projectRoot, ".planning/config.json"),
  });
  const planningConfigPath = planningScope.configPath;
  const initialEvidence = await captureRuntimeEvidence({
    projectRoot,
    matrixPath,
    planningConfigPath,
    codexRoot,
    claudeRoot,
    codexSkillsRoot,
    claudeSkillsRoot,
    instructionFiles: matrix.projectInstructionFiles,
    projectVerifierFiles: matrix.projectVerifierFiles,
  });
  const findings = [];
  if (initialEvidence.sourceSha !== sourceShaBefore || initialEvidence.matrix?.sha256 !== matrixSha256) {
    addFinding(findings, "runtime_parity_evidence_changed_during_check");
  }
  const observedCore = Object.fromEntries(Object.keys(matrix.coreFiles).map((relative) => [relative, {}]));
  const runtimeCore = {};
  const projectVerifier = await verifyProjectVerifierFiles(projectRoot, matrix.projectVerifierFiles);
  findings.push(...projectVerifier.findings);

  for (const [runtime, root] of [["codex", codexRoot], ["claude", claudeRoot]]) {
    const inspected = await inspectRuntimeCoreRoot(root, matrix.coreFiles, matrix.gsdVersion);
    runtimeCore[runtime] = inspected;
    for (const [relative, digest] of Object.entries(inspected.observed)) {
      observedCore[relative][runtime] = digest;
    }
    for (const finding of inspected.findings) findings.push({ ...finding, runtime });
  }

  try {
    const codexSkills = await skillManifest(codexSkillsRoot);
    const claudeSkills = await skillManifest(claudeSkillsRoot);
    if (
      JSON.stringify(codexSkills) !== JSON.stringify(matrix.skillSurface.manifests.codex) ||
      JSON.stringify(claudeSkills) !== JSON.stringify(matrix.skillSurface.manifests.claude)
    ) {
      addFinding(findings, "runtime_parity_skill_surface_drift", {
        codexCount: Object.keys(codexSkills).length,
        claudeCount: Object.keys(claudeSkills).length,
      });
    }
  } catch {
    addFinding(findings, "runtime_parity_skill_surface_unreadable");
  }

  for (const [coreRuntime, inspected] of Object.entries(runtimeCore)) {
    if (inspected.status !== "pass") continue;
    for (const runtime of ["codex", "claude"]) {
      const observed = projectInstructionFromRegistry(inspected.registryRuntimes, runtime);
      if (observed !== matrix.projectInstructionFiles[runtime].path) {
        addFinding(findings, "runtime_parity_instruction_registry_drift", { coreRuntime, runtime, observed });
      }
      if (JSON.stringify(selectedHostProfile(inspected.registryRuntimes[runtime])) !== JSON.stringify(matrix.hostProfiles[runtime])) {
        addFinding(findings, "runtime_parity_host_profile_drift", { coreRuntime, runtime });
      }
    }
  }
  for (const [runtime, instruction] of Object.entries(matrix.projectInstructionFiles)) {
    try {
      const raw = await readPlainFile(path.join(projectRoot, instruction.path), "runtime_parity_instruction_file_missing");
      if (sha256(raw) !== instruction.sha256) addFinding(findings, "runtime_parity_instruction_digest_drift", { runtime });
    } catch (error) {
      addFinding(findings, error instanceof RuntimeParityError ? error.code : "runtime_parity_instruction_file_missing", { runtime });
    }
  }

  let planningConfigSha256 = null;
  let observedWiringFindings = null;
  try {
    const raw = await readPlainFile(planningConfigPath, "runtime_parity_shared_config_missing");
    planningConfigSha256 = sha256(raw);
    if (initialEvidence.planningConfig?.sha256 !== planningConfigSha256) {
      addFinding(findings, "runtime_parity_evidence_changed_during_check");
    }
    const config = JSON.parse(raw.toString("utf8"));
    if (planningConfigSha256 !== matrix.sharedConfig.sha256 || config.runtime !== matrix.sharedConfig.runtime) {
      addFinding(findings, "runtime_parity_shared_config_drift");
    }
    const wiring = await checkGsdHardeningWiring({ configPath: planningConfigPath, projectRoot });
    observedWiringFindings = wiring.findings;
    const wiringComparison = compareRuntimeWiringFindings(wiring.findings, matrix.expectedWiringFindings);
    findings.push(...wiringComparison.findings);
  } catch (error) {
    addFinding(findings, error instanceof RuntimeParityError ? error.code : "runtime_parity_shared_config_unreadable");
  }

  const smoke = await runDeterministicParitySmoke(projectRoot);
  if (!smoke.equivalent || smoke.goodStatus !== "pass" || smoke.badStatus !== "fail") {
    addFinding(findings, "runtime_parity_deterministic_smoke_failed");
  }
  findings.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  if (typeof options.testCheckpoint === "function") await options.testCheckpoint("before_final_freshness_check");
  const finalEvidence = await captureRuntimeEvidence({
    projectRoot,
    matrixPath,
    planningConfigPath,
    codexRoot,
    claudeRoot,
    codexSkillsRoot,
    claudeSkillsRoot,
    instructionFiles: matrix.projectInstructionFiles,
    projectVerifierFiles: matrix.projectVerifierFiles,
  });
  if (JSON.stringify(finalEvidence) !== JSON.stringify(initialEvidence)) {
    addFinding(findings, "runtime_parity_evidence_changed_during_check");
    findings.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  }
  const rowCounts = Object.fromEntries([...STATUSES].map((status) => [status, matrix.rows.filter((row) => row.status === status).length]));
  const status = findings.length === 0 ? "pass" : "fail";
  return {
    schemaVersion: 1,
    kind: "nutrition_runtime_parity_check",
    status,
    readiness: deriveRuntimeParityReadiness(status, rowCounts),
    sourceSha: sourceShaBefore,
    matrixSha256,
    projectVerifierBundleSha256: projectVerifier.bundleSha256,
    planningConfigSha256,
    observedWiringFindings,
    evidenceSnapshotSha256: sha256(Buffer.from(JSON.stringify(initialEvidence), "utf8")),
    worktreeIdentitySha256: scope.worktreeIdentitySha256,
    gitCommonIdentitySha256: scope.gitCommonIdentitySha256,
    gsdVersion: matrix.gsdVersion,
    rowCounts,
    observedCore,
    deterministicSmoke: smoke,
    findings,
  };
}

function parseCli(argv) {
  const values = {};
  for (const arg of argv) {
    const match = arg.match(/^--(project-root)=(.*)$/s);
    requireCondition(match && !Object.hasOwn(values, match[1]), "runtime_parity_usage_error");
    values[match[1]] = match[2];
  }
  requireCondition(typeof values["project-root"] === "string", "runtime_parity_usage_error");
  return values;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  try {
    const values = parseCli(process.argv.slice(2));
    const result = await checkLiveRuntimeParity({ projectRoot: values["project-root"] });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === "pass" ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "nutrition_runtime_parity_error",
        code: error instanceof RuntimeParityError ? error.code : "runtime_parity_unexpected_error",
      })}\n`,
    );
    process.exitCode = 1;
  }
}
