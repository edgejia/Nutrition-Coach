#!/usr/bin/env node

import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  assertNoAmbientGitAuthority,
  runAuthoritativeGit,
  sanitizedGitEnvironment,
} from "./git-authority.mjs";

const YARN_BIN = process.platform === "win32" ? "yarn.cmd" : "yarn";
const REQUIRED_TZ = "Asia/Taipei";
const MAX_RELEASE_DURATION_MS = 18 * 60 * 1000;
const TERMINATION_GRACE_MS = 1_000;
const KILL_CONFIRMATION_MS = 2_000;
const PROCESS_POLL_MS = 25;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;
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

function boundedDuration(name, fallback, minimum = 0) {
  const value = process.env[name];
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) {
    console.error(`[release-check] FAIL: invalid ${name}`);
    process.exit(2);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > MAX_RELEASE_DURATION_MS) {
    console.error(`[release-check] FAIL: invalid ${name}`);
    process.exit(2);
  }
  return parsed;
}

const releaseStartedAtMs = Date.now();
const releaseDeadlineAtMs =
  releaseStartedAtMs + boundedDuration("NUTRITION_RELEASE_CHECK_DEADLINE_MS", MAX_RELEASE_DURATION_MS, 50);
const postflightDelayMs = boundedDuration("NUTRITION_RELEASE_CHECK_POSTFLIGHT_DELAY_MS", 0);

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

function runGit(args, encoding = "utf8") {
  return runAuthoritativeGit(args, {
    cwd: projectRoot,
    encoding,
    maxBuffer: 256 * 1024 * 1024,
    env: sanitizedGitEnvironment(),
  });
}

