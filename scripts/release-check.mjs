#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import {
  CommandReceiptError,
  classifySpawnTermination,
  publishFailedCommandReceipt,
  publishPassedCommandReceipt,
  resolveCommandReceiptPathOutsideProject,
  reserveCommandReceiptPath,
  stableCommandWorkspaceFingerprint,
} from "./workflow/command-receipt.mjs";
import { withWorkflowWriterFence } from "./workflow/workflow-lease.mjs";
import { assertNoAmbientGitAuthority, runAuthoritativeGit, sanitizedGitEnvironment } from "./git-authority.mjs";

const YARN_BIN = process.platform === "win32" ? "yarn.cmd" : "yarn";
const REQUIRED_TZ = "Asia/Taipei";
const DRY_RUN_FLAG = "--dry-run";
const MAX_RELEASE_DURATION_MS = 18 * 60 * 1000;
const TERMINATION_GRACE_MS = 1_000;
const KILL_CONFIRMATION_MS = 2_000;
const PROCESS_POLL_MS = 25;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
const RUN_ID_PATTERN = /^[0-9a-f-]{36}$/;
const RELEASE_CHILD_GIT_ENVIRONMENT = {
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
};
const RELEASE_FAILURE_CODES = {
  timezone_contract: "timezone_contract_failed",
  typescript_gate: "typescript_gate_failed",
  full_test_suite: "test_unclassified_failure",
  capability_matrix: "capability_matrix_failed",
  behavior_matrix: "behavior_matrix_failed",
  policy_taxonomy: "policy_taxonomy_failed",
  frontend_build: "frontend_build_failed",
  release_deadline: "release_deadline_exceeded",
  workspace_stability: "workspace_changed_during_release_check",
};
const releaseStartedAtMs = Date.now();

class ReleaseGateFailure extends Error {
  constructor(label, gate, result) {
    super(`release gate failed: ${gate}`);
    this.name = "ReleaseGateFailure";
    this.label = label;
    this.gate = gate;
    this.result = result;
  }
}

try {
  assertNoAmbientGitAuthority(process.env);
} catch {
  console.error("[release-check] FAIL: ambient Git authority environment is forbidden");
  process.exit(2);
}

function releaseChildEnvironment(envOverrides = {}) {
  const inherited = { ...process.env, ...envOverrides };
  return { ...sanitizedGitEnvironment(inherited), ...RELEASE_CHILD_GIT_ENVIRONMENT };
}

function resolveReleaseDurationMs() {
  const value = process.env.NUTRITION_RELEASE_CHECK_DEADLINE_MS;
  if (value === undefined) return MAX_RELEASE_DURATION_MS;
  if (!/^\d+$/.test(value)) {
    console.error("[release-check] FAIL: invalid tightened release deadline");
    process.exit(2);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 50 || parsed > MAX_RELEASE_DURATION_MS) {
    console.error("[release-check] FAIL: invalid tightened release deadline");
    process.exit(2);
  }
  return parsed;
}

function resolvePostflightDelayMs() {
  const value = process.env.NUTRITION_RELEASE_CHECK_POSTFLIGHT_DELAY_MS;
  if (value === undefined) return 0;
  if (!/^\d+$/.test(value)) {
    console.error("[release-check] FAIL: invalid postflight test delay");
    process.exit(2);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > MAX_RELEASE_DURATION_MS) {
    console.error("[release-check] FAIL: invalid postflight test delay");
    process.exit(2);
  }
  return parsed;
}

const releaseDeadlineAtMs = releaseStartedAtMs + resolveReleaseDurationMs();
const postflightDelayMs = resolvePostflightDelayMs();

function discoverProjectRoot() {
  return fs.realpathSync(
    runAuthoritativeGit(["rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: sanitizedGitEnvironment(),
    }).trim(),
  );
}

const projectRoot = discoverProjectRoot();

function runGit(args) {
  return runAuthoritativeGit(args, {
    cwd: projectRoot,
    encoding: "utf8",
    env: sanitizedGitEnvironment(),
  }).trim();
}

