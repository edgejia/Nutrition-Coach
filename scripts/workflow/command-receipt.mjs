import fs from "node:fs/promises";
import fsSync, { constants as fsConstants } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { resolveWorkflowProjectScope, verifyWorkflowLeaseSignature, withWorkflowWriterFence } from "./workflow-lease.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const RUN_ID_PATTERN = /^[0-9a-f-]{36}$/;
const COMMAND_CODES = {
  "release-check": {
    timezone_contract: "timezone_contract_failed",
    typescript_gate: "typescript_gate_failed",
    full_test_suite: "test_unclassified_failure",
    capability_matrix: "capability_matrix_failed",
    behavior_matrix: "behavior_matrix_failed",
    frontend_build: "frontend_build_failed",
    release_deadline: "release_deadline_exceeded",
    workspace_stability: "workspace_changed_during_release_check",
    release_check_complete: "release_check_passed",
  },
};
const ALLOWED_SIGNALS = new Set([
  "SIGABRT", "SIGALRM", "SIGBUS", "SIGCHLD", "SIGCONT", "SIGFPE", "SIGHUP", "SIGILL", "SIGINT", "SIGIO",
  "SIGKILL", "SIGPIPE", "SIGPROF", "SIGPWR", "SIGQUIT", "SIGSEGV", "SIGSTKFLT", "SIGSTOP", "SIGSYS",
  "SIGTERM", "SIGTRAP", "SIGTSTP", "SIGTTIN", "SIGTTOU", "SIGURG", "SIGUSR1", "SIGUSR2", "SIGVTALRM",
  "SIGWINCH", "SIGXCPU", "SIGXFSZ",
]);

export class CommandReceiptError extends Error {
  constructor(code) {
    super(code);
    this.name = "CommandReceiptError";
    this.code = code;
  }
}

function fail(code) {
  throw new CommandReceiptError(code);
}

