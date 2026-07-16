#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveCanonicalPhaseRoot } from "./project-scope.mjs";
import { verifyWorkflowLeaseSignature, withWorkflowWriterFence } from "./workflow-lease.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const RUNTIMES = new Set(["codex", "claude"]);
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:Z|[+-]\d{2}:\d{2})$/;
const PHASE_ID_PATTERN = /^\d+(?:\.\d+)?$/;
const MAX_INPUT_BYTES = 4 * 1024 * 1024;
const SEAL_KEYS = [
  "evidenceManifestSha256",
  "executionRuntime",
  "gsdVersion",
  "gitCommonIdentitySha256",
  "inputs",
  "kind",
  "modelProfile",
  "phaseId",
  "phaseRootRelative",
  "schemaVersion",
  "verifiedAt",
  "verifiedSourceSha",
  "worktreeIdentitySha256",
  "workflowFenceId",
  "workflowLeaseId",
  "leaseAttestationSha256",
  "sealSha256",
  "sealSignature",
].sort();
const DRAFT_KEYS = [
  "evidenceManifestSha256",
  "gitCommonIdentitySha256",
  "inputs",
  "kind",
  "phaseId",
  "phaseRootRelative",
  "schemaVersion",
  "verifiedAt",
  "verifiedSourceSha",
  "worktreeIdentitySha256",
].sort();

export class VerificationSealError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = "VerificationSealError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, details) {
  throw new VerificationSealError(code, details);
}

function requireCondition(condition, code, details) {
  if (!condition) {
    fail(code, details);
  }
}

function normalizeRelativeFile(root, value, code = "seal_input_invalid") {
  requireCondition(typeof value === "string" && value.length > 0, code);
  requireCondition(!path.isAbsolute(value) && !value.includes("\\"), code);
  const normalized = path.posix.normalize(value);
  requireCondition(normalized !== "." && normalized !== ".." && !normalized.startsWith("../"), code);
  const absolute = path.resolve(root, normalized);
  const relative = path.relative(root, absolute);
  requireCondition(relative && !relative.startsWith("..") && !path.isAbsolute(relative), code);
  return { relative: normalized, absolute };
}

function canonicalPhaseScope(options, phaseId) {
  try {
    return resolveCanonicalPhaseRoot({ projectRoot: options.projectRoot, phaseRoot: options.root, phaseId });
  } catch (error) {
    fail(typeof error?.code === "string" ? error.code : "seal_project_scope_invalid");
  }
}

function normalizeDirectPhaseFile(root, value, phaseId, code) {
  const normalized = normalizeRelativeFile(root, value, code);
  requireCondition(path.posix.dirname(normalized.relative) === ".", code);
  const escaped = phaseId.replaceAll(".", "\\.");
  const allowed = new RegExp(`^${escaped}(?:-\\d+-SUMMARY|-(?:UAT|VALIDATION|VERIFICATION))\\.md$`);
  requireCondition(allowed.test(normalized.relative), code);
  return normalized;
}

function normalizeSealPath(root, value, phaseId) {
  const normalized = normalizeRelativeFile(root, value, "seal_path_invalid");
  requireCondition(normalized.relative === `${phaseId}-SEAL.json`, "seal_path_invalid");
  return normalized;
}

function resolveSourceSha(projectRoot) {
  let value;
  try {
    value = execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.resolve(projectRoot), encoding: "utf8" }).trim();
  } catch {
    fail("seal_project_git_required");
  }
  requireCondition(SHA_PATTERN.test(value), "seal_live_source_sha_invalid");
  return value;
}

function exactKeys(value, expected, code) {
  requireCondition(value && typeof value === "object" && !Array.isArray(value), code);
  requireCondition(JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expected), code);
}