function readGitLines(args) {
  try {
    return runGit(args)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

function hasGitRef(ref) {
  try {
    runAuthoritativeGit(["rev-parse", "--verify", ref], {
      cwd: projectRoot,
      stdio: "ignore",
      env: sanitizedGitEnvironment(),
    });
    return true;
  } catch {
    return false;
  }
}

function resolveBaseRef(argv) {
  const explicitArg = argv.find((arg) => arg.startsWith("--base="));
  const explicitBase = explicitArg ? explicitArg.slice("--base=".length) : argv[0];
  const candidates = [explicitBase, "origin/main", "main"].filter(Boolean);
  const seen = new Set();

  for (const ref of candidates) {
    if (seen.has(ref) || !hasGitRef(ref)) {
      continue;
    }
    seen.add(ref);

    try {
      const mergeBase = runGit(["merge-base", "HEAD", ref]);
      if (mergeBase) {
        return { ref, mergeBase };
      }
    } catch {
      // Try the next candidate.
    }
  }

  return null;
}

function collectChangedFiles(baseInfo) {
  const files = new Set();

  if (baseInfo) {
    for (const file of readGitLines(["diff", "--name-only", "--diff-filter=ACMR", `${baseInfo.mergeBase}..HEAD`])) {
      files.add(file);
    }
  }

  for (const file of readGitLines(["diff", "--name-only", "--diff-filter=ACMR"])) {
    files.add(file);
  }

  for (const file of readGitLines(["diff", "--cached", "--name-only", "--diff-filter=ACMR"])) {
    files.add(file);
  }

  for (const file of readGitLines(["ls-files", "--others", "--exclude-standard"])) {
    files.add(file);
  }

  return [...files].sort();
}

async function publishFailureReceipt(gate, result) {
  try {
    const workspaceAfterSha256 = stableCommandWorkspaceFingerprint(projectRoot);
    const receipt = await publishFailedCommandReceipt({
      commandId: "release-check",
      runId,
      sourceSha,
      workspaceBeforeSha256,
      workspaceAfterSha256,
      gate,
      result,
      receiptPath,
      reservation,
      ...receiptAuthority,
    });
    console.error(`[release-check] Receipt: ${JSON.stringify(receipt)}`);
  } catch (error) {
    const code = error instanceof CommandReceiptError ? error.code : "receipt_publication_failed";
    console.error(`[release-check] Receipt publication failed: ${code}`);
  }
}

async function publishSuccessReceipt() {
  try {
    assertWithinReleaseDeadline();
    const workspaceAfterSha256 = stableCommandWorkspaceFingerprint(projectRoot);
    assertWithinReleaseDeadline();
    if (workspaceAfterSha256 !== workspaceBeforeSha256) {
      const receipt = await publishFailedCommandReceipt({
        commandId: "release-check",
        runId,
        sourceSha,
        workspaceBeforeSha256,
        workspaceAfterSha256,
        gate: "workspace_stability",
        result: { status: 1, signal: null },
        receiptPath,
        reservation,
        ...receiptAuthority,
      });
      printGateFailure("Workspace stability", "workspace_stability", {
        status: 1,
        signal: null,
        diagnostics: { stdout: "empty", stderr: "empty", stdoutTruncated: false, stderrTruncated: false },
      });
      console.error(`[release-check] Receipt: ${JSON.stringify(receipt)}`);
      return false;
    }
    const receipt = await publishPassedCommandReceipt({
      commandId: "release-check",
      runId,
      sourceSha,
      workspaceBeforeSha256,
      workspaceAfterSha256,
      receiptPath,
      reservation,
      testHook: (stage) => {
        if (stage === "before_receipt_commit_cas") assertWithinReleaseDeadline();
      },
      ...receiptAuthority,
    });
    console.log(`[release-check] Receipt: ${JSON.stringify(receipt)}`);
    return true;
  } catch (error) {
    if (error?.code === "ETIMEDOUT") {
      console.error("[release-check] FAIL: release deadline exceeded during postflight");
      await publishFailureReceipt("release_deadline", {
        status: null,
        signal: "SIGTERM",
        error: Object.assign(new Error("release deadline exceeded"), { code: "ETIMEDOUT" }),
      });
      return false;
    }
    const code = error instanceof CommandReceiptError ? error.code : "receipt_publication_failed";
    console.error(`[release-check] Receipt publication failed: ${code}`);
    return false;
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function assertWithinReleaseDeadline() {
  if (Date.now() >= releaseDeadlineAtMs) {
    throw Object.assign(new Error("release deadline exceeded"), { code: "ETIMEDOUT" });
  }
}

function signalChildGroup(child, signal) {
  if (!Number.isInteger(child.pid)) return false;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return true;
    console.error(`[release-check] ${signal} process-group delivery was not confirmed`);
    return false;
  }
}

function childGroupIsQuiescent(child) {
  if (!Number.isInteger(child.pid)) return true;
  try {
    if (process.platform === "win32") return child.exitCode !== null || child.signalCode !== null;
    process.kill(-child.pid, 0);
    return false;
  } catch (error) {
    return error?.code === "ESRCH";
  }
}

async function waitForChildGroupQuiescence(child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!childGroupIsQuiescent(child) && Date.now() < deadline) {
    await delay(Math.min(PROCESS_POLL_MS, Math.max(1, deadline - Date.now())));
  }
  return childGroupIsQuiescent(child);
}

async function terminateChildGroup(child) {
  signalChildGroup(child, "SIGTERM");
  if (await waitForChildGroupQuiescence(child, TERMINATION_GRACE_MS)) return true;
  signalChildGroup(child, "SIGKILL");
  return waitForChildGroupQuiescence(child, KILL_CONFIRMATION_MS);
}

async function executeStep(args, timeoutMs, envOverrides = {}) {
  let child;
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;
  const recordOutput = (stream, chunk) => {
    const bytes = Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(String(chunk));
    if (stream === "stdout") {
      if (stdoutBytes >= MAX_DIAGNOSTIC_BYTES) {
        stdoutTruncated = true;
        return;
      }
      stdoutBytes = Math.min(MAX_DIAGNOSTIC_BYTES, stdoutBytes + bytes);
      stdoutTruncated ||= stdoutBytes >= MAX_DIAGNOSTIC_BYTES;
    } else {
      if (stderrBytes >= MAX_DIAGNOSTIC_BYTES) {
        stderrTruncated = true;
        return;
      }
      stderrBytes = Math.min(MAX_DIAGNOSTIC_BYTES, stderrBytes + bytes);
      stderrTruncated ||= stderrBytes >= MAX_DIAGNOSTIC_BYTES;
    }
  };
  const diagnostics = () => ({
    stdout: stdoutBytes > 0 ? "present" : "empty",
    stderr: stderrBytes > 0 ? "present" : "empty",
    stdoutTruncated,
    stderrTruncated,
  });
  try {
    child = spawn(YARN_BIN, args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: releaseChildEnvironment(envOverrides),
    });
    child.stdout?.on("data", (chunk) => recordOutput("stdout", chunk));
    child.stderr?.on("data", (chunk) => recordOutput("stderr", chunk));
  } catch (error) {
    return { status: null, signal: null, error, diagnostics: diagnostics() };
  }

  const stepDeadlineAtMs = Date.now() + timeoutMs;
  const completion = new Promise((resolve) => {
    let spawnError = null;
    let settled = false;
    const finish = (status, signal) => {
      if (settled) return;
      settled = true;
      resolve({
        status: spawnError ? null : status,
        signal: spawnError ? null : signal,
        completedAtMs: Date.now(),
        diagnostics: diagnostics(),
        ...(spawnError ? { error: spawnError } : {}),
      });
    };
    child.once("error", (error) => {
      spawnError = error;
      finish(null, null);
    });
    child.once("exit", (status, signal) => finish(status, signal));
  });
  let deadlineTimer;
  const deadline = new Promise((resolve) => {
    deadlineTimer = setTimeout(() => resolve(null), timeoutMs);
  });
  const completed = await Promise.race([completion, deadline]);
  clearTimeout(deadlineTimer);
  if (completed !== null) {
    if (completed.completedAtMs >= stepDeadlineAtMs) {
      await terminateChildGroup(child);
      child.stdout?.destroy();
      child.stderr?.destroy();
      return {
        status: null,
        signal: "SIGTERM",
        error: Object.assign(new Error("release deadline exceeded"), { code: "ETIMEDOUT" }),
        diagnostics: diagnostics(),
      };
    }
    if (!childGroupIsQuiescent(child)) {
      const cleanupConfirmed = await terminateChildGroup(child);
      child.stdout?.destroy();
      child.stderr?.destroy();
      if (!cleanupConfirmed) {
        console.error("[release-check] Completed process-group cleanup was not confirmed");
      }
      return {
        ...completed,
        error: Object.assign(new Error("completed child left a live process group"), {
          code: "EPROCESSGROUPLEAK",
        }),
        diagnostics: diagnostics(),
      };
    }
    return completed;
  }

  const cleanupConfirmed = await terminateChildGroup(child);
  if (!cleanupConfirmed) {
    console.error("[release-check] Timed-out process-group cleanup was not confirmed");
  }
  child.stdout?.destroy();
  child.stderr?.destroy();
  await Promise.race([completion, delay(KILL_CONFIRMATION_MS)]);
  return {
    status: null,
    signal: "SIGTERM",
    error: Object.assign(new Error("release deadline exceeded"), { code: "ETIMEDOUT" }),
    diagnostics: diagnostics(),
  };
}

function diagnosticErrorClass(result) {
  const code = result?.error?.code;
  if (typeof code !== "string" || code.length === 0) return "none";
  if (["ENOENT", "EACCES", "ETIMEDOUT", "EPROCESSGROUPLEAK"].includes(code)) return code;
  if (/^E[A-Z0-9]+$/.test(code)) return "RESOURCE";
  return "OTHER";
}

function printGateFailure(label, gate, result) {
  const termination = classifySpawnTermination(result);
  console.error(
    `[release-check] FAIL: ${label}; diagnostic: ${JSON.stringify({
      schemaVersion: 1,
      kind: "release_check_failure",
      gate,
      sanitizedCode: RELEASE_FAILURE_CODES[gate] ?? "unclassified_failure",
      termination,
      errorClass: diagnosticErrorClass(result),
      output: result?.diagnostics ?? { stdout: "empty", stderr: "empty", stdoutTruncated: false, stderrTruncated: false },
    })}`,
  );
}

async function runStep(label, gate, args, envOverrides = {}) {
  console.log(`\n[release-check] ${label}`);
  const remainingMs = releaseDeadlineAtMs - Date.now();
  const result = remainingMs <= 0
    ? { status: null, signal: "SIGTERM", error: Object.assign(new Error("release deadline exceeded"), { code: "ETIMEDOUT" }) }
    : await executeStep(args, remainingMs, envOverrides);
  if (result.error || result.status !== 0) {
    printGateFailure(label, gate, result);
    throw new ReleaseGateFailure(label, gate, result);
  }
}

function validateTimezoneContract() {
  const runtimeTz = process.env.TZ;
  if (runtimeTz !== REQUIRED_TZ) {
    const received = runtimeTz === undefined ? "<missing>" : runtimeTz;
    console.error(`[release-check] FAIL: TZ must be ${REQUIRED_TZ}; received ${received}`);
    return false;
  }

  console.log(`[release-check] Timezone contract: ${REQUIRED_TZ}`);
  return true;
}

const args = process.argv.slice(2);
const isDryRun = args.includes(DRY_RUN_FLAG);
if (
  args.some(
    (arg) =>
      (arg.startsWith("--workflow-") && !arg.startsWith("--workflow-token=") && !arg.startsWith("--workflow-runtime=")) ||
      (arg.startsWith("--receipt") && !arg.startsWith("--receipt=")),
  )
) {
  console.error("[release-check] FAIL: unknown receipt authority argument");
  process.exit(2);
}
for (const prefix of ["--receipt=", "--run-id=", "--workflow-token=", "--workflow-runtime="]) {
  const matching = args.filter((arg) => arg.startsWith(prefix));
  if (matching.length > 1 || matching.some((arg) => arg.length === prefix.length)) {
    console.error(`[release-check] FAIL: invalid or duplicate ${prefix.slice(0, -1)}`);
    process.exit(2);
  }
}
const receiptArg = args.find((arg) => arg.startsWith("--receipt="));
const runIdArg = args.find((arg) => arg.startsWith("--run-id="));
const tokenArg = args.find((arg) => arg.startsWith("--workflow-token="));
const runtimeArg = args.find((arg) => arg.startsWith("--workflow-runtime="));
if ((tokenArg === undefined) !== (runtimeArg === undefined)) {
  console.error("[release-check] FAIL: signed receipts require both --workflow-token and --workflow-runtime");
  process.exit(2);
}
if (receiptArg !== undefined && (tokenArg === undefined || runtimeArg === undefined)) {
  console.error("[release-check] FAIL: --receipt requires both --workflow-token and --workflow-runtime");
  process.exit(2);
}
if (tokenArg !== undefined && receiptArg === undefined) {
  console.error("[release-check] FAIL: signed receipt authority requires --receipt");
  process.exit(2);
}
if (receiptArg !== undefined && runIdArg === undefined) {
  console.error("[release-check] FAIL: --receipt requires a caller-bound --run-id");
  process.exit(2);
}
if (runIdArg !== undefined && receiptArg === undefined) {
  console.error("[release-check] FAIL: --run-id requires --receipt");
  process.exit(2);
}
if (runIdArg !== undefined && !RUN_ID_PATTERN.test(runIdArg.slice("--run-id=".length))) {
  console.error("[release-check] FAIL: invalid --run-id");
  process.exit(2);
}
const checkArgs = args.filter(
  (arg) => arg !== receiptArg && arg !== runIdArg && arg !== tokenArg && arg !== runtimeArg,
);
const receiptAuthorityBase = tokenArg
  ? {
      projectRoot,
      tokenFile: tokenArg.slice("--workflow-token=".length),
      expectedRuntime: runtimeArg.slice("--workflow-runtime=".length),
    }
  : {};
let receiptAuthority = receiptAuthorityBase;
let receiptPath = null;
if (receiptArg) {
  try {
    receiptPath = await resolveCommandReceiptPathOutsideProject(
      receiptArg.slice("--receipt=".length),
      projectRoot,
    );
  } catch (error) {
    const code = error instanceof CommandReceiptError ? error.code : "receipt_path_unsafe";
    console.error(`[release-check] FAIL: --receipt path rejected: ${code}`);
    process.exit(2);
  }
}
const baseInfo = resolveBaseRef(checkArgs);
const changedFiles = collectChangedFiles(baseInfo);
const sourceSha = runGit(["rev-parse", "HEAD"]);
const runId = runIdArg ? runIdArg.slice("--run-id=".length) : randomUUID();
const workspaceBeforeSha256 = stableCommandWorkspaceFingerprint(projectRoot);
let reservation = null;
const touchesServerBoundary = changedFiles.some(
  (file) => file.startsWith("server/routes/") || file.startsWith("server/services/"),
);

console.log("[release-check] Starting release verification");
if (baseInfo) {
  console.log(`[release-check] Diff base: ${baseInfo.ref} (merge-base ${baseInfo.mergeBase.slice(0, 7)})`);
} else {
  console.log("[release-check] Diff base: unavailable; using working tree changes only");
}

if (changedFiles.length > 0) {
  console.log(`[release-check] Changed files considered: ${changedFiles.length}`);
} else {
  console.log("[release-check] No changed files detected; running core release gates anyway");
}

const timezoneValid = validateTimezoneContract();

if (isDryRun) {
  if (receiptPath) {
    console.error("[release-check] FAIL: dry-run does not publish release evidence");
    process.exit(2);
  }
  if (!timezoneValid) process.exit(1);
  console.log("\n[release-check] Dry run complete");
  process.exit(0);
}

async function runGateSequence() {
  if (!timezoneValid) {
    await publishFailureReceipt("timezone_contract", { status: 1, signal: null });
    return 1;
  }

  try {
    await runStep("TypeScript gate", "typescript_gate", ["tsc", "--noEmit"]);
    await runStep("Full test suite", "full_test_suite", ["test"], { NODE_ENV: "test" });
    if (touchesServerBoundary) {
      console.log(
        "\n[release-check] Note: server route/service changes detected; yarn test already includes the integration suite.",
      );
    }

    await runStep("Capability matrix generated doc drift", "capability_matrix", ["matrix:gen:check"]);
    await runStep("Behavior matrix generated doc drift", "behavior_matrix", ["behavior-matrix:gen:check"]);
    await runStep("Policy taxonomy coverage", "policy_taxonomy", ["policy-taxonomy:check"]);
    await runStep("Frontend build", "frontend_build", ["build"]);
  } catch (error) {
    if (error instanceof ReleaseGateFailure) {
      await publishFailureReceipt(error.gate, error.result);
      return Number.isInteger(error.result.status) && error.result.status !== 0 ? error.result.status : 1;
    }
    console.error("[release-check] FAIL: release gate orchestration failed: unexpected_error");
    return 1;
  }

  if (postflightDelayMs > 0) await delay(postflightDelayMs);
  try {
    assertWithinReleaseDeadline();
  } catch (error) {
    printGateFailure("Release deadline", "release_deadline", {
      status: null,
      signal: "SIGTERM",
      error,
      diagnostics: { stdout: "empty", stderr: "empty", stdoutTruncated: false, stderrTruncated: false },
    });
    await publishFailureReceipt("release_deadline", { status: null, signal: "SIGTERM", error });
    return 1;
  }

  if (!(await publishSuccessReceipt())) return 1;
  console.log("\n[release-check] PASS");
  return 0;
}

async function runSignedReleaseCheck() {
  const maxDurationSeconds = Math.max(
    1,
    Math.min(86_400, Math.ceil(Math.max(1, releaseDeadlineAtMs - Date.now()) / 1_000) + 1),
  );
  try {
    const governed = await withWorkflowWriterFence(
      {
        ...receiptAuthorityBase,
        purpose: "maintenance_check",
        maxDurationSeconds,
      },
      async (holder) => {
        const nested = holder.nestedEnvironment();
        receiptAuthority = {
          ...receiptAuthorityBase,
          fenceId: holder.fenceId,
          nestedCapability: nested.NUTRITION_WORKFLOW_FENCE_CAPABILITY,
        };
        try {
          reservation = await reserveCommandReceiptPath(receiptPath, {
            commandId: "release-check",
            runId,
            sourceSha,
            workspaceBeforeSha256,
            ...receiptAuthority,
          });
        } catch (error) {
          const code = error instanceof CommandReceiptError ? error.code : "receipt_reservation_failed";
          console.error(`[release-check] FAIL: receipt reservation failed: ${code}`);
          return { releaseStatus: 2 };
        }
        return { releaseStatus: await runGateSequence() };
      },
    );
    if (governed.status === "needs_reconciliation") {
      console.error(`[release-check] FAIL: writer fence cleanup failed: ${governed.writerCleanupCode}`);
      return 1;
    }
    return governed.releaseStatus === 0 ? 0 : governed.releaseStatus ?? 1;
  } catch (error) {
    const code = error instanceof CommandReceiptError ? error.code : "writer_fence_failed";
    console.error(`[release-check] FAIL: signed release run failed: ${code}`);
    return 1;
  }
}

const exitStatus = receiptPath ? await runSignedReleaseCheck() : await runGateSequence();
process.exitCode = exitStatus;
