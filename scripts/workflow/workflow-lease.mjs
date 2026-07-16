#!/usr/bin/env node

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
  randomUUID,
  sign as signBytes,
  verify as verifyBytes,
} from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants as fsConstants, lstatSync, realpathSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const RUNTIMES = new Set(["codex", "claude"]);
const TAKEOVER_REASONS = new Set(["runtime_handoff", "abandoned_session", "operator_recovery"]);
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const PROFILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/;
const RFC3339_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:Z|[+-]\d{2}:\d{2})$/;
const MAX_LEASE_BYTES = 16 * 1024;
const MAX_TOKEN_BYTES = 4 * 1024;
const MAX_MUTEX_BYTES = 4 * 1024;
const MAX_WRITER_BYTES = 8 * 1024;
const MAX_ATTESTATION_BYTES = 8 * 1024;
const MAX_TRANSITION_BYTES = 64 * 1024;
const TAKEOVER_AUTHORIZATION_WINDOW_MS = 60_000;
const TAKEOVER_CLOCK_SKEW_MS = 5_000;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WRITER_PURPOSES = new Set(["artifact_stamp", "workflow_command", "pilot", "maintenance_check"]);
const GIT_ROUTING_ENVIRONMENT = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];

export class WorkflowLeaseError extends Error {
  constructor(code) {
    super(code);
    this.name = "WorkflowLeaseError";
    this.code = code;
  }
}

function fail(code) {
  throw new WorkflowLeaseError(code);
}

function requireCondition(condition, code) {
  if (!condition) fail(code);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sanitizedGitEnvironment() {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
}

function timestamp(now = new Date()) {
  requireCondition(now instanceof Date && !Number.isNaN(now.valueOf()), "lease_time_invalid");
  return new Date(now.valueOf() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00");
}

function boundedTakeoverNow(options) {
  const actualNow = new Date();
  let authorizedOperatorNow = null;
  if (options.reasonCode !== "runtime_handoff" && options.operatorSuccessorAcquiredAt !== undefined) {
    requireCondition(
      typeof options.operatorSuccessorAcquiredAt === "string" &&
        RFC3339_PATTERN.test(options.operatorSuccessorAcquiredAt),
      "lease_takeover_operator_successor_time_required",
    );
    authorizedOperatorNow = new Date(options.operatorSuccessorAcquiredAt);
  }
  const requested = options.now ?? authorizedOperatorNow ?? actualNow;
  requireCondition(requested instanceof Date && !Number.isNaN(requested.valueOf()), "lease_time_invalid");
  if (authorizedOperatorNow !== null) {
    requireCondition(
      requested.valueOf() === authorizedOperatorNow.valueOf(),
      "lease_takeover_operator_successor_time_mismatch",
    );
  }
  requireCondition(
    Math.abs(requested.valueOf() - actualNow.valueOf()) <= TAKEOVER_CLOCK_SKEW_MS,
    "lease_takeover_now_override_forbidden",
  );
  return requested;
}

function injectedFault(options, stage) {
  const stages = Array.isArray(options.testFaults) ? options.testFaults : [];
  if (!stages.includes(stage)) return;
  const error = new Error(`injected_${stage}`);
  error.code = `injected_${stage}`;
  throw error;
}

function resolveProjectScope(options) {
  requireCondition(typeof options.projectRoot === "string" && options.projectRoot.length > 0, "lease_project_root_required");
  requireCondition(
    GIT_ROUTING_ENVIRONMENT.every((name) => process.env[name] === undefined),
    "workflow_git_environment_override_forbidden",
  );
  const declared = path.resolve(options.projectRoot);
  let rootStat;
  let realDeclared;
  let topLevel;
  let commonRaw;
  try {
    rootStat = lstatSync(declared);
    realDeclared = realpathSync(declared);
    topLevel = execFileSync("git", ["--no-replace-objects", "rev-parse", "--show-toplevel"], {
      cwd: declared,
      encoding: "utf8",
      env: sanitizedGitEnvironment(),
    }).trim();
    commonRaw = execFileSync("git", ["--no-replace-objects", "rev-parse", "--git-common-dir"], {
      cwd: declared,
      encoding: "utf8",
      env: sanitizedGitEnvironment(),
    }).trim();
  } catch {
    fail("workflow_project_git_scope_invalid");
  }
  let canonicalTopLevel;
  try {
    canonicalTopLevel = realpathSync(path.resolve(topLevel));
  } catch {
    fail("workflow_project_git_scope_invalid");
  }
  requireCondition(
    rootStat.isDirectory() &&
      !rootStat.isSymbolicLink() &&
      declared === realDeclared &&
      realDeclared === canonicalTopLevel,
    "workflow_project_git_scope_invalid",
  );
  const commonCandidate = path.isAbsolute(commonRaw) ? path.resolve(commonRaw) : path.resolve(declared, commonRaw);
  let commonDir;
  try {
    commonDir = realpathSync(commonCandidate);
  } catch {
    fail("workflow_project_git_scope_invalid");
  }
  if (options.commonDir !== undefined) {
    let declaredCommonDir;
    try {
      declaredCommonDir = realpathSync(path.resolve(options.commonDir));
    } catch {
      fail("workflow_common_dir_override_forbidden");
    }
    requireCondition(declaredCommonDir === commonDir, "workflow_common_dir_override_forbidden");
  }
  return { projectRoot: canonicalTopLevel, commonDir };
}

function leasePaths(options) {
  const { projectRoot, commonDir } = resolveProjectScope(options);
  const directory = path.join(commonDir, "nutrition-workflow");
  return {
    projectRoot,
    commonDir,
    directory,
    lease: path.join(directory, "lease.json"),
    mutex: path.join(directory, "operation.lock"),
    writer: path.join(directory, "writer.lock"),
    attestations: path.join(directory, "lease-attestations"),
  };
}

export function resolveWorkflowProjectScope(options) {
  const scope = resolveProjectScope(options);
  return {
    projectRoot: scope.projectRoot,
    commonDir: scope.commonDir,
    worktreeIdentitySha256: digest(scope.projectRoot),
    gitCommonIdentitySha256: digest(scope.commonDir),
  };
}

async function pathExists(candidate) {
  try {
    await fs.lstat(candidate);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

async function requireSafeGovernanceDirectory(paths, create) {
  const commonDir = path.dirname(paths.directory);
  if (create) await fs.mkdir(commonDir, { recursive: true, mode: 0o700 });
  const parsed = path.parse(commonDir);
  let current = parsed.root;
  for (const component of commonDir.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await fs.lstat(current).catch(() => null);
    if (stat === null) {
      requireCondition(!create, "workflow_governance_directory_missing");
      return false;
    }
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), "workflow_governance_directory_unsafe");
  }
  const governance = await fs.lstat(paths.directory).catch(() => null);
  if (governance === null && create) {
    await fs.mkdir(paths.directory, { recursive: true, mode: 0o700 });
  }
  const verifiedGovernance = await fs.lstat(paths.directory).catch(() => null);
  if (verifiedGovernance !== null) {
    requireCondition(
      verifiedGovernance.isDirectory() &&
        !verifiedGovernance.isSymbolicLink() &&
        (verifiedGovernance.mode & 0o777) === 0o700,
      "workflow_governance_directory_unsafe",
    );
    if (typeof process.getuid === "function") {
      requireCondition(verifiedGovernance.uid === process.getuid(), "workflow_governance_directory_unsafe");
    }
  }
  return true;
}

async function readBoundedJson(filePath, maxBytes, missingCode, invalidCode) {
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") fail(missingCode);
    fail(invalidCode);
  }
  let raw;
  let before;
  try {
    before = await handle.stat();
    requireCondition(before.isFile() && before.size <= maxBytes && before.nlink === 1, invalidCode);
    raw = await handle.readFile("utf8");
    requireCondition(Buffer.byteLength(raw) <= maxBytes, invalidCode);
    const after = await handle.stat();
    const pathStat = await fs.lstat(filePath).catch(() => null);
    requireCondition(
      before.dev === after.dev &&
        before.ino === after.ino &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs &&
        after.nlink === 1 &&
        pathStat?.isFile() &&
        !pathStat.isSymbolicLink() &&
        pathStat.dev === after.dev &&
        pathStat.ino === after.ino &&
        pathStat.size === after.size &&
        pathStat.mtimeMs === after.mtimeMs &&
        pathStat.ctimeMs === after.ctimeMs &&
        pathStat.nlink === 1,
      invalidCode,
    );
  } finally {
    await handle.close().catch(() => undefined);
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail(invalidCode);
  }
  return { raw, value };
}

async function readPrivateJsonFile(filePath, maxBytes, missingCode, invalidCode, unsafeCode) {
  const parentPath = path.dirname(filePath);
  const parentBefore = await fs.lstat(parentPath).catch(() => null);
  requireCondition(
    parentBefore?.isDirectory() &&
      !parentBefore.isSymbolicLink() &&
      (parentBefore.mode & 0o022) === 0,
    unsafeCode,
  );
  if (typeof process.getuid === "function") {
    requireCondition(parentBefore.uid === process.getuid(), unsafeCode);
  }
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") fail(missingCode);
    fail(unsafeCode);
  }
  let raw;
  let before;
  let after;
  try {
    before = await handle.stat();
    requireCondition(
      before.isFile() &&
        before.size > 0 &&
        before.size <= maxBytes &&
        (before.mode & 0o777) === 0o600 &&
        before.nlink === 1,
      unsafeCode,
    );
    if (typeof process.getuid === "function") requireCondition(before.uid === process.getuid(), unsafeCode);
    raw = await handle.readFile("utf8");
    requireCondition(Buffer.byteLength(raw) <= maxBytes, invalidCode);
    after = await handle.stat();
    requireCondition(
      before.dev === after.dev &&
        before.ino === after.ino &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs &&
        before.mode === after.mode &&
        after.nlink === 1,
      unsafeCode,
    );
    const pathStat = await fs.lstat(filePath).catch(() => null);
    requireCondition(
      pathStat?.isFile() &&
        !pathStat.isSymbolicLink() &&
        pathStat.dev === after.dev &&
        pathStat.ino === after.ino &&
        pathStat.size === after.size &&
        pathStat.mtimeMs === after.mtimeMs &&
        pathStat.ctimeMs === after.ctimeMs &&
        pathStat.mode === after.mode &&
        pathStat.nlink === 1 &&
        (await fs.realpath(filePath)) === filePath,
      unsafeCode,
    );
    const parentAfter = await fs.lstat(parentPath).catch(() => null);
    requireCondition(
      parentAfter?.dev === parentBefore.dev &&
        parentAfter.ino === parentBefore.ino &&
        parentAfter.mode === parentBefore.mode &&
        parentAfter.uid === parentBefore.uid,
      unsafeCode,
    );
  } finally {
    await handle.close().catch(() => undefined);
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail(invalidCode);
  }
  return { raw, rawDigest: digest(raw), value, dev: after.dev, ino: after.ino };
}