function validateSealSchema(seal) {
  exactKeys(seal, SEAL_KEYS, "seal_schema_invalid");
  requireCondition(seal.schemaVersion === 2 && seal.kind === "workflow_verification_seal", "seal_schema_invalid");
  requireCondition(typeof seal.phaseId === "string" && PHASE_ID_PATTERN.test(seal.phaseId), "seal_schema_invalid");
  requireCondition(
    typeof seal.phaseRootRelative === "string" &&
      seal.phaseRootRelative.startsWith(".planning/") &&
      path.posix.normalize(seal.phaseRootRelative) === seal.phaseRootRelative,
    "seal_schema_invalid",
  );
  requireCondition(/^[0-9a-f]{64}$/.test(seal.worktreeIdentitySha256 ?? ""), "seal_schema_invalid");
  requireCondition(/^[0-9a-f]{64}$/.test(seal.gitCommonIdentitySha256 ?? ""), "seal_schema_invalid");
  requireCondition(typeof seal.verifiedSourceSha === "string" && SHA_PATTERN.test(seal.verifiedSourceSha), "seal_schema_invalid");
  requireCondition(RUNTIMES.has(seal.executionRuntime), "seal_schema_invalid");
  requireCondition(typeof seal.gsdVersion === "string" && VERSION_PATTERN.test(seal.gsdVersion), "seal_schema_invalid");
  requireCondition(typeof seal.modelProfile === "string" && SAFE_ID_PATTERN.test(seal.modelProfile), "seal_schema_invalid");
  requireCondition(typeof seal.verifiedAt === "string" && RFC3339_PATTERN.test(seal.verifiedAt), "seal_schema_invalid");
  requireCondition(Array.isArray(seal.inputs) && seal.inputs.length > 0, "seal_schema_invalid");
  for (const input of seal.inputs) {
    exactKeys(input, ["path", "sha256"], "seal_input_schema_invalid");
    requireCondition(typeof input.path === "string" && typeof input.sha256 === "string" && /^[0-9a-f]{64}$/.test(input.sha256), "seal_input_schema_invalid");
  }
  requireCondition(typeof seal.evidenceManifestSha256 === "string" && /^[0-9a-f]{64}$/.test(seal.evidenceManifestSha256), "seal_digest_invalid");
  requireCondition(/^[0-9a-f-]{36}$/.test(seal.workflowLeaseId ?? ""), "seal_schema_invalid");
  requireCondition(/^[0-9a-f-]{36}$/.test(seal.workflowFenceId ?? ""), "seal_schema_invalid");
  requireCondition(/^[0-9a-f]{64}$/.test(seal.leaseAttestationSha256 ?? ""), "seal_schema_invalid");
  requireCondition(/^[0-9a-f]{64}$/.test(seal.sealSha256 ?? ""), "seal_digest_invalid");
  requireCondition(/^[A-Za-z0-9_-]+$/.test(seal.sealSignature ?? ""), "seal_signature_invalid");
}

