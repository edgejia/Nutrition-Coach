#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveCanonicalPlanningArtifact } from "./project-scope.mjs";
import {
  resolveWorkflowProjectScope,
  verifyWorkflowLeaseSignature,
  withWorkflowWriterFence,
} from "./workflow-lease.mjs";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const RUNTIMES = new Set(["codex", "claude"]);
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024;
const MAX_RECEIPT_BYTES = 16 * 1024;
const PROVENANCE_KEYS = [
  "workflow_provenance_schema",
  "execution_runtime",
  "gsd_version",
  "model_profile",
  "workflow_lease_id",
  "workflow_fence_id",
  "source_sha",
  "lease_attestation_sha256",
  "worktree_identity_sha256",
  "git_common_identity_sha256",
  "artifact_identity_sha256",
  "artifact_payload_sha256",
  "previous_artifact_provenance_sha256",
  "artifact_provenance_sha256",
  "artifact_provenance_signature",
];
const RECEIPT_KEYS = [
  "artifactAfterSha256",
  "artifactBeforeSha256",
  "artifactIdentitySha256",
  "artifactKind",
  "artifactProvenanceSha256",
  "artifactProvenanceSignature",
  "artifactWorkflowFenceId",
  "executionRuntime",
  "gitCommonIdentitySha256",
  "gsdVersion",
  "kind",
  "leaseAttestationSha256",
  "modelProfile",
  "receiptSha256",
  "receiptSignature",
  "receiptWorkflowFenceId",
  "schemaVersion",
  "sourceSha",
  "state",
  "status",
  "workflowLeaseId",
  "worktreeIdentitySha256",
].sort();
const PREPARATION_KEYS = [
  "committedReceipt",
  "kind",
  "preparationSha256",
  "preparationSignature",
  "schemaVersion",
  "state",
  "transactionId",
].sort();

export class ArtifactProvenanceError extends Error {
  constructor(code) {
    super(code);
    this.name = "ArtifactProvenanceError";
    this.code = code;
  }
}

function fail(code) {
  throw new ArtifactProvenanceError(code);
}

