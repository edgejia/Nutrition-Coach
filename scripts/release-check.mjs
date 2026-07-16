#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import process from "node:process";
import {
  CommandReceiptError,
  publishFailedCommandReceipt,
  publishPassedCommandReceipt,
  resolveCommandReceiptPathOutsideProject,
  reserveCommandReceiptPath,
  stableCommandWorkspaceFingerprint,
} from "./workflow/command-receipt.mjs";

const YARN_BIN = process.platform === "win32" ? "yarn.cmd" : "yarn";
const REQUIRED_TZ = "Asia/Taipei";
const DRY_RUN_FLAG = "--dry-run";
const MAX_RELEASE_DURATION_MS = 18 * 60 * 1000;
const TERMINATION_GRACE_MS = 1_000;
const KILL_CONFIRMATION_MS = 2_000;
const PROCESS_POLL_MS = 25;
const RUN_ID_PATTERN = /^[0-9a-f-]{36}$/;
const GIT_ROUTING_ENVIRONMENT = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];
const releaseStartedAtMs = Date.now();

if (GIT_ROUTING_ENVIRONMENT.some((name) => process.env[name] !== undefined)) {
  console.error("[release-check] FAIL: ambient Git routing environment is forbidden");
  process.exit(2);
}

function sanitizedGitEnvironment() {
  return {
    ...Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith("GIT_"))),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
  };
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
    execFileSync("git", ["--no-replace-objects", "rev-parse", "--show-toplevel"], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: sanitizedGitEnvironment(),
    }).trim(),
  );
}

const projectRoot = discoverProjectRoot();

function runGit(args) {
  return execFileSync("git", ["--no-replace-objects", ...args], {
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
    execFileSync("git", ["--no-replace-objects", "rev-parse", "--verify", ref], {
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
      console.error(`[release-check] FAIL: workspace changed while gates were running`);
      console.error(`[release-check] Receipt: ${JSON.stringify(receipt)}`);
      process.exit(1);
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
    assertWithinReleaseDeadline();
    console.log(`[release-check] Receipt: ${JSON.stringify(receipt)}`);
  } catch (error) {
    if (error?.code === "ETIMEDOUT") {
      console.error("[release-check] FAIL: release deadline exceeded during postflight");
      await publishFailureReceipt("release_deadline", {
        status: null,
        signal: "SIGTERM",
        error: Object.assign(new Error("release deadline exceeded"), { code: "ETIMEDOUT" }),
      });
      process.exit(1);
    }
    const code = error instanceof CommandReceiptError ? error.code : "receipt_publication_failed";
    console.error(`[release-check] Receipt publication failed: ${code}`);
    process.exit(1);
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

async function executeStep(args, timeoutMs) {
  let child;
  try {
    child = spawn(YARN_BIN, args, {
      cwd: projectRoot,
      stdio: ["ignore", "ignore", "ignore"],
      detached: process.platform !== "win32",
    });
  } catch (error) {
    return { status: null, signal: null, error };
  }

  const stepDeadlineAtMs = Date.now() + timeoutMs;
  const completion = new Promise((resolve) => {
    let spawnError = null;
    child.once("error", (error) => {
      spawnError = error;
    });
    child.once("close", (status, signal) => {
      resolve({ status, signal, completedAtMs: Date.now(), ...(spawnError ? { error: spawnError } : {}) });
    });
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
      return {
        status: null,
        signal: "SIGTERM",
        error: Object.assign(new Error("release deadline exceeded"), { code: "ETIMEDOUT" }),
      };
    }
    if (!childGroupIsQuiescent(child)) {
      const cleanupConfirmed = await terminateChildGroup(child);
      if (!cleanupConfirmed) {
        console.error("[release-check] Completed process-group cleanup was not confirmed");
      }
      return {
        ...completed,
        error: Object.assign(new Error("completed child left a live process group"), {
          code: "EPROCESSGROUPLEAK",
        }),
      };
    }
    return completed;
  }

  const cleanupConfirmed = await terminateChildGroup(child);
  if (!cleanupConfirmed) {
    console.error("[release-check] Timed-out process-group cleanup was not confirmed");
  }
  await Promise.race([completion, delay(KILL_CONFIRMATION_MS)]);
  return {
    status: null,
    signal: "SIGTERM",
    error: Object.assign(new Error("release deadline exceeded"), { code: "ETIMEDOUT" }),
  };
}

async function runStep(label, gate, args) {
  console.log(`\n[release-check] ${label}`);
  const remainingMs = releaseDeadlineAtMs - Date.now();
  const result = remainingMs <= 0
    ? { status: null, signal: "SIGTERM", error: Object.assign(new Error("release deadline exceeded"), { code: "ETIMEDOUT" }) }
    : await executeStep(args, remainingMs);
  if (result.error || result.status !== 0) {
    console.error(`[release-check] FAIL: ${label}; raw child output suppressed`);
    await publishFailureReceipt(gate, result);
    process.exit(Number.isInteger(result.status) && result.status !== 0 ? result.status : 1);
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
const receiptAuthority = tokenArg
  ? {
      projectRoot,
      tokenFile: tokenArg.slice("--workflow-token=".length),
      expectedRuntime: runtimeArg.slice("--workflow-runtime=".length),
    }
  : {};
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

if (receiptPath) {
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
    process.exit(2);
  }
}

if (!timezoneValid) {
  await publishFailureReceipt("timezone_contract", { status: 1, signal: null });
  process.exit(1);
}

await runStep("TypeScript gate", "typescript_gate", ["tsc", "--noEmit"]);
await runStep("Full test suite", "full_test_suite", ["test"]);
if (touchesServerBoundary) {
  console.log(
    "\n[release-check] Note: server route/service changes detected; yarn test already includes the integration suite.",
  );
}

await runStep("Capability matrix generated doc drift", "capability_matrix", ["matrix:gen:check"]);
await runStep("Behavior matrix generated doc drift", "behavior_matrix", ["behavior-matrix:gen:check"]);
await runStep("Frontend build", "frontend_build", ["build"]);

if (postflightDelayMs > 0) await delay(postflightDelayMs);
try {
  assertWithinReleaseDeadline();
} catch (error) {
  console.error("[release-check] FAIL: release deadline exceeded during postflight");
  await publishFailureReceipt("release_deadline", {
    status: null,
    signal: "SIGTERM",
    error,
  });
  process.exit(1);
}
await publishSuccessReceipt();
console.log("\n[release-check] PASS");