async function discoverVerificationInputs(root, sealPath) {
  const phaseId = path.basename(sealPath).match(/^(\d+(?:\.\d+)?)-SEAL\.json$/)?.[1];
  requireCondition(phaseId !== undefined, "seal_path_invalid");
  const target = normalizeSealPath(root, sealPath, phaseId);
  const directory = path.dirname(target.absolute);
  const entries = await fs.readdir(directory, { withFileTypes: true }).catch(() => []);
  const relative = [];
  for (const entry of entries) {
    if (!/(?:-SUMMARY|-UAT|-VALIDATION|-VERIFICATION)\.md$/.test(entry.name)) continue;
    requireCondition(entry.isFile() && !entry.isSymbolicLink(), "seal_dependency_unsafe");
    relative.push(path.posix.join(path.posix.dirname(target.relative), entry.name).replace(/^\.\//, ""));
  }
  relative.sort((left, right) => left.localeCompare(right, "en"));
  requireCondition(relative.length > 0, "seal_required_inputs_invalid");
  return relative;
}

async function readPlainFileSnapshot(filePath, code) {
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    fail(code);
  }
  try {
    const stat = await handle.stat();
    requireCondition(stat.isFile() && stat.size <= MAX_INPUT_BYTES, code);
    const raw = await handle.readFile();
    return { sha256: createHash("sha256").update(raw).digest("hex"), dev: stat.dev, ino: stat.ino, size: stat.size };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function stablePlainFileSnapshot(filePath, code) {
  const first = await readPlainFileSnapshot(filePath, code);
  const second = await readPlainFileSnapshot(filePath, code);
  requireCondition(
    first.dev === second.dev && first.ino === second.ino && first.size === second.size && first.sha256 === second.sha256,
    "seal_input_changed_during_read",
  );
  return second;
}

function sameFileSnapshot(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.sha256 === right.sha256;
}

function observationTimestamp(now = new Date()) {
  requireCondition(now instanceof Date && !Number.isNaN(now.valueOf()), "seal_observation_time_invalid");
  return new Date(now.valueOf() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00");
}

function manifestPayload(seal) {
  return {
    schemaVersion: seal.schemaVersion,
    kind: seal.kind,
    phaseId: seal.phaseId,
    phaseRootRelative: seal.phaseRootRelative,
    worktreeIdentitySha256: seal.worktreeIdentitySha256,
    gitCommonIdentitySha256: seal.gitCommonIdentitySha256,
    verifiedSourceSha: seal.verifiedSourceSha,
    executionRuntime: seal.executionRuntime,
    gsdVersion: seal.gsdVersion,
    modelProfile: seal.modelProfile,
    workflowLeaseId: seal.workflowLeaseId,
    workflowFenceId: seal.workflowFenceId,
    leaseAttestationSha256: seal.leaseAttestationSha256,
    verifiedAt: seal.verifiedAt,
    inputs: seal.inputs,
  };
}

function sealDigestPayload(seal) {
  return { ...manifestPayload(seal), evidenceManifestSha256: seal.evidenceManifestSha256 };
}

function sealSignaturePayload(seal) {
  return { ...sealDigestPayload(seal), sealSha256: seal.sealSha256 };
}

function digestPayload(payload) {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function createVerificationSeal(options) {
  requireCondition(typeof options.phaseId === "string" && PHASE_ID_PATTERN.test(options.phaseId), "seal_phase_id_invalid");
  const scope = canonicalPhaseScope(options, options.phaseId);
  const root = scope.phaseRoot;
  const sourceShaBefore = resolveSourceSha(scope.projectRoot);
  requireCondition(typeof options.verifiedSourceSha === "string" && SHA_PATTERN.test(options.verifiedSourceSha), "seal_source_sha_invalid");
  requireCondition(options.verifiedSourceSha === sourceShaBefore, "seal_live_source_sha_mismatch");
  requireCondition(Array.isArray(options.inputs) && options.inputs.length > 0, "seal_inputs_required");

  const normalized = options.inputs.map((input) => normalizeDirectPhaseFile(root, input, options.phaseId, "seal_input_invalid"));
  const relativePaths = normalized.map((input) => input.relative);
  requireCondition(new Set(relativePaths).size === relativePaths.length, "seal_input_duplicate");
  normalized.sort((left, right) => left.relative.localeCompare(right.relative, "en"));
  const inputs = [];
  for (const input of normalized) {
    inputs.push({ path: input.relative, sha256: (await stablePlainFileSnapshot(input.absolute, "seal_input_missing_or_unsafe")).sha256 });
  }
  requireCondition(resolveSourceSha(scope.projectRoot) === sourceShaBefore, "seal_live_source_sha_changed");

  const seal = {
    schemaVersion: 1,
    kind: "workflow_verification_seal",
    phaseId: options.phaseId,
    phaseRootRelative: scope.phaseRootRelative,
    worktreeIdentitySha256: scope.worktreeIdentitySha256,
    gitCommonIdentitySha256: scope.gitCommonIdentitySha256,
    verifiedSourceSha: options.verifiedSourceSha,
    verifiedAt: observationTimestamp(options.now),
    inputs,
  };
  return { ...seal, evidenceManifestSha256: digestPayload(manifestPayload(seal)) };
}

async function readSeal(root, sealPath) {
  const phaseId = path.basename(sealPath).match(/^(\d+(?:\.\d+)?)-SEAL\.json$/)?.[1];
  requireCondition(phaseId !== undefined, "seal_path_invalid");
  const target = normalizeSealPath(root, sealPath, phaseId);
  let handle;
  try {
    handle = await fs.open(target.absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    fail("seal_file_missing_or_unsafe");
  }
  let seal;
  let raw;
  let stat;
  try {
    stat = await handle.stat();
    requireCondition(stat.isFile() && stat.size <= 64 * 1024, "seal_file_missing_or_unsafe");
    raw = await handle.readFile("utf8");
    seal = JSON.parse(raw);
  } catch {
    fail("seal_file_invalid");
  } finally {
    await handle.close().catch(() => undefined);
  }
  validateSealSchema(seal);
  return { target, seal, raw, rawSha256: digestPayload(raw), dev: stat.dev, ino: stat.ino };
}

async function stableReadSeal(root, sealPath) {
  const first = await readSeal(root, sealPath);
  const second = await readSeal(root, sealPath);
  requireCondition(
    first.dev === second.dev && first.ino === second.ino && first.rawSha256 === second.rawSha256,
    "seal_changed_during_read",
  );
  return second;
}

async function verifySealSignature(projectRoot, seal) {
  requireCondition(digestPayload(manifestPayload(seal)) === seal.evidenceManifestSha256, "seal_manifest_tampered");
  requireCondition(digestPayload(sealDigestPayload(seal)) === seal.sealSha256, "seal_digest_tampered");
  const attestation = await verifyWorkflowLeaseSignature({
    projectRoot,
    leaseId: seal.workflowLeaseId,
    attestationSha256: seal.leaseAttestationSha256,
    payload: sealSignaturePayload(seal),
    signature: seal.sealSignature,
  }).catch((error) => fail(error?.code === "lease_signature_invalid" ? "seal_signature_invalid" : "seal_attestation_invalid"));
  requireCondition(attestation.executionRuntime === seal.executionRuntime, "seal_holder_identity_mismatch");
  requireCondition(attestation.gsdVersion === seal.gsdVersion, "seal_holder_identity_mismatch");
  requireCondition(attestation.modelProfile === seal.modelProfile, "seal_holder_identity_mismatch");
  return attestation;
}

export async function checkVerificationSeal(options) {
  let loaded;
  try {
    requireCondition(typeof options.expectedSourceSha === "string" && SHA_PATTERN.test(options.expectedSourceSha), "seal_expected_source_sha_required");
    requireCondition(typeof options.expectedPhaseId === "string" && PHASE_ID_PATTERN.test(options.expectedPhaseId), "seal_expected_phase_required");
    requireCondition(RUNTIMES.has(options.expectedRuntime), "seal_expected_runtime_required");
    requireCondition(VERSION_PATTERN.test(options.expectedGsdVersion ?? ""), "seal_expected_gsd_version_required");
    requireCondition(SAFE_ID_PATTERN.test(options.expectedModelProfile ?? ""), "seal_expected_model_profile_required");
    requireCondition(/^[0-9a-f-]{36}$/.test(options.expectedWorkflowLeaseId ?? ""), "seal_expected_lease_id_required");
    const scope = canonicalPhaseScope(options, options.expectedPhaseId);
    const root = scope.phaseRoot;
    const sourceShaBefore = resolveSourceSha(scope.projectRoot);
    requireCondition(sourceShaBefore === options.expectedSourceSha, "seal_live_source_sha_mismatch");
    loaded = await stableReadSeal(root, options.sealPath);
    const { seal } = loaded;
    await verifySealSignature(scope.projectRoot, seal);
    requireCondition(seal.phaseId === options.expectedPhaseId, "seal_phase_id_mismatch");
    requireCondition(seal.phaseRootRelative === scope.phaseRootRelative, "seal_phase_root_mismatch");
    requireCondition(seal.worktreeIdentitySha256 === scope.worktreeIdentitySha256, "seal_worktree_identity_mismatch");
    requireCondition(seal.gitCommonIdentitySha256 === scope.gitCommonIdentitySha256, "seal_git_common_identity_mismatch");
    requireCondition(seal.verifiedSourceSha === options.expectedSourceSha, "seal_source_sha_mismatch");
    requireCondition(seal.executionRuntime === options.expectedRuntime, "seal_runtime_mismatch");
    requireCondition(seal.gsdVersion === options.expectedGsdVersion, "seal_gsd_version_mismatch");
    requireCondition(seal.modelProfile === options.expectedModelProfile, "seal_model_profile_mismatch");
    requireCondition(seal.workflowLeaseId === options.expectedWorkflowLeaseId, "seal_lease_id_mismatch");
    const paths = seal.inputs.map((input) => normalizeDirectPhaseFile(root, input.path, seal.phaseId, "seal_input_invalid").relative);
    requireCondition(new Set(paths).size === paths.length, "seal_input_duplicate");
    const discoveredInputs = await discoverVerificationInputs(root, options.sealPath);
    let requiredPaths = discoveredInputs;
    if (options.requiredInputs !== undefined) {
      requireCondition(Array.isArray(options.requiredInputs) && options.requiredInputs.length > 0, "seal_required_inputs_invalid");
      requiredPaths = options.requiredInputs.map((input) => normalizeDirectPhaseFile(root, input, seal.phaseId, "seal_required_inputs_invalid").relative);
      requireCondition(new Set(requiredPaths).size === requiredPaths.length, "seal_required_inputs_invalid");
      requiredPaths.sort((left, right) => left.localeCompare(right, "en"));
      requireCondition(JSON.stringify(requiredPaths) === JSON.stringify(discoveredInputs), "seal_required_inputs_incomplete");
    }
    const actualSorted = [...paths].sort((left, right) => left.localeCompare(right, "en"));
    requireCondition(JSON.stringify(actualSorted) === JSON.stringify(requiredPaths), "seal_input_set_mismatch");

    const staleInputs = [];
    const inputSnapshots = new Map();
    for (const input of seal.inputs) {
      const normalized = normalizeDirectPhaseFile(root, input.path, seal.phaseId, "seal_input_invalid");
      const snapshot = await stablePlainFileSnapshot(normalized.absolute, "seal_input_missing_or_unsafe");
      inputSnapshots.set(input.path, { absolute: normalized.absolute, snapshot });
      if (snapshot.sha256 !== input.sha256) {
        staleInputs.push(input.path);
      }
    }
    staleInputs.sort((left, right) => left.localeCompare(right, "en"));
    requireCondition(resolveSourceSha(scope.projectRoot) === sourceShaBefore, "seal_live_source_sha_changed");
    if (typeof options.testHook === "function") await options.testHook("before_final_pair_check");
    const finalSeal = await readSeal(root, options.sealPath);
    requireCondition(
      finalSeal.dev === loaded.dev && finalSeal.ino === loaded.ino && finalSeal.rawSha256 === loaded.rawSha256,
      "seal_changed_during_check",
    );
    for (const { absolute, snapshot } of inputSnapshots.values()) {
      requireCondition(sameFileSnapshot(await readPlainFileSnapshot(absolute, "seal_input_missing_or_unsafe"), snapshot), "seal_input_changed_during_check");
    }
    requireCondition(resolveSourceSha(scope.projectRoot) === sourceShaBefore, "seal_live_source_sha_changed");
    return {
      schemaVersion: 1,
      kind: "workflow_verification_seal_check",
      status: staleInputs.length === 0 ? "pass" : "fail",
      code: staleInputs.length === 0 ? "verification_fresh" : "stale_verification",
      phaseId: seal.phaseId,
      phaseRootRelative: seal.phaseRootRelative,
      worktreeIdentitySha256: seal.worktreeIdentitySha256,
      gitCommonIdentitySha256: seal.gitCommonIdentitySha256,
      evidenceManifestSha256: seal.evidenceManifestSha256,
      staleInputs,
    };
  } catch (error) {
    if (error instanceof VerificationSealError) {
      return {
        schemaVersion: 1,
        kind: "workflow_verification_seal_check",
        status: "fail",
        code: error.code,
        staleInputs: [],
      };
    }
    throw error;
  }
}

async function writeVerificationSealUnderFence(options, holder) {
  const draft = options.seal;
  requireCondition(draft?.schemaVersion === 1 && draft.kind === "workflow_verification_seal", "seal_draft_invalid");
  exactKeys(draft, DRAFT_KEYS, "seal_draft_invalid");
  requireCondition(typeof draft.phaseId === "string" && PHASE_ID_PATTERN.test(draft.phaseId), "seal_draft_invalid");
  requireCondition(digestPayload(manifestPayload(draft)) === draft.evidenceManifestSha256, "seal_manifest_tampered");
  const scope = canonicalPhaseScope(options, draft.phaseId);
  const root = scope.phaseRoot;
  const target = normalizeSealPath(root, options.sealPath, draft.phaseId);
  requireCondition(draft.phaseRootRelative === scope.phaseRootRelative, "seal_phase_root_mismatch");
  requireCondition(draft.worktreeIdentitySha256 === scope.worktreeIdentitySha256, "seal_worktree_identity_mismatch");
  requireCondition(draft.gitCommonIdentitySha256 === scope.gitCommonIdentitySha256, "seal_git_common_identity_mismatch");
  requireCondition(draft.verifiedSourceSha === resolveSourceSha(scope.projectRoot), "seal_live_source_sha_mismatch");
  const captureFresh = async (changedCode) => {
    const discoveredInputs = await discoverVerificationInputs(root, options.sealPath);
    const declaredInputs = draft.inputs
      .map((input) => normalizeDirectPhaseFile(root, input.path, draft.phaseId, "seal_input_invalid").relative)
      .sort((left, right) => left.localeCompare(right, "en"));
    requireCondition(JSON.stringify(declaredInputs) === JSON.stringify(discoveredInputs), "seal_input_set_mismatch");
    const snapshots = new Map();
    for (const input of draft.inputs) {
      const normalized = normalizeDirectPhaseFile(root, input.path, draft.phaseId, "seal_input_invalid");
      const snapshot = await stablePlainFileSnapshot(normalized.absolute, "seal_input_missing_or_unsafe");
      requireCondition(snapshot.sha256 === input.sha256, changedCode);
      snapshots.set(input.path, { absolute: normalized.absolute, snapshot });
    }
    return snapshots;
  };
  const initialInputs = await captureFresh("seal_input_changed_before_write");
  const existingStat = await fs.lstat(target.absolute).catch(() => null);
  const existing = existingStat === null ? null : await stableReadSeal(root, target.relative);
  if (existing !== null) {
    requireCondition(typeof options.replaceDigest === "string" && /^[0-9a-f]{64}$/.test(options.replaceDigest), "seal_replace_digest_required");
    requireCondition(existing.seal.evidenceManifestSha256 === options.replaceDigest, "seal_replace_digest_mismatch");
  } else {
    requireCondition(options.replaceDigest === undefined, "seal_replace_target_missing");
  }

  const baseSeal = {
    schemaVersion: 2,
    kind: "workflow_verification_seal",
    phaseId: draft.phaseId,
    phaseRootRelative: scope.phaseRootRelative,
    worktreeIdentitySha256: scope.worktreeIdentitySha256,
    gitCommonIdentitySha256: scope.gitCommonIdentitySha256,
    verifiedSourceSha: draft.verifiedSourceSha,
    executionRuntime: holder.executionRuntime,
    gsdVersion: holder.gsdVersion,
    modelProfile: holder.modelProfile,
    workflowLeaseId: holder.leaseId,
    workflowFenceId: holder.fenceId,
    leaseAttestationSha256: holder.leaseAttestationSha256,
    verifiedAt: draft.verifiedAt,
    inputs: draft.inputs,
  };
  const withManifest = { ...baseSeal, evidenceManifestSha256: digestPayload(manifestPayload(baseSeal)) };
  const withDigest = { ...withManifest, sealSha256: digestPayload(sealDigestPayload(withManifest)) };
  const signedSeal = { ...withDigest, sealSignature: holder.signPayload(sealSignaturePayload(withDigest)) };
  validateSealSchema(signedSeal);

  const temp = path.join(path.dirname(target.absolute), `.${path.basename(target.absolute)}.tmp-${randomUUID()}`);
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(signedSeal, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await holder.assertCurrent();
    requireCondition(signedSeal.verifiedSourceSha === resolveSourceSha(scope.projectRoot), "seal_live_source_sha_changed");
    const beforePublishInputs = await captureFresh("seal_input_changed_before_write");
    for (const [name, original] of initialInputs) {
      requireCondition(sameFileSnapshot(beforePublishInputs.get(name).snapshot, original.snapshot), "seal_input_changed_before_write");
    }
    if (existing === null) {
      try {
        await fs.link(temp, target.absolute);
      } catch (error) {
        if (error && typeof error === "object" && error.code === "EEXIST") {
          fail("seal_destination_exists");
        }
        throw error;
      }
      await fs.unlink(temp);
    } else {
      const current = await readSeal(root, target.relative);
      requireCondition(
        current.dev === existing.dev && current.ino === existing.ino && current.rawSha256 === existing.rawSha256,
        "seal_replace_target_changed",
      );
      await fs.rename(temp, target.absolute);
    }
    const directory = await fs.open(path.dirname(target.absolute), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    if (typeof options.testHook === "function") await options.testHook("after_seal_publication");
    await holder.assertCurrent();
    requireCondition(signedSeal.verifiedSourceSha === resolveSourceSha(scope.projectRoot), "seal_live_source_sha_changed");
    const published = await stableReadSeal(root, target.relative);
    requireCondition(published.seal.sealSha256 === signedSeal.sealSha256, "seal_publication_changed");
    await verifySealSignature(scope.projectRoot, published.seal);
    for (const [name, prior] of beforePublishInputs) {
      requireCondition(
        sameFileSnapshot(await readPlainFileSnapshot(prior.absolute, "seal_input_missing_or_unsafe"), prior.snapshot),
        "seal_input_changed_after_write",
        { input: name },
      );
    }
    await holder.assertCurrent();
    requireCondition(signedSeal.verifiedSourceSha === resolveSourceSha(scope.projectRoot), "seal_live_source_sha_changed");
  } finally {
    await fs.unlink(temp).catch(() => undefined);
  }
  return {
    schemaVersion: 1,
    kind: "workflow_verification_seal_write",
    status: "pass",
    phaseId: signedSeal.phaseId,
    phaseRootRelative: signedSeal.phaseRootRelative,
    worktreeIdentitySha256: signedSeal.worktreeIdentitySha256,
    gitCommonIdentitySha256: signedSeal.gitCommonIdentitySha256,
    evidenceManifestSha256: signedSeal.evidenceManifestSha256,
    sealSha256: signedSeal.sealSha256,
    workflowLeaseId: signedSeal.workflowLeaseId,
    writerFenceId: holder.fenceId,
    writerFenceReleased: true,
    cleanupRequired: false,
  };
}

export async function writeVerificationSeal(options) {
  requireCondition(options.seal?.schemaVersion === 1 && options.seal.kind === "workflow_verification_seal", "seal_draft_invalid");
  const scope = canonicalPhaseScope(options, options.seal.phaseId);
  const scopedOptions = { ...options, projectRoot: scope.projectRoot, root: scope.phaseRoot };
  return withWorkflowWriterFence(
    {
      projectRoot: scope.projectRoot,
      tokenFile: options.tokenFile,
      expectedRuntime: options.expectedRuntime,
      purpose: "workflow_command",
      maxDurationSeconds: options.maxDurationSeconds ?? 30,
      now: options.now,
      fenceId: options.fenceId,
    },
    (holder) => writeVerificationSealUnderFence(scopedOptions, holder),
  );
}

function parseCli(argv) {
  const [command, ...args] = argv;
  const schemas = {
    create: {
      required: new Set(["root", "project-root", "phase", "source-sha", "runtime", "seal", "token-file"]),
      optional: new Set(["replace-digest"]),
      inputs: true,
    },
    check: {
      required: new Set(["root", "project-root", "phase", "source-sha", "lease-id", "runtime", "gsd-version", "model-profile", "seal"]),
      optional: new Set(),
      inputs: false,
    },
  };
  const schema = schemas[command];
  requireCondition(schema !== undefined, "seal_usage_error");
  const values = {};
  const inputs = [];
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.*)$/s);
    if (!match) {
      fail("seal_usage_error");
    }
    requireCondition(match[2].length > 0, "seal_usage_error");
    if (match[1] === "input" && schema.inputs) {
      inputs.push(match[2]);
    } else {
      requireCondition(
        (schema.required.has(match[1]) || schema.optional.has(match[1])) && !Object.hasOwn(values, match[1]),
        "seal_usage_error",
      );
      values[match[1]] = match[2];
    }
  }
  requireCondition([...schema.required].every((key) => Object.hasOwn(values, key)), "seal_usage_error");
  if (schema.inputs) requireCondition(inputs.length > 0, "seal_usage_error");
  return { command, values, inputs };
}

function required(values, key) {
  requireCondition(typeof values[key] === "string" && values[key].length > 0, "seal_usage_error");
  return values[key];
}

async function runCli(argv) {
  const { command, values, inputs } = parseCli(argv);
  if (command === "create") {
    const root = required(values, "root");
    const seal = await createVerificationSeal({
      root,
      projectRoot: required(values, "project-root"),
      phaseId: required(values, "phase"),
      verifiedSourceSha: required(values, "source-sha"),
      inputs,
    });
    return writeVerificationSeal({
      root,
      projectRoot: required(values, "project-root"),
      tokenFile: required(values, "token-file"),
      expectedRuntime: required(values, "runtime"),
      sealPath: required(values, "seal"),
      seal,
      replaceDigest: values["replace-digest"],
    });
  }
  if (command === "check") {
    return checkVerificationSeal({
      root: required(values, "root"),
      projectRoot: required(values, "project-root"),
      sealPath: required(values, "seal"),
      expectedPhaseId: required(values, "phase"),
      expectedSourceSha: required(values, "source-sha"),
      expectedRuntime: required(values, "runtime"),
      expectedGsdVersion: required(values, "gsd-version"),
      expectedModelProfile: required(values, "model-profile"),
      expectedWorkflowLeaseId: required(values, "lease-id"),
    });
  }
  fail("seal_usage_error");
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  try {
    const result = await runCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === "pass" ? 0 : 1;
  } catch (error) {
    const code = error instanceof VerificationSealError ? error.code : "seal_unexpected_error";
    process.stderr.write(`${JSON.stringify({ schemaVersion: 1, kind: "workflow_verification_seal_error", code })}\n`);
    process.exitCode = 1;
  }
}