function requireCondition(condition, code) {
  if (!condition) fail(code);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizedGitEnvironment() {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
}

function isWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function normalizeArtifact(projectRoot, artifact, requireExisting = true) {
  try {
    return resolveCanonicalPlanningArtifact({ projectRoot, artifact, requireExisting });
  } catch (error) {
    fail(typeof error?.code === "string" ? error.code : "artifact_project_scope_invalid");
  }
}

function resolveSourceSha(projectRoot) {
  const value = execFileSync("git", ["--no-replace-objects", "rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: sanitizedGitEnvironment(),
  }).trim();
  requireCondition(SOURCE_SHA_PATTERN.test(value), "artifact_source_sha_invalid");
  return value;
}

async function assertSafeArtifactParents(target) {
  const rootStat = await fs.lstat(target.root).catch(() => null);
  requireCondition(rootStat?.isDirectory() && !rootStat.isSymbolicLink(), "artifact_project_root_unsafe");
  const parentRelative = path.relative(target.root, path.dirname(target.absolute));
  let current = target.root;
  for (const component of parentRelative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await fs.lstat(current).catch(() => null);
    requireCondition(stat?.isDirectory() && !stat.isSymbolicLink(), "artifact_parent_unsafe");
  }
}

async function readArtifactSnapshot(target) {
  await assertSafeArtifactParents(target);
  let handle;
  try {
    handle = await fs.open(target.absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    fail("artifact_missing_or_unsafe");
  }
  let stat;
  let raw;
  try {
    stat = await handle.stat();
    requireCondition(stat.isFile() && stat.size > 0 && stat.size <= MAX_ARTIFACT_BYTES, "artifact_missing_or_unsafe");
    raw = await handle.readFile("utf8");
    requireCondition(Buffer.byteLength(raw) <= MAX_ARTIFACT_BYTES, "artifact_missing_or_unsafe");
  } finally {
    await handle.close().catch(() => undefined);
  }
  requireCondition(!raw.includes("\r"), "artifact_line_endings_unsupported");
  return { raw, dev: stat.dev, ino: stat.ino, mode: stat.mode & 0o777 };
}

function artifactSnapshotSha256(snapshot) {
  return sha256(snapshot.raw);
}

function requireMatchingArtifactSnapshot(snapshot, expected, code = "artifact_changed_during_stamp") {
  requireCondition(
    snapshot.dev === expected.dev &&
      snapshot.ino === expected.ino &&
      artifactSnapshotSha256(snapshot) === artifactSnapshotSha256(expected),
    code,
  );
}

async function assertArtifactSnapshotCurrent(target, expected, code = "artifact_changed_during_stamp") {
  const current = await readArtifactSnapshot(target);
  requireMatchingArtifactSnapshot(current, expected, code);
  return current;
}

function splitFrontmatter(raw) {
  requireCondition(raw.startsWith("---\n"), "artifact_frontmatter_missing");
  const closing = raw.indexOf("\n---", 4);
  requireCondition(closing !== -1 && (raw[closing + 4] === "\n" || raw.length === closing + 4), "artifact_frontmatter_invalid");
  const lines = raw.slice(4, closing).split("\n");
  const body = raw.slice(closing);
  const values = new Map();
  for (const line of lines) {
    const quotedKey = line.match(/^["']([A-Za-z0-9_-]+)["']:\s*/);
    requireCondition(
      !quotedKey || !PROVENANCE_KEYS.includes(quotedKey[1]),
      "artifact_frontmatter_unsupported_key_encoding",
    );
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*?)\s*$/);
    if (!match) continue;
    requireCondition(!values.has(match[1]), "artifact_frontmatter_duplicate_key");
    values.set(match[1], match[2].replace(/^['"]|['"]$/g, ""));
  }
  const cleanLines = lines.filter((line) => {
    const match = line.match(/^([A-Za-z0-9_-]+):/);
    return !match || !PROVENANCE_KEYS.includes(match[1]);
  });
  return { lines, cleanLines, body, values, cleanRaw: `---\n${cleanLines.join("\n")}${body}` };
}

function injectedFault(options, stage) {
  const stages = Array.isArray(options.testFaults) ? options.testFaults : [];
  if (!stages.includes(stage)) return;
  const error = new Error(`injected_${stage}`);
  error.code = `injected_${stage}`;
  throw error;
}

function provenancePayload(values, artifactKind) {
  return {
    schemaVersion: 1,
    artifactKind,
    executionRuntime: values.execution_runtime,
    gsdVersion: values.gsd_version,
    modelProfile: values.model_profile,
    workflowLeaseId: values.workflow_lease_id,
    workflowFenceId: values.workflow_fence_id,
    sourceSha: values.source_sha,
    leaseAttestationSha256: values.lease_attestation_sha256,
    worktreeIdentitySha256: values.worktree_identity_sha256,
    gitCommonIdentitySha256: values.git_common_identity_sha256,
    artifactIdentitySha256: values.artifact_identity_sha256,
    artifactPayloadSha256: values.artifact_payload_sha256,
    previousArtifactProvenanceSha256:
      values.previous_artifact_provenance_sha256 === "none"
        ? null
        : values.previous_artifact_provenance_sha256,
  };
}

function provenanceSignaturePayload(values, artifactKind) {
  return {
    ...provenancePayload(values, artifactKind),
    artifactProvenanceSha256: values.artifact_provenance_sha256,
  };
}

function validateProvenance(frontmatter, artifactKind, artifactIdentitySha256, options = {}) {
  const present = PROVENANCE_KEYS.filter((key) => frontmatter.values.has(key));
  if (present.length === 0) return null;
  requireCondition(present.length === PROVENANCE_KEYS.length, "artifact_provenance_incomplete");
  const values = Object.fromEntries(PROVENANCE_KEYS.map((key) => [key, frontmatter.values.get(key)]));
  requireCondition(values.workflow_provenance_schema === "1", "artifact_provenance_invalid");
  requireCondition(RUNTIMES.has(values.execution_runtime), "artifact_provenance_invalid");
  requireCondition(VERSION_PATTERN.test(values.gsd_version), "artifact_provenance_invalid");
  requireCondition(SAFE_ID_PATTERN.test(values.model_profile), "artifact_provenance_invalid");
  requireCondition(/^[0-9a-f-]{36}$/.test(values.workflow_lease_id), "artifact_provenance_invalid");
  requireCondition(/^[0-9a-f-]{36}$/.test(values.workflow_fence_id), "artifact_provenance_invalid");
  requireCondition(SOURCE_SHA_PATTERN.test(values.source_sha), "artifact_provenance_invalid");
  requireCondition(SHA256_PATTERN.test(values.lease_attestation_sha256), "artifact_provenance_invalid");
  requireCondition(SHA256_PATTERN.test(values.worktree_identity_sha256), "artifact_provenance_invalid");
  requireCondition(SHA256_PATTERN.test(values.git_common_identity_sha256), "artifact_provenance_invalid");
  if (options.worktreeIdentitySha256 !== undefined) {
    requireCondition(values.worktree_identity_sha256 === options.worktreeIdentitySha256, "artifact_worktree_identity_mismatch");
  }
  if (options.gitCommonIdentitySha256 !== undefined) {
    requireCondition(values.git_common_identity_sha256 === options.gitCommonIdentitySha256, "artifact_git_common_identity_mismatch");
  }
  requireCondition(SHA256_PATTERN.test(values.artifact_identity_sha256), "artifact_provenance_invalid");
  requireCondition(values.artifact_identity_sha256 === artifactIdentitySha256, "artifact_identity_mismatch");
  requireCondition(SHA256_PATTERN.test(values.artifact_payload_sha256), "artifact_provenance_invalid");
  requireCondition(
    values.previous_artifact_provenance_sha256 === "none" ||
      SHA256_PATTERN.test(values.previous_artifact_provenance_sha256),
    "artifact_provenance_invalid",
  );
  requireCondition(SHA256_PATTERN.test(values.artifact_provenance_sha256), "artifact_provenance_invalid");
  requireCondition(/^[A-Za-z0-9_-]+$/.test(values.artifact_provenance_signature), "artifact_provenance_invalid");
  requireCondition(
    sha256(JSON.stringify(provenancePayload(values, artifactKind))) === values.artifact_provenance_sha256,
    "artifact_provenance_record_tampered",
  );
  if (!options.allowStalePayload) {
    requireCondition(sha256(frontmatter.cleanRaw) === values.artifact_payload_sha256, "artifact_payload_stale");
  }
  return values;
}

async function ensureSafeReceiptParent(target, create) {
  const directory = path.dirname(target);
  const parsed = path.parse(directory);
  let current = parsed.root;
  for (const component of directory.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    const parent = current;
    current = path.join(current, component);
    let stat = await fs.lstat(current).catch((error) => {
      if (error && typeof error === "object" && error.code === "ENOENT") return null;
      throw error;
    });
    if (stat === null && create) {
      await fs.mkdir(current, { mode: 0o700 }).catch((error) => {
        if (!(error && typeof error === "object" && error.code === "EEXIST")) throw error;
      });
      const parentHandle = await fs.open(parent, "r");
      try {
        await parentHandle.sync();
      } finally {
        await parentHandle.close();
      }
      stat = await fs.lstat(current).catch(() => null);
    }
    requireCondition(stat?.isDirectory() && !stat.isSymbolicLink(), "provenance_receipt_parent_unsafe");
  }
}

function receiptPayload(value) {
  return {
    schemaVersion: value.schemaVersion,
    kind: value.kind,
    status: value.status,
    state: value.state,
    artifactKind: value.artifactKind,
    artifactIdentitySha256: value.artifactIdentitySha256,
    artifactBeforeSha256: value.artifactBeforeSha256,
    artifactAfterSha256: value.artifactAfterSha256,
    artifactProvenanceSha256: value.artifactProvenanceSha256,
    artifactProvenanceSignature: value.artifactProvenanceSignature,
    workflowLeaseId: value.workflowLeaseId,
    artifactWorkflowFenceId: value.artifactWorkflowFenceId,
    receiptWorkflowFenceId: value.receiptWorkflowFenceId,
    leaseAttestationSha256: value.leaseAttestationSha256,
    worktreeIdentitySha256: value.worktreeIdentitySha256,
    gitCommonIdentitySha256: value.gitCommonIdentitySha256,
    sourceSha: value.sourceSha,
    executionRuntime: value.executionRuntime,
    gsdVersion: value.gsdVersion,
    modelProfile: value.modelProfile,
  };
}

function receiptSignaturePayload(value) {
  return { ...receiptPayload(value), receiptSha256: value.receiptSha256 };
}

function validateCommittedReceiptValue(value) {
  requireCondition(value && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(RECEIPT_KEYS), "provenance_receipt_invalid");
  requireCondition(
    value.schemaVersion === 1 &&
      value.kind === "workflow_artifact_provenance_receipt" &&
      value.status === "pass" &&
      value.state === "committed",
    "provenance_receipt_not_committed",
  );
  requireCondition(["plan", "summary", "verification"].includes(value.artifactKind), "provenance_receipt_invalid");
  for (const key of [
    "artifactBeforeSha256",
    "artifactAfterSha256",
    "artifactIdentitySha256",
    "artifactProvenanceSha256",
    "leaseAttestationSha256",
    "worktreeIdentitySha256",
    "gitCommonIdentitySha256",
    "receiptSha256",
  ]) {
    requireCondition(SHA256_PATTERN.test(value[key]), "provenance_receipt_invalid");
  }
  requireCondition(/^[A-Za-z0-9_-]+$/.test(value.artifactProvenanceSignature), "provenance_receipt_invalid");
  requireCondition(/^[A-Za-z0-9_-]+$/.test(value.receiptSignature), "provenance_receipt_invalid");
  requireCondition(/^[0-9a-f-]{36}$/.test(value.workflowLeaseId), "provenance_receipt_invalid");
  requireCondition(/^[0-9a-f-]{36}$/.test(value.artifactWorkflowFenceId), "provenance_receipt_invalid");
  requireCondition(/^[0-9a-f-]{36}$/.test(value.receiptWorkflowFenceId), "provenance_receipt_invalid");
  requireCondition(SOURCE_SHA_PATTERN.test(value.sourceSha), "provenance_receipt_invalid");
  requireCondition(RUNTIMES.has(value.executionRuntime), "provenance_receipt_invalid");
  requireCondition(VERSION_PATTERN.test(value.gsdVersion), "provenance_receipt_invalid");
  requireCondition(SAFE_ID_PATTERN.test(value.modelProfile), "provenance_receipt_invalid");
  requireCondition(sha256(JSON.stringify(receiptPayload(value))) === value.receiptSha256, "provenance_receipt_tampered");
  return value;
}

function preparationPayload(value) {
  return {
    schemaVersion: value.schemaVersion,
    kind: value.kind,
    state: value.state,
    transactionId: value.transactionId,
    committedReceipt: value.committedReceipt,
  };
}

function preparationSignaturePayload(value) {
  return { ...preparationPayload(value), preparationSha256: value.preparationSha256 };
}

function signedReceiptPreparation(holder, receipt) {
  const prepared = {
    schemaVersion: 1,
    kind: "workflow_artifact_provenance_receipt_preparation",
    state: "prepared",
    transactionId: randomUUID(),
    committedReceipt: receipt,
  };
  prepared.preparationSha256 = sha256(JSON.stringify(preparationPayload(prepared)));
  prepared.preparationSignature = holder.signPayload(preparationSignaturePayload(prepared));
  return prepared;
}

function validateReceiptPreparation(value) {
  requireCondition(value && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(PREPARATION_KEYS), "provenance_preparation_invalid");
  requireCondition(
    value.schemaVersion === 1 &&
      value.kind === "workflow_artifact_provenance_receipt_preparation" &&
      value.state === "prepared" &&
      /^[0-9a-f-]{36}$/.test(value.transactionId),
    "provenance_preparation_invalid",
  );
  validateCommittedReceiptValue(value.committedReceipt);
  requireCondition(SHA256_PATTERN.test(value.preparationSha256), "provenance_preparation_invalid");
  requireCondition(/^[A-Za-z0-9_-]+$/.test(value.preparationSignature), "provenance_preparation_invalid");
  requireCondition(
    sha256(JSON.stringify(preparationPayload(value))) === value.preparationSha256,
    "provenance_preparation_tampered",
  );
  return value;
}

function signedCommittedReceipt(holder, fields) {
  const receipt = {
    schemaVersion: 1,
    kind: "workflow_artifact_provenance_receipt",
    status: "pass",
    state: "committed",
    ...fields,
  };
  receipt.receiptSha256 = sha256(JSON.stringify(receiptPayload(receipt)));
  receipt.receiptSignature = holder.signPayload(receiptSignaturePayload(receipt));
  return receipt;
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function normalizeReceiptPath(receiptPath, projectRoot) {
  requireCondition(typeof receiptPath === "string" && path.isAbsolute(receiptPath), "provenance_receipt_path_must_be_absolute");
  let scope;
  try {
    scope = resolveWorkflowProjectScope({ projectRoot });
  } catch {
    fail("artifact_project_scope_invalid");
  }
  let existing = path.dirname(path.resolve(receiptPath));
  const suffix = [path.basename(path.resolve(receiptPath))];
  while ((await fs.lstat(existing).catch(() => null)) === null) {
    const parent = path.dirname(existing);
    requireCondition(parent !== existing, "provenance_receipt_parent_unsafe");
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  const stat = await fs.lstat(existing).catch(() => null);
  requireCondition(stat?.isDirectory() && !stat.isSymbolicLink(), "provenance_receipt_parent_unsafe");
  const target = path.resolve(await fs.realpath(existing), ...suffix);
  requireCondition(!isWithin(scope.projectRoot, target), "provenance_receipt_inside_project");
  requireCondition(!isWithin(scope.commonDir, target), "provenance_receipt_inside_git_common_dir");
  return target;
}

function receiptTempPattern(receiptPath) {
  const escaped = path.basename(receiptPath).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^\\.${escaped}\\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
  );
}

function artifactTempPattern(target) {
  const escaped = path.basename(target.absolute).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^\\.${escaped}\\.tmp-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`,
  );
}

async function readArtifactTempSnapshot(filePath) {
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    fail("artifact_temp_recovery_ambiguous");
  }
  let raw;
  let stat;
  try {
    stat = await handle.stat();
    requireCondition(stat.isFile() && stat.size > 0 && stat.size <= MAX_ARTIFACT_BYTES, "artifact_temp_recovery_ambiguous");
    raw = await handle.readFile("utf8");
    requireCondition(Buffer.byteLength(raw) <= MAX_ARTIFACT_BYTES && !raw.includes("\r"), "artifact_temp_recovery_ambiguous");
  } finally {
    await handle.close().catch(() => undefined);
  }
  return { path: filePath, raw, rawSha256: sha256(raw), dev: stat.dev, ino: stat.ino };
}

async function loadArtifactTemps(target) {
  const directory = path.dirname(target.absolute);
  const pattern = artifactTempPattern(target);
  const names = (await fs.readdir(directory))
    .filter((name) => pattern.test(name))
    .sort((left, right) => left.localeCompare(right, "en"));
  const snapshots = [];
  for (const name of names) snapshots.push(await readArtifactTempSnapshot(path.join(directory, name)));
  return snapshots;
}

async function assertArtifactTempSnapshotCurrent(snapshot) {
  const current = await readArtifactTempSnapshot(snapshot.path);
  requireCondition(
    current.dev === snapshot.dev && current.ino === snapshot.ino && current.rawSha256 === snapshot.rawSha256,
    "artifact_temp_recovery_ambiguous",
  );
}

async function readReceiptJsonSnapshot(filePath, { allowMissing = false, invalidCode = "provenance_receipt_invalid" } = {}) {
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (allowMissing && error && typeof error === "object" && error.code === "ENOENT") return null;
    fail(invalidCode);
  }
  let raw;
  let stat;
  try {
    stat = await handle.stat();
    requireCondition(stat.isFile() && stat.size > 0 && stat.size <= MAX_RECEIPT_BYTES, invalidCode);
    raw = await handle.readFile("utf8");
    requireCondition(Buffer.byteLength(raw) <= MAX_RECEIPT_BYTES, invalidCode);
  } finally {
    await handle.close().catch(() => undefined);
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail(invalidCode);
  }
  return { path: filePath, raw, rawSha256: sha256(raw), dev: stat.dev, ino: stat.ino, value };
}

function classifyReceiptSnapshot(snapshot) {
  if (snapshot.value?.kind === "workflow_artifact_provenance_receipt") {
    validateCommittedReceiptValue(snapshot.value);
    return { ...snapshot, state: "committed", receipt: snapshot.value };
  }
  if (snapshot.value?.kind === "workflow_artifact_provenance_receipt_preparation") {
    validateReceiptPreparation(snapshot.value);
    return { ...snapshot, state: "prepared", receipt: snapshot.value.committedReceipt };
  }
  fail("provenance_receipt_recovery_ambiguous");
}

async function assertReceiptSnapshotCurrent(snapshot) {
  const current = await readReceiptJsonSnapshot(snapshot.path, {
    invalidCode: "provenance_receipt_recovery_ambiguous",
  });
  requireCondition(
    current.dev === snapshot.dev && current.ino === snapshot.ino && current.rawSha256 === snapshot.rawSha256,
    "provenance_receipt_recovery_ambiguous",
  );
}

async function verifyCommittedReceiptEvidence(target, receipt, sourceSha) {
  validateCommittedReceiptValue(receipt);
  const attestation = await verifyWorkflowLeaseSignature({
    projectRoot: target.root,
    leaseId: receipt.workflowLeaseId,
    attestationSha256: receipt.leaseAttestationSha256,
    payload: receiptSignaturePayload(receipt),
    signature: receipt.receiptSignature,
  });
  requireCondition(attestation.executionRuntime === receipt.executionRuntime, "provenance_receipt_lease_identity_mismatch");
  requireCondition(attestation.gsdVersion === receipt.gsdVersion, "provenance_receipt_lease_identity_mismatch");
  requireCondition(attestation.modelProfile === receipt.modelProfile, "provenance_receipt_lease_identity_mismatch");
  requireCondition(receipt.artifactKind === target.artifactKind, "provenance_receipt_artifact_mismatch");
  requireCondition(receipt.artifactIdentitySha256 === sha256(target.relative), "artifact_identity_mismatch");
  requireCondition(receipt.worktreeIdentitySha256 === target.worktreeIdentitySha256, "artifact_worktree_identity_mismatch");
  requireCondition(receipt.gitCommonIdentitySha256 === target.gitCommonIdentitySha256, "artifact_git_common_identity_mismatch");
  requireCondition(receipt.sourceSha === sourceSha, "artifact_source_sha_mismatch");
}

async function verifyReceiptPreparationEvidence(target, preparation, sourceSha) {
  validateReceiptPreparation(preparation);
  const receipt = preparation.committedReceipt;
  await verifyCommittedReceiptEvidence(target, receipt, sourceSha);
  await verifyWorkflowLeaseSignature({
    projectRoot: target.root,
    leaseId: receipt.workflowLeaseId,
    attestationSha256: receipt.leaseAttestationSha256,
    payload: preparationSignaturePayload(preparation),
    signature: preparation.preparationSignature,
  });
}

async function verifyArtifactMatchesReceipt(target, receipt) {
  const snapshot = await readArtifactSnapshot(target);
  requireCondition(sha256(snapshot.raw) === receipt.artifactAfterSha256, "provenance_receipt_artifact_mismatch");
  const values = validateProvenance(splitFrontmatter(snapshot.raw), target.artifactKind, sha256(target.relative), {
    worktreeIdentitySha256: target.worktreeIdentitySha256,
    gitCommonIdentitySha256: target.gitCommonIdentitySha256,
  });
  requireCondition(values !== null, "artifact_provenance_missing");
  await verifyWorkflowLeaseSignature({
    projectRoot: target.root,
    leaseId: values.workflow_lease_id,
    attestationSha256: values.lease_attestation_sha256,
    payload: provenanceSignaturePayload(values, target.artifactKind),
    signature: values.artifact_provenance_signature,
  });
  requireCondition(receipt.artifactProvenanceSha256 === values.artifact_provenance_sha256, "provenance_receipt_artifact_mismatch");
  requireCondition(receipt.artifactProvenanceSignature === values.artifact_provenance_signature, "provenance_receipt_artifact_mismatch");
  requireCondition(receipt.workflowLeaseId === values.workflow_lease_id, "provenance_receipt_artifact_mismatch");
  requireCondition(receipt.artifactWorkflowFenceId === values.workflow_fence_id, "provenance_receipt_artifact_mismatch");
  requireCondition(receipt.leaseAttestationSha256 === values.lease_attestation_sha256, "provenance_receipt_artifact_mismatch");
  requireCondition(receipt.worktreeIdentitySha256 === values.worktree_identity_sha256, "provenance_receipt_artifact_mismatch");
  requireCondition(receipt.gitCommonIdentitySha256 === values.git_common_identity_sha256, "provenance_receipt_artifact_mismatch");
  requireCondition(receipt.sourceSha === values.source_sha, "provenance_receipt_artifact_mismatch");
  requireCondition(receipt.executionRuntime === values.execution_runtime, "provenance_receipt_artifact_mismatch");
  requireCondition(receipt.gsdVersion === values.gsd_version, "provenance_receipt_artifact_mismatch");
  requireCondition(receipt.modelProfile === values.model_profile, "provenance_receipt_artifact_mismatch");
  return { snapshot, values };
}

function requireReceiptOwnedByHolder(receipt, holder) {
  requireCondition(
    receipt.workflowLeaseId === holder.leaseId &&
      receipt.leaseAttestationSha256 === holder.leaseAttestationSha256 &&
      receipt.executionRuntime === holder.executionRuntime &&
      receipt.gsdVersion === holder.gsdVersion &&
      receipt.modelProfile === holder.modelProfile,
    "provenance_receipt_holder_mismatch",
  );
}

function requireProvenanceOwnedByHolder(values, holder, code) {
  requireCondition(
    values.workflow_lease_id === holder.leaseId &&
      values.lease_attestation_sha256 === holder.leaseAttestationSha256 &&
      values.execution_runtime === holder.executionRuntime &&
      values.gsd_version === holder.gsdVersion &&
      values.model_profile === holder.modelProfile,
    code,
  );
}

async function runTestCheckpoint(options, stage) {
  if (typeof options?.testCheckpoint === "function") await options.testCheckpoint(stage);
}

async function removeArtifactTempSnapshots(snapshots, holder) {
  for (const snapshot of snapshots) {
    await assertArtifactTempSnapshotCurrent(snapshot);
    await holder.assertCurrent();
    await fs.unlink(snapshot.path);
  }
  if (snapshots.length > 0) await syncDirectory(path.dirname(snapshots[0].path));
}

async function removeArtifactTempPathIfPresent(temp, holder) {
  if ((await fs.lstat(temp).catch(() => null)) === null) return;
  await holder.assertCurrent();
  await fs.unlink(temp);
  await syncDirectory(path.dirname(temp));
}

async function reconcileOrphanArtifactTemp({ target, temps, holder, sourceSha, confirmedSnapshot }) {
  requireCondition(temps.length === 1, "artifact_temp_recovery_ambiguous");
  const current = await assertArtifactSnapshotCurrent(target, confirmedSnapshot);
  const currentFrontmatter = splitFrontmatter(current.raw);
  const currentValues = validateProvenance(currentFrontmatter, target.artifactKind, sha256(target.relative), {
    allowStalePayload: true,
    worktreeIdentitySha256: target.worktreeIdentitySha256,
    gitCommonIdentitySha256: target.gitCommonIdentitySha256,
  });
  if (currentValues) {
    await verifyWorkflowLeaseSignature({
      projectRoot: target.root,
      leaseId: currentValues.workflow_lease_id,
      attestationSha256: currentValues.lease_attestation_sha256,
      payload: provenanceSignaturePayload(currentValues, target.artifactKind),
      signature: currentValues.artifact_provenance_signature,
    });
  }

  try {
    const tempFrontmatter = splitFrontmatter(temps[0].raw);
    const tempValues = validateProvenance(tempFrontmatter, target.artifactKind, sha256(target.relative), {
      worktreeIdentitySha256: target.worktreeIdentitySha256,
      gitCommonIdentitySha256: target.gitCommonIdentitySha256,
    });
    requireCondition(tempValues !== null, "artifact_temp_recovery_ambiguous");
    await verifyWorkflowLeaseSignature({
      projectRoot: target.root,
      leaseId: tempValues.workflow_lease_id,
      attestationSha256: tempValues.lease_attestation_sha256,
      payload: provenanceSignaturePayload(tempValues, target.artifactKind),
      signature: tempValues.artifact_provenance_signature,
    });
    requireProvenanceOwnedByHolder(tempValues, holder, "artifact_temp_recovery_ambiguous");
    requireCondition(tempValues.source_sha === sourceSha, "artifact_temp_recovery_ambiguous");
    requireCondition(tempFrontmatter.cleanRaw === currentFrontmatter.cleanRaw, "artifact_temp_recovery_ambiguous");
    requireCondition(
      tempValues.previous_artifact_provenance_sha256 === (currentValues?.artifact_provenance_sha256 ?? "none"),
      "artifact_temp_recovery_ambiguous",
    );
  } catch {
    fail("artifact_temp_recovery_ambiguous");
  }
  await assertArtifactSnapshotCurrent(target, confirmedSnapshot);
  await removeArtifactTempSnapshots(temps, holder);
  return { state: "continue", recoveryAction: "removed_orphan_artifact_temp" };
}

async function verifyFinalArtifactReceiptPair({
  target,
  receiptPath,
  receipt,
  sourceSha,
  holder,
  expectedArtifactSnapshot = null,
  options,
}) {
  await runTestCheckpoint(options, "before_final_pair_validation");
  requireCondition(resolveSourceSha(target.root) === sourceSha, "artifact_source_sha_mismatch");
  const normalized = await normalizeReceiptPath(receiptPath, target.root);
  const receiptSnapshot = await readReceiptJsonSnapshot(normalized, {
    invalidCode: "provenance_receipt_changed",
  });
  const classified = classifyReceiptSnapshot(receiptSnapshot);
  requireCondition(classified.state === "committed", "provenance_receipt_not_committed");
  requireCondition(
    classified.receipt.receiptSha256 === receipt.receiptSha256 &&
      receiptSnapshot.rawSha256 === sha256(`${JSON.stringify(receipt, null, 2)}\n`),
    "provenance_receipt_changed",
  );
  await verifyCommittedReceiptEvidence(target, classified.receipt, sourceSha);
  requireReceiptOwnedByHolder(classified.receipt, holder);
  const artifact = await verifyArtifactMatchesReceipt(target, classified.receipt);
  if (expectedArtifactSnapshot !== null) {
    requireMatchingArtifactSnapshot(artifact.snapshot, expectedArtifactSnapshot);
  }
  await holder.assertCurrent();
  await assertReceiptSnapshotCurrent(receiptSnapshot);
  await assertArtifactSnapshotCurrent(target, artifact.snapshot, "artifact_changed_after_commit");
  await assertReceiptSnapshotCurrent(receiptSnapshot);
  requireCondition(resolveSourceSha(target.root) === sourceSha, "artifact_source_sha_mismatch");
  await holder.assertCurrent();
  return {
    receipt: classified.receipt,
    artifactSha256: artifactSnapshotSha256(artifact.snapshot),
    values: artifact.values,
  };
}

async function loadReceiptTemps(receiptPath, target, sourceSha) {
  const directory = path.dirname(receiptPath);
  const pattern = receiptTempPattern(receiptPath);
  const names = (await fs.readdir(directory)).filter((name) => pattern.test(name)).sort((left, right) => left.localeCompare(right, "en"));
  const snapshots = [];
  for (const name of names) {
    try {
      const classified = classifyReceiptSnapshot(
        await readReceiptJsonSnapshot(path.join(directory, name), {
          invalidCode: "provenance_receipt_recovery_ambiguous",
        }),
      );
      if (classified.state === "prepared") {
        await verifyReceiptPreparationEvidence(target, classified.value, sourceSha);
      } else {
        await verifyCommittedReceiptEvidence(target, classified.receipt, sourceSha);
      }
      snapshots.push(classified);
    } catch {
      fail("provenance_receipt_recovery_ambiguous");
    }
  }
  return snapshots;
}

function requireMatchingReceiptTemps(temps, receipt) {
  requireCondition(
    temps.every((temp) => temp.receipt.receiptSha256 === receipt.receiptSha256),
    "provenance_receipt_recovery_ambiguous",
  );
}

async function removeReceiptSnapshots(snapshots, holder) {
  for (const snapshot of snapshots) {
    await assertReceiptSnapshotCurrent(snapshot);
    await holder.assertCurrent();
    await fs.unlink(snapshot.path);
  }
}

async function replaceReceiptAtomically(receiptPath, receipt, expectedSnapshot, holder) {
  const temp = path.join(path.dirname(receiptPath), `.${path.basename(receiptPath)}.tmp-${randomUUID()}`);
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await assertReceiptSnapshotCurrent(expectedSnapshot);
    await holder.assertCurrent();
    await fs.rename(temp, receiptPath);
    await syncDirectory(path.dirname(receiptPath));
  } finally {
    const tempExists = await fs.lstat(temp).catch(() => null);
    if (tempExists !== null) {
      await holder.assertCurrent();
      await fs.unlink(temp);
    }
  }
}

async function reconcileReceiptTransaction({ target, receiptPath, holder, sourceSha, confirmedSnapshot, options }) {
  const normalized = await normalizeReceiptPath(receiptPath, target.root);
  await assertArtifactSnapshotCurrent(target, confirmedSnapshot);
  await holder.assertCurrent();
  await ensureSafeReceiptParent(normalized, true);
  let targetSnapshot = await readReceiptJsonSnapshot(normalized, {
    allowMissing: true,
    invalidCode: "provenance_receipt_recovery_ambiguous",
  });
  let temps = await loadReceiptTemps(normalized, target, sourceSha);
  const artifactTemps = await loadArtifactTemps(target);
  if (targetSnapshot === null) {
    if (temps.length === 0) {
      if (artifactTemps.length === 0) return { state: "continue", recoveryAction: null };
      return reconcileOrphanArtifactTemp({
        target,
        temps: artifactTemps,
        holder,
        sourceSha,
        confirmedSnapshot,
      });
    }
    requireCondition(temps.length === 1 && temps[0].state === "prepared", "provenance_receipt_recovery_ambiguous");
    requireReceiptOwnedByHolder(temps[0].receipt, holder);
    await assertArtifactSnapshotCurrent(target, confirmedSnapshot);
    await assertReceiptSnapshotCurrent(temps[0]);
    await holder.assertCurrent();
    await fs.link(temps[0].path, normalized).catch(() => fail("provenance_receipt_recovery_ambiguous"));
    await syncDirectory(path.dirname(normalized));
    targetSnapshot = await readReceiptJsonSnapshot(normalized, {
      invalidCode: "provenance_receipt_recovery_ambiguous",
    });
    temps = await loadReceiptTemps(normalized, target, sourceSha);
  }

  let classified;
  try {
    classified = classifyReceiptSnapshot(targetSnapshot);
    if (classified.state === "prepared") {
      await verifyReceiptPreparationEvidence(target, classified.value, sourceSha);
    } else {
      await verifyCommittedReceiptEvidence(target, classified.receipt, sourceSha);
    }
  } catch {
    fail("provenance_receipt_recovery_ambiguous");
  }
  requireReceiptOwnedByHolder(classified.receipt, holder);
  requireMatchingReceiptTemps(temps, classified.receipt);
  requireCondition(
    artifactTemps.length <= 1 && artifactTemps.every((temp) => temp.rawSha256 === classified.receipt.artifactAfterSha256),
    "artifact_temp_recovery_ambiguous",
  );

  if (classified.state === "committed") {
    const artifact = await verifyArtifactMatchesReceipt(target, classified.receipt);
    requireMatchingArtifactSnapshot(artifact.snapshot, confirmedSnapshot);
    await removeReceiptSnapshots(temps, holder);
    await removeArtifactTempSnapshots(artifactTemps, holder);
    await syncDirectory(path.dirname(normalized));
    const finalPair = await verifyFinalArtifactReceiptPair({
      target,
      receiptPath: normalized,
      receipt: classified.receipt,
      sourceSha,
      holder,
      expectedArtifactSnapshot: confirmedSnapshot,
      options,
    });
    return {
      state: "pass",
      recoveryAction: "already_committed",
      ...finalPair,
    };
  }

  const artifact = await readArtifactSnapshot(target);
  requireMatchingArtifactSnapshot(artifact, confirmedSnapshot);
  const artifactSha256 = sha256(artifact.raw);
  if (artifactSha256 === classified.receipt.artifactAfterSha256) {
    await verifyArtifactMatchesReceipt(target, classified.receipt);
    await replaceReceiptAtomically(normalized, classified.receipt, classified, holder);
    await removeReceiptSnapshots(temps, holder);
    await removeArtifactTempSnapshots(artifactTemps, holder);
    await syncDirectory(path.dirname(normalized));
    const finalPair = await verifyFinalArtifactReceiptPair({
      target,
      receiptPath: normalized,
      receipt: classified.receipt,
      sourceSha,
      holder,
      expectedArtifactSnapshot: confirmedSnapshot,
      options,
    });
    return {
      state: "pass",
      recoveryAction: "finalized_prepared_receipt",
      ...finalPair,
    };
  }
  requireCondition(
    artifactSha256 === classified.receipt.artifactBeforeSha256 &&
      classified.receipt.artifactBeforeSha256 !== classified.receipt.artifactAfterSha256,
    "provenance_receipt_recovery_ambiguous",
  );
  await assertReceiptSnapshotCurrent(classified);
  await holder.assertCurrent();
  await fs.unlink(normalized);
  await removeReceiptSnapshots(temps, holder);
  await removeArtifactTempSnapshots(artifactTemps, holder);
  await syncDirectory(path.dirname(normalized));
  return { state: "continue", recoveryAction: "rolled_back_prepared_receipt" };
}

async function prepareReceiptExclusive(receiptPath, projectRoot, receipt, holder, transaction, options) {
  const target = await normalizeReceiptPath(receiptPath, projectRoot);
  await holder.assertCurrent();
  await ensureSafeReceiptParent(target, true);
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${randomUUID()}`);
  const prepared = signedReceiptPreparation(holder, receipt);
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(prepared, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await holder.assertCurrent();
    await fs.link(temp, target).catch((error) => {
      if (error && typeof error === "object" && error.code === "EEXIST") fail("provenance_receipt_exists");
      throw error;
    });
    transaction.receiptPublished = true;
    transaction.receiptPath = target;
    transaction.phase = "receipt_prepare_sync";
    injectedFault(options, "receipt_prepare_sync");
    await syncDirectory(path.dirname(target));
    transaction.phase = "receipt_prepare_temp_cleanup";
    injectedFault(options, "receipt_prepare_temp_cleanup");
    await holder.assertCurrent();
    await fs.unlink(temp);
    await syncDirectory(path.dirname(target));
    transaction.phase = "receipt_prepared";
  } catch (error) {
    if (!transaction.receiptPublished && (await fs.lstat(temp).catch(() => null)) !== null) {
      await holder.assertCurrent();
      await fs.unlink(temp);
    }
    throw error;
  }
  const snapshot = await readReceiptJsonSnapshot(target, {
    invalidCode: "provenance_receipt_changed",
  });
  requireCondition(
    snapshot.rawSha256 === sha256(`${JSON.stringify(prepared, null, 2)}\n`),
    "provenance_receipt_changed",
  );
  return { target, prepared, snapshot };
}

async function cleanupPreparedReceipt(preparation, holder, transaction, options) {
  transaction.phase = "prepared_receipt_cleanup";
  await assertReceiptSnapshotCurrent(preparation.snapshot);
  await holder.assertCurrent();
  await fs.unlink(preparation.target);
  transaction.receiptPublished = false;
  injectedFault(options, "prepared_receipt_cleanup_sync");
  await syncDirectory(path.dirname(preparation.target));
  transaction.receiptPath = null;
  transaction.phase = "clean";
}

async function commitPreparedReceipt(preparation, holder, transaction, options) {
  const receipt = preparation.prepared.committedReceipt;
  validateCommittedReceiptValue(receipt);
  await assertReceiptSnapshotCurrent(preparation.snapshot);
  const temp = path.join(path.dirname(preparation.target), `.${path.basename(preparation.target)}.tmp-${randomUUID()}`);
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await assertReceiptSnapshotCurrent(preparation.snapshot);
    await holder.assertCurrent();
    await fs.rename(temp, preparation.target);
    transaction.receiptReplaced = true;
    transaction.phase = "receipt_commit_sync";
    injectedFault(options, "receipt_commit_sync");
    await syncDirectory(path.dirname(preparation.target));
    transaction.receiptDurable = true;
    transaction.phase = "receipt_committed";
  } finally {
    if ((await fs.lstat(temp).catch(() => null)) !== null) {
      await holder.assertCurrent();
      await fs.unlink(temp);
    }
  }
}

function stampEnvelope({
  status,
  changed,
  target,
  artifactSha256,
  values,
  holder,
  receipt,
  receiptCommitted = receipt !== null,
  reconciliationCode = null,
  transactionState = null,
  recoveryAction = null,
}) {
  return {
    schemaVersion: 1,
    kind: "workflow_artifact_provenance_stamp",
    status,
    changed,
    artifact: target.relative,
    artifactSha256,
    artifactProvenanceSha256: values.artifact_provenance_sha256,
    workflowLeaseId: values.workflow_lease_id,
    artifactWorkflowFenceId: values.workflow_fence_id,
    observedFenceId: holder.fenceId,
    sourceSha: values.source_sha,
    executionRuntime: values.execution_runtime,
    gsdVersion: values.gsd_version,
    modelProfile: values.model_profile,
    receiptCommitted,
    cleanupRequired: status !== "pass",
    reconciliationCode,
    transactionState,
    recoveryAction,
    receipt,
  };
}

function reconciliationEnvelope(base, transaction, code) {
  return stampEnvelope({
    ...base,
    status: "needs_reconciliation",
    changed: transaction.artifactReplaced,
    receipt: null,
    receiptCommitted: transaction.receiptDurable,
    reconciliationCode: code,
    transactionState: {
      phase: transaction.phase,
      receiptPublished: transaction.receiptPublished,
      artifactReplaced: transaction.artifactReplaced,
      artifactDurable: transaction.artifactDurable,
      receiptReplaced: transaction.receiptReplaced,
      receiptDurable: transaction.receiptDurable,
    },
  });
}

function reconciliationCode(error, transaction) {
  if (error instanceof ArtifactProvenanceError) return error.code;
  switch (transaction.phase) {
    case "receipt_prepare_sync":
      return "provenance_receipt_prepare_sync_failed";
    case "receipt_prepare_temp_cleanup":
      return "provenance_receipt_prepare_cleanup_failed";
    case "prepared_receipt_cleanup":
      return "provenance_prepared_receipt_cleanup_failed";
    case "artifact_commit_sync":
      return "artifact_commit_sync_failed";
    case "receipt_commit_sync":
      return "provenance_receipt_commit_sync_failed";
    case "receipt_prepared":
    case "artifact_committed":
      return "provenance_receipt_commit_failed";
    case "receipt_committed":
      return "artifact_provenance_post_commit_check_failed";
    default:
      return "artifact_provenance_reconciliation_required";
  }
}

export async function stampArtifactProvenance(options) {
  const target = normalizeArtifact(options.projectRoot, options.artifact);
  const artifactIdentitySha256 = sha256(target.relative);
  requireCondition(SOURCE_SHA_PATTERN.test(options.sourceSha ?? ""), "artifact_expected_source_sha_required");
  const sourceSha = resolveSourceSha(target.root);
  requireCondition(sourceSha === options.sourceSha, "artifact_source_sha_mismatch");
  const confirmedSnapshot = await readArtifactSnapshot(target);
  const confirmedSha256 = sha256(confirmedSnapshot.raw);
  requireCondition(options.confirmArtifactSha256 === confirmedSha256, "artifact_preimage_confirmation_mismatch");
  return withWorkflowWriterFence(
    {
      projectRoot: target.root,
      tokenFile: options.tokenFile,
      expectedRuntime: options.expectedRuntime,
      purpose: "artifact_stamp",
      maxDurationSeconds: 300,
      now: options.now,
    },
    async (holder) => {
      requireCondition(resolveSourceSha(target.root) === sourceSha, "artifact_source_sha_mismatch");
      await runTestCheckpoint(options, "before_receipt_recovery");
      const recovery = await reconcileReceiptTransaction({
        target,
        receiptPath: options.receiptPath,
        holder,
        sourceSha,
        confirmedSnapshot,
        options,
      });
      if (recovery.state === "pass") {
        requireCondition(resolveSourceSha(target.root) === sourceSha, "artifact_source_sha_mismatch");
        await holder.assertCurrent();
        return stampEnvelope({
          status: "pass",
          changed: false,
          target,
          artifactSha256: recovery.artifactSha256,
          values: recovery.values,
          holder,
          receipt: recovery.receipt,
          receiptCommitted: true,
          recoveryAction: recovery.recoveryAction,
        });
      }
      const recoveryAction = recovery.recoveryAction;
      const beforeSnapshot = await readArtifactSnapshot(target);
      const before = beforeSnapshot.raw;
      const beforeSha256 = sha256(before);
      requireMatchingArtifactSnapshot(beforeSnapshot, confirmedSnapshot);
      const frontmatter = splitFrontmatter(before);
      const existing = validateProvenance(frontmatter, target.artifactKind, artifactIdentitySha256, {
        allowStalePayload: true,
        worktreeIdentitySha256: target.worktreeIdentitySha256,
        gitCommonIdentitySha256: target.gitCommonIdentitySha256,
      });
      if (existing) {
        await verifyWorkflowLeaseSignature({
          projectRoot: target.root,
          leaseId: existing.workflow_lease_id,
          attestationSha256: existing.lease_attestation_sha256,
          payload: provenanceSignaturePayload(existing, target.artifactKind),
          signature: existing.artifact_provenance_signature,
        });
      }
      const payloadSha256 = sha256(frontmatter.cleanRaw);

      const receiptFields = (artifactBeforeSha256, artifactAfterSha256, values) => ({
        artifactKind: target.artifactKind,
        artifactIdentitySha256,
        artifactBeforeSha256,
        artifactAfterSha256,
        artifactProvenanceSha256: values.artifact_provenance_sha256,
        artifactProvenanceSignature: values.artifact_provenance_signature,
        workflowLeaseId: values.workflow_lease_id,
        artifactWorkflowFenceId: values.workflow_fence_id,
        receiptWorkflowFenceId: holder.fenceId,
        leaseAttestationSha256: values.lease_attestation_sha256,
        worktreeIdentitySha256: values.worktree_identity_sha256,
        gitCommonIdentitySha256: values.git_common_identity_sha256,
        sourceSha: values.source_sha,
        executionRuntime: values.execution_runtime,
        gsdVersion: values.gsd_version,
        modelProfile: values.model_profile,
      });

      if (
        existing &&
        existing.execution_runtime === holder.executionRuntime &&
        existing.gsd_version === holder.gsdVersion &&
        existing.model_profile === holder.modelProfile &&
        existing.workflow_lease_id === holder.leaseId &&
        existing.source_sha === sourceSha &&
        existing.artifact_payload_sha256 === payloadSha256
      ) {
        const fields = receiptFields(beforeSha256, beforeSha256, existing);
        const receipt = signedCommittedReceipt(holder, fields);
        const transaction = {
          phase: "clean",
          artifactReplaced: false,
          artifactDurable: false,
          receiptPublished: false,
          receiptReplaced: false,
          receiptDurable: false,
          receiptPath: null,
        };
        const base = {
          target,
          artifactSha256: beforeSha256,
          values: existing,
          holder,
          recoveryAction,
        };
        let preparation;
        try {
          preparation = await prepareReceiptExclusive(
            options.receiptPath,
            target.root,
            receipt,
            holder,
            transaction,
            options,
          );
        } catch (error) {
          if (transaction.receiptPublished) {
            return reconciliationEnvelope(base, transaction, reconciliationCode(error, transaction));
          }
          throw error;
        }
        try {
          await commitPreparedReceipt(preparation, holder, transaction, options);
          const finalPair = await verifyFinalArtifactReceiptPair({
            target,
            receiptPath: options.receiptPath,
            receipt,
            sourceSha,
            holder,
            expectedArtifactSnapshot: confirmedSnapshot,
            options,
          });
          base.artifactSha256 = finalPair.artifactSha256;
          base.values = finalPair.values;
        } catch (error) {
          return reconciliationEnvelope(base, transaction, reconciliationCode(error, transaction));
        }
        return stampEnvelope({
          ...base,
          status: "pass",
          changed: false,
          receipt,
          receiptCommitted: true,
        });
      }
      if (existing) {
        requireCondition(
          options.replaceProvenanceSha256 === existing.artifact_provenance_sha256,
          "artifact_provenance_replace_digest_required",
        );
      } else {
        requireCondition(options.replaceProvenanceSha256 === undefined, "artifact_provenance_replace_target_missing");
      }
      const values = {
        workflow_provenance_schema: "1",
        execution_runtime: holder.executionRuntime,
        gsd_version: holder.gsdVersion,
        model_profile: holder.modelProfile,
        workflow_lease_id: holder.leaseId,
        workflow_fence_id: holder.fenceId,
        source_sha: sourceSha,
        lease_attestation_sha256: holder.leaseAttestationSha256,
        worktree_identity_sha256: target.worktreeIdentitySha256,
        git_common_identity_sha256: target.gitCommonIdentitySha256,
        artifact_identity_sha256: artifactIdentitySha256,
        artifact_payload_sha256: payloadSha256,
        previous_artifact_provenance_sha256: existing?.artifact_provenance_sha256 ?? "none",
      };
      values.artifact_provenance_sha256 = sha256(JSON.stringify(provenancePayload(values, target.artifactKind)));
      values.artifact_provenance_signature = holder.signPayload(provenanceSignaturePayload(values, target.artifactKind));
      const provenanceLines = [
        `workflow_provenance_schema: ${values.workflow_provenance_schema}`,
        `execution_runtime: ${values.execution_runtime}`,
        `gsd_version: ${values.gsd_version}`,
        `model_profile: ${values.model_profile}`,
        `workflow_lease_id: ${values.workflow_lease_id}`,
        `workflow_fence_id: ${values.workflow_fence_id}`,
        `source_sha: ${values.source_sha}`,
        `lease_attestation_sha256: ${values.lease_attestation_sha256}`,
        `worktree_identity_sha256: ${values.worktree_identity_sha256}`,
        `git_common_identity_sha256: ${values.git_common_identity_sha256}`,
        `artifact_identity_sha256: ${values.artifact_identity_sha256}`,
        `artifact_payload_sha256: ${values.artifact_payload_sha256}`,
        `previous_artifact_provenance_sha256: ${values.previous_artifact_provenance_sha256}`,
        `artifact_provenance_sha256: ${values.artifact_provenance_sha256}`,
        `artifact_provenance_signature: ${values.artifact_provenance_signature}`,
      ];
      const next = `---\n${[...frontmatter.cleanLines, ...provenanceLines].join("\n")}${frontmatter.body}`;
      const afterSha256 = sha256(next);
      const fields = receiptFields(beforeSha256, afterSha256, values);
      const receipt = signedCommittedReceipt(holder, fields);
      const transaction = {
        phase: "clean",
        artifactReplaced: false,
        artifactDurable: false,
        receiptPublished: false,
        receiptReplaced: false,
        receiptDurable: false,
        receiptPath: null,
      };
      const base = {
        target,
        artifactSha256: afterSha256,
        values,
        holder,
        recoveryAction,
      };
      const temp = path.join(path.dirname(target.absolute), `.${path.basename(target.absolute)}.tmp-${randomUUID()}`);
      const handle = await fs.open(temp, "wx", beforeSnapshot.mode);
      try {
        await handle.writeFile(next, "utf8");
        await handle.sync();
      } catch (error) {
        await removeArtifactTempPathIfPresent(temp, holder);
        throw error;
      } finally {
        await handle.close();
      }
      injectedFault(options, "artifact_temp_sync");
      let preparation;
      try {
        preparation = await prepareReceiptExclusive(
          options.receiptPath,
          target.root,
          receipt,
          holder,
          transaction,
          options,
        );
      } catch (error) {
        await removeArtifactTempPathIfPresent(temp, holder);
        if (transaction.receiptPublished) {
          return reconciliationEnvelope(base, transaction, reconciliationCode(error, transaction));
        }
        throw error;
      }
      try {
        const current = await readArtifactSnapshot(target);
        requireCondition(
          sha256(current.raw) === beforeSha256 && current.dev === beforeSnapshot.dev && current.ino === beforeSnapshot.ino,
          "artifact_changed_during_stamp",
        );
        requireCondition(resolveSourceSha(target.root) === sourceSha, "artifact_source_sha_mismatch");
        await holder.assertCurrent();
        injectedFault(options, "before_artifact_commit");
      } catch (error) {
        await removeArtifactTempPathIfPresent(temp, holder);
        try {
          await cleanupPreparedReceipt(preparation, holder, transaction, options);
        } catch (cleanupError) {
          return reconciliationEnvelope(base, transaction, reconciliationCode(cleanupError, transaction));
        }
        throw error;
      }
      try {
        await holder.assertCurrent();
        await fs.rename(temp, target.absolute);
        transaction.artifactReplaced = true;
        transaction.phase = "artifact_commit_sync";
        injectedFault(options, "artifact_commit_sync");
        await syncDirectory(path.dirname(target.absolute));
        transaction.artifactDurable = true;
        transaction.phase = "artifact_committed";
      } catch (error) {
        await removeArtifactTempPathIfPresent(temp, holder);
        if (transaction.artifactReplaced) {
          return reconciliationEnvelope(base, transaction, reconciliationCode(error, transaction));
        }
        try {
          await cleanupPreparedReceipt(preparation, holder, transaction, options);
        } catch (cleanupError) {
          return reconciliationEnvelope(base, transaction, reconciliationCode(cleanupError, transaction));
        }
        throw error;
      }
      try {
        await commitPreparedReceipt(preparation, holder, transaction, options);
        const finalPair = await verifyFinalArtifactReceiptPair({
          target,
          receiptPath: options.receiptPath,
          receipt,
          sourceSha,
          holder,
          options,
        });
        base.artifactSha256 = finalPair.artifactSha256;
        base.values = finalPair.values;
      } catch (error) {
        return reconciliationEnvelope(base, transaction, reconciliationCode(error, transaction));
      }
      return stampEnvelope({
        ...base,
        status: "pass",
        changed: true,
        receipt,
        receiptCommitted: true,
      });
    },
  );
}

async function readCommittedReceipt(receiptPath, projectRoot) {
  requireCondition(typeof receiptPath === "string" && path.isAbsolute(receiptPath), "provenance_receipt_required");
  const target = await normalizeReceiptPath(receiptPath, projectRoot);
  await ensureSafeReceiptParent(target, false);
  let handle;
  try {
    handle = await fs.open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    fail("provenance_receipt_missing_or_unsafe");
  }
  let raw;
  let stat;
  try {
    stat = await handle.stat();
    requireCondition(stat.isFile() && stat.size <= 16 * 1024, "provenance_receipt_missing_or_unsafe");
    raw = await handle.readFile("utf8");
    requireCondition(Buffer.byteLength(raw) <= 16 * 1024, "provenance_receipt_missing_or_unsafe");
  } finally {
    await handle.close().catch(() => undefined);
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail("provenance_receipt_invalid");
  }
  validateCommittedReceiptValue(value);
  return { value, target, dev: stat.dev, ino: stat.ino, rawSha256: sha256(raw) };
}

export async function checkArtifactProvenance(options) {
  requireCondition(Array.isArray(options.artifacts) && options.artifacts.length > 0, "artifact_list_required");
  requireCondition(SOURCE_SHA_PATTERN.test(options.expectedSourceSha ?? ""), "artifact_expected_source_sha_required");
  const projectRoot = path.resolve(options.projectRoot);
  const currentSourceSha = resolveSourceSha(projectRoot);
  requireCondition(currentSourceSha === options.expectedSourceSha, "artifact_source_sha_mismatch");
  const receiptPaths = options.receiptPaths ?? [];
  requireCondition(Array.isArray(receiptPaths), "provenance_receipt_list_invalid");
  requireCondition(receiptPaths.length <= options.artifacts.length, "provenance_receipt_list_invalid");
  const normalizedArtifacts = options.artifacts.map((artifact) => ({
    input: artifact,
    target: normalizeArtifact(projectRoot, artifact, false),
  }));
  requireCondition(
    new Set(normalizedArtifacts.map(({ target }) => target.absolute)).size === normalizedArtifacts.length,
    "artifact_list_duplicate",
  );
  const normalizedReceiptPaths = await Promise.all(
    receiptPaths.map((receiptPath) => normalizeReceiptPath(receiptPath, projectRoot)),
  );
  requireCondition(
    new Set(normalizedReceiptPaths).size === normalizedReceiptPaths.length,
    "provenance_receipt_duplicate",
  );
  const findings = [];
  const records = [];
  const verifiedSnapshots = [];
  const artifactInodes = new Set();
  const receiptInodes = new Set();
  const pairs = normalizedArtifacts
    .map(({ input, target }, index) => ({ input, target, receiptPath: normalizedReceiptPaths[index] }))
    .sort((left, right) => left.target.relative.localeCompare(right.target.relative, "en"));
  for (const { input, target, receiptPath } of pairs) {
    try {
      const artifactIdentitySha256 = sha256(target.relative);
      const artifactSnapshot = await readArtifactSnapshot(target);
      const artifactInode = `${artifactSnapshot.dev}:${artifactSnapshot.ino}`;
      requireCondition(!artifactInodes.has(artifactInode), "artifact_inode_duplicate");
      artifactInodes.add(artifactInode);
      const raw = artifactSnapshot.raw;
      const values = validateProvenance(splitFrontmatter(raw), target.artifactKind, artifactIdentitySha256, {
        worktreeIdentitySha256: target.worktreeIdentitySha256,
        gitCommonIdentitySha256: target.gitCommonIdentitySha256,
      });
      requireCondition(values !== null, "artifact_provenance_missing");
      const attestation = await verifyWorkflowLeaseSignature({
        projectRoot: target.root,
        leaseId: values.workflow_lease_id,
        attestationSha256: values.lease_attestation_sha256,
        payload: provenanceSignaturePayload(values, target.artifactKind),
        signature: values.artifact_provenance_signature,
      });
      requireCondition(attestation.executionRuntime === values.execution_runtime, "artifact_lease_identity_mismatch");
      requireCondition(attestation.gsdVersion === values.gsd_version, "artifact_lease_identity_mismatch");
      requireCondition(attestation.modelProfile === values.model_profile, "artifact_lease_identity_mismatch");
      const receiptSnapshot = await readCommittedReceipt(receiptPath, target.root);
      const receiptInode = `${receiptSnapshot.dev}:${receiptSnapshot.ino}`;
      requireCondition(!receiptInodes.has(receiptInode), "provenance_receipt_inode_duplicate");
      receiptInodes.add(receiptInode);
      const receipt = receiptSnapshot.value;
      await verifyWorkflowLeaseSignature({
        projectRoot: target.root,
        leaseId: receipt.workflowLeaseId,
        attestationSha256: receipt.leaseAttestationSha256,
        payload: receiptSignaturePayload(receipt),
        signature: receipt.receiptSignature,
      });
      requireCondition(receipt.artifactKind === target.artifactKind, "provenance_receipt_artifact_mismatch");
      requireCondition(receipt.artifactIdentitySha256 === artifactIdentitySha256, "artifact_identity_mismatch");
      requireCondition(receipt.artifactAfterSha256 === sha256(raw), "provenance_receipt_artifact_mismatch");
      requireCondition(receipt.artifactProvenanceSha256 === values.artifact_provenance_sha256, "provenance_receipt_artifact_mismatch");
      requireCondition(receipt.artifactProvenanceSignature === values.artifact_provenance_signature, "provenance_receipt_artifact_mismatch");
      requireCondition(receipt.workflowLeaseId === values.workflow_lease_id, "provenance_receipt_artifact_mismatch");
      requireCondition(receipt.artifactWorkflowFenceId === values.workflow_fence_id, "provenance_receipt_artifact_mismatch");
      requireCondition(receipt.leaseAttestationSha256 === values.lease_attestation_sha256, "provenance_receipt_artifact_mismatch");
      requireCondition(receipt.worktreeIdentitySha256 === values.worktree_identity_sha256, "provenance_receipt_artifact_mismatch");
      requireCondition(receipt.gitCommonIdentitySha256 === values.git_common_identity_sha256, "provenance_receipt_artifact_mismatch");
      requireCondition(receipt.worktreeIdentitySha256 === target.worktreeIdentitySha256, "artifact_worktree_identity_mismatch");
      requireCondition(receipt.gitCommonIdentitySha256 === target.gitCommonIdentitySha256, "artifact_git_common_identity_mismatch");
      requireCondition(receipt.sourceSha === values.source_sha, "provenance_receipt_artifact_mismatch");
      requireCondition(receipt.executionRuntime === values.execution_runtime, "provenance_receipt_artifact_mismatch");
      requireCondition(receipt.gsdVersion === values.gsd_version, "provenance_receipt_artifact_mismatch");
      requireCondition(receipt.modelProfile === values.model_profile, "provenance_receipt_artifact_mismatch");
      requireCondition(values.source_sha === options.expectedSourceSha, "artifact_source_sha_mismatch");
      if (options.expectedRuntime !== undefined) {
        requireCondition(values.execution_runtime === options.expectedRuntime, "artifact_runtime_mismatch");
      }
      if (options.expectedGsdVersion !== undefined) {
        requireCondition(values.gsd_version === options.expectedGsdVersion, "artifact_gsd_version_mismatch");
      }
      records.push({
        artifact: target.relative,
        artifactKind: target.artifactKind,
        executionRuntime: values.execution_runtime,
        gsdVersion: values.gsd_version,
        modelProfile: values.model_profile,
        workflowLeaseId: values.workflow_lease_id,
        workflowFenceId: values.workflow_fence_id,
        sourceSha: values.source_sha,
        worktreeIdentitySha256: values.worktree_identity_sha256,
        gitCommonIdentitySha256: values.git_common_identity_sha256,
        artifactPayloadSha256: values.artifact_payload_sha256,
        artifactProvenanceSha256: values.artifact_provenance_sha256,
        attestationVerified: true,
        receiptCommitted: true,
      });
      verifiedSnapshots.push({
        artifact: target.relative,
        target,
        artifactDev: artifactSnapshot.dev,
        artifactIno: artifactSnapshot.ino,
        artifactSha256: sha256(raw),
        receiptPath,
        receiptDev: receiptSnapshot.dev,
        receiptIno: receiptSnapshot.ino,
        receiptSha256: receiptSnapshot.rawSha256,
      });
    } catch (error) {
      findings.push({
        artifact: target.relative ?? String(input),
        code:
          error instanceof ArtifactProvenanceError
            ? error.code
            : typeof error?.code === "string"
              ? error.code
              : "artifact_provenance_unexpected_error",
      });
    }
  }
  if (typeof options.testCheckpoint === "function") {
    await options.testCheckpoint("before_final_source_check");
  }
  for (const snapshot of verifiedSnapshots) {
    try {
      const current = await readArtifactSnapshot(snapshot.target);
      requireCondition(
        current.dev === snapshot.artifactDev &&
          current.ino === snapshot.artifactIno &&
          sha256(current.raw) === snapshot.artifactSha256,
        "artifact_changed_during_check",
      );
    } catch {
      findings.push({ artifact: snapshot.artifact, code: "artifact_changed_during_check" });
    }
    try {
      const currentReceipt = await readCommittedReceipt(snapshot.receiptPath, projectRoot);
      requireCondition(
        currentReceipt.dev === snapshot.receiptDev &&
          currentReceipt.ino === snapshot.receiptIno &&
          currentReceipt.rawSha256 === snapshot.receiptSha256,
        "provenance_receipt_changed_during_check",
      );
    } catch {
      findings.push({ artifact: snapshot.artifact, code: "provenance_receipt_changed_during_check" });
    }
  }
  let finalSourceSha = null;
  try {
    finalSourceSha = resolveSourceSha(projectRoot);
  } catch {
    // The exact Git failure is intentionally reduced to a stable freshness finding.
  }
  if (finalSourceSha !== options.expectedSourceSha) {
    findings.push({ artifact: "$source", code: "artifact_source_sha_changed_during_check" });
    records.length = 0;
  }
  if (findings.some((finding) => /changed_during_check$/.test(finding.code))) records.length = 0;
  findings.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  return {
    schemaVersion: 1,
    kind: "workflow_artifact_provenance_check",
    status: findings.length === 0 ? "pass" : "fail",
    records,
    findings,
  };
}

function parseCli(argv) {
  const [command, ...args] = argv;
  requireCondition(command === "stamp" || command === "check", "artifact_provenance_usage_error");
  const values = {};
  const artifacts = [];
  const receipts = [];
  const allowed =
    command === "stamp"
      ? new Set(["project-root", "artifact", "token-file", "runtime", "confirm-sha256", "replace-provenance-sha256", "receipt", "source-sha"])
      : new Set(["project-root", "artifact", "receipt", "runtime", "gsd-version", "source-sha"]);
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.*)$/s);
    requireCondition(match && allowed.has(match[1]), "artifact_provenance_usage_error");
    if (match[1] === "artifact" && command === "check") artifacts.push(match[2]);
    else if (match[1] === "receipt" && command === "check") receipts.push(match[2]);
    else {
      requireCondition(!Object.hasOwn(values, match[1]), "artifact_provenance_usage_error");
      values[match[1]] = match[2];
    }
  }
  requireCondition(typeof values["project-root"] === "string", "artifact_provenance_usage_error");
  if (command === "stamp") {
    for (const key of ["artifact", "token-file", "runtime", "confirm-sha256", "receipt", "source-sha"]) {
      requireCondition(typeof values[key] === "string" && values[key].length > 0, "artifact_provenance_usage_error");
    }
  } else {
    requireCondition(artifacts.length > 0, "artifact_provenance_usage_error");
    requireCondition(receipts.length === artifacts.length, "artifact_provenance_usage_error");
    requireCondition(typeof values["source-sha"] === "string" && values["source-sha"].length > 0, "artifact_provenance_usage_error");
  }
  return { command, values, artifacts, receipts };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  try {
    const { command, values, artifacts, receipts } = parseCli(process.argv.slice(2));
    const result =
      command === "stamp"
        ? await stampArtifactProvenance({
            projectRoot: values["project-root"],
            artifact: values.artifact,
            tokenFile: values["token-file"],
            expectedRuntime: values.runtime,
            confirmArtifactSha256: values["confirm-sha256"],
            replaceProvenanceSha256: values["replace-provenance-sha256"],
            receiptPath: values.receipt,
            sourceSha: values["source-sha"],
          })
        : await checkArtifactProvenance({
            projectRoot: values["project-root"],
            artifacts,
            receiptPaths: receipts,
            expectedRuntime: values.runtime,
            expectedGsdVersion: values["gsd-version"],
            expectedSourceSha: values["source-sha"],
          });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === "pass" ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "workflow_artifact_provenance_error",
        code: error instanceof ArtifactProvenanceError ? error.code : error?.code ?? "artifact_provenance_unexpected_error",
      })}\n`,
    );
    process.exitCode = 1;
  }
}