async function readRawFileMetadata(filePath, maxBytes, missingCode, invalidCode) {
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") fail(missingCode);
    fail(invalidCode);
  }
  try {
    const before = await handle.stat();
    requireCondition(before.isFile() && before.size <= maxBytes && before.nlink === 1, invalidCode);
    const raw = await handle.readFile();
    requireCondition(raw.length <= maxBytes, invalidCode);
    const after = await handle.stat();
    const pathStat = await fs.lstat(filePath).catch(() => null);
    requireCondition(
      before.dev === after.dev &&
        before.ino === after.ino &&
        before.size === after.size &&
        before.mtimeMs === after.mtimeMs &&
        before.ctimeMs === after.ctimeMs &&
        after.nlink === 1 &&
        pathStat?.isFile() &&
        !pathStat.isSymbolicLink() &&
        pathStat.dev === after.dev &&
        pathStat.ino === after.ino &&
        pathStat.size === after.size &&
        pathStat.mtimeMs === after.mtimeMs &&
        pathStat.ctimeMs === after.ctimeMs &&
        pathStat.nlink === 1,
      invalidCode,
    );
    return {
      raw,
      rawDigest: digest(raw),
      byteLength: raw.length,
      modifiedAt: timestamp(new Date(after.mtimeMs)),
      modifiedAtMs: after.mtimeMs,
      changedAtMs: after.ctimeMs,
      device: after.dev,
      inode: after.ino,
      mode: after.mode,
      linkCount: after.nlink,
    };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

function validateLease(value) {
  requireCondition(value?.schemaVersion === 1 && value?.kind === "workflow_writer_lease", "workflow_lease_invalid");
  requireCondition(typeof value.leaseId === "string" && /^[0-9a-f-]{36}$/.test(value.leaseId), "workflow_lease_invalid");
  requireCondition(typeof value.tokenSha256 === "string" && /^[0-9a-f]{64}$/.test(value.tokenSha256), "workflow_lease_invalid");
  requireCondition(
    typeof value.publicKeySpki === "string" &&
      value.publicKeySpki.length <= 512 &&
      BASE64URL_PATTERN.test(value.publicKeySpki),
    "workflow_lease_invalid",
  );
  requireCondition(typeof value.publicKeySha256 === "string" && /^[0-9a-f]{64}$/.test(value.publicKeySha256), "workflow_lease_invalid");
  requireCondition(digest(Buffer.from(value.publicKeySpki, "base64url")) === value.publicKeySha256, "workflow_lease_invalid");
  requireCondition(
    typeof value.leaseAttestationSha256 === "string" && /^[0-9a-f]{64}$/.test(value.leaseAttestationSha256),
    "workflow_lease_invalid",
  );
  requireCondition(RUNTIMES.has(value.executionRuntime), "workflow_lease_invalid");
  requireCondition(typeof value.gsdVersion === "string" && VERSION_PATTERN.test(value.gsdVersion), "workflow_lease_invalid");
  requireCondition(typeof value.modelProfile === "string" && PROFILE_PATTERN.test(value.modelProfile), "workflow_lease_invalid");
  requireCondition(
    Number.isInteger(value.processId) &&
      value.processId > 0 &&
      typeof value.processFingerprint === "string" &&
      SHA256_PATTERN.test(value.processFingerprint) &&
      Number.isInteger(value.acquisitionProcessId) &&
      value.acquisitionProcessId > 0 &&
      typeof value.acquisitionProcessFingerprint === "string" &&
      SHA256_PATTERN.test(value.acquisitionProcessFingerprint),
    "workflow_lease_invalid",
  );
  requireCondition(typeof value.acquiredAt === "string" && typeof value.renewedAt === "string" && typeof value.expiresAt === "string", "workflow_lease_invalid");
  requireCondition(
    RFC3339_PATTERN.test(value.acquiredAt) && RFC3339_PATTERN.test(value.renewedAt) && RFC3339_PATTERN.test(value.expiresAt),
    "workflow_lease_invalid",
  );
  const acquiredAt = Date.parse(value.acquiredAt);
  const renewedAt = Date.parse(value.renewedAt);
  const expiresAt = Date.parse(value.expiresAt);
  requireCondition(
    Number.isFinite(acquiredAt) &&
      Number.isFinite(renewedAt) &&
      Number.isFinite(expiresAt) &&
      acquiredAt <= renewedAt &&
      renewedAt < expiresAt,
    "workflow_lease_invalid",
  );
  const takeoverFields = [value.predecessorLeaseId, value.predecessorLeaseDigest, value.handoffReason];
  const hasTakeoverFields = takeoverFields.some((field) => field !== undefined);
  requireCondition(
    !hasTakeoverFields ||
      (UUID_PATTERN.test(value.predecessorLeaseId ?? "") &&
        SHA256_PATTERN.test(value.predecessorLeaseDigest ?? "") &&
        TAKEOVER_REASONS.has(value.handoffReason)),
    "workflow_lease_invalid",
  );
  return value;
}

function validateMutex(value) {
  requireCondition(value?.schemaVersion === 1 && value?.kind === "workflow_lease_operation", "lease_operation_lock_invalid");
  requireCondition(typeof value.operationId === "string" && /^[0-9a-f-]{36}$/.test(value.operationId), "lease_operation_lock_invalid");
  requireCondition(
    typeof value.acquiredAt === "string" &&
      RFC3339_PATTERN.test(value.acquiredAt) &&
      typeof value.recoverAfter === "string" &&
      RFC3339_PATTERN.test(value.recoverAfter),
    "lease_operation_lock_invalid",
  );
  requireCondition(
    Number.isFinite(Date.parse(value.acquiredAt)) && Date.parse(value.recoverAfter) >= Date.parse(value.acquiredAt) + 60_000,
    "lease_operation_lock_invalid",
  );
  requireCondition(Number.isInteger(value.processId) && value.processId > 0, "lease_operation_lock_invalid");
  requireCondition(typeof value.processFingerprint === "string" && /^[0-9a-f]{64}$/.test(value.processFingerprint), "lease_operation_lock_invalid");
  return value;
}

function validateWriterFence(value) {
  requireCondition(value?.schemaVersion === 1 && value?.kind === "workflow_writer_fence", "workflow_writer_fence_invalid");
  requireCondition(typeof value.fenceId === "string" && /^[0-9a-f-]{36}$/.test(value.fenceId), "workflow_writer_fence_invalid");
  requireCondition(typeof value.leaseId === "string" && /^[0-9a-f-]{36}$/.test(value.leaseId), "workflow_writer_fence_invalid");
  requireCondition(typeof value.leaseDigest === "string" && /^[0-9a-f]{64}$/.test(value.leaseDigest), "workflow_writer_fence_invalid");
  requireCondition(RUNTIMES.has(value.executionRuntime), "workflow_writer_fence_invalid");
  requireCondition(WRITER_PURPOSES.has(value.purpose), "workflow_writer_fence_invalid");
  requireCondition(Number.isInteger(value.processId) && value.processId > 0, "workflow_writer_fence_invalid");
  requireCondition(typeof value.processFingerprint === "string" && /^[0-9a-f]{64}$/.test(value.processFingerprint), "workflow_writer_fence_invalid");
  requireCondition(
    typeof value.nestedCapabilitySha256 === "string" && /^[0-9a-f]{64}$/.test(value.nestedCapabilitySha256),
    "workflow_writer_fence_invalid",
  );
  requireCondition(
    typeof value.acquiredAt === "string" &&
      RFC3339_PATTERN.test(value.acquiredAt) &&
      typeof value.expiresAt === "string" &&
      RFC3339_PATTERN.test(value.expiresAt) &&
      Date.parse(value.acquiredAt) < Date.parse(value.expiresAt),
    "workflow_writer_fence_invalid",
  );
  requireCondition(
    value.childRegistrationPending === undefined || value.childRegistrationPending === true,
    "workflow_writer_fence_invalid",
  );
  requireCondition(
    value.childProcessGroupId === undefined || (Number.isInteger(value.childProcessGroupId) && value.childProcessGroupId > 1),
    "workflow_writer_fence_invalid",
  );
  requireCondition(
    value.childProcessGroupRegisteredAt === undefined ||
      (typeof value.childProcessGroupRegisteredAt === "string" && RFC3339_PATTERN.test(value.childProcessGroupRegisteredAt)),
    "workflow_writer_fence_invalid",
  );
  requireCondition(
    !(value.childRegistrationPending === true && value.childProcessGroupId !== undefined) &&
      ((value.childProcessGroupId === undefined) === (value.childProcessGroupRegisteredAt === undefined)),
    "workflow_writer_fence_invalid",
  );
  return value;
}

async function readMutex(paths, missingCode = "lease_operation_lock_missing") {
  const loaded = await readBoundedJson(paths.mutex, MAX_MUTEX_BYTES, missingCode, "lease_operation_lock_invalid");
  return { raw: loaded.raw, value: validateMutex(loaded.value), mutexDigest: digest(loaded.raw) };
}

async function readWriterFence(paths, missingCode = "workflow_writer_fence_missing") {
  const loaded = await readBoundedJson(paths.writer, MAX_WRITER_BYTES, missingCode, "workflow_writer_fence_invalid");
  return { raw: loaded.raw, value: validateWriterFence(loaded.value), writerDigest: digest(loaded.raw) };
}

async function readLease(paths, missingCode = "workflow_lease_missing") {
  const loaded = await readBoundedJson(paths.lease, MAX_LEASE_BYTES, missingCode, "workflow_lease_invalid");
  return { raw: loaded.raw, value: validateLease(loaded.value), leaseDigest: digest(loaded.raw) };
}

function validateHolder(options) {
  requireCondition(RUNTIMES.has(options.executionRuntime), "lease_runtime_invalid");
  requireCondition(typeof options.gsdVersion === "string" && VERSION_PATTERN.test(options.gsdVersion), "lease_gsd_version_invalid");
  requireCondition(typeof options.modelProfile === "string" && PROFILE_PATTERN.test(options.modelProfile), "lease_model_profile_invalid");
  requireCondition(Number.isInteger(options.ttlSeconds) && options.ttlSeconds >= 60 && options.ttlSeconds <= 86400, "lease_ttl_invalid");
}

function createLeaseCredentials() {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeySpki = publicKey.export({ type: "spki", format: "der" }).toString("base64url");
  const privateKeyPkcs8 = privateKey.export({ type: "pkcs8", format: "der" }).toString("base64url");
  return {
    token: randomBytes(32).toString("base64url"),
    publicKeySpki,
    privateKeyPkcs8,
  };
}

function leaseAttestation(lease) {
  return {
    schemaVersion: 1,
    kind: "workflow_lease_attestation",
    leaseId: lease.leaseId,
    executionRuntime: lease.executionRuntime,
    gsdVersion: lease.gsdVersion,
    modelProfile: lease.modelProfile,
    acquisitionProcessId: lease.acquisitionProcessId,
    acquisitionProcessFingerprint: lease.acquisitionProcessFingerprint,
    publicKeySpki: lease.publicKeySpki,
    publicKeySha256: lease.publicKeySha256,
    acquiredAt: lease.acquiredAt,
    predecessorLeaseId: lease.predecessorLeaseId ?? null,
  };
}

function makeLease(options, credentials, now = new Date()) {
  validateHolder(options);
  const acquiredAt = timestamp(now);
  const expiresAt = timestamp(new Date(now.valueOf() + options.ttlSeconds * 1000));
  const acquisitionProcessFingerprint = processFingerprint();
  const base = {
    schemaVersion: 1,
    kind: "workflow_writer_lease",
    leaseId: randomUUID(),
    tokenSha256: digest(credentials.token),
    publicKeySpki: credentials.publicKeySpki,
    publicKeySha256: digest(Buffer.from(credentials.publicKeySpki, "base64url")),
    executionRuntime: options.executionRuntime,
    gsdVersion: options.gsdVersion,
    modelProfile: options.modelProfile,
    processId: process.pid,
    processFingerprint: acquisitionProcessFingerprint,
    acquisitionProcessId: process.pid,
    acquisitionProcessFingerprint,
    acquiredAt,
    renewedAt: acquiredAt,
    expiresAt,
    ...(options.predecessorLeaseId ? { predecessorLeaseId: options.predecessorLeaseId } : {}),
  };
  const attestation = leaseAttestation(base);
  return {
    ...base,
    leaseAttestationSha256: digest(`${JSON.stringify(attestation, null, 2)}\n`),
  };
}

async function writeExclusiveJson(filePath, value, mode = 0o600) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const handle = await fs.open(filePath, "wx", mode);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function requireSafeTokenPath(options, paths) {
  const tokenFile = options.tokenFile;
  requireCondition(typeof tokenFile === "string" && path.isAbsolute(tokenFile), "lease_token_path_must_be_absolute");
  let existing = path.dirname(path.resolve(tokenFile));
  const suffix = [path.basename(path.resolve(tokenFile))];
  while ((await fs.lstat(existing).catch(() => null)) === null) {
    const parent = path.dirname(existing);
    requireCondition(parent !== existing, "lease_token_parent_unsafe");
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  const existingStat = await fs.lstat(existing).catch(() => null);
  requireCondition(existingStat?.isDirectory() && !existingStat.isSymbolicLink(), "lease_token_parent_unsafe");
  const physicalAncestor = await fs.realpath(existing);
  const resolved = path.resolve(physicalAncestor, ...suffix);
  requireCondition(!isWithin(paths.projectRoot, resolved), "lease_token_path_inside_project");
  requireCondition(!isWithin(paths.commonDir, resolved), "lease_token_path_inside_git_common_dir");

  const parsed = path.parse(path.dirname(resolved));
  const components = path.dirname(resolved).slice(parsed.root.length).split(path.sep).filter(Boolean);
  let current = parsed.root;
  for (const component of components) {
    current = path.join(current, component);
    let stat;
    try {
      stat = await fs.lstat(current);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") continue;
      throw error;
    }
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), "lease_token_parent_unsafe");
  }
  const designatedParent = await fs.lstat(path.dirname(resolved)).catch(() => null);
  if (designatedParent !== null) {
    requireCondition(
      designatedParent.isDirectory() &&
        !designatedParent.isSymbolicLink() &&
        (designatedParent.mode & 0o022) === 0,
      "lease_token_parent_unsafe",
    );
    if (typeof process.getuid === "function") {
      requireCondition(designatedParent.uid === process.getuid(), "lease_token_parent_unsafe");
    }
  }
  return resolved;
}

async function removeOwnedMutex(paths, operation) {
  const current = await readMutex(paths);
  requireCondition(current.value.operationId === operation.operationId, "lease_operation_cleanup_failed");
  await fs.unlink(paths.mutex);
  requireCondition(!(await pathExists(paths.mutex)), "lease_operation_cleanup_failed");
  await syncDirectory(paths.directory);
}

function processFingerprint(processId = process.pid) {
  try {
    const started = execFileSync("/bin/ps", ["-o", "lstart=", "-p", String(processId)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      env: { PATH: "/usr/bin:/bin", LC_ALL: "C", LANG: "C", TZ: "UTC" },
    }).trim();
    requireCondition(started.length > 0, "lease_process_identity_unavailable");
    return digest(`${processId}:${started}`);
  } catch (error) {
    if (error instanceof WorkflowLeaseError) throw error;
    fail("lease_process_identity_unavailable");
  }
}

function processIsSameOwner(operation) {
  try {
    process.kill(operation.processId, 0);
  } catch (error) {
    return !(error && typeof error === "object" && error.code === "ESRCH");
  }
  try {
    return processFingerprint(operation.processId) === operation.processFingerprint;
  } catch {
    return true;
  }
}

function processGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === "object" && error.code === "ESRCH");
  }
}