function readGitLines(args) {
  try {
    return runGit(args)
      .trim()
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
  const explicit = argv.find((arg) => arg.startsWith("--base="))?.slice("--base=".length) ?? argv[0];
  const seen = new Set();
  for (const ref of [explicit, "origin/main", "main"].filter(Boolean)) {
    if (seen.has(ref) || !hasGitRef(ref)) continue;
    seen.add(ref);
    try {
      const mergeBase = runGit(["merge-base", "HEAD", ref]).trim();
      if (mergeBase) return { ref, mergeBase };
    } catch {
      // Try the next canonical fallback.
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
  for (const args of [
    ["diff", "--name-only", "--diff-filter=ACMR"],
    ["diff", "--cached", "--name-only", "--diff-filter=ACMR"],
    ["ls-files", "--others", "--exclude-standard"],
  ]) {
    for (const file of readGitLines(args)) files.add(file);
  }
  return [...files].sort();
}

function workspaceFingerprintOnce() {
  const listed = (args) =>
    runGit(args, "buffer")
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
  const entries = [...new Set([
    ...listed(["ls-files", "-z"]),
    ...listed(["ls-files", "--others", "--exclude-standard", "-z"]),
  ])].sort();
  const hash = createHash("sha256");
  hash.update("nutrition-release-workspace-v1\0");
  hash.update(runGit(["rev-parse", "HEAD"]).trim());
  hash.update("\0");
  for (const relative of entries) {
    const absolute = path.resolve(projectRoot, relative);
    const bounded = path.relative(projectRoot, absolute);
    if (!bounded || bounded.startsWith("..") || path.isAbsolute(bounded)) {
      throw new Error("workspace path escaped project root");
    }
    const stat = fs.lstatSync(absolute, { throwIfNoEntry: false });
    hash.update(`${relative}\0`);
    if (!stat) hash.update("missing\0");
    else if (stat.isFile()) {
      hash.update(`file:${stat.mode & 0o7777}:`);
      hash.update(createHash("sha256").update(fs.readFileSync(absolute)).digest("hex"));
      hash.update("\0");
    } else if (stat.isSymbolicLink()) {
      hash.update(`symlink:${fs.readlinkSync(absolute)}\0`);
    } else {
      throw new Error("unsupported workspace entry");
    }
  }
  return hash.digest("hex");
}

function stableWorkspaceFingerprint() {
  const first = workspaceFingerprintOnce();
  const second = workspaceFingerprintOnce();
  if (first !== second) throw new Error("workspace changed during fingerprint");
  return first;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function signalChildGroup(child, signal) {
  if (!Number.isInteger(child.pid)) return false;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
    return true;
  } catch (error) {
    return error?.code === "ESRCH";
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
  const output = { stdout: 0, stderr: 0, stdoutTruncated: false, stderrTruncated: false };
  const record = (stream, chunk) => {
    const key = stream;
    const truncatedKey = `${stream}Truncated`;
    const bytes = Buffer.isBuffer(chunk) ? chunk.byteLength : Buffer.byteLength(String(chunk));
    if (output[key] >= MAX_DIAGNOSTIC_BYTES) {
      output[truncatedKey] = true;
      return;
    }
    output[key] = Math.min(MAX_DIAGNOSTIC_BYTES, output[key] + bytes);
    output[truncatedKey] ||= output[key] >= MAX_DIAGNOSTIC_BYTES;
  };
  const diagnostics = () => ({
    stdout: output.stdout > 0 ? "present" : "empty",
    stderr: output.stderr > 0 ? "present" : "empty",
    stdoutTruncated: output.stdoutTruncated,
    stderrTruncated: output.stderrTruncated,
  });
  try {
    child = spawn(YARN_BIN, args, {
      cwd: projectRoot,
      stdio: ["ignore", "pipe", "pipe"],
      detached: process.platform !== "win32",
      env: releaseChildEnvironment(envOverrides),
    });
    child.stdout?.on("data", (chunk) => record("stdout", chunk));
    child.stderr?.on("data", (chunk) => record("stderr", chunk));
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

  if (completed !== null && completed.completedAtMs < stepDeadlineAtMs && childGroupIsQuiescent(child)) {
    return completed;
  }

  const cleanupConfirmed = await terminateChildGroup(child);
  child.stdout?.destroy();
  child.stderr?.destroy();
  if (!cleanupConfirmed) console.error("[release-check] Child process-group cleanup was not confirmed");
  if (completed !== null) {
    return {
      ...completed,
      error: Object.assign(new Error("completed child left a live process group"), {
        code: "EPROCESSGROUPLEAK",
      }),
      diagnostics: diagnostics(),
    };
  }
  await Promise.race([completion, delay(KILL_CONFIRMATION_MS)]);
  return {
    status: null,
    signal: "SIGTERM",
    error: Object.assign(new Error("release deadline exceeded"), { code: "ETIMEDOUT" }),
    diagnostics: diagnostics(),
  };
}

function classifyTermination(result) {
  if (result?.error?.code === "ETIMEDOUT") return { kind: "timeout", value: "TIMEOUT" };
  if (result?.error?.code === "EPROCESSGROUPLEAK") return { kind: "process_group_leak", value: "PROCESS_GROUP_LEAK" };
  if (typeof result?.signal === "string" && result.signal.length > 0) return { kind: "signal", value: result.signal };
  if (Number.isInteger(result?.status)) return { kind: "exit_code", value: result.status };
  return { kind: "spawn_error", value: "SPAWN_ERROR" };
}

function printGateFailure(label, gate, result) {
  const code = result?.error?.code;
  const errorClass =
    typeof code !== "string" || code.length === 0
      ? "none"
      : ["ENOENT", "EACCES", "ETIMEDOUT", "EPROCESSGROUPLEAK"].includes(code)
        ? code
        : /^E[A-Z0-9]+$/.test(code)
          ? "RESOURCE"
          : "OTHER";
  console.error(
    `[release-check] FAIL: ${label}; diagnostic: ${JSON.stringify({
      schemaVersion: 1,
      kind: "release_check_failure",
      gate,
      sanitizedCode: RELEASE_FAILURE_CODES[gate] ?? "unclassified_failure",
      termination: classifyTermination(result),
      errorClass,
      output: result?.diagnostics ?? {
        stdout: "empty",
        stderr: "empty",
        stdoutTruncated: false,
        stderrTruncated: false,
      },
    })}`,
  );
}

async function runStep(label, gate, args, envOverrides = {}) {
  console.log(`\n[release-check] ${label}`);
  const remainingMs = releaseDeadlineAtMs - Date.now();
  const result =
    remainingMs <= 0
      ? {
          status: null,
          signal: "SIGTERM",
          error: Object.assign(new Error("release deadline exceeded"), { code: "ETIMEDOUT" }),
        }
      : await executeStep(args, remainingMs, envOverrides);
  if (result.error || result.status !== 0) {
    printGateFailure(label, gate, result);
    throw new ReleaseGateFailure(label, gate, result);
  }
}

function validateTimezoneContract() {
  if (process.env.TZ === REQUIRED_TZ) {
    console.log(`[release-check] Timezone contract: ${REQUIRED_TZ}`);
    return true;
  }
  console.error(`[release-check] FAIL: TZ must be ${REQUIRED_TZ}; received ${process.env.TZ ?? "<missing>"}`);
  return false;
}

const args = process.argv.slice(2);
const allowedArgs = args.every((arg) => arg === "--dry-run" || arg.startsWith("--base=") || !arg.startsWith("--"));
if (!allowedArgs || args.filter((arg) => arg.startsWith("--base=")).length > 1) {
  console.error("[release-check] FAIL: unknown or duplicate argument");
  process.exit(2);
}

const isDryRun = args.includes("--dry-run");
const baseInfo = resolveBaseRef(args.filter((arg) => arg !== "--dry-run"));
const changedFiles = collectChangedFiles(baseInfo);
const touchesServerBoundary = changedFiles.some(
  (file) => file.startsWith("server/routes/") || file.startsWith("server/services/"),
);

console.log("[release-check] Starting release verification");
if (baseInfo) {
  console.log(`[release-check] Diff base: ${baseInfo.ref} (merge-base ${baseInfo.mergeBase.slice(0, 7)})`);
} else {
  console.log("[release-check] Diff base: unavailable; using working tree changes only");
}
console.log(
  changedFiles.length > 0
    ? `[release-check] Changed files considered: ${changedFiles.length}`
    : "[release-check] No changed files detected; running core release gates anyway",
);

const timezoneValid = validateTimezoneContract();
if (isDryRun) {
  if (!timezoneValid) process.exit(1);
  console.log("\n[release-check] Dry run complete");
  process.exit(0);
}
if (!timezoneValid) process.exit(1);

let workspaceBeforeSha256;
try {
  workspaceBeforeSha256 = stableWorkspaceFingerprint();
} catch {
  console.error("[release-check] FAIL: could not capture a stable workspace baseline");
  process.exit(1);
}

try {
  await runStep("TypeScript gate", "typescript_gate", ["tsc", "--noEmit"]);
  await runStep("Full test suite", "full_test_suite", ["test"], { NODE_ENV: "test" });
  if (touchesServerBoundary) {
    console.log("\n[release-check] Note: server route/service changes detected; yarn test includes integration coverage.");
  }
  await runStep("Capability matrix generated doc drift", "capability_matrix", ["matrix:gen:check"]);
  await runStep("Behavior matrix generated doc drift", "behavior_matrix", ["behavior-matrix:gen:check"]);
  await runStep("Policy taxonomy coverage", "policy_taxonomy", ["policy-taxonomy:check"]);
  await runStep("Frontend build", "frontend_build", ["build"]);
} catch (error) {
  if (!(error instanceof ReleaseGateFailure)) {
    console.error("[release-check] FAIL: release gate orchestration failed: unexpected_error");
  }
  process.exitCode = 1;
}

if (process.exitCode !== 1) {
  if (postflightDelayMs > 0) await delay(postflightDelayMs);
  if (Date.now() >= releaseDeadlineAtMs) {
    printGateFailure("Release deadline", "release_deadline", {
      status: null,
      signal: "SIGTERM",
      error: Object.assign(new Error("release deadline exceeded"), { code: "ETIMEDOUT" }),
    });
    process.exitCode = 1;
  } else {
    try {
      const workspaceAfterSha256 = stableWorkspaceFingerprint();
      if (workspaceAfterSha256 !== workspaceBeforeSha256) {
        printGateFailure("Workspace stability", "workspace_stability", { status: 1, signal: null });
        process.exitCode = 1;
      }
    } catch {
      printGateFailure("Workspace stability", "workspace_stability", {
        status: 1,
        signal: null,
        error: Object.assign(new Error("workspace fingerprint failed"), { code: "ERESOURCE" }),
      });
      process.exitCode = 1;
    }
  }
}

if (process.exitCode !== 1) console.log("\n[release-check] PASS");