function requireCondition(condition, code) {
  if (!condition) {
    fail(code);
  }
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

async function canonicalExistingDirectory(candidate, code) {
  const stat = await fs.lstat(candidate).catch(() => null);
  requireCondition(stat?.isDirectory() && !stat.isSymbolicLink(), code);
  return fs.realpath(candidate);
}

function isWithin(parent, candidate) {
  const relative = path.relative(path.resolve(parent), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function canonicalPhysicalTarget(candidate, code) {
  let existing = path.dirname(path.resolve(candidate));
  const suffix = [path.basename(path.resolve(candidate))];
  while ((await fs.lstat(existing).catch(() => null)) === null) {
    const parent = path.dirname(existing);
    requireCondition(parent !== existing, code);
    suffix.unshift(path.basename(existing));
    existing = parent;
  }
  const physicalAncestor = await canonicalExistingDirectory(existing, code);
  return path.resolve(physicalAncestor, ...suffix);
}

export async function resolveCommandReceiptPathOutsideProject(receiptPath, projectRoot) {
  requireCondition(typeof receiptPath === "string" && receiptPath.length > 0, "receipt_path_required");
  requireCondition(typeof projectRoot === "string" && projectRoot.length > 0, "receipt_project_root_required");
  let scope;
  try {
    scope = resolveWorkflowProjectScope({ projectRoot });
  } catch {
    fail("receipt_project_root_unsafe");
  }
  const target = await canonicalPhysicalTarget(receiptPath, "receipt_parent_unsafe");
  requireCondition(!isWithin(scope.projectRoot, target), "receipt_path_inside_project");
  requireCondition(!isWithin(scope.commonDir, target), "receipt_path_inside_git_common_dir");
  return target;
}

function runWorkspaceGit(projectRoot, args, options = {}) {
  return execFileSync("git", ["--no-replace-objects", ...args], {
    cwd: projectRoot,
    encoding: options.encoding ?? "utf8",
    maxBuffer: 256 * 1024 * 1024,
    env: sanitizedGitEnvironment(),
  });
}

function commandWorkspaceFingerprintOnce(projectRoot) {
  const tracked = runWorkspaceGit(projectRoot, ["ls-files", "-z"], { encoding: "buffer" })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const untracked = runWorkspaceGit(projectRoot, ["ls-files", "--others", "--exclude-standard", "-z"], {
    encoding: "buffer",
  })
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
  const entries = [...new Set([...tracked, ...untracked])].sort();
  const hash = createHash("sha256");
  hash.update("nutrition-release-workspace-v1\0");
  hash.update(runWorkspaceGit(projectRoot, ["rev-parse", "HEAD"]).trim());
  hash.update("\0");
  for (const relative of entries) {
    const absolute = path.resolve(projectRoot, relative);
    const bounded = path.relative(projectRoot, absolute);
    requireCondition(bounded && !bounded.startsWith("..") && !path.isAbsolute(bounded), "receipt_workspace_path_unsafe");
    const stat = fsSync.lstatSync(absolute, { throwIfNoEntry: false });
    hash.update(relative);
    hash.update("\0");
    if (!stat) {
      hash.update("missing\0");
    } else if (stat.isFile()) {
      hash.update(`file:${stat.mode & 0o7777}:`);
      hash.update(createHash("sha256").update(fsSync.readFileSync(absolute)).digest("hex"));
      hash.update("\0");
    } else if (stat.isSymbolicLink()) {
      hash.update(`symlink:${fsSync.readlinkSync(absolute)}\0`);
    } else {
      fail("receipt_workspace_entry_unsupported");
    }
  }
  return hash.digest("hex");
}

export function stableCommandWorkspaceFingerprint(projectRoot) {
  let scope;
  try {
    scope = resolveWorkflowProjectScope({ projectRoot });
  } catch {
    fail("receipt_project_root_unsafe");
  }
  const first = commandWorkspaceFingerprintOnce(scope.projectRoot);
  const second = commandWorkspaceFingerprintOnce(scope.projectRoot);
  requireCondition(first === second, "receipt_workspace_changed_during_fingerprint");
  return first;
}

async function ensureCanonicalReceiptParent(target) {
  const parent = path.dirname(target);
  const parsed = path.parse(parent);
  let current = parsed.root;
  let missing = false;
  for (const component of parent.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await fs.lstat(current).catch(() => null);
    if (stat === null) {
      missing = true;
      continue;
    }
    requireCondition(!missing && stat.isDirectory() && !stat.isSymbolicLink(), "receipt_parent_unsafe");
    requireCondition((await fs.realpath(current)) === current, "receipt_parent_unsafe");
  }
  await fs.mkdir(parent, { recursive: true, mode: 0o700 });
  current = parsed.root;
  for (const component of parent.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await fs.lstat(current).catch(() => null);
    requireCondition(stat?.isDirectory() && !stat.isSymbolicLink(), "receipt_parent_unsafe");
    requireCondition((await fs.realpath(current)) === current, "receipt_parent_unsafe");
  }
}

export function asiaTaipeiReceiptTimestamp(now = new Date()) {
  requireCondition(now instanceof Date && !Number.isNaN(now.valueOf()), "invalid_observation_time");
  return new Date(now.valueOf() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00");
}

export function classifySpawnTermination(result) {
  if (result?.error && typeof result.error === "object" && result.error.code === "ETIMEDOUT") {
    return { kind: "timeout", value: "TIMEOUT" };
  }
  if (result?.error && typeof result.error === "object" && result.error.code === "EPROCESSGROUPLEAK") {
    return { kind: "process_group_leak", value: "PROCESS_GROUP_LEAK" };
  }
  if (typeof result?.signal === "string" && result.signal.length > 0) {
    return {
      kind: "signal",
      value: ALLOWED_SIGNALS.has(result.signal) ? result.signal : "SIGNAL_OTHER",
    };
  }
  if (Number.isInteger(result?.status)) {
    return { kind: "exit_code", value: result.status };
  }
  return { kind: "spawn_error", value: "SPAWN_ERROR" };
}

function sanitizedCode(commandId, gate, outcome) {
  const command = COMMAND_CODES[commandId];
  requireCondition(command && Object.hasOwn(command, gate), "receipt_gate_not_allowlisted");
  if (outcome === "passed") {
    requireCondition(gate === "release_check_complete", "receipt_success_gate_invalid");
    return command[gate];
  }
  requireCondition(gate !== "release_check_complete", "receipt_failure_gate_invalid");
  return command[gate];
}

export function createCommandReceipt(options) {
  requireCondition(Object.hasOwn(COMMAND_CODES, options.commandId), "receipt_command_not_allowlisted");
  requireCondition(typeof options.sourceSha === "string" && SHA_PATTERN.test(options.sourceSha), "receipt_source_sha_invalid");
  requireCondition(options.outcome === "failed" || options.outcome === "passed", "receipt_outcome_invalid");
  requireCondition(typeof options.runId === "string" && RUN_ID_PATTERN.test(options.runId), "receipt_run_id_invalid");
  requireCondition(
    typeof options.workspaceBeforeSha256 === "string" && SHA256_PATTERN.test(options.workspaceBeforeSha256),
    "receipt_workspace_digest_invalid",
  );
  requireCondition(
    typeof options.workspaceAfterSha256 === "string" && SHA256_PATTERN.test(options.workspaceAfterSha256),
    "receipt_workspace_digest_invalid",
  );
  const workspaceStable = options.workspaceBeforeSha256 === options.workspaceAfterSha256;
  requireCondition(options.workspaceStable === workspaceStable, "receipt_workspace_stability_invalid");
  if (options.outcome === "passed") {
    requireCondition(workspaceStable, "receipt_pass_requires_stable_workspace");
  }
  const termination = options.termination;
  requireCondition(
    termination && ["exit_code", "signal", "timeout", "spawn_error", "process_group_leak"].includes(termination.kind),
    "receipt_termination_invalid",
  );
  if (termination.kind === "exit_code") {
    requireCondition(Number.isInteger(termination.value) && termination.value >= 0 && termination.value <= 255, "receipt_exit_code_invalid");
  } else {
    requireCondition(typeof termination.value === "string" && /^[A-Z0-9_]+$/.test(termination.value), "receipt_termination_value_invalid");
  }

  return {
    schemaVersion: 1,
    kind: "workflow_command_receipt",
    commandId: options.commandId,
    runId: options.runId,
    sourceSha: options.sourceSha,
    workspaceBeforeSha256: options.workspaceBeforeSha256,
    workspaceAfterSha256: options.workspaceAfterSha256,
    workspaceStable,
    gate: options.gate,
    outcome: options.outcome,
    termination: { kind: termination.kind, value: termination.value },
    sanitizedCode: sanitizedCode(options.commandId, options.gate, options.outcome),
    observedAt: asiaTaipeiReceiptTimestamp(options.now),
  };
}

function resolveSourceSha(projectRoot) {
  let source;
  try {
    source = execFileSync("git", ["--no-replace-objects", "rev-parse", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: sanitizedGitEnvironment(),
    }).trim();
  } catch {
    fail("receipt_project_git_required");
  }
  requireCondition(SHA_PATTERN.test(source), "receipt_live_source_sha_invalid");
  return source;
}

function signedReceiptPayload(receipt) {
  const { receiptSha256: _digest, receiptSignature: _signature, ...payload } = receipt;
  return payload;
}

function signedReceiptSignaturePayload(receipt) {
  return { ...signedReceiptPayload(receipt), receiptSha256: receipt.receiptSha256 };
}

function signCommandReceipt(holder, scope, receipt) {
  const signed = {
    ...receipt,
    schemaVersion: 2,
    worktreeIdentitySha256: scope.worktreeIdentitySha256,
    gitCommonIdentitySha256: scope.gitCommonIdentitySha256,
    workflowLeaseId: holder.leaseId,
    workflowFenceId: holder.fenceId,
    leaseAttestationSha256: holder.leaseAttestationSha256,
    executionRuntime: holder.executionRuntime,
    gsdVersion: holder.gsdVersion,
    modelProfile: holder.modelProfile,
  };
  signed.receiptSha256 = sha256(JSON.stringify(signedReceiptPayload(signed)));
  signed.receiptSignature = holder.signPayload(signedReceiptSignaturePayload(signed));
  return signed;
}

function reservationPayload(reservation) {
  const { reservationSha256: _digest, reservationSignature: _signature, ...payload } = reservation;
  return payload;
}

function reservationSignaturePayload(reservation) {
  return { ...reservationPayload(reservation), reservationSha256: reservation.reservationSha256 };
}

function signReservation(holder, scope, reservation) {
  const signed = {
    ...reservation,
    schemaVersion: 2,
    worktreeIdentitySha256: scope.worktreeIdentitySha256,
    gitCommonIdentitySha256: scope.gitCommonIdentitySha256,
    workflowLeaseId: holder.leaseId,
    workflowFenceId: holder.fenceId,
    leaseAttestationSha256: holder.leaseAttestationSha256,
    executionRuntime: holder.executionRuntime,
    gsdVersion: holder.gsdVersion,
    modelProfile: holder.modelProfile,
  };
  signed.reservationSha256 = sha256(JSON.stringify(reservationPayload(signed)));
  signed.reservationSignature = holder.signPayload(reservationSignaturePayload(signed));
  return signed;
}

async function verifySignedReservation(projectRoot, reservation, scope, expectedLeaseId) {
  requireCondition(reservation?.schemaVersion === 2 && reservation.kind === "workflow_command_receipt_reservation", "receipt_reservation_invalid");
  requireCondition(sha256(JSON.stringify(reservationPayload(reservation))) === reservation.reservationSha256, "receipt_reservation_tampered");
  requireCondition(reservation.worktreeIdentitySha256 === scope.worktreeIdentitySha256, "receipt_reservation_worktree_mismatch");
  requireCondition(reservation.gitCommonIdentitySha256 === scope.gitCommonIdentitySha256, "receipt_reservation_git_common_mismatch");
  requireCondition(reservation.workflowLeaseId === expectedLeaseId, "receipt_reservation_holder_mismatch");
  const attestation = await verifyWorkflowLeaseSignature({
    projectRoot,
    leaseId: reservation.workflowLeaseId,
    attestationSha256: reservation.leaseAttestationSha256,
    payload: reservationSignaturePayload(reservation),
    signature: reservation.reservationSignature,
  }).catch(() => fail("receipt_reservation_signature_invalid"));
  requireCondition(attestation.executionRuntime === reservation.executionRuntime, "receipt_reservation_holder_mismatch");
  requireCondition(attestation.gsdVersion === reservation.gsdVersion, "receipt_reservation_holder_mismatch");
  requireCondition(attestation.modelProfile === reservation.modelProfile, "receipt_reservation_holder_mismatch");
}

function reservationDocument(options) {
  requireCondition(Object.hasOwn(COMMAND_CODES, options.commandId), "receipt_command_not_allowlisted");
  requireCondition(typeof options.runId === "string" && RUN_ID_PATTERN.test(options.runId), "receipt_run_id_invalid");
  requireCondition(typeof options.sourceSha === "string" && SHA_PATTERN.test(options.sourceSha), "receipt_source_sha_invalid");
  requireCondition(
    typeof options.workspaceBeforeSha256 === "string" && SHA256_PATTERN.test(options.workspaceBeforeSha256),
    "receipt_workspace_digest_invalid",
  );
  return {
    schemaVersion: 1,
    kind: "workflow_command_receipt_reservation",
    commandId: options.commandId,
    runId: options.runId,
    sourceSha: options.sourceSha,
    workspaceBeforeSha256: options.workspaceBeforeSha256,
    state: "reserved",
  };
}

async function readReceiptSnapshot(target, code = "receipt_reservation_changed") {
  let handle;
  try {
    handle = await fs.open(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    fail(code);
  }
  let raw;
  let stat;
  try {
    stat = await handle.stat();
    requireCondition(stat.isFile() && stat.size > 0 && stat.size <= 64 * 1024, code);
    raw = await handle.readFile("utf8");
  } finally {
    await handle.close().catch(() => undefined);
  }
  return { raw, rawSha256: sha256(raw), dev: stat.dev, ino: stat.ino };
}

async function stableReceiptSnapshot(target, code = "receipt_reservation_changed") {
  const first = await readReceiptSnapshot(target, code);
  const second = await readReceiptSnapshot(target, code);
  requireCondition(first.dev === second.dev && first.ino === second.ino && first.rawSha256 === second.rawSha256, code);
  return second;
}

export async function reserveCommandReceiptPath(receiptPath, options) {
  const reservation = reservationDocument(options);
  requireCondition(options.tokenFile !== undefined && options.projectRoot !== undefined && options.expectedRuntime !== undefined, "receipt_signing_authority_required");
  const scope = resolveWorkflowProjectScope({ projectRoot: options.projectRoot });
  const target = await resolveCommandReceiptPathOutsideProject(receiptPath, scope.projectRoot);
  requireCondition(resolveSourceSha(scope.projectRoot) === options.sourceSha, "receipt_live_source_sha_mismatch");
  const governed = await withWorkflowWriterFence(
    {
      projectRoot: scope.projectRoot,
      tokenFile: options.tokenFile,
      expectedRuntime: options.expectedRuntime,
      purpose: "maintenance_check",
      maxDurationSeconds: options.maxDurationSeconds ?? 30,
      now: options.now,
    },
    async (holder) => {
      const signed = signReservation(holder, scope, reservation);
      await writeCommandReceiptAtomic(target, signed);
      await holder.assertCurrent();
      requireCondition(resolveSourceSha(scope.projectRoot) === options.sourceSha, "receipt_live_source_sha_changed");
      return { signed };
    },
  );
  requireCondition(governed.status !== "needs_reconciliation", "receipt_writer_cleanup_failed");
  return governed.signed;
}

async function commitReservedCommandReceipt(receiptPath, reservation, receipt, testHook) {
  const target = path.resolve(receiptPath);
  await ensureCanonicalReceiptParent(target);
  const expected = `${JSON.stringify(reservation, null, 2)}\n`;
  const reservedSnapshot = await stableReceiptSnapshot(target);
  requireCondition(reservedSnapshot.raw === expected, "receipt_reservation_changed");
  requireCondition(receipt.runId === reservation.runId, "receipt_reservation_binding_mismatch");
  requireCondition(receipt.sourceSha === reservation.sourceSha, "receipt_reservation_binding_mismatch");
  requireCondition(
    receipt.workspaceBeforeSha256 === reservation.workspaceBeforeSha256,
    "receipt_reservation_binding_mismatch",
  );
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${randomUUID()}`);
  let handle;
  try {
    handle = await fs.open(temp, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    if (typeof testHook === "function") await testHook("before_receipt_commit_cas");
    const latest = await readReceiptSnapshot(target);
    requireCondition(
      latest.dev === reservedSnapshot.dev && latest.ino === reservedSnapshot.ino && latest.rawSha256 === reservedSnapshot.rawSha256,
      "receipt_reservation_changed",
    );
    await fs.rename(temp, target);
    const directory = await fs.open(path.dirname(target), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
    if (typeof testHook === "function") await testHook("after_receipt_publication");
    const published = await stableReceiptSnapshot(target, "receipt_publication_changed");
    requireCondition(published.raw === `${JSON.stringify(receipt, null, 2)}\n`, "receipt_publication_changed");
  } finally {
    if (handle) await handle.close().catch(() => undefined);
    await fs.unlink(temp).catch(() => undefined);
  }
}

async function writeCommandReceiptAtomic(receiptPath, receipt) {
  requireCondition(typeof receiptPath === "string" && receiptPath.length > 0, "receipt_path_required");
  const target = path.resolve(receiptPath);
  await ensureCanonicalReceiptParent(target);
  const temp = path.join(path.dirname(target), `.${path.basename(target)}.tmp-${randomUUID()}`);
  let handle;
  try {
    handle = await fs.open(temp, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(receipt, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    try {
      await fs.link(temp, target);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EEXIST") {
        fail("receipt_destination_exists");
      }
      throw error;
    }
    await fs.unlink(temp);
    const directory = await fs.open(path.dirname(target), "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } finally {
    if (handle) {
      await handle.close().catch(() => undefined);
    }
    await fs.unlink(temp).catch(() => undefined);
  }
}

async function finalizeCommandReceipt(options, receipt) {
  if (options.tokenFile === undefined) {
    requireCondition(options.receiptPath === undefined || options.receiptPath === null, "receipt_signing_authority_required");
    return receipt;
  }
  const scope = resolveWorkflowProjectScope({ projectRoot: options.projectRoot });
  const target = options.receiptPath
    ? await resolveCommandReceiptPathOutsideProject(options.receiptPath, scope.projectRoot)
    : null;
  requireCondition(receipt.sourceSha === resolveSourceSha(scope.projectRoot), "receipt_live_source_sha_mismatch");
  const governed = await withWorkflowWriterFence(
    {
      projectRoot: scope.projectRoot,
      tokenFile: options.tokenFile,
      expectedRuntime: options.expectedRuntime,
      purpose: "maintenance_check",
      maxDurationSeconds: options.maxDurationSeconds ?? 30,
      now: options.now,
    },
    async (holder) => {
      const signed = signCommandReceipt(holder, scope, receipt);
      if (target) {
        requireCondition(options.reservation !== undefined, "receipt_reservation_required");
        await verifySignedReservation(scope.projectRoot, options.reservation, scope, holder.leaseId);
        await commitReservedCommandReceipt(target, options.reservation, signed, options.testHook);
      }
      await holder.assertCurrent();
      requireCondition(receipt.sourceSha === resolveSourceSha(scope.projectRoot), "receipt_live_source_sha_changed");
      return { signed };
    },
  );
  requireCondition(governed.status !== "needs_reconciliation", "receipt_writer_cleanup_failed");
  return governed.signed;
}

export async function publishFailedCommandReceipt(options) {
  const termination = classifySpawnTermination(options.result);
  const receipt = createCommandReceipt({
    commandId: options.commandId,
    runId: options.runId,
    sourceSha: options.sourceSha,
    workspaceBeforeSha256: options.workspaceBeforeSha256,
    workspaceAfterSha256: options.workspaceAfterSha256,
    workspaceStable: options.workspaceBeforeSha256 === options.workspaceAfterSha256,
    gate: options.gate,
    outcome: "failed",
    termination,
    now: options.now,
  });
  return finalizeCommandReceipt(options, receipt);
}

export async function publishPassedCommandReceipt(options) {
  const receipt = createCommandReceipt({
    commandId: options.commandId,
    runId: options.runId,
    sourceSha: options.sourceSha,
    workspaceBeforeSha256: options.workspaceBeforeSha256,
    workspaceAfterSha256: options.workspaceAfterSha256,
    workspaceStable: options.workspaceBeforeSha256 === options.workspaceAfterSha256,
    gate: "release_check_complete",
    outcome: "passed",
    termination: { kind: "exit_code", value: 0 },
    now: options.now,
  });
  return finalizeCommandReceipt(options, receipt);
}

export async function verifyCommandReceipt(options) {
  requireCondition(
    typeof options.expectedRunId === "string" && RUN_ID_PATTERN.test(options.expectedRunId),
    "receipt_expected_run_id_required",
  );
  requireCondition(
    options.expectedOutcome === "passed" || options.expectedOutcome === "failed",
    "receipt_expected_outcome_required",
  );
  requireCondition(
    typeof options.expectedWorkspaceBeforeSha256 === "string" && SHA256_PATTERN.test(options.expectedWorkspaceBeforeSha256),
    "receipt_expected_workspace_digest_required",
  );
  requireCondition(
    typeof options.expectedWorkspaceAfterSha256 === "string" && SHA256_PATTERN.test(options.expectedWorkspaceAfterSha256),
    "receipt_expected_workspace_digest_required",
  );
  if (options.expectedOutcome === "passed") {
    requireCondition(
      options.expectedWorkspaceBeforeSha256 === options.expectedWorkspaceAfterSha256,
      "receipt_expected_pass_requires_stable_workspace",
    );
  }
  const target = await resolveCommandReceiptPathOutsideProject(options.receiptPath, options.projectRoot);
  const snapshot = await stableReceiptSnapshot(target, "receipt_file_invalid");
  let receipt;
  try {
    receipt = JSON.parse(snapshot.raw);
  } catch {
    fail("receipt_file_invalid");
  }
  requireCondition(receipt?.schemaVersion === 2 && receipt.kind === "workflow_command_receipt", "receipt_unsigned_or_invalid");
  const requiredKeys = [
    "commandId", "executionRuntime", "gate", "gitCommonIdentitySha256", "gsdVersion", "kind",
    "leaseAttestationSha256", "modelProfile", "observedAt", "outcome", "receiptSha256", "receiptSignature",
    "runId", "sanitizedCode", "schemaVersion", "sourceSha", "termination", "workflowFenceId", "workflowLeaseId",
    "workspaceAfterSha256", "workspaceBeforeSha256", "workspaceStable", "worktreeIdentitySha256",
  ].sort();
  requireCondition(JSON.stringify(Object.keys(receipt).sort()) === JSON.stringify(requiredKeys), "receipt_schema_invalid");
  requireCondition(sha256(JSON.stringify(signedReceiptPayload(receipt))) === receipt.receiptSha256, "receipt_tampered");
  requireCondition(Object.hasOwn(COMMAND_CODES, receipt.commandId), "receipt_schema_invalid");
  requireCondition(typeof receipt.runId === "string" && RUN_ID_PATTERN.test(receipt.runId), "receipt_schema_invalid");
  requireCondition(SHA_PATTERN.test(receipt.sourceSha ?? ""), "receipt_schema_invalid");
  requireCondition(SHA256_PATTERN.test(receipt.workspaceBeforeSha256 ?? ""), "receipt_schema_invalid");
  requireCondition(SHA256_PATTERN.test(receipt.workspaceAfterSha256 ?? ""), "receipt_schema_invalid");
  requireCondition(receipt.workspaceStable === (receipt.workspaceBeforeSha256 === receipt.workspaceAfterSha256), "receipt_schema_invalid");
  requireCondition(receipt.outcome === "passed" || receipt.outcome === "failed", "receipt_schema_invalid");
  requireCondition(receipt.sanitizedCode === sanitizedCode(receipt.commandId, receipt.gate, receipt.outcome), "receipt_schema_invalid");
  requireCondition(
    receipt.termination && JSON.stringify(Object.keys(receipt.termination).sort()) === JSON.stringify(["kind", "value"]),
    "receipt_schema_invalid",
  );
  requireCondition(
    ["exit_code", "signal", "timeout", "spawn_error", "process_group_leak"].includes(receipt.termination.kind),
    "receipt_schema_invalid",
  );
  requireCondition(typeof receipt.observedAt === "string" && !Number.isNaN(Date.parse(receipt.observedAt)), "receipt_schema_invalid");
  requireCondition(/^[0-9a-f-]{36}$/.test(receipt.workflowLeaseId ?? ""), "receipt_schema_invalid");
  requireCondition(/^[0-9a-f-]{36}$/.test(receipt.workflowFenceId ?? ""), "receipt_schema_invalid");
  requireCondition(SHA256_PATTERN.test(receipt.leaseAttestationSha256 ?? ""), "receipt_schema_invalid");
  requireCondition(SHA256_PATTERN.test(receipt.worktreeIdentitySha256 ?? ""), "receipt_schema_invalid");
  requireCondition(SHA256_PATTERN.test(receipt.gitCommonIdentitySha256 ?? ""), "receipt_schema_invalid");
  const scope = resolveWorkflowProjectScope({ projectRoot: options.projectRoot });
  requireCondition(receipt.runId === options.expectedRunId, "receipt_run_id_mismatch");
  requireCondition(receipt.outcome === options.expectedOutcome, "receipt_outcome_mismatch");
  requireCondition(
    receipt.workspaceBeforeSha256 === options.expectedWorkspaceBeforeSha256,
    "receipt_workspace_before_mismatch",
  );
  requireCondition(
    receipt.workspaceAfterSha256 === options.expectedWorkspaceAfterSha256,
    "receipt_workspace_after_mismatch",
  );
  if (receipt.outcome === "passed") {
    requireCondition(receipt.workspaceStable, "receipt_pass_requires_stable_workspace");
    requireCondition(receipt.gate === "release_check_complete", "receipt_success_gate_invalid");
    requireCondition(
      receipt.termination.kind === "exit_code" && receipt.termination.value === 0,
      "receipt_pass_termination_invalid",
    );
  }
  requireCondition(receipt.sourceSha === options.expectedSourceSha, "receipt_source_sha_mismatch");
  const sourceShaBefore = resolveSourceSha(scope.projectRoot);
  requireCondition(sourceShaBefore === options.expectedSourceSha, "receipt_live_source_sha_mismatch");
  const workspaceShaBefore = stableCommandWorkspaceFingerprint(scope.projectRoot);
  requireCondition(workspaceShaBefore === options.expectedWorkspaceAfterSha256, "receipt_live_workspace_mismatch");
  requireCondition(receipt.worktreeIdentitySha256 === scope.worktreeIdentitySha256, "receipt_worktree_identity_mismatch");
  requireCondition(receipt.gitCommonIdentitySha256 === scope.gitCommonIdentitySha256, "receipt_git_common_identity_mismatch");
  requireCondition(receipt.workflowLeaseId === options.expectedWorkflowLeaseId, "receipt_holder_identity_mismatch");
  requireCondition(receipt.executionRuntime === options.expectedRuntime, "receipt_runtime_mismatch");
  requireCondition(receipt.gsdVersion === options.expectedGsdVersion, "receipt_gsd_version_mismatch");
  requireCondition(receipt.modelProfile === options.expectedModelProfile, "receipt_model_profile_mismatch");
  const attestation = await verifyWorkflowLeaseSignature({
    projectRoot: scope.projectRoot,
    leaseId: receipt.workflowLeaseId,
    attestationSha256: receipt.leaseAttestationSha256,
    payload: signedReceiptSignaturePayload(receipt),
    signature: receipt.receiptSignature,
  }).catch(() => fail("receipt_signature_invalid"));
  requireCondition(attestation.executionRuntime === receipt.executionRuntime, "receipt_holder_identity_mismatch");
  requireCondition(attestation.gsdVersion === receipt.gsdVersion, "receipt_holder_identity_mismatch");
  requireCondition(attestation.modelProfile === receipt.modelProfile, "receipt_holder_identity_mismatch");
  const finalSnapshot = await readReceiptSnapshot(target, "receipt_file_changed");
  requireCondition(
    finalSnapshot.dev === snapshot.dev && finalSnapshot.ino === snapshot.ino && finalSnapshot.rawSha256 === snapshot.rawSha256,
    "receipt_file_changed",
  );
  requireCondition(resolveSourceSha(scope.projectRoot) === sourceShaBefore, "receipt_live_source_sha_changed");
  requireCondition(
    stableCommandWorkspaceFingerprint(scope.projectRoot) === workspaceShaBefore,
    "receipt_live_workspace_changed",
  );
  return receipt;
}

function parseVerifyCli(argv) {
  const [command, ...args] = argv;
  requireCondition(command === "verify", "receipt_usage_error");
  const allowed = new Set([
    "project-root", "receipt", "source-sha", "run-id", "outcome", "workspace-before-sha256",
    "workspace-after-sha256", "lease-id", "runtime", "gsd-version", "model-profile",
  ]);
  const values = {};
  for (const arg of args) {
    const match = arg.match(/^--([^=]+)=(.*)$/s);
    requireCondition(match && allowed.has(match[1]) && match[2].length > 0 && !Object.hasOwn(values, match[1]), "receipt_usage_error");
    values[match[1]] = match[2];
  }
  requireCondition([...allowed].every((key) => typeof values[key] === "string"), "receipt_usage_error");
  return values;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  try {
    const values = parseVerifyCli(process.argv.slice(2));
    const receipt = await verifyCommandReceipt({
      projectRoot: values["project-root"],
      receiptPath: values.receipt,
      expectedSourceSha: values["source-sha"],
      expectedRunId: values["run-id"],
      expectedOutcome: values.outcome,
      expectedWorkspaceBeforeSha256: values["workspace-before-sha256"],
      expectedWorkspaceAfterSha256: values["workspace-after-sha256"],
      expectedWorkflowLeaseId: values["lease-id"],
      expectedRuntime: values.runtime,
      expectedGsdVersion: values["gsd-version"],
      expectedModelProfile: values["model-profile"],
    });
    process.stdout.write(`${JSON.stringify(receipt, null, 2)}\n`);
    if (receipt.outcome !== "passed") process.exitCode = 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "workflow_command_receipt_error",
        code: error instanceof CommandReceiptError ? error.code : error?.code ?? "receipt_unexpected_error",
      })}\n`,
    );
    process.exitCode = 1;
  }
}