async function installExclusiveJson(filePath, value, mode = 0o600, existsCode = "lease_operation_in_progress") {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${randomUUID()}`);
  await writeExclusiveJson(temp, value, mode);
  try {
    await fs.link(temp, filePath).catch((error) => {
      if (error && typeof error === "object" && error.code === "EEXIST") fail(existsCode);
      throw error;
    });
    await syncDirectory(path.dirname(filePath));
  } finally {
    let removed = false;
    try {
      await fs.unlink(temp);
      removed = true;
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    }
    if (removed) await syncDirectory(path.dirname(filePath));
  }
}

async function unlinkDurably(filePath, options, faultStage) {
  await fs.unlink(filePath);
  if (faultStage) injectedFault(options, faultStage);
  await syncDirectory(path.dirname(filePath));
}

async function withMutex(paths, callback, options = {}) {
  await requireSafeGovernanceDirectory(paths, true);
  await fs.mkdir(paths.directory, { recursive: true, mode: 0o700 });
  const acquired = new Date();
  const recoveryDelaySeconds = Math.max(60, options.recoveryDelaySeconds ?? 60);
  const operation = {
    schemaVersion: 1,
    kind: "workflow_lease_operation",
    operationId: randomUUID(),
    acquiredAt: timestamp(acquired),
    recoverAfter: timestamp(new Date(acquired.valueOf() + recoveryDelaySeconds * 1000)),
    processId: process.pid,
    processFingerprint: processFingerprint(),
  };
  await installExclusiveJson(paths.mutex, operation);
  let result;
  let callbackError;
  try {
    if (!options.allowPreparedTransition) await requireNoPreparedLeaseTransition(paths);
    result = await callback(operation);
  } catch (error) {
    callbackError = error;
  }
  try {
    await removeOwnedMutex(paths, operation);
  } catch {
    fail("lease_operation_cleanup_failed");
  }
  if (callbackError) throw callbackError;
  return result;
}

function tokenRecord(leaseId, credentials) {
  return {
    schemaVersion: 1,
    kind: "workflow_writer_token",
    leaseId,
    token: credentials.token,
    privateKeyPkcs8: credentials.privateKeyPkcs8,
  };
}

async function writeTokenFile(options, paths, leaseId, credentials) {
  const tokenFile = await requireSafeTokenPath(options, paths);
  const expected = tokenRecord(leaseId, credentials);
  await installExclusiveJson(tokenFile, expected, 0o600, "lease_token_already_exists");
  try {
    const published = await readTokenFileRecord(options, paths);
    requireCondition(
      published.raw === `${JSON.stringify(expected, null, 2)}\n`,
      "lease_token_publication_changed",
    );
  } catch (error) {
    await fs.unlink(tokenFile).catch(() => undefined);
    await syncDirectory(path.dirname(tokenFile)).catch(() => undefined);
    throw error;
  }
}

function validateTokenRecord(value) {
  requireCondition(
    value?.schemaVersion === 1 &&
      value?.kind === "workflow_writer_token" &&
      typeof value.leaseId === "string" &&
      UUID_PATTERN.test(value.leaseId) &&
      typeof value.token === "string" &&
      value.token.length >= 40 &&
      typeof value.privateKeyPkcs8 === "string" &&
      value.privateKeyPkcs8.length <= 1024 &&
      BASE64URL_PATTERN.test(value.privateKeyPkcs8),
    "lease_token_invalid",
  );
  return value;
}

async function readTokenFileRecord(options, paths) {
  const tokenFile = await requireSafeTokenPath(options, paths);
  const loaded = await readPrivateJsonFile(
    tokenFile,
    MAX_TOKEN_BYTES,
    "lease_token_missing",
    "lease_token_invalid",
    "lease_token_file_unsafe",
  );
  return { ...loaded, value: validateTokenRecord(loaded.value), tokenDigest: digest(loaded.raw) };
}

async function readTokenFile(options, paths) {
  return (await readTokenFileRecord(options, paths)).value;
}

async function writeLeaseAttestation(paths, lease) {
  const value = leaseAttestation(lease);
  const raw = `${JSON.stringify(value, null, 2)}\n`;
  requireCondition(digest(raw) === lease.leaseAttestationSha256, "lease_attestation_digest_mismatch");
  const existed = await pathExists(paths.attestations);
  await fs.mkdir(paths.attestations, { recursive: true, mode: 0o700 });
  if (!existed) await syncDirectory(paths.directory);
  const directory = await fs.lstat(paths.attestations);
  requireCondition(directory.isDirectory() && !directory.isSymbolicLink(), "lease_attestation_directory_unsafe");
  const target = path.join(paths.attestations, `${lease.leaseId}.json`);
  await installExclusiveJson(target, value, 0o600, "lease_attestation_collision");
  return target;
}

function validateLeaseAttestation(value) {
  requireCondition(value?.schemaVersion === 1 && value?.kind === "workflow_lease_attestation", "lease_attestation_invalid");
  requireCondition(typeof value.leaseId === "string" && /^[0-9a-f-]{36}$/.test(value.leaseId), "lease_attestation_invalid");
  requireCondition(RUNTIMES.has(value.executionRuntime), "lease_attestation_invalid");
  requireCondition(typeof value.gsdVersion === "string" && VERSION_PATTERN.test(value.gsdVersion), "lease_attestation_invalid");
  requireCondition(typeof value.modelProfile === "string" && PROFILE_PATTERN.test(value.modelProfile), "lease_attestation_invalid");
  requireCondition(Number.isInteger(value.acquisitionProcessId) && value.acquisitionProcessId > 0, "lease_attestation_invalid");
  requireCondition(SHA256_PATTERN.test(value.acquisitionProcessFingerprint ?? ""), "lease_attestation_invalid");
  requireCondition(
    typeof value.publicKeySpki === "string" && value.publicKeySpki.length <= 512 && BASE64URL_PATTERN.test(value.publicKeySpki),
    "lease_attestation_invalid",
  );
  requireCondition(typeof value.publicKeySha256 === "string" && /^[0-9a-f]{64}$/.test(value.publicKeySha256), "lease_attestation_invalid");
  requireCondition(digest(Buffer.from(value.publicKeySpki, "base64url")) === value.publicKeySha256, "lease_attestation_invalid");
  requireCondition(typeof value.acquiredAt === "string" && RFC3339_PATTERN.test(value.acquiredAt), "lease_attestation_invalid");
  requireCondition(value.predecessorLeaseId === null || /^[0-9a-f-]{36}$/.test(value.predecessorLeaseId), "lease_attestation_invalid");
  return value;
}

async function readLeaseAttestation(paths, leaseId, expectedDigest) {
  const directory = await fs.lstat(paths.attestations).catch(() => null);
  requireCondition(directory?.isDirectory() && !directory.isSymbolicLink(), "lease_attestation_directory_unsafe");
  const target = path.join(paths.attestations, `${leaseId}.json`);
  const loaded = await readBoundedJson(target, MAX_ATTESTATION_BYTES, "lease_attestation_missing", "lease_attestation_invalid");
  const value = validateLeaseAttestation(loaded.value);
  requireCondition(value.leaseId === leaseId, "lease_attestation_invalid");
  requireCondition(digest(loaded.raw) === expectedDigest, "lease_attestation_digest_mismatch");
  return { value, attestationDigest: expectedDigest };
}

function requireLeaseAttestationBinding(attestation, lease) {
  requireCondition(attestation.leaseId === lease.leaseId, "lease_attestation_identity_mismatch");
  requireCondition(attestation.executionRuntime === lease.executionRuntime, "lease_attestation_identity_mismatch");
  requireCondition(attestation.gsdVersion === lease.gsdVersion, "lease_attestation_identity_mismatch");
  requireCondition(attestation.modelProfile === lease.modelProfile, "lease_attestation_identity_mismatch");
  requireCondition(
    attestation.acquisitionProcessId === lease.acquisitionProcessId,
    "lease_attestation_identity_mismatch",
  );
  requireCondition(
    attestation.acquisitionProcessFingerprint === lease.acquisitionProcessFingerprint,
    "lease_attestation_identity_mismatch",
  );
  requireCondition(attestation.publicKeySpki === lease.publicKeySpki, "lease_attestation_identity_mismatch");
  requireCondition(attestation.publicKeySha256 === lease.publicKeySha256, "lease_attestation_identity_mismatch");
  requireCondition(attestation.acquiredAt === lease.acquiredAt, "lease_attestation_identity_mismatch");
  requireCondition(
    attestation.predecessorLeaseId === (lease.predecessorLeaseId ?? null),
    "lease_attestation_identity_mismatch",
  );
}

async function requireNoWriterFence(paths) {
  requireCondition(!(await pathExists(paths.writer)), "workflow_writer_active");
}

function safeLeaseReceipt(kind, lease, now = new Date()) {
  return {
    schemaVersion: 1,
    kind,
    status: "pass",
    leaseId: lease.leaseId,
    executionRuntime: lease.executionRuntime,
    gsdVersion: lease.gsdVersion,
    modelProfile: lease.modelProfile,
    observedAt: timestamp(now),
    expiresAt: lease.expiresAt,
  };
}

export async function acquireWorkflowLease(options) {
  const paths = leasePaths(options);
  await requireSafeTokenPath(options, paths);
  const credentials = createLeaseCredentials();
  return withMutex(paths, async () => {
    await requireNoWriterFence(paths);
    requireCondition(!(await pathExists(paths.lease)), "workflow_lease_active");
    await validateLeaseTransitionLedger(paths, await scanLeaseTransitions(paths), null);
    const lease = makeLease(options, credentials, options.now);
    let tokenWritten = false;
    let attestationPath = null;
    try {
      await writeTokenFile(options, paths, lease.leaseId, credentials);
      tokenWritten = true;
      attestationPath = await writeLeaseAttestation(paths, lease);
      await installExclusiveJson(paths.lease, lease, 0o600, "workflow_lease_active");
    } catch (error) {
      if (tokenWritten) await fs.unlink(options.tokenFile).catch(() => undefined);
      if (attestationPath) await fs.unlink(attestationPath).catch(() => undefined);
      throw error;
    }
    return { ...safeLeaseReceipt("workflow_writer_lease_acquire", lease, options.now), tokenFileWritten: true };
  });
}

export async function getWorkflowLeaseStatus(options) {
  const paths = leasePaths(options);
  await requireSafeGovernanceDirectory(paths, false);
  let transitionFailure = null;
  const transitions = await scanLeaseTransitions(paths).catch((error) => {
    if (error instanceof WorkflowLeaseError && error.code.startsWith("lease_transition_")) {
      transitionFailure = error.code;
      return { prepared: null, records: [] };
    }
    throw error;
  });
  const preparedTransition = transitions.prepared;
  let corruptMutex = null;
  const mutex = await readMutex(paths).catch((error) => {
    if (error instanceof WorkflowLeaseError && error.code === "lease_operation_lock_missing") return null;
    if (error instanceof WorkflowLeaseError && error.code === "lease_operation_lock_invalid") return null;
    throw error;
  });
  if (!mutex && (await pathExists(paths.mutex))) {
    corruptMutex = await readRawFileMetadata(
      paths.mutex,
      MAX_MUTEX_BYTES,
      "lease_operation_lock_missing",
      "lease_operation_lock_invalid",
    );
  }
  const writer = await readWriterFence(paths).catch((error) => {
    if (error instanceof WorkflowLeaseError && error.code === "workflow_writer_fence_missing") return null;
    throw error;
  });
  if (!(await pathExists(paths.lease))) {
    let ledgerFailure = null;
    try {
      await validateLeaseTransitionLedger(paths, transitions, null);
    } catch (error) {
      ledgerFailure = error instanceof WorkflowLeaseError ? error.code : "lease_transition_ledger_incomplete";
    }
    const transitionBlocked = Boolean(transitionFailure || preparedTransition || ledgerFailure);
    return {
      schemaVersion: 1,
      kind: "workflow_writer_lease_status",
      status: mutex || corruptMutex || writer || transitionBlocked ? "fail" : "pass",
      code: corruptMutex
        ? "lease_operation_lock_invalid"
        : mutex
          ? "lease_transition_in_progress"
          : transitionFailure
            ? transitionFailure
            : preparedTransition
              ? "lease_transition_recovery_required"
              : ledgerFailure
                ? ledgerFailure
              : writer
                ? "orphan_writer_fence"
                : "workflow_lease_inactive",
      active: mutex || corruptMutex || writer || transitionBlocked ? null : false,
      operationBlocked: Boolean(mutex || corruptMutex || transitionBlocked),
      writerBlocked: Boolean(writer),
      readyForWriter: false,
      ...(mutex
        ? {
            operationId: mutex.value.operationId,
            operationDigest: mutex.mutexDigest,
            operationAcquiredAt: mutex.value.acquiredAt,
            operationRecoverAfter: mutex.value.recoverAfter,
          }
        : {}),
      ...(corruptMutex
        ? {
            operationDigest: corruptMutex.rawDigest,
            operationByteLength: corruptMutex.byteLength,
            operationModifiedAt: corruptMutex.modifiedAt,
            corruptMutexRecoveryEligible: false,
            corruptMutexRecoveryBlockingCode: "lease_corrupt_mutex_recovery_owner_evidence_unavailable",
          }
        : {}),
      ...(writer
        ? {
            writerFenceId: writer.value.fenceId,
            writerFenceDigest: writer.writerDigest,
            writerFenceExpiresAt: writer.value.expiresAt,
            writerChildRegistrationPending: writer.value.childRegistrationPending === true,
            writerChildProcessGroupId: writer.value.childProcessGroupId ?? null,
          }
        : {}),
      ...(preparedTransition
        ? {
            transitionId: preparedTransition.value.transitionId,
            transitionAction: preparedTransition.value.action,
            transitionDigest: preparedTransition.transitionDigest,
            transitionPreparedAt: preparedTransition.value.preparedAt,
          }
        : {}),
      observedAt: timestamp(options.now),
    };
  }
  const loaded = await readLease(paths);
  let ledgerFailure = null;
  try {
    await validateLeaseTransitionLedger(paths, transitions, loaded.value);
  } catch (error) {
    ledgerFailure = error instanceof WorkflowLeaseError ? error.code : "lease_transition_ledger_incomplete";
  }
  let attestationFailure = null;
  try {
    const attestation = await readLeaseAttestation(
      paths,
      loaded.value.leaseId,
      loaded.value.leaseAttestationSha256,
    );
    requireLeaseAttestationBinding(attestation.value, loaded.value);
  } catch (error) {
    attestationFailure = error instanceof WorkflowLeaseError ? error.code : "lease_attestation_invalid";
  }
  const expired = new Date(loaded.value.expiresAt).valueOf() <= (options.now ?? new Date()).valueOf();
  const transitionBlocked = Boolean(transitionFailure || preparedTransition || ledgerFailure);
  const operationBlocked = Boolean(mutex || corruptMutex || transitionBlocked);
  const writerBlocked = Boolean(writer);
  const blockingCode = attestationFailure
    ? attestationFailure
    : corruptMutex
      ? "lease_operation_lock_invalid"
      : mutex
        ? "lease_transition_in_progress"
        : transitionFailure
          ? transitionFailure
          : preparedTransition
            ? "lease_transition_recovery_required"
            : ledgerFailure
              ? ledgerFailure
              : writer
                ? "workflow_writer_active"
                : expired
                  ? "workflow_lease_expired"
                  : null;
  return {
    ...safeLeaseReceipt("workflow_writer_lease_status", loaded.value, options.now),
    ...(blockingCode ? { status: "fail", code: blockingCode } : {}),
    active: true,
    expired,
    leaseDigest: loaded.leaseDigest,
    priorLeaseEvidenceSha256: digest(canonicalPayload(historicalLeaseFields(loaded.value))),
    operationBlocked,
    writerBlocked,
    readyForWriter: !blockingCode,
    ...(mutex
      ? {
          operationId: mutex.value.operationId,
          operationDigest: mutex.mutexDigest,
          operationAcquiredAt: mutex.value.acquiredAt,
          operationRecoverAfter: mutex.value.recoverAfter,
        }
      : {}),
    ...(corruptMutex
      ? {
          status: "fail",
          code: "lease_operation_lock_invalid",
          operationDigest: corruptMutex.rawDigest,
          operationByteLength: corruptMutex.byteLength,
          operationModifiedAt: corruptMutex.modifiedAt,
          corruptMutexRecoveryEligible: false,
          corruptMutexRecoveryBlockingCode: "lease_corrupt_mutex_recovery_owner_evidence_unavailable",
        }
      : {}),
    ...(writer
      ? {
          writerFenceId: writer.value.fenceId,
          writerFenceDigest: writer.writerDigest,
          writerFenceExpiresAt: writer.value.expiresAt,
          writerFencePurpose: writer.value.purpose,
          writerChildRegistrationPending: writer.value.childRegistrationPending === true,
          writerChildProcessGroupId: writer.value.childProcessGroupId ?? null,
        }
      : {}),
    ...(preparedTransition
      ? {
          transitionId: preparedTransition.value.transitionId,
          transitionAction: preparedTransition.value.action,
          transitionDigest: preparedTransition.transitionDigest,
          transitionPreparedAt: preparedTransition.value.preparedAt,
        }
      : {}),
  };
}

export async function assertWorkflowLeaseHolder(options) {
  const paths = leasePaths(options);
  await requireSafeTokenPath(options, paths);
  requireCondition(!(await pathExists(paths.mutex)), "lease_operation_in_progress");
  requireCondition(!(await pathExists(paths.writer)), "workflow_writer_active");
  return loadWorkflowLeaseHolder(options, paths);
}

async function loadWorkflowLeaseHolder(options, paths) {
  await requireSafeGovernanceDirectory(paths, false);
  const transitions = await scanLeaseTransitions(paths);
  requireCondition(!transitions.prepared, "lease_transition_recovery_required");
  const loaded = await readLease(paths);
  await validateLeaseTransitionLedger(paths, transitions, loaded.value);
  const token = await readTokenFile(options, paths);
  validateTokenBinding(loaded.value, token);
  const attestation = await readLeaseAttestation(paths, loaded.value.leaseId, loaded.value.leaseAttestationSha256);
  requireLeaseAttestationBinding(attestation.value, loaded.value);
  const now = options.now ?? new Date();
  requireCondition(Date.parse(loaded.value.expiresAt) > now.valueOf(), "workflow_lease_expired");
  if (options.expectedRuntime !== undefined) {
    requireCondition(loaded.value.executionRuntime === options.expectedRuntime, "lease_holder_identity_mismatch");
  }
  return {
    ...safeLeaseReceipt("workflow_writer_lease_holder", loaded.value, now),
    leaseDigest: loaded.leaseDigest,
    leaseAttestationSha256: loaded.value.leaseAttestationSha256,
    publicKeySha256: loaded.value.publicKeySha256,
    _token: token,
  };
}

function safeHolder(holder) {
  const { _token, ...safe } = holder;
  return safe;
}

async function validateExistingWriterFence(options, paths) {
  const fence = await readWriterFence(paths);
  requireCondition(fence.value.fenceId === options.fenceId, "workflow_writer_fence_id_mismatch");
  const now = options.now ?? new Date();
  requireCondition(Date.parse(fence.value.expiresAt) > now.valueOf(), "workflow_writer_fence_expired");
  const holder = await loadWorkflowLeaseHolder(options, paths);
  requireCondition(fence.value.leaseId === holder.leaseId, "workflow_writer_fence_lease_mismatch");
  requireCondition(fence.value.leaseDigest === holder.leaseDigest, "workflow_writer_fence_lease_mismatch");
  requireCondition(fence.value.executionRuntime === holder.executionRuntime, "workflow_writer_fence_lease_mismatch");
  const sameProcess =
    fence.value.processId === process.pid && fence.value.processFingerprint === processFingerprint();
  const delegated =
    typeof options.nestedCapability === "string" &&
    options.nestedCapability.length >= 32 &&
    digest(options.nestedCapability) === fence.value.nestedCapabilitySha256;
  requireCondition(sameProcess || delegated, "workflow_writer_nested_authority_invalid");
  return { fence, holder, nestedCapability: delegated ? options.nestedCapability : null };
}

async function beginWorkflowWriterFence(options, paths) {
  requireCondition(WRITER_PURPOSES.has(options.purpose), "workflow_writer_purpose_invalid");
  requireCondition(
    Number.isInteger(options.maxDurationSeconds) && options.maxDurationSeconds >= 1 && options.maxDurationSeconds <= 86400,
    "workflow_writer_duration_invalid",
  );
  return withMutex(paths, async () => {
    await requireNoWriterFence(paths);
    const holder = await loadWorkflowLeaseHolder(options, paths);
    const now = options.now ?? new Date();
    requireCondition(
      Date.parse(holder.expiresAt) > now.valueOf() + options.maxDurationSeconds * 1000,
      "workflow_lease_insufficient_duration",
    );
    const nestedCapability = randomBytes(32).toString("base64url");
    const writer = {
      schemaVersion: 1,
      kind: "workflow_writer_fence",
      fenceId: randomUUID(),
      leaseId: holder.leaseId,
      leaseDigest: holder.leaseDigest,
      executionRuntime: holder.executionRuntime,
      purpose: options.purpose,
      processId: process.pid,
      processFingerprint: processFingerprint(),
      nestedCapabilitySha256: digest(nestedCapability),
      acquiredAt: timestamp(now),
      expiresAt: timestamp(new Date(now.valueOf() + options.maxDurationSeconds * 1000)),
    };
    await installExclusiveJson(paths.writer, writer, 0o600, "workflow_writer_active");
    return { fence: await readWriterFence(paths), holder, nestedCapability };
  });
}

async function replaceWriterFenceCas(paths, before, next) {
  validateWriterFence(next);
  const temp = path.join(paths.directory, `.writer.tmp-${randomUUID()}`);
  await writeExclusiveJson(temp, next);
  try {
    const current = await readWriterFence(paths);
    requireCondition(current.writerDigest === before.writerDigest, "workflow_writer_fence_changed");
    await fs.rename(temp, paths.writer);
    await syncDirectory(paths.directory);
    return await readWriterFence(paths);
  } finally {
    await fs.unlink(temp).catch(() => undefined);
  }
}

async function updateOwnedWriterFence(options, paths, owned, update) {
  const next = await withMutex(paths, async () => {
    const current = await readWriterFence(paths);
    requireCondition(current.writerDigest === owned.fence.writerDigest, "workflow_writer_fence_changed");
    requireCondition(current.value.fenceId === owned.fence.value.fenceId, "workflow_writer_fence_changed");
    return replaceWriterFenceCas(paths, current, update(current.value));
  });
  owned.fence = next;
}

async function endWorkflowWriterFence(options, paths, expected) {
  return withMutex(paths, async () => {
    const current = await readWriterFence(paths);
    requireCondition(current.writerDigest === expected.fence.writerDigest, "workflow_writer_fence_changed");
    requireCondition(current.value.childRegistrationPending !== true, "workflow_writer_child_registration_incomplete");
    requireCondition(
      current.value.childProcessGroupId === undefined || !processGroupExists(current.value.childProcessGroupId),
      "workflow_writer_child_group_alive",
    );
    const holder = await loadWorkflowLeaseHolder(options, paths);
    requireCondition(holder.leaseDigest === expected.holder.leaseDigest, "workflow_lease_changed");
    await fs.unlink(paths.writer);
    await syncDirectory(paths.directory);
  });
}

function canonicalPayload(value) {
  return Buffer.from(JSON.stringify(value), "utf8");
}

export async function withWorkflowWriterFence(options, callback) {
  const paths = leasePaths(options);
  await requireSafeTokenPath(options, paths);
  const nestedFenceId = options.fenceId ?? process.env.NUTRITION_WORKFLOW_FENCE_ID;
  const nestedCapability =
    options.nestedCapability ?? process.env.NUTRITION_WORKFLOW_FENCE_CAPABILITY;
  const owned = nestedFenceId
    ? await validateExistingWriterFence({ ...options, fenceId: nestedFenceId, nestedCapability }, paths)
    : await beginWorkflowWriterFence(options, paths);
  const context = {
    ...safeHolder(owned.holder),
    fenceId: owned.fence.value.fenceId,
    get fenceDigest() {
      return owned.fence.writerDigest;
    },
    get fenceExpiresAt() {
      return owned.fence.value.expiresAt;
    },
    signPayload(value) {
      const privateKey = createPrivateKey({
        key: Buffer.from(owned.holder._token.privateKeyPkcs8, "base64url"),
        type: "pkcs8",
        format: "der",
      });
      return signBytes(null, canonicalPayload(value), privateKey).toString("base64url");
    },
    nestedEnvironment() {
      requireCondition(
        typeof owned.nestedCapability === "string" && owned.nestedCapability.length >= 32,
        "workflow_writer_nested_capability_unavailable",
      );
      return {
        NUTRITION_WORKFLOW_FENCE_ID: owned.fence.value.fenceId,
        NUTRITION_WORKFLOW_FENCE_CAPABILITY: owned.nestedCapability,
      };
    },
    async assertCurrent() {
      await validateExistingWriterFence(
        {
          ...options,
          fenceId: owned.fence.value.fenceId,
          nestedCapability: owned.nestedCapability,
        },
        paths,
      );
    },
    async beginChildRegistration() {
      await updateOwnedWriterFence(options, paths, owned, (current) => {
        requireCondition(
          current.childRegistrationPending === undefined && current.childProcessGroupId === undefined,
          "workflow_writer_child_already_registered",
        );
        return { ...current, childRegistrationPending: true };
      });
    },
    async registerChildProcessGroup(processGroupId) {
      requireCondition(Number.isInteger(processGroupId) && processGroupId > 1, "workflow_writer_child_group_invalid");
      await updateOwnedWriterFence(options, paths, owned, (current) => {
        requireCondition(current.childRegistrationPending === true, "workflow_writer_child_registration_not_pending");
        const { childRegistrationPending: _pending, ...base } = current;
        return {
          ...base,
          childProcessGroupId: processGroupId,
          childProcessGroupRegisteredAt: timestamp(options.now),
        };
      });
    },
    async clearChildRegistration() {
      await updateOwnedWriterFence(options, paths, owned, (current) => {
        requireCondition(
          current.childRegistrationPending === true && current.childProcessGroupId === undefined,
          "workflow_writer_child_registration_not_pending",
        );
        const { childRegistrationPending: _pending, ...base } = current;
        return base;
      });
    },
  };
  let result;
  let callbackError;
  try {
    result = await callback(context);
  } catch (error) {
    callbackError = error;
  }
  let cleanupError;
  if (!nestedFenceId) {
    try {
      await endWorkflowWriterFence(options, paths, owned);
    } catch (error) {
      cleanupError = error;
    }
  }
  if (cleanupError) {
    if (!callbackError && result && typeof result === "object" && !Array.isArray(result)) {
      return {
        ...result,
        status: "needs_reconciliation",
        cleanupRequired: true,
        writerFenceReleased: false,
        writerCleanupCode:
          cleanupError instanceof WorkflowLeaseError ? cleanupError.code : "workflow_writer_cleanup_failed",
      };
    }
    throw cleanupError;
  }
  if (callbackError) throw callbackError;
  if (nestedFenceId && result && typeof result === "object" && !Array.isArray(result)) {
    return {
      ...result,
      writerFenceReleased: false,
      writerFenceRetainedByOuter: true,
    };
  }
  return result;
}

export async function verifyWorkflowLeaseSignature(options) {
  requireCondition(typeof options.leaseId === "string" && /^[0-9a-f-]{36}$/.test(options.leaseId), "lease_signature_input_invalid");
  requireCondition(typeof options.attestationSha256 === "string" && /^[0-9a-f]{64}$/.test(options.attestationSha256), "lease_signature_input_invalid");
  requireCondition(typeof options.signature === "string" && BASE64URL_PATTERN.test(options.signature), "lease_signature_input_invalid");
  const paths = leasePaths(options);
  await requireSafeGovernanceDirectory(paths, false);
  const attestation = await readLeaseAttestation(paths, options.leaseId, options.attestationSha256);
  let publicKey;
  try {
    publicKey = createPublicKey({ key: Buffer.from(attestation.value.publicKeySpki, "base64url"), type: "spki", format: "der" });
  } catch {
    fail("lease_attestation_public_key_invalid");
  }
  requireCondition(
    verifyBytes(null, canonicalPayload(options.payload), publicKey, Buffer.from(options.signature, "base64url")),
    "lease_signature_invalid",
  );
  return attestation.value;
}

function validateTokenBinding(lease, token) {
  requireCondition(token.leaseId === lease.leaseId, "lease_token_lease_id_mismatch");
  requireCondition(digest(token.token) === lease.tokenSha256, "lease_token_mismatch");
  let publicKeySpki;
  try {
    const privateKey = createPrivateKey({ key: Buffer.from(token.privateKeyPkcs8, "base64url"), type: "pkcs8", format: "der" });
    publicKeySpki = createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64url");
  } catch {
    fail("lease_private_key_invalid");
  }
  requireCondition(publicKeySpki === lease.publicKeySpki, "lease_private_key_mismatch");
}

export function workflowTakeoverAuthorizationPayload(options) {
  return {
    schemaVersion: 1,
    kind: "workflow_lease_takeover_authorization",
    authorizationMode: options.authorizationMode,
    priorLeaseId: options.priorLeaseId,
    priorLeaseDigest: options.priorLeaseDigest,
    priorLeaseEvidenceSha256: options.priorLeaseEvidenceSha256,
    reasonCode: options.reasonCode,
    confirmation: options.confirmation,
    successorExecutionRuntime: options.successorExecutionRuntime,
    successorGsdVersion: options.successorGsdVersion,
    successorModelProfile: options.successorModelProfile,
    successorTtlSeconds: options.successorTtlSeconds,
    successorCredentialPathSha256: options.successorCredentialPathSha256,
    issuedAt: options.issuedAt,
    notAfter: options.notAfter,
    successorAcquiredAt: options.successorAcquiredAt,
    authorityId: options.authorityId ?? null,
    requestId: options.requestId ?? null,
  };
}

function takeoverAuthorizationPayload(options, priorLease, priorLeaseDigest, successorTokenPath, timing, authority = {}) {
  return workflowTakeoverAuthorizationPayload({
    authorizationMode: options.reasonCode === "runtime_handoff" ? "predecessor_signature" : "operator_hmac",
    priorLeaseId: priorLease.leaseId,
    priorLeaseDigest,
    priorLeaseEvidenceSha256: digest(canonicalPayload(historicalLeaseFields(priorLease))),
    reasonCode: options.reasonCode,
    confirmation: options.confirm,
    successorExecutionRuntime: options.executionRuntime,
    successorGsdVersion: options.gsdVersion,
    successorModelProfile: options.modelProfile,
    successorTtlSeconds: options.ttlSeconds,
    successorCredentialPathSha256: digest(successorTokenPath),
    issuedAt: timing.issuedAt,
    notAfter: timing.notAfter,
    successorAcquiredAt: timestamp(options.now),
    ...authority,
  });
}

async function authorizeRuntimeHandoff(options, paths, before, successorTokenPath) {
  const now = options.now;
  requireCondition(now.valueOf() >= Date.parse(before.value.renewedAt), "lease_time_regression");
  requireCondition(now.valueOf() < Date.parse(before.value.expiresAt), "lease_takeover_predecessor_lease_expired");
  requireCondition(
    typeof options.predecessorTokenFile === "string" && options.predecessorTokenFile.length > 0,
    "lease_takeover_predecessor_authority_required",
  );
  const predecessorOptions = { ...options, tokenFile: options.predecessorTokenFile };
  const predecessorTokenPath = await requireSafeTokenPath(predecessorOptions, paths);
  requireCondition(predecessorTokenPath !== successorTokenPath, "lease_takeover_token_paths_must_differ");
  const predecessorToken = await readTokenFileRecord(predecessorOptions, paths);
  validateTokenBinding(before.value, predecessorToken.value);
  const payload = takeoverAuthorizationPayload(
    options,
    before.value,
    before.leaseDigest,
    successorTokenPath,
    {
      issuedAt: timestamp(now),
      notAfter: timestamp(new Date(now.valueOf() + TAKEOVER_AUTHORIZATION_WINDOW_MS)),
    },
  );
  let privateKey;
  let publicKey;
  try {
    privateKey = createPrivateKey({
      key: Buffer.from(predecessorToken.value.privateKeyPkcs8, "base64url"),
      type: "pkcs8",
      format: "der",
    });
    publicKey = createPublicKey({
      key: Buffer.from(before.value.publicKeySpki, "base64url"),
      type: "spki",
      format: "der",
    });
  } catch {
    fail("lease_takeover_predecessor_signature_invalid");
  }
  const signature = signBytes(null, canonicalPayload(payload), privateKey);
  requireCondition(
    verifyBytes(null, canonicalPayload(payload), publicKey, signature),
    "lease_takeover_predecessor_signature_invalid",
  );
  return {
    schemaVersion: 1,
    kind: "workflow_lease_takeover_authorization",
    mode: "predecessor_signature",
    payload,
    payloadSha256: digest(canonicalPayload(payload)),
    signerLeaseId: before.value.leaseId,
    signerAttestationSha256: before.value.leaseAttestationSha256,
    signature: signature.toString("base64url"),
  };
}

async function authorizeNewTakeover(options, paths, before, successorTokenPath) {
  if (options.reasonCode === "runtime_handoff") {
    return authorizeRuntimeHandoff(options, paths, before, successorTokenPath);
  }
  requireCondition(options.now.valueOf() >= Date.parse(before.value.expiresAt), "lease_takeover_requires_expired_lease");
  requireCondition(
    Number.isInteger(before.value.processId) && SHA256_PATTERN.test(before.value.processFingerprint ?? ""),
    "lease_takeover_owner_evidence_unavailable",
  );
  requireCondition(!processIsSameOwner(before.value), "lease_takeover_owner_alive");
  fail("lease_operator_takeover_durable_authority_unavailable");
}

function validateHistoricalTokenBinding(lease, token) {
  requireCondition(token.leaseId === lease.leaseId, "lease_token_lease_id_mismatch");
  let publicKeySpki;
  try {
    const privateKey = createPrivateKey({ key: Buffer.from(token.privateKeyPkcs8, "base64url"), type: "pkcs8", format: "der" });
    publicKeySpki = createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64url");
  } catch {
    fail("lease_private_key_invalid");
  }
  requireCondition(publicKeySpki === lease.publicKeySpki, "lease_private_key_mismatch");
}

async function replaceLeaseCas(paths, before, next, options = {}, faultStage = null) {
  const temp = path.join(paths.directory, `.lease.tmp-${randomUUID()}`);
  await writeExclusiveJson(temp, next);
  try {
    const current = await readLease(paths);
    requireCondition(current.leaseDigest === before.leaseDigest, "workflow_lease_changed");
    await fs.rename(temp, paths.lease);
    if (faultStage) injectedFault(options, faultStage);
    await syncDirectory(paths.directory);
  } finally {
    let removed = false;
    try {
      await fs.unlink(temp);
      removed = true;
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    }
    if (removed) await syncDirectory(paths.directory);
  }
}

function exactKeys(value, expected) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...expected].sort()),
  );
}

function validateOperationRecoveryHistory(value, code) {
  requireCondition(
    exactKeys(value, [
      "kind",
      "operationAcquiredAt",
      "operationDigest",
      "operationId",
      "reasonCode",
      "recoveredAt",
      "schemaVersion",
      "status",
    ]) &&
      value.schemaVersion === 1 &&
      value.kind === "workflow_lease_operation_recovery" &&
      value.status === "committed" &&
      UUID_PATTERN.test(value.operationId) &&
      SHA256_PATTERN.test(value.operationDigest) &&
      RFC3339_PATTERN.test(value.operationAcquiredAt) &&
      RFC3339_PATTERN.test(value.recoveredAt) &&
      ["abandoned_session", "operator_recovery"].includes(value.reasonCode),
    code,
  );
  return value;
}

function validateWriterRecoveryHistory(value, code) {
  requireCondition(
    exactKeys(value, [
      "fenceDigest",
      "fenceId",
      "kind",
      "leaseId",
      "reasonCode",
      "recoveredAt",
      "schemaVersion",
      "status",
    ]) &&
      value.schemaVersion === 1 &&
      value.kind === "workflow_writer_fence_recovery" &&
      value.status === "committed" &&
      UUID_PATTERN.test(value.fenceId) &&
      SHA256_PATTERN.test(value.fenceDigest) &&
      UUID_PATTERN.test(value.leaseId) &&
      RFC3339_PATTERN.test(value.recoveredAt) &&
      ["abandoned_session", "operator_recovery"].includes(value.reasonCode),
    code,
  );
  return value;
}

function transitionSignaturePayload(record, state) {
  return {
    schemaVersion: record.schemaVersion,
    kind: record.kind,
    action: record.action,
    state,
    transitionId: record.transitionId,
    preparedAt: record.preparedAt,
    priorLeaseDigest: record.priorLeaseDigest,
    priorLease: record.priorLease,
    successorLeaseDigest: record.successorLeaseDigest,
    successorLease: record.successorLease,
    reasonCode: record.reasonCode,
    credentialPathSha256: record.credentialPathSha256,
    credentialRecordSha256: record.credentialRecordSha256,
    signerLeaseId: record.signerLeaseId,
    signerAttestationSha256: record.signerAttestationSha256,
    takeoverAuthorization: record.takeoverAuthorization,
  };
}

function historicalLeaseFields(lease) {
  return {
    schemaVersion: lease.schemaVersion,
    kind: lease.kind,
    leaseId: lease.leaseId,
    publicKeySpki: lease.publicKeySpki,
    publicKeySha256: lease.publicKeySha256,
    leaseAttestationSha256: lease.leaseAttestationSha256,
    executionRuntime: lease.executionRuntime,
    gsdVersion: lease.gsdVersion,
    modelProfile: lease.modelProfile,
    processId: lease.processId,
    processFingerprint: lease.processFingerprint,
    acquisitionProcessId: lease.acquisitionProcessId,
    acquisitionProcessFingerprint: lease.acquisitionProcessFingerprint,
    predecessorLeaseId: lease.predecessorLeaseId ?? null,
    acquiredAt: lease.acquiredAt,
    renewedAt: lease.renewedAt,
    expiresAt: lease.expiresAt,
  };
}

function validateHistoricalLease(value) {
  requireCondition(
    exactKeys(value, [
      "acquiredAt",
      "acquisitionProcessFingerprint",
      "acquisitionProcessId",
      "executionRuntime",
      "expiresAt",
      "gsdVersion",
      "kind",
      "leaseAttestationSha256",
      "leaseId",
      "modelProfile",
      "processFingerprint",
      "processId",
      "predecessorLeaseId",
      "publicKeySha256",
      "publicKeySpki",
      "renewedAt",
      "schemaVersion",
    ]) &&
      value.schemaVersion === 1 &&
      value.kind === "workflow_writer_lease" &&
      UUID_PATTERN.test(value.leaseId) &&
      RUNTIMES.has(value.executionRuntime) &&
      VERSION_PATTERN.test(value.gsdVersion) &&
      PROFILE_PATTERN.test(value.modelProfile) &&
      Number.isInteger(value.processId) &&
      value.processId > 0 &&
      SHA256_PATTERN.test(value.processFingerprint) &&
      Number.isInteger(value.acquisitionProcessId) &&
      value.acquisitionProcessId > 0 &&
      SHA256_PATTERN.test(value.acquisitionProcessFingerprint) &&
      (value.predecessorLeaseId === null || UUID_PATTERN.test(value.predecessorLeaseId)) &&
      BASE64URL_PATTERN.test(value.publicKeySpki) &&
      SHA256_PATTERN.test(value.publicKeySha256) &&
      digest(Buffer.from(value.publicKeySpki, "base64url")) === value.publicKeySha256 &&
      SHA256_PATTERN.test(value.leaseAttestationSha256) &&
      RFC3339_PATTERN.test(value.acquiredAt) &&
      RFC3339_PATTERN.test(value.renewedAt) &&
      RFC3339_PATTERN.test(value.expiresAt) &&
      Date.parse(value.acquiredAt) <= Date.parse(value.renewedAt) &&
      Date.parse(value.renewedAt) < Date.parse(value.expiresAt),
    "lease_transition_history_invalid",
  );
  return value;
}

function signTransitionState(record, state, privateKeyPkcs8) {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyPkcs8, "base64url"),
    type: "pkcs8",
    format: "der",
  });
  return signBytes(null, canonicalPayload(transitionSignaturePayload(record, state)), privateKey).toString("base64url");
}

function createTransitionRecord(value, privateKeyPkcs8) {
  const record = {
    schemaVersion: 2,
    kind: "workflow_lease_transition",
    state: "prepared",
    ...value,
    stateAuthorizations: null,
  };
  record.stateAuthorizations = {
    prepared: signTransitionState(record, "prepared", privateKeyPkcs8),
    committed: signTransitionState(record, "committed", privateKeyPkcs8),
    aborted: record.action === "takeover" ? signTransitionState(record, "aborted", privateKeyPkcs8) : null,
  };
  return record;
}

function validateTakeoverAuthorization(value, record) {
  requireCondition(
    value?.schemaVersion === 1 &&
      value.kind === "workflow_lease_takeover_authorization" &&
      value.mode === "predecessor_signature" &&
      SHA256_PATTERN.test(value.payloadSha256 ?? "") &&
      value.payload &&
      typeof value.payload === "object" &&
      !Array.isArray(value.payload),
    "lease_transition_authorization_invalid",
  );
  const expectedPayloadKeys = [
    "authorityId",
    "authorizationMode",
    "confirmation",
    "issuedAt",
    "kind",
    "notAfter",
    "priorLeaseDigest",
    "priorLeaseEvidenceSha256",
    "priorLeaseId",
    "reasonCode",
    "requestId",
    "schemaVersion",
    "successorAcquiredAt",
    "successorCredentialPathSha256",
    "successorExecutionRuntime",
    "successorGsdVersion",
    "successorModelProfile",
    "successorTtlSeconds",
  ];
  requireCondition(exactKeys(value.payload, expectedPayloadKeys), "lease_transition_authorization_invalid");
  requireCondition(
    digest(canonicalPayload(value.payload)) === value.payloadSha256 &&
      value.payload.schemaVersion === 1 &&
      value.payload.kind === "workflow_lease_takeover_authorization" &&
      value.payload.priorLeaseId === record.priorLease.leaseId &&
      value.payload.priorLeaseDigest === record.priorLeaseDigest &&
      value.payload.priorLeaseEvidenceSha256 === digest(canonicalPayload(record.priorLease)) &&
      value.payload.reasonCode === record.reasonCode &&
      value.payload.confirmation ===
        `TAKEOVER:${record.priorLease.leaseId}:${record.priorLeaseDigest}:${record.reasonCode}` &&
      value.payload.successorExecutionRuntime === record.successorLease.executionRuntime &&
      value.payload.successorGsdVersion === record.successorLease.gsdVersion &&
      value.payload.successorModelProfile === record.successorLease.modelProfile &&
      value.payload.successorCredentialPathSha256 === record.credentialPathSha256 &&
      value.payload.successorAcquiredAt === record.successorLease.acquiredAt &&
      value.payload.successorTtlSeconds ===
        (Date.parse(record.successorLease.expiresAt) - Date.parse(record.successorLease.acquiredAt)) / 1000 &&
      RFC3339_PATTERN.test(value.payload.issuedAt ?? "") &&
      RFC3339_PATTERN.test(value.payload.notAfter ?? "") &&
      Date.parse(value.payload.issuedAt) <= Date.parse(value.payload.successorAcquiredAt) &&
      Date.parse(value.payload.successorAcquiredAt) <= Date.parse(value.payload.notAfter) &&
      Date.parse(value.payload.notAfter) - Date.parse(value.payload.issuedAt) <= TAKEOVER_AUTHORIZATION_WINDOW_MS,
    "lease_transition_authorization_invalid",
  );
  requireCondition(
    exactKeys(value, [
      "kind", "mode", "payload", "payloadSha256", "schemaVersion", "signature",
      "signerAttestationSha256", "signerLeaseId",
    ]) &&
      value.payload.authorizationMode === "predecessor_signature" &&
      value.payload.authorityId === null &&
      value.payload.requestId === null &&
      value.signerLeaseId === record.priorLease.leaseId &&
      value.signerAttestationSha256 === record.priorLease.leaseAttestationSha256 &&
      BASE64URL_PATTERN.test(value.signature ?? ""),
    "lease_transition_authorization_invalid",
  );
  let publicKey;
  try {
    publicKey = createPublicKey({
      key: Buffer.from(record.priorLease.publicKeySpki, "base64url"),
      type: "spki",
      format: "der",
    });
  } catch {
    fail("lease_transition_authorization_invalid");
  }
  requireCondition(
    verifyBytes(
      null,
      canonicalPayload(value.payload),
      publicKey,
      Buffer.from(value.signature, "base64url"),
    ),
    "lease_transition_authorization_invalid",
  );
  return value;
}

function validateTransitionRecord(value) {
  const expectedKeys = [
    "action",
    "credentialPathSha256",
    "credentialRecordSha256",
    "kind",
    "preparedAt",
    "priorLease",
    "priorLeaseDigest",
    "reasonCode",
    "schemaVersion",
    "signerAttestationSha256",
    "signerLeaseId",
    "state",
    "stateAuthorizations",
    "successorLease",
    "successorLeaseDigest",
    "takeoverAuthorization",
    "transitionId",
  ];
  requireCondition(exactKeys(value, expectedKeys), "lease_transition_history_invalid");
  requireCondition(
    value.schemaVersion === 2 &&
      value.kind === "workflow_lease_transition" &&
      ["release", "takeover"].includes(value.action) &&
      ["prepared", "committed", "aborted"].includes(value.state),
    "lease_transition_history_invalid",
  );
  requireCondition(UUID_PATTERN.test(value.transitionId), "lease_transition_history_invalid");
  requireCondition(RFC3339_PATTERN.test(value.preparedAt), "lease_transition_history_invalid");
  requireCondition(SHA256_PATTERN.test(value.priorLeaseDigest), "lease_transition_history_invalid");
  validateHistoricalLease(value.priorLease);
  requireCondition(UUID_PATTERN.test(value.priorLease.leaseId), "lease_transition_history_invalid");
  requireCondition(SHA256_PATTERN.test(value.credentialPathSha256), "lease_transition_history_invalid");
  requireCondition(SHA256_PATTERN.test(value.credentialRecordSha256), "lease_transition_history_invalid");
  requireCondition(UUID_PATTERN.test(value.signerLeaseId), "lease_transition_history_invalid");
  requireCondition(SHA256_PATTERN.test(value.signerAttestationSha256), "lease_transition_history_invalid");
  requireCondition(
    exactKeys(value.stateAuthorizations, ["aborted", "committed", "prepared"]) &&
      BASE64URL_PATTERN.test(value.stateAuthorizations.prepared) &&
      BASE64URL_PATTERN.test(value.stateAuthorizations.committed),
    "lease_transition_history_invalid",
  );
  if (value.action === "release") {
    requireCondition(
      value.reasonCode === null &&
        value.successorLease === null &&
        value.successorLeaseDigest === null &&
        value.signerLeaseId === value.priorLease.leaseId &&
        value.signerAttestationSha256 === value.priorLease.leaseAttestationSha256 &&
        value.takeoverAuthorization === null &&
        value.stateAuthorizations.aborted === null &&
        value.state !== "aborted",
      "lease_transition_history_invalid",
    );
  } else {
    requireCondition(TAKEOVER_REASONS.has(value.reasonCode), "lease_transition_history_invalid");
    requireCondition(SHA256_PATTERN.test(value.successorLeaseDigest), "lease_transition_history_invalid");
    validateLease(value.successorLease);
    requireCondition(
      UUID_PATTERN.test(value.successorLease.leaseId) &&
        digest(`${JSON.stringify(value.successorLease, null, 2)}\n`) === value.successorLeaseDigest &&
        value.successorLease.predecessorLeaseId === value.priorLease.leaseId &&
        value.successorLease.predecessorLeaseDigest === value.priorLeaseDigest &&
        value.successorLease.handoffReason === value.reasonCode &&
        value.signerLeaseId === value.successorLease.leaseId &&
        value.signerAttestationSha256 === value.successorLease.leaseAttestationSha256 &&
        typeof value.stateAuthorizations.aborted === "string" &&
        BASE64URL_PATTERN.test(value.stateAuthorizations.aborted),
      "lease_transition_history_invalid",
    );
    validateTakeoverAuthorization(value.takeoverAuthorization, value);
  }
  return value;
}

function transitionHistoryName(record) {
  return record.action === "release"
    ? `release-${record.priorLease.leaseId}.json`
    : `takeover-${record.priorLease.leaseId}-to-${record.successorLease.leaseId}.json`;
}

function verifyTransitionAuthorization(record) {
  const signer = record.action === "release" ? record.priorLease : record.successorLease;
  let publicKey;
  try {
    publicKey = createPublicKey({ key: Buffer.from(signer.publicKeySpki, "base64url"), type: "spki", format: "der" });
  } catch {
    fail("lease_transition_history_invalid");
  }
  for (const state of record.action === "release" ? ["prepared", "committed"] : ["prepared", "committed", "aborted"]) {
    requireCondition(
      verifyBytes(
        null,
        canonicalPayload(transitionSignaturePayload(record, state)),
        publicKey,
        Buffer.from(record.stateAuthorizations[state], "base64url"),
      ),
      "lease_transition_history_invalid",
    );
  }
}

async function validateTransitionAttestation(paths, record) {
  const required = [record.priorLease];
  if (record.action === "takeover") required.push(record.successorLease);
  for (const lease of required) {
    const target = path.join(paths.attestations, `${lease.leaseId}.json`);
    if (!(await pathExists(target))) {
      requireCondition(
        record.action === "takeover" &&
          lease.leaseId === record.successorLease.leaseId &&
          record.state !== "committed",
        "lease_transition_history_invalid",
      );
      continue;
    }
    const attestation = await readLeaseAttestation(paths, lease.leaseId, lease.leaseAttestationSha256);
    try {
      requireLeaseAttestationBinding(attestation.value, lease);
    } catch {
      fail("lease_transition_history_invalid");
    }
  }
}

async function readTransitionRecord(paths, fileName) {
  const filePath = path.join(paths.directory, fileName);
  const loaded = await readBoundedJson(
    filePath,
    MAX_TRANSITION_BYTES,
    "lease_transition_history_invalid",
    "lease_transition_history_invalid",
  );
  let value;
  try {
    value = validateTransitionRecord(loaded.value);
    requireCondition(transitionHistoryName(value) === fileName, "lease_transition_history_invalid");
    verifyTransitionAuthorization(value);
    await validateTransitionAttestation(paths, value);
  } catch (error) {
    if (error instanceof WorkflowLeaseError && error.code === "lease_transition_history_invalid") throw error;
    fail("lease_transition_history_invalid");
  }
  return { filePath, fileName, raw: loaded.raw, transitionDigest: digest(loaded.raw), value };
}

async function scanLeaseTransitions(paths) {
  let entries;
  try {
    entries = await fs.readdir(paths.directory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return { prepared: null, records: [] };
    throw error;
  }
  const candidates = entries
    .filter((entry) => /^release-[0-9a-f-]{36}\.json$/.test(entry.name) || /^takeover-[0-9a-f-]{36}-to-[0-9a-f-]{36}\.json$/.test(entry.name))
    .sort((left, right) => left.name.localeCompare(right.name, "en"));
  const prepared = [];
  const records = [];
  for (const entry of candidates) {
    requireCondition(entry.isFile() && !entry.isSymbolicLink(), "lease_transition_history_invalid");
    const loaded = await readTransitionRecord(paths, entry.name);
    if (loaded.value) records.push(loaded);
    if (loaded.value?.state === "prepared") prepared.push(loaded);
  }
  requireCondition(prepared.length <= 1, "lease_transition_history_ambiguous");
  return { prepared: prepared[0] ?? null, records };
}

function requireActiveTakeoverTransitionBinding(activeLease, committedTakeovers) {
  const incoming = committedTakeovers.filter(
    (loaded) => loaded.value.successorLease.leaseId === activeLease.leaseId,
  );
  if (activeLease.predecessorLeaseId === undefined) {
    requireCondition(incoming.length === 0, "lease_transition_ledger_incomplete");
    return;
  }
  requireCondition(incoming.length === 1, "lease_transition_ledger_incomplete");
  const record = incoming[0].value;
  requireCondition(
    record.priorLease.leaseId === activeLease.predecessorLeaseId &&
      record.priorLeaseDigest === activeLease.predecessorLeaseDigest &&
      record.reasonCode === activeLease.handoffReason,
    "lease_transition_ledger_incomplete",
  );
  const initial = record.successorLease;
  for (const key of [
    "schemaVersion",
    "kind",
    "leaseId",
    "tokenSha256",
    "publicKeySpki",
    "publicKeySha256",
    "leaseAttestationSha256",
    "executionRuntime",
    "gsdVersion",
    "modelProfile",
    "acquisitionProcessId",
    "acquisitionProcessFingerprint",
    "acquiredAt",
    "predecessorLeaseId",
    "predecessorLeaseDigest",
    "handoffReason",
  ]) {
    requireCondition(activeLease[key] === initial[key], "lease_transition_ledger_incomplete");
  }
}

async function validateLeaseTransitionLedger(paths, transitions, activeLease) {
  let entries;
  try {
    entries = await fs.readdir(paths.attestations, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") entries = [];
    else throw error;
  }
  const attestedLeaseIds = new Set();
  for (const entry of entries) {
    const leaseId = entry.name.endsWith(".json") ? entry.name.slice(0, -5) : "";
    requireCondition(
      entry.isFile() && !entry.isSymbolicLink() && UUID_PATTERN.test(leaseId),
      "lease_transition_ledger_incomplete",
    );
    requireCondition(!attestedLeaseIds.has(leaseId), "lease_transition_ledger_incomplete");
    attestedLeaseIds.add(leaseId);
  }

  const committed = transitions.records.filter((loaded) => loaded.value.state === "committed");
  const committedTakeovers = committed.filter((loaded) => loaded.value.action === "takeover");
  const incoming = new Map();
  const outgoing = new Map();
  const increment = (counts, leaseId) => counts.set(leaseId, (counts.get(leaseId) ?? 0) + 1);
  for (const loaded of committed) {
    const record = loaded.value;
    increment(outgoing, record.priorLease.leaseId);
    if (record.action === "takeover") increment(incoming, record.successorLease.leaseId);
  }
  for (const count of incoming.values()) requireCondition(count === 1, "lease_transition_ledger_incomplete");
  for (const count of outgoing.values()) requireCondition(count === 1, "lease_transition_ledger_incomplete");

  if (activeLease) {
    requireCondition(attestedLeaseIds.has(activeLease.leaseId), "lease_transition_ledger_incomplete");
    requireActiveTakeoverTransitionBinding(activeLease, committedTakeovers);
  }
  for (const leaseId of attestedLeaseIds) {
    const isActive = activeLease?.leaseId === leaseId;
    requireCondition(
      isActive ? (outgoing.get(leaseId) ?? 0) === 0 : (outgoing.get(leaseId) ?? 0) === 1,
      "lease_transition_ledger_incomplete",
    );
  }
  for (const leaseId of new Set([...incoming.keys(), ...outgoing.keys()])) {
    requireCondition(attestedLeaseIds.has(leaseId), "lease_transition_ledger_incomplete");
  }
}

async function requireNoPreparedLeaseTransition(paths) {
  const transitions = await scanLeaseTransitions(paths);
  requireCondition(!transitions.prepared, "lease_transition_recovery_required");
}

async function replaceTransitionState(paths, loaded, state, options, faultStage) {
  const next = { ...loaded.value, state };
  validateTransitionRecord(next);
  verifyTransitionAuthorization(next);
  const temp = path.join(paths.directory, `.${loaded.fileName}.tmp-${randomUUID()}`);
  await writeExclusiveJson(temp, next);
  try {
    const current = await readBoundedJson(
      loaded.filePath,
      MAX_TRANSITION_BYTES,
      "lease_transition_history_changed",
      "lease_transition_history_changed",
    );
    requireCondition(digest(current.raw) === loaded.transitionDigest, "lease_transition_history_changed");
    await fs.rename(temp, loaded.filePath);
    if (faultStage) injectedFault(options, faultStage);
    await syncDirectory(paths.directory);
  } finally {
    let removed = false;
    try {
      await fs.unlink(temp);
      removed = true;
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === "ENOENT")) throw error;
    }
    if (removed) await syncDirectory(paths.directory);
  }
  return {
    ...loaded,
    raw: `${JSON.stringify(next, null, 2)}\n`,
    transitionDigest: digest(`${JSON.stringify(next, null, 2)}\n`),
    value: next,
  };
}

function transitionReconciliationEnvelope(record, error, extra = {}) {
  return {
    schemaVersion: 1,
    kind: `workflow_writer_lease_${record.action}`,
    status: "needs_reconciliation",
    cleanupRequired: true,
    transitionId: record.transitionId,
    transitionAction: record.action,
    reconciliationCode: error instanceof WorkflowLeaseError ? error.code : error?.code ?? "lease_transition_io_failed",
    ...extra,
  };
}

export async function renewWorkflowLease(options) {
  validateHolder(options);
  const paths = leasePaths(options);
  await requireSafeTokenPath(options, paths);
  return withMutex(paths, async () => {
    await requireNoWriterFence(paths);
    const before = await readLease(paths);
    await validateLeaseTransitionLedger(paths, await scanLeaseTransitions(paths), before.value);
    const token = await readTokenFile(options, paths);
    validateTokenBinding(before.value, token);
    requireCondition(before.value.executionRuntime === options.executionRuntime, "lease_holder_identity_mismatch");
    requireCondition(before.value.gsdVersion === options.gsdVersion, "lease_holder_identity_mismatch");
    requireCondition(before.value.modelProfile === options.modelProfile, "lease_holder_identity_mismatch");
    const now = options.now ?? new Date();
    requireCondition(now.valueOf() >= Date.parse(before.value.renewedAt), "lease_time_regression");
    requireCondition(now.valueOf() < Date.parse(before.value.expiresAt), "workflow_lease_expired");
    const next = {
      ...before.value,
      executionRuntime: options.executionRuntime,
      gsdVersion: options.gsdVersion,
      modelProfile: options.modelProfile,
      processId: process.pid,
      processFingerprint: processFingerprint(),
      renewedAt: timestamp(now),
      expiresAt: timestamp(new Date(now.valueOf() + options.ttlSeconds * 1000)),
    };
    validateLease(next);
    await replaceLeaseCas(paths, before, next);
    return safeLeaseReceipt("workflow_writer_lease_renew", next, now);
  });
}

async function readLeaseOptional(paths) {
  try {
    return await readLease(paths);
  } catch (error) {
    if (error instanceof WorkflowLeaseError && error.code === "workflow_lease_missing") return null;
    throw error;
  }
}

async function readTransitionTokenOptional(options, paths, record, lease) {
  const tokenPath = await requireSafeTokenPath(options, paths);
  requireCondition(digest(tokenPath) === record.credentialPathSha256, "lease_transition_token_path_mismatch");
  if (!(await pathExists(tokenPath))) return null;
  const token = await readTokenFileRecord(options, paths);
  requireCondition(token.tokenDigest === record.credentialRecordSha256, "lease_transition_token_digest_mismatch");
  if (lease.tokenSha256) validateTokenBinding(lease, token.value);
  else validateHistoricalTokenBinding(lease, token.value);
  return token;
}

async function readTransitionAttestationOptional(paths, lease) {
  const target = path.join(paths.attestations, `${lease.leaseId}.json`);
  if (!(await pathExists(target))) return null;
  return { target, loaded: await readLeaseAttestation(paths, lease.leaseId, lease.leaseAttestationSha256) };
}

function releaseReceiptFromTransition(record, recoveryAction) {
  return {
    ...safeLeaseReceipt("workflow_writer_lease_release", record.priorLease, new Date(record.preparedAt)),
    status: "pass",
    active: false,
    priorRecordPreserved: true,
    tokenFileRemoved: true,
    historyCommitted: true,
    cleanupRequired: false,
    transitionId: record.transitionId,
    recoveryAction,
  };
}

function takeoverReceiptFromTransition(record, recoveryAction) {
  return {
    ...safeLeaseReceipt("workflow_writer_lease_takeover", record.successorLease, new Date(record.preparedAt)),
    status: "pass",
    priorLeaseId: record.priorLease.leaseId,
    reasonCode: record.reasonCode,
    priorRecordPreserved: true,
    tokenFileWritten: true,
    historyCommitted: true,
    cleanupRequired: false,
    transitionId: record.transitionId,
    recoveryAction,
  };
}

function exactCommittedTransition(records, predicate) {
  const matches = records.filter((loaded) => loaded.value.state === "committed" && predicate(loaded.value));
  requireCondition(matches.length <= 1, "lease_transition_retry_ambiguous");
  return matches[0] ?? null;
}

async function replayCommittedRelease(options, paths, transitions, tokenPath) {
  const expectedTransitionId = options.expectedTransitionId;
  if (expectedTransitionId !== undefined) {
    requireCondition(UUID_PATTERN.test(expectedTransitionId), "lease_transition_id_invalid");
  }
  const committed = exactCommittedTransition(
    transitions.records,
    (record) =>
      record.action === "release" &&
      record.credentialPathSha256 === digest(tokenPath) &&
      (expectedTransitionId === undefined || record.transitionId === expectedTransitionId),
  );
  if (!committed) return null;
  requireCondition(!(await pathExists(tokenPath)), "lease_transition_committed_credential_present");
  return releaseReceiptFromTransition(committed.value, "replayed_committed_release");
}

async function replayCommittedTakeover(options, paths, transitions, tokenPath) {
  const committed = exactCommittedTransition(
    transitions.records,
    (record) =>
      record.action === "takeover" &&
      record.priorLease.leaseId === options.expectedLeaseId &&
      record.priorLeaseDigest === options.expectedLeaseDigest &&
      record.reasonCode === options.reasonCode &&
      record.credentialPathSha256 === digest(tokenPath),
  );
  if (!committed) return null;
  requireCondition(
    options.confirm ===
      `TAKEOVER:${committed.value.priorLease.leaseId}:${committed.value.priorLeaseDigest}:${committed.value.reasonCode}`,
    "lease_takeover_confirmation_mismatch",
  );
  const current = await readLeaseOptional(paths);
  requireCondition(
    current &&
      current.value.leaseId === committed.value.successorLease.leaseId &&
      current.leaseDigest === committed.value.successorLeaseDigest,
    "lease_transition_lease_mismatch",
  );
  requireCondition(await readTransitionTokenOptional(options, paths, committed.value, committed.value.successorLease), "lease_transition_token_missing");
  requireCondition(await readTransitionAttestationOptional(paths, committed.value.successorLease), "lease_transition_attestation_missing");
  return takeoverReceiptFromTransition(committed.value, "replayed_committed_takeover");
}

async function reconcileReleaseTransition(options, paths, loaded) {
  const record = loaded.value;
  requireCondition(record.action === "release", "lease_transition_action_mismatch");
  const current = await readLeaseOptional(paths);
  if (current) {
    requireCondition(
      current.value.leaseId === record.priorLease.leaseId && current.leaseDigest === record.priorLeaseDigest,
      "lease_transition_lease_mismatch",
    );
  }
  const token = await readTransitionTokenOptional(options, paths, record, record.priorLease);
  requireCondition(!current || token, "lease_transition_token_missing");
  if (current) {
    await unlinkDurably(paths.lease, options, "release_after_lease_unlink");
  }
  if (token) {
    await unlinkDurably(await requireSafeTokenPath(options, paths), options, "release_after_token_unlink");
  }
  await replaceTransitionState(paths, loaded, "committed", options, "release_after_history_commit");
  return releaseReceiptFromTransition(record, current ? "completed_prepared_release" : "finalized_released_lease");
}

async function reconcileTakeoverTransition(options, paths, loaded) {
  const record = loaded.value;
  requireCondition(record.action === "takeover", "lease_transition_action_mismatch");
  requireCondition(record.priorLease.leaseId === options.expectedLeaseId, "lease_takeover_id_mismatch");
  requireCondition(record.priorLeaseDigest === options.expectedLeaseDigest, "lease_takeover_digest_mismatch");
  requireCondition(record.reasonCode === options.reasonCode, "lease_takeover_reason_mismatch");
  requireCondition(
    options.confirm === `TAKEOVER:${record.priorLease.leaseId}:${record.priorLeaseDigest}:${record.reasonCode}`,
    "lease_takeover_confirmation_mismatch",
  );
  const current = await readLeaseOptional(paths);
  requireCondition(current, "lease_transition_lease_missing");
  const isPrior = current.leaseDigest === record.priorLeaseDigest && current.value.leaseId === record.priorLease.leaseId;
  const isSuccessor =
    current.leaseDigest === record.successorLeaseDigest && current.value.leaseId === record.successorLease.leaseId;
  requireCondition(isPrior || isSuccessor, "lease_transition_lease_mismatch");
  const token = await readTransitionTokenOptional(options, paths, record, record.successorLease);
  const attestation = await readTransitionAttestationOptional(paths, record.successorLease);

  if (isPrior && !token) {
    if (attestation) await unlinkDurably(attestation.target, options, null);
    await replaceTransitionState(paths, loaded, "aborted", options, "takeover_after_abort_commit");
    return { aborted: true };
  }
  requireCondition(token, "lease_transition_token_missing");
  if (!attestation) await writeLeaseAttestation(paths, record.successorLease);
  if (isPrior) {
    await replaceLeaseCas(paths, current, record.successorLease, options, "takeover_after_lease_replace");
  }
  await replaceTransitionState(paths, loaded, "committed", options, "takeover_after_history_commit");
  return { aborted: false, receipt: takeoverReceiptFromTransition(record, isPrior ? "completed_prepared_takeover" : "finalized_successor_lease") };
}

export async function releaseWorkflowLease(options) {
  const paths = leasePaths(options);
  const tokenPath = await requireSafeTokenPath(options, paths);
  return withMutex(paths, async () => {
    await requireNoWriterFence(paths);
    const transitions = await scanLeaseTransitions(paths);
    if (transitions.prepared) {
      try {
        return await reconcileReleaseTransition(options, paths, transitions.prepared);
      } catch (error) {
        if (error instanceof WorkflowLeaseError) throw error;
        return transitionReconciliationEnvelope(transitions.prepared.value, error, {
          active: Boolean(await readLeaseOptional(paths)),
          tokenFileRemoved: !(await pathExists(tokenPath)),
          historyCommitted: false,
        });
      }
    }
    const before = await readLeaseOptional(paths);
    if (!before) {
      const replayed = await replayCommittedRelease(options, paths, transitions, tokenPath);
      if (replayed) return replayed;
      fail("workflow_lease_missing");
    }
    await validateLeaseTransitionLedger(paths, transitions, before.value);
    const token = await readTokenFileRecord(options, paths);
    validateTokenBinding(before.value, token.value);
    const receipt = {
      ...safeLeaseReceipt("workflow_writer_lease_release", before.value, options.now),
      active: false,
      priorRecordPreserved: true,
    };
    const history = path.join(paths.directory, `release-${before.value.leaseId}.json`);
    requireCondition(!(await pathExists(history)), "lease_history_collision");
    const prepared = createTransitionRecord({
      action: "release",
      transitionId: randomUUID(),
      preparedAt: receipt.observedAt,
      priorLeaseDigest: before.leaseDigest,
      priorLease: historicalLeaseFields(before.value),
      successorLeaseDigest: null,
      successorLease: null,
      reasonCode: null,
      credentialPathSha256: digest(tokenPath),
      credentialRecordSha256: token.tokenDigest,
      signerLeaseId: before.value.leaseId,
      signerAttestationSha256: before.value.leaseAttestationSha256,
      takeoverAuthorization: null,
    }, token.value.privateKeyPkcs8);
    await installExclusiveJson(history, prepared, 0o600, "lease_history_collision");
    const raw = `${JSON.stringify(prepared, null, 2)}\n`;
    const loaded = {
      filePath: history,
      fileName: path.basename(history),
      raw,
      transitionDigest: digest(raw),
      value: prepared,
    };
    try {
      injectedFault(options, "release_after_prepare");
      return await reconcileReleaseTransition(options, paths, loaded);
    } catch (error) {
      return transitionReconciliationEnvelope(prepared, error, {
        active: Boolean(await readLeaseOptional(paths)),
        tokenFileRemoved: !(await pathExists(tokenPath)),
        historyCommitted: false,
      });
    }
  }, { allowPreparedTransition: true });
}

export async function takeoverWorkflowLease(options) {
  options = { ...options, now: boundedTakeoverNow(options) };
  validateHolder(options);
  requireCondition(TAKEOVER_REASONS.has(options.reasonCode), "lease_takeover_reason_invalid");
  const paths = leasePaths(options);
  const tokenPath = await requireSafeTokenPath(options, paths);
  return withMutex(paths, async () => {
    await requireNoWriterFence(paths);
    const transitions = await scanLeaseTransitions(paths);
    if (transitions.prepared) {
      let reconciled;
      try {
        reconciled = await reconcileTakeoverTransition(options, paths, transitions.prepared);
      } catch (error) {
        if (error instanceof WorkflowLeaseError) throw error;
        return transitionReconciliationEnvelope(transitions.prepared.value, error, {
          tokenFileWritten: await pathExists(tokenPath),
          historyCommitted: false,
        });
      }
      if (!reconciled.aborted) return reconciled.receipt;
    }
    const replayed = await replayCommittedTakeover(options, paths, transitions, tokenPath);
    if (replayed) return replayed;
    const before = await readLease(paths);
    await validateLeaseTransitionLedger(paths, transitions, before.value);
    requireCondition(before.value.leaseId === options.expectedLeaseId, "lease_takeover_id_mismatch");
    requireCondition(before.leaseDigest === options.expectedLeaseDigest, "lease_takeover_digest_mismatch");
    requireCondition(
      options.confirm === `TAKEOVER:${before.value.leaseId}:${before.leaseDigest}:${options.reasonCode}`,
      "lease_takeover_confirmation_mismatch",
    );
    const takeoverAuthorization = await authorizeNewTakeover(options, paths, before, tokenPath);
    const credentials = createLeaseCredentials();
    const next = {
      ...makeLease({ ...options, predecessorLeaseId: before.value.leaseId }, credentials, options.now),
      predecessorLeaseId: before.value.leaseId,
      predecessorLeaseDigest: before.leaseDigest,
      handoffReason: options.reasonCode,
    };
    validateLease(next);
    const receipt = {
      ...safeLeaseReceipt("workflow_writer_lease_takeover", next, options.now),
      priorLeaseId: before.value.leaseId,
      reasonCode: options.reasonCode,
      priorRecordPreserved: true,
      tokenFileWritten: true,
    };
    const history = path.join(paths.directory, `takeover-${before.value.leaseId}-to-${next.leaseId}.json`);
    requireCondition(!(await pathExists(history)), "lease_history_collision");
    requireCondition(!(await pathExists(tokenPath)), "lease_token_already_exists");
    const attestationPath = path.join(paths.attestations, `${next.leaseId}.json`);
    requireCondition(!(await pathExists(attestationPath)), "lease_attestation_collision");
    const successorToken = tokenRecord(next.leaseId, credentials);
    const successorTokenRaw = `${JSON.stringify(successorToken, null, 2)}\n`;
    const prepared = createTransitionRecord({
      action: "takeover",
      transitionId: randomUUID(),
      preparedAt: receipt.observedAt,
      reasonCode: options.reasonCode,
      priorLeaseDigest: before.leaseDigest,
      priorLease: historicalLeaseFields(before.value),
      successorLeaseDigest: digest(`${JSON.stringify(next, null, 2)}\n`),
      successorLease: next,
      credentialPathSha256: digest(tokenPath),
      credentialRecordSha256: digest(successorTokenRaw),
      signerLeaseId: next.leaseId,
      signerAttestationSha256: next.leaseAttestationSha256,
      takeoverAuthorization,
    }, credentials.privateKeyPkcs8);
    await installExclusiveJson(history, prepared, 0o600, "lease_history_collision");
    const raw = `${JSON.stringify(prepared, null, 2)}\n`;
    const loaded = {
      filePath: history,
      fileName: path.basename(history),
      raw,
      transitionDigest: digest(raw),
      value: prepared,
    };
    try {
      injectedFault(options, "takeover_after_prepare");
      await writeTokenFile(options, paths, next.leaseId, credentials);
      injectedFault(options, "takeover_after_token");
      await writeLeaseAttestation(paths, next);
      injectedFault(options, "takeover_after_attestation");
      await replaceLeaseCas(paths, before, next, options, "takeover_after_lease_replace");
      await replaceTransitionState(paths, loaded, "committed", options, "takeover_after_history_commit");
      return takeoverReceiptFromTransition(prepared, "none");
    } catch (error) {
      return transitionReconciliationEnvelope(prepared, error, {
        tokenFileWritten: await pathExists(tokenPath),
        historyCommitted: false,
      });
    }
  }, { allowPreparedTransition: true });
}

export async function recoverWorkflowLeaseMutex(options) {
  requireCondition(
    options.reasonCode === "abandoned_session" || options.reasonCode === "operator_recovery",
    "lease_mutex_recovery_reason_invalid",
  );
  requireCondition(
    typeof options.expectedOperationId === "string" &&
      UUID_PATTERN.test(options.expectedOperationId) &&
      typeof options.expectedOperationDigest === "string" &&
      SHA256_PATTERN.test(options.expectedOperationDigest),
    "lease_mutex_recovery_input_invalid",
  );
  const paths = leasePaths(options);
  await requireSafeGovernanceDirectory(paths, false);
  const history = path.join(paths.directory, `operation-recovery-${options.expectedOperationId}.json`);
  if (!(await pathExists(paths.mutex))) {
    requireCondition(
      options.confirm ===
        `RECOVER_MUTEX:${options.expectedOperationId}:${options.expectedOperationDigest}:${options.reasonCode}`,
      "lease_mutex_recovery_confirmation_mismatch",
    );
    const existing = await readBoundedJson(history, MAX_MUTEX_BYTES, "lease_operation_lock_missing", "lease_history_invalid");
    const value = validateOperationRecoveryHistory(existing.value, "lease_history_invalid");
    requireCondition(
      value.operationId === options.expectedOperationId &&
        value.operationDigest === options.expectedOperationDigest &&
        value.reasonCode === options.reasonCode,
      "lease_history_invalid",
    );
    return {
      schemaVersion: 1,
      kind: "workflow_lease_operation_recovery_receipt",
      status: "pass",
      operationId: value.operationId,
      operationDigest: value.operationDigest,
      recoveredAt: value.recoveredAt,
      reasonCode: value.reasonCode,
      priorRecordPreserved: true,
      alreadyRecovered: true,
    };
  }
  const before = await readMutex(paths);
  requireCondition(before.value.operationId === options.expectedOperationId, "lease_mutex_recovery_id_mismatch");
  requireCondition(before.mutexDigest === options.expectedOperationDigest, "lease_mutex_recovery_digest_mismatch");
  requireCondition(
    options.confirm ===
      `RECOVER_MUTEX:${before.value.operationId}:${before.mutexDigest}:${options.reasonCode}`,
    "lease_mutex_recovery_confirmation_mismatch",
  );
  const now = options.now ?? new Date();
  requireCondition(now.valueOf() >= Date.parse(before.value.recoverAfter), "lease_operation_lock_not_stale");
  requireCondition(!processIsSameOwner(before.value), "lease_operation_owner_alive");
  const observedAt = timestamp(now);
  const record = {
    schemaVersion: 1,
    kind: "workflow_lease_operation_recovery",
    status: "committed",
    operationId: before.value.operationId,
    operationDigest: before.mutexDigest,
    operationAcquiredAt: before.value.acquiredAt,
    recoveredAt: observedAt,
    reasonCode: options.reasonCode,
  };
  let effectiveRecoveredAt = observedAt;
  if (await pathExists(history)) {
    const existing = await readBoundedJson(history, MAX_MUTEX_BYTES, "lease_history_invalid", "lease_history_invalid");
    const value = validateOperationRecoveryHistory(existing.value, "lease_history_collision");
    requireCondition(
      value.schemaVersion === record.schemaVersion &&
        value.kind === record.kind &&
        value.status === record.status &&
        value.operationId === record.operationId &&
        value.operationDigest === record.operationDigest &&
        value.operationAcquiredAt === record.operationAcquiredAt &&
        value.reasonCode === record.reasonCode,
      "lease_history_collision",
    );
    effectiveRecoveredAt = value.recoveredAt;
  } else {
    await writeExclusiveJson(history, record);
    await syncDirectory(paths.directory);
  }
  const current = await readMutex(paths);
  requireCondition(current.mutexDigest === before.mutexDigest, "lease_operation_lock_changed");
  await unlinkDurably(paths.mutex, options, null);
  return {
    schemaVersion: 1,
    kind: "workflow_lease_operation_recovery_receipt",
    status: "pass",
    operationId: before.value.operationId,
    operationDigest: before.mutexDigest,
    recoveredAt: effectiveRecoveredAt,
    reasonCode: options.reasonCode,
    priorRecordPreserved: true,
    alreadyRecovered: false,
  };
}

export async function recoverCorruptWorkflowLeaseMutex(options) {
  requireCondition(
    options.reasonCode === "abandoned_session" || options.reasonCode === "operator_recovery",
    "lease_mutex_recovery_reason_invalid",
  );
  requireCondition(
    typeof options.expectedOperationDigest === "string" && SHA256_PATTERN.test(options.expectedOperationDigest),
    "lease_mutex_recovery_input_invalid",
  );
  const paths = leasePaths(options);
  await requireSafeGovernanceDirectory(paths, false);
  const before = await readRawFileMetadata(
    paths.mutex,
    MAX_MUTEX_BYTES,
    "lease_operation_lock_missing",
    "lease_operation_lock_invalid",
  );
  let corrupt = false;
  try {
    validateMutex(JSON.parse(before.raw.toString("utf8")));
  } catch (error) {
    if (error instanceof SyntaxError || (error instanceof WorkflowLeaseError && error.code === "lease_operation_lock_invalid")) {
      corrupt = true;
    } else {
      throw error;
    }
  }
  requireCondition(corrupt, "lease_operation_lock_not_corrupt");
  requireCondition(before.rawDigest === options.expectedOperationDigest, "lease_mutex_recovery_digest_mismatch");
  requireCondition(
    options.confirm === `RECOVER_CORRUPT_MUTEX:${before.rawDigest}:${options.reasonCode}`,
    "lease_mutex_recovery_confirmation_mismatch",
  );
  const now = options.now ?? new Date();
  requireCondition(now.valueOf() - before.modifiedAtMs >= 60_000, "lease_operation_lock_not_stale");
  // A malformed record has no authenticated PID/start-time or registered-child evidence.
  // Age, digest, and operator intent cannot prove the original writer is absent, so deleting
  // it would permit an overlapping writer. Keep the exact bytes in place until an external
  // containment mechanism can supply independently verifiable quiescence evidence.
  fail("lease_corrupt_mutex_recovery_owner_evidence_unavailable");
}

export async function recoverWorkflowWriterFence(options) {
  requireCondition(
    options.reasonCode === "abandoned_session" || options.reasonCode === "operator_recovery",
    "writer_fence_recovery_reason_invalid",
  );
  requireCondition(
    typeof options.expectedFenceId === "string" &&
      UUID_PATTERN.test(options.expectedFenceId) &&
      typeof options.expectedFenceDigest === "string" &&
      SHA256_PATTERN.test(options.expectedFenceDigest),
    "writer_fence_recovery_input_invalid",
  );
  const paths = leasePaths(options);
  return withMutex(paths, async () => {
    const history = path.join(paths.directory, `writer-recovery-${options.expectedFenceId}.json`);
    if (!(await pathExists(paths.writer))) {
      requireCondition(
        options.confirm ===
          `RECOVER_WRITER:${options.expectedFenceId}:${options.expectedFenceDigest}:${options.reasonCode}`,
        "writer_fence_recovery_confirmation_mismatch",
      );
      const existing = await readBoundedJson(history, MAX_WRITER_BYTES, "workflow_writer_fence_missing", "lease_history_invalid");
      const value = validateWriterRecoveryHistory(existing.value, "lease_history_invalid");
      requireCondition(
        value.fenceId === options.expectedFenceId &&
          value.fenceDigest === options.expectedFenceDigest &&
          value.reasonCode === options.reasonCode,
        "lease_history_invalid",
      );
      return {
        schemaVersion: 1,
        kind: "workflow_writer_fence_recovery_receipt",
        status: "pass",
        fenceId: value.fenceId,
        fenceDigest: value.fenceDigest,
        recoveredAt: value.recoveredAt,
        reasonCode: value.reasonCode,
        alreadyRecovered: true,
      };
    }
    const before = await readWriterFence(paths);
    requireCondition(before.value.fenceId === options.expectedFenceId, "writer_fence_recovery_id_mismatch");
    requireCondition(before.writerDigest === options.expectedFenceDigest, "writer_fence_recovery_digest_mismatch");
    requireCondition(
      options.confirm ===
        `RECOVER_WRITER:${before.value.fenceId}:${before.writerDigest}:${options.reasonCode}`,
      "writer_fence_recovery_confirmation_mismatch",
    );
    const now = options.now ?? new Date();
    requireCondition(now.valueOf() >= Date.parse(before.value.expiresAt), "workflow_writer_fence_not_expired");
    requireCondition(!processIsSameOwner(before.value), "workflow_writer_owner_alive");
    requireCondition(before.value.childRegistrationPending !== true, "workflow_writer_child_registration_incomplete");
    requireCondition(
      before.value.childProcessGroupId === undefined || !processGroupExists(before.value.childProcessGroupId),
      "workflow_writer_child_group_alive",
    );
    const recoveredAt = timestamp(now);
    const record = {
      schemaVersion: 1,
      kind: "workflow_writer_fence_recovery",
      status: "committed",
      fenceId: before.value.fenceId,
      fenceDigest: before.writerDigest,
      leaseId: before.value.leaseId,
      recoveredAt,
      reasonCode: options.reasonCode,
    };
    let effectiveRecoveredAt = recoveredAt;
    if (await pathExists(history)) {
      const existing = await readBoundedJson(history, MAX_WRITER_BYTES, "lease_history_invalid", "lease_history_invalid");
      const value = validateWriterRecoveryHistory(existing.value, "lease_history_collision");
      requireCondition(
        value.schemaVersion === record.schemaVersion &&
          value.kind === record.kind &&
          value.status === record.status &&
          value.fenceId === record.fenceId &&
          value.fenceDigest === record.fenceDigest &&
          value.leaseId === record.leaseId &&
          value.reasonCode === record.reasonCode,
        "lease_history_collision",
      );
      effectiveRecoveredAt = value.recoveredAt;
    } else {
      await writeExclusiveJson(history, record);
      await syncDirectory(paths.directory);
    }
    const current = await readWriterFence(paths);
    requireCondition(current.writerDigest === before.writerDigest, "workflow_writer_fence_changed");
    await unlinkDurably(paths.writer, options, null);
    return {
      schemaVersion: 1,
      kind: "workflow_writer_fence_recovery_receipt",
      status: "pass",
      fenceId: before.value.fenceId,
      fenceDigest: before.writerDigest,
      recoveredAt: effectiveRecoveredAt,
      reasonCode: options.reasonCode,
      alreadyRecovered: false,
    };
  });
}

function parseCli(argv) {
  const [command, ...args] = argv;
  const values = {};
  const allowed = {
    status: ["project-root"],
    acquire: ["project-root", "runtime", "gsd-version", "model-profile", "ttl-seconds", "token-file"],
    renew: ["project-root", "runtime", "gsd-version", "model-profile", "ttl-seconds", "token-file"],
    release: ["project-root", "token-file", "expected-transition-id"],
    takeover: [
      "project-root",
      "runtime",
      "gsd-version",
      "model-profile",
      "ttl-seconds",
      "token-file",
      "expected-lease-id",
      "expected-lease-digest",
      "reason-code",
      "confirm",
      "predecessor-token-file",
      "operator-authority-file",
      "operator-request-id",
      "operator-authorization",
      "operator-issued-at",
      "operator-not-after",
      "successor-acquired-at",
    ],
    "recover-mutex": [
      "project-root",
      "expected-operation-id",
      "expected-operation-digest",
      "reason-code",
      "confirm",
    ],
    "recover-corrupt-mutex": ["project-root", "expected-operation-digest", "reason-code", "confirm"],
    "recover-writer": [
      "project-root",
      "expected-fence-id",
      "expected-fence-digest",
      "reason-code",
      "confirm",
    ],
  };
  requireCondition(Object.hasOwn(allowed, command), "lease_usage_error");
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.*)$/s);
    requireCondition(match, "lease_usage_error");
    requireCondition(allowed[command].includes(match[1]) && !Object.hasOwn(values, match[1]), "lease_usage_error");
    values[match[1]] = match[2];
  }
  const optional =
    command === "release"
      ? new Set(["expected-transition-id"])
      : command === "takeover"
        ? new Set([
            "predecessor-token-file",
            "operator-authority-file",
            "operator-request-id",
            "operator-authorization",
            "operator-issued-at",
            "operator-not-after",
            "successor-acquired-at",
          ])
        : new Set();
  requireCondition(
    allowed[command]
      .filter((key) => !optional.has(key))
      .every((key) => typeof values[key] === "string" && values[key].length > 0),
    "lease_usage_error",
  );
  return { command, values };
}

function holder(values) {
  requireCondition(/^\d+$/.test(values["ttl-seconds"]), "lease_usage_error");
  return {
    executionRuntime: values.runtime,
    gsdVersion: values["gsd-version"],
    modelProfile: values["model-profile"],
    ttlSeconds: Number(values["ttl-seconds"]),
  };
}

async function runCli(argv) {
  const { command, values } = parseCli(argv);
  const base = { projectRoot: values["project-root"] };
  if (command === "status") return getWorkflowLeaseStatus(base);
  if (command === "acquire") return acquireWorkflowLease({ ...base, ...holder(values), tokenFile: values["token-file"] });
  if (command === "renew") return renewWorkflowLease({ ...base, ...holder(values), tokenFile: values["token-file"] });
  if (command === "release") {
    return releaseWorkflowLease({
      ...base,
      tokenFile: values["token-file"],
      ...(values["expected-transition-id"] ? { expectedTransitionId: values["expected-transition-id"] } : {}),
    });
  }
  if (command === "recover-mutex") {
    return recoverWorkflowLeaseMutex({
      ...base,
      expectedOperationId: values["expected-operation-id"],
      expectedOperationDigest: values["expected-operation-digest"],
      reasonCode: values["reason-code"],
      confirm: values.confirm,
    });
  }
  if (command === "recover-corrupt-mutex") {
    return recoverCorruptWorkflowLeaseMutex({
      ...base,
      expectedOperationDigest: values["expected-operation-digest"],
      reasonCode: values["reason-code"],
      confirm: values.confirm,
    });
  }
  if (command === "recover-writer") {
    return recoverWorkflowWriterFence({
      ...base,
      expectedFenceId: values["expected-fence-id"],
      expectedFenceDigest: values["expected-fence-digest"],
      reasonCode: values["reason-code"],
      confirm: values.confirm,
    });
  }
  return takeoverWorkflowLease({
    ...base,
    ...holder(values),
    tokenFile: values["token-file"],
    expectedLeaseId: values["expected-lease-id"],
    expectedLeaseDigest: values["expected-lease-digest"],
    reasonCode: values["reason-code"],
    confirm: values.confirm,
    ...(values["predecessor-token-file"]
      ? { predecessorTokenFile: values["predecessor-token-file"] }
      : {}),
    ...(values["operator-authority-file"]
      ? { operatorAuthorityFile: values["operator-authority-file"] }
      : {}),
    ...(values["operator-request-id"] ? { operatorRequestId: values["operator-request-id"] } : {}),
    ...(values["operator-authorization"]
      ? { operatorAuthorization: values["operator-authorization"] }
      : {}),
    ...(values["operator-issued-at"] ? { operatorIssuedAt: values["operator-issued-at"] } : {}),
    ...(values["operator-not-after"] ? { operatorNotAfter: values["operator-not-after"] } : {}),
    ...(values["successor-acquired-at"]
      ? { operatorSuccessorAcquiredAt: values["successor-acquired-at"] }
      : {}),
  });
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  try {
    const result = await runCli(process.argv.slice(2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === "pass" ? 0 : 1;
  } catch (error) {
    const code = error instanceof WorkflowLeaseError ? error.code : "lease_unexpected_error";
    process.stderr.write(`${JSON.stringify({ schemaVersion: 1, kind: "workflow_writer_lease_error", code })}\n`);
    process.exitCode = 1;
  }
}
