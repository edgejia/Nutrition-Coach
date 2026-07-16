#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFileSync, spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveWorkflowProjectScope, verifyWorkflowLeaseSignature, withWorkflowWriterFence } from "./workflow-lease.mjs";

const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const RUN_ID_PATTERN = /^[0-9a-f-]{36}$/;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const COMMAND_LABELS = new Set(["maintenance_check", "pilot"]);
const REASONING_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max", "unknown"]);
const EVENT_TYPES = new Set(["retry", "replan", "repair"]);
const METRIC_SOURCE_RUNTIME = new Map([
  ["codex_usage_api", "codex"],
  ["claude_usage_api", "claude"],
]);
const MAX_METRICS_BYTES = 4 * 1024;
const MAX_COUNTER = 1_000_000_000;
const PROCESS_GROUP_TERM_GRACE_MS = 750;
const PROCESS_GROUP_KILL_GRACE_MS = 1500;

export class WorkflowTelemetryError extends Error {
  constructor(code) {
    super(code);
    this.name = "WorkflowTelemetryError";
    this.code = code;
  }
}

function fail(code) {
  throw new WorkflowTelemetryError(code);
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

function canonicalEnvironment(environment) {
  return Object.entries(environment ?? process.env)
    .filter(([, value]) => typeof value === "string")
    .sort(([left], [right]) => left.localeCompare(right, "en"));
}

export function workflowCommandBundleSha256(options) {
  requireCondition(Array.isArray(options.command) && options.command.length > 0 && options.command.every((value) => typeof value === "string"), "telemetry_command_required");
  const payload = {
    schemaVersion: 1,
    kind: "workflow_command_bundle",
    authorizationProfile: "signed_exact_bundle",
    phaseId: options.phaseId,
    expectedSourceSha: options.expectedSourceSha,
    reasoningEffort: options.reasoningEffort,
    timeoutSeconds: options.timeoutSeconds,
    command: options.command,
    environmentSha256: sha256(JSON.stringify(canonicalEnvironment(options.env))),
    artifacts: options.artifacts ?? [],
    events: options.events ?? [],
    metricsPathSha256: options.metricsPath === undefined ? null : sha256(options.metricsPath),
  };
  return sha256(JSON.stringify(payload));
}

function recordPayload(record) {
  const { recordSha256: _digest, recordSignature: _signature, ...payload } = record;
  return payload;
}

function recordSignaturePayload(record) {
  return { ...recordPayload(record), recordSha256: record.recordSha256 };
}

function signRecord(holder, fields) {
  const record = { ...fields };
  record.recordSha256 = sha256(JSON.stringify(recordPayload(record)));
  record.recordSignature = holder.signPayload(recordSignaturePayload(record));
  return record;
}

function receiptPayload(receipt) {
  const { receiptSha256: _digest, receiptSignature: _signature, ...payload } = receipt;
  return payload;
}

function receiptSignaturePayload(receipt) {
  return { ...receiptPayload(receipt), receiptSha256: receipt.receiptSha256 };
}

function signReceipt(holder, fields) {
  const receipt = { ...fields };
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

function timestamp(now = new Date()) {
  requireCondition(now instanceof Date && !Number.isNaN(now.valueOf()), "telemetry_time_invalid");
  return new Date(now.valueOf() + 8 * 60 * 60 * 1000).toISOString().replace("Z", "+08:00");
}

function resolveSourceSha(projectRoot) {
  const value = execFileSync("git", ["--no-replace-objects", "rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
    env: sanitizedGitEnvironment(),
  }).trim();
  requireCondition(SOURCE_SHA_PATTERN.test(value), "telemetry_source_sha_invalid");
  return value;
}

function unavailableMetric() {
  return { availability: "unavailable", sourceClaim: null, attribution: null, value: null, routingEvidenceEligible: false };
}

function providedMetric(source, value) {
  return {
    availability: "caller_declared",
    sourceClaim: source,
    attribution: "not_run_delta_verified",
    value,
    routingEvidenceEligible: false,
  };
}

function validateCounter(value) {
  requireCondition(Number.isInteger(value) && value >= 0 && value <= MAX_COUNTER, "telemetry_counter_invalid");
  return value;
}

async function loadRuntimeMetrics(metricsPath, expectedRuntime) {
  if (metricsPath === undefined) {
    return {
      agentSessionCount: unavailableMetric(),
      toolCallCount: unavailableMetric(),
      inputTokens: unavailableMetric(),
      outputTokens: unavailableMetric(),
    };
  }
  requireCondition(typeof metricsPath === "string" && path.isAbsolute(metricsPath), "telemetry_metrics_path_invalid");
  let handle;
  try {
    handle = await fs.open(metricsPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    fail("telemetry_metrics_file_unsafe");
  }
  let raw;
  try {
    const stat = await handle.stat();
    requireCondition(stat.isFile() && stat.size <= MAX_METRICS_BYTES, "telemetry_metrics_file_unsafe");
    raw = await handle.readFile("utf8");
    requireCondition(Buffer.byteLength(raw) <= MAX_METRICS_BYTES, "telemetry_metrics_file_unsafe");
  } finally {
    await handle.close().catch(() => undefined);
  }
  let metrics;
  try {
    metrics = JSON.parse(raw);
  } catch {
    fail("telemetry_metrics_invalid_json");
  }
  const keys = Object.keys(metrics).sort();
  const expected = ["agentSessionCount", "inputTokens", "kind", "outputTokens", "schemaVersion", "source", "toolCallCount"].sort();
  requireCondition(JSON.stringify(keys) === JSON.stringify(expected), "telemetry_metrics_unknown_or_missing_field");
  requireCondition(metrics.schemaVersion === 1 && metrics.kind === "workflow_runtime_metrics", "telemetry_metrics_invalid");
  requireCondition(METRIC_SOURCE_RUNTIME.has(metrics.source), "telemetry_metrics_source_invalid");
  requireCondition(METRIC_SOURCE_RUNTIME.get(metrics.source) === expectedRuntime, "telemetry_metrics_runtime_mismatch");
  return {
    agentSessionCount: providedMetric(metrics.source, validateCounter(metrics.agentSessionCount)),
    toolCallCount: providedMetric(metrics.source, validateCounter(metrics.toolCallCount)),
    inputTokens: providedMetric(metrics.source, validateCounter(metrics.inputTokens)),
    outputTokens: providedMetric(metrics.source, validateCounter(metrics.outputTokens)),
  };
}

function normalizeArtifact(projectRoot, artifact) {
  requireCondition(typeof artifact === "string" && artifact.length > 0 && !path.isAbsolute(artifact), "telemetry_artifact_path_invalid");
  const normalized = path.posix.normalize(artifact);
  requireCondition(normalized !== ".." && !normalized.startsWith("../") && !normalized.includes("\\"), "telemetry_artifact_path_invalid");
  const absolute = path.resolve(projectRoot, normalized);
  const relative = path.relative(projectRoot, absolute);
  requireCondition(relative && !relative.startsWith("..") && !path.isAbsolute(relative), "telemetry_artifact_path_invalid");
  return { absolute, name: path.basename(absolute) };
}

async function safeArtifactSize(projectRoot, artifact) {
  const target = normalizeArtifact(projectRoot, artifact);
  const rootStat = await fs.lstat(projectRoot).catch(() => null);
  requireCondition(rootStat?.isDirectory() && !rootStat.isSymbolicLink(), "telemetry_project_root_unsafe");
  const parentRelative = path.relative(projectRoot, path.dirname(target.absolute));
  let current = projectRoot;
  for (const component of parentRelative.split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    const stat = await fs.lstat(current).catch(() => null);
    if (stat === null) return { target, missing: true, size: 0 };
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), "telemetry_artifact_path_unsafe");
  }
  let handle;
  try {
    handle = await fs.open(target.absolute, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return { target, missing: true, size: 0 };
    fail("telemetry_artifact_path_unsafe");
  }
  try {
    const stat = await handle.stat();
    requireCondition(stat.isFile(), "telemetry_artifact_path_unsafe");
    validateCounter(stat.size);
    return { target, missing: false, size: stat.size };
  } finally {
    await handle.close().catch(() => undefined);
  }
}

async function measureArtifacts(projectRoot, artifacts) {
  const unique = [...new Set(artifacts ?? [])];
  requireCondition(unique.length === (artifacts ?? []).length, "telemetry_artifact_duplicate");
  let planBytes = 0;
  let artifactBytes = 0;
  let missingArtifactCount = 0;
  for (const artifact of unique) {
    const observed = await safeArtifactSize(projectRoot, artifact);
    if (observed.missing) missingArtifactCount += 1;
    artifactBytes += observed.size;
    if (observed.target.name.endsWith("-PLAN.md")) planBytes += observed.size;
    validateCounter(artifactBytes);
    validateCounter(planBytes);
  }
  return { declaredArtifactCount: unique.length, observedArtifactCount: unique.length - missingArtifactCount, missingArtifactCount, artifactBytes, planBytes };
}

function eventCounts(events) {
  const counts = { retry: 0, replan: 0, repair: 0 };
  for (const event of events ?? []) {
    requireCondition(EVENT_TYPES.has(event), "telemetry_event_invalid");
    counts[event] = validateCounter(counts[event] + 1);
  }
  return counts;
}

function classifyTermination(result, timeoutSeconds) {
  if (result.timedOut) return { kind: "timeout", value: timeoutSeconds };
  if (typeof result.signal === "string" && result.signal.length > 0) {
    return { kind: "signal", value: /^[A-Z0-9_]+$/.test(result.signal) ? result.signal : "SIGNAL_OTHER" };
  }
  if (Number.isInteger(result.status)) return { kind: "exit_code", value: result.status };
  return { kind: "spawn_error", value: "SPAWN_ERROR" };
}

function processGroupExists(processGroupId) {
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    return !(error && typeof error === "object" && error.code === "ESRCH");
  }
}

function signalProcessGroup(processGroupId, signal) {
  try {
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (!(error && typeof error === "object" && error.code === "ESRCH")) throw error;
  }
}

async function waitForProcessGroupExit(processGroupId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(processGroupId) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processGroupExists(processGroupId);
}

async function terminateProcessGroup(processGroupId) {
  if (!processGroupExists(processGroupId)) return true;
  signalProcessGroup(processGroupId, "SIGTERM");
  if (await waitForProcessGroupExit(processGroupId, PROCESS_GROUP_TERM_GRACE_MS)) return true;
  signalProcessGroup(processGroupId, "SIGKILL");
  return waitForProcessGroupExit(processGroupId, PROCESS_GROUP_KILL_GRACE_MS);
}

async function runChild(command, options) {
  requireCondition(process.platform !== "win32", "telemetry_process_group_unsupported");
  let child;
  try {
    child = spawn(command[0], command.slice(1), {
      cwd: options.cwd,
      detached: true,
      env: options.env,
      // Child output can contain prompts, tokens, or transcripts. Reserve the
      // wrapper's stdout for its single structured receipt.
      stdio: "ignore",
    });
  } catch {
    await options.onSpawnFailure();
    return {
      status: null,
      signal: null,
      timedOut: false,
      spawnError: true,
      descendantLeakDetected: false,
      processGroupQuiescent: true,
      processGroupId: null,
    };
  }

  const close = new Promise((resolve) => {
    child.once("close", (status, signal) => resolve({ status, signal }));
  });
  const spawned = await new Promise((resolve) => {
    child.once("spawn", () => resolve(true));
    child.once("error", () => resolve(false));
  });
  if (!spawned || !Number.isInteger(child.pid)) {
    await options.onSpawnFailure();
    return {
      status: null,
      signal: null,
      timedOut: false,
      spawnError: true,
      descendantLeakDetected: false,
      processGroupQuiescent: true,
      processGroupId: null,
    };
  }

  const processGroupId = child.pid;
  try {
    await options.onSpawn(processGroupId);
  } catch (error) {
    await terminateProcessGroup(processGroupId).catch(() => false);
    throw error;
  }
  let timeoutHandle;
  const first = await Promise.race([
    close.then((value) => ({ kind: "close", value })),
    new Promise((resolve) => {
      timeoutHandle = setTimeout(() => resolve({ kind: "timeout" }), options.timeoutSeconds * 1000);
    }),
  ]);
  clearTimeout(timeoutHandle);
  if (first.kind === "timeout") {
    const processGroupQuiescent = await terminateProcessGroup(processGroupId);
    const closed = await Promise.race([
      close,
      new Promise((resolve) => setTimeout(() => resolve({ status: null, signal: null }), PROCESS_GROUP_KILL_GRACE_MS)),
    ]);
    return {
      ...closed,
      timedOut: true,
      spawnError: false,
      descendantLeakDetected: false,
      processGroupQuiescent,
      processGroupId,
    };
  }

  const descendantLeakDetected = processGroupExists(processGroupId);
  const processGroupQuiescent = descendantLeakDetected ? await terminateProcessGroup(processGroupId) : true;
  return {
    ...first.value,
    timedOut: false,
    spawnError: false,
    descendantLeakDetected,
    processGroupQuiescent,
    processGroupId,
  };
}

async function createRunningRecord(recordPath, record) {
  const directory = path.dirname(recordPath);
  const governanceDirectory = path.dirname(directory);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const directoryStat = await fs.lstat(directory);
  requireCondition(directoryStat.isDirectory() && !directoryStat.isSymbolicLink(), "telemetry_directory_unsafe");
  const handle = await fs.open(recordPath, "wx", 0o600).catch((error) => {
    if (error && typeof error === "object" && error.code === "EEXIST") fail("telemetry_record_exists");
    throw error;
  });
  try {
    await handle.writeFile(`${JSON.stringify(record, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await syncDirectory(directory);
  await syncDirectory(governanceDirectory);
}

async function readRecordSnapshot(recordPath) {
  let handle;
  try {
    handle = await fs.open(recordPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch {
    fail("telemetry_record_changed");
  }
  let raw;
  let stat;
  try {
    stat = await handle.stat();
    requireCondition(stat.isFile() && stat.size > 0 && stat.size <= 128 * 1024, "telemetry_record_changed");
    raw = await handle.readFile("utf8");
  } finally {
    await handle.close().catch(() => undefined);
  }
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    fail("telemetry_record_changed");
  }
  requireCondition(sha256(JSON.stringify(recordPayload(value))) === value.recordSha256, "telemetry_record_tampered");
  return { raw, rawSha256: sha256(raw), dev: stat.dev, ino: stat.ino, value };
}

async function stableRecordSnapshot(recordPath) {
  const first = await readRecordSnapshot(recordPath);
  const second = await readRecordSnapshot(recordPath);
  requireCondition(first.dev === second.dev && first.ino === second.ino && first.rawSha256 === second.rawSha256, "telemetry_record_changed");
  return second;
}

async function finishRecord(recordPath, runningRecord, completedRecord) {
  const expected = await stableRecordSnapshot(recordPath);
  requireCondition(expected.raw === `${JSON.stringify(runningRecord, null, 2)}\n`, "telemetry_record_changed");
  const temp = path.join(path.dirname(recordPath), `.${path.basename(recordPath)}.tmp-${randomUUID()}`);
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(completedRecord, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    const current = await readRecordSnapshot(recordPath);
    requireCondition(
      current.dev === expected.dev && current.ino === expected.ino && current.rawSha256 === expected.rawSha256,
      "telemetry_record_changed",
    );
    await fs.rename(temp, recordPath);
    await syncDirectory(path.dirname(recordPath));
    const published = await stableRecordSnapshot(recordPath);
    requireCondition(published.raw === `${JSON.stringify(completedRecord, null, 2)}\n`, "telemetry_record_changed");
    return published;
  } finally {
    await fs.unlink(temp).catch(() => undefined);
  }
}

function safePostflightCode(error) {
  if (error instanceof WorkflowTelemetryError) return error.code;
  if (
    error &&
    typeof error === "object" &&
    typeof error.code === "string" &&
    /^(?:workflow|lease|telemetry)_[a-z0-9_]+$/.test(error.code)
  ) {
    return error.code;
  }
  return "telemetry_postflight_unexpected_error";
}

export async function runInstrumentedWorkflow(options) {
  requireCondition(options.commonDir === undefined, "telemetry_common_dir_override_rejected");
  const scope = resolveWorkflowProjectScope({ projectRoot: options.projectRoot });
  const projectRoot = scope.projectRoot;
  requireCondition(SAFE_ID_PATTERN.test(options.phaseId ?? ""), "telemetry_phase_id_invalid");
  requireCondition(COMMAND_LABELS.has(options.commandLabel), "telemetry_command_label_invalid");
  requireCondition(REASONING_EFFORTS.has(options.reasoningEffort), "telemetry_reasoning_effort_invalid");
  requireCondition(Array.isArray(options.command) && options.command.length > 0 && options.command.every((value) => typeof value === "string"), "telemetry_command_required");
  requireCondition(options.sourceSha === undefined, "telemetry_legacy_source_override_rejected");
  requireCondition(SOURCE_SHA_PATTERN.test(options.expectedSourceSha ?? ""), "telemetry_expected_source_sha_required");
  requireCondition(options.commandLabel !== "pilot", "telemetry_pilot_containment_unavailable");
  requireCondition(
    Number.isInteger(options.timeoutSeconds) && options.timeoutSeconds >= 1 && options.timeoutSeconds <= 86400,
    "telemetry_timeout_invalid",
  );
  if (options.finishNow !== undefined) timestamp(options.finishNow);
  const runId = options.runId ?? randomUUID();
  requireCondition(RUN_ID_PATTERN.test(runId), "telemetry_run_id_invalid");
  const commandBundleSha256 = workflowCommandBundleSha256(options);
  if (options.expectedBundleSha256 !== undefined) {
    requireCondition(/^[0-9a-f]{64}$/.test(options.expectedBundleSha256), "telemetry_expected_bundle_invalid");
    requireCondition(options.expectedBundleSha256 === commandBundleSha256, "telemetry_command_bundle_mismatch");
  }
  const commonDir = scope.commonDir;
  const recordPath = path.join(commonDir, "nutrition-workflow", "telemetry", `${options.phaseId}-${runId}.json`);
  const governed = await withWorkflowWriterFence(
    {
      projectRoot,
      tokenFile: options.tokenFile,
      expectedRuntime: options.expectedRuntime,
      purpose: options.commandLabel === "pilot" ? "pilot" : options.commandLabel === "maintenance_check" ? "maintenance_check" : "workflow_command",
      maxDurationSeconds: options.timeoutSeconds + 30,
      now: options.now,
    },
    async (holder) => {
      const metrics = await loadRuntimeMetrics(options.metricsPath, holder.executionRuntime);
      const measuredBefore = await measureArtifacts(projectRoot, options.artifacts ?? []);
      const declaredEvents = eventCounts(options.events ?? []);
      const sourceShaBefore = resolveSourceSha(projectRoot);
      requireCondition(SOURCE_SHA_PATTERN.test(sourceShaBefore), "telemetry_source_sha_invalid");
      requireCondition(sourceShaBefore === options.expectedSourceSha, "telemetry_source_sha_mismatch");
      const runningRecord = signRecord(holder, {
        schemaVersion: 2,
        kind: "workflow_telemetry_record",
        state: "running",
        runId,
        phaseId: options.phaseId,
        authorizationProfile: "signed_exact_bundle",
        commandBundleSha256,
        sourceShaBefore,
        worktreeIdentitySha256: scope.worktreeIdentitySha256,
        gitCommonIdentitySha256: scope.gitCommonIdentitySha256,
        workflowLeaseId: holder.leaseId,
        workflowFenceId: holder.fenceId,
        leaseAttestationSha256: holder.leaseAttestationSha256,
        executionRuntime: holder.executionRuntime,
        gsdVersion: holder.gsdVersion,
        modelProfile: holder.modelProfile,
        reasoningEffort: options.reasoningEffort,
        timeoutSeconds: options.timeoutSeconds,
        startedAt: timestamp(options.now),
        declaredEvents,
        measuredBefore,
        metrics,
      });
      await holder.beginChildRegistration();
      try {
        await createRunningRecord(recordPath, runningRecord);
        if (typeof options.testHook === "function") {
          await options.testHook("after_running_record_publication", recordPath);
        }
      } catch (error) {
        await holder.clearChildRegistration();
        throw error;
      }
      const start = process.hrtime.bigint();
      const result = await runChild(options.command, {
        cwd: projectRoot,
        env: {
          ...(options.env ?? process.env),
          ...holder.nestedEnvironment(),
        },
        timeoutSeconds: options.timeoutSeconds,
        onSpawn: (processGroupId) => holder.registerChildProcessGroup(processGroupId),
        onSpawnFailure: () => holder.clearChildRegistration(),
      });
      const wallTimeMs = Number((process.hrtime.bigint() - start) / 1_000_000n);
      const termination = classifyTermination(result, options.timeoutSeconds);
      const processGroup = {
        isolation: "posix_process_group_limited",
        scope: "original_process_group_only",
        registered: result.processGroupId !== null,
        descendantLeakDetected: result.descendantLeakDetected,
        quiescent: result.processGroupQuiescent,
        pilotEligible: false,
      };
      const childOutcome =
        termination.kind === "exit_code" &&
        termination.value === 0 &&
        !result.descendantLeakDetected &&
        result.processGroupQuiescent
          ? "pass"
          : "fail";
      const basePostflight = {
        childOutcome,
        finishedAt: timestamp(options.finishNow),
        wallTimeMs: validateCounter(wallTimeMs),
        termination,
        processGroup,
      };
      let completedRecord;
      let postflightCode = null;
      let sourceShaAfterObserved = null;
      try {
        requireCondition(result.processGroupQuiescent, "telemetry_process_group_not_quiescent");
        const measuredAfter = await measureArtifacts(projectRoot, options.artifacts ?? []);
        const sourceShaAfter = resolveSourceSha(projectRoot);
        sourceShaAfterObserved = sourceShaAfter;
        requireCondition(SOURCE_SHA_PATTERN.test(sourceShaAfter), "telemetry_source_sha_invalid");
        requireCondition(sourceShaAfter === options.expectedSourceSha, "telemetry_source_sha_changed");
        await holder.assertCurrent();
        completedRecord = signRecord(holder, {
          ...runningRecord,
          state: "completed",
          ...basePostflight,
          sourceShaAfter,
          measuredAfter,
        });
      } catch (error) {
        postflightCode = safePostflightCode(error);
        completedRecord = signRecord(holder, {
          ...runningRecord,
          state: "needs_reconciliation",
          ...basePostflight,
          code: "telemetry_postflight_failed",
          postflightCode,
          ...(SOURCE_SHA_PATTERN.test(sourceShaAfterObserved ?? "") ? { sourceShaAfterObserved } : {}),
        });
      }
      let telemetryCommitted = true;
      let publicationVerified = false;
      let publishedRecord = null;
      try {
        publishedRecord = await finishRecord(recordPath, runningRecord, completedRecord);
      } catch {
        telemetryCommitted = false;
      }
      if (telemetryCommitted) {
        try {
          if (typeof options.testHook === "function") await options.testHook("after_record_publication", recordPath);
          requireCondition(resolveSourceSha(projectRoot) === options.expectedSourceSha, "telemetry_source_sha_changed_after_publication");
          await holder.assertCurrent();
          requireCondition(workflowCommandBundleSha256(options) === commandBundleSha256, "telemetry_command_bundle_changed_after_publication");
          const finalRecord = await readRecordSnapshot(recordPath);
          requireCondition(
            finalRecord.dev === publishedRecord.dev && finalRecord.ino === publishedRecord.ino && finalRecord.rawSha256 === publishedRecord.rawSha256,
            "telemetry_record_changed_after_publication",
          );
          await verifyWorkflowLeaseSignature({
            projectRoot,
            leaseId: finalRecord.value.workflowLeaseId,
            attestationSha256: finalRecord.value.leaseAttestationSha256,
            payload: recordSignaturePayload(finalRecord.value),
            signature: finalRecord.value.recordSignature,
          });
          requireCondition(resolveSourceSha(projectRoot) === options.expectedSourceSha, "telemetry_source_sha_changed_after_publication");
          await holder.assertCurrent();
          requireCondition(workflowCommandBundleSha256(options) === commandBundleSha256, "telemetry_command_bundle_changed_after_publication");
          publicationVerified = true;
        } catch (error) {
          if (postflightCode === null) postflightCode = safePostflightCode(error);
        }
      }
      const receipt = signReceipt(holder, {
        schemaVersion: 2,
        kind: "workflow_telemetry_receipt",
        status:
          telemetryCommitted && postflightCode === null
            ? childOutcome === "pass"
              ? "limited_observation"
              : "fail"
            : "needs_reconciliation",
        childOutcome,
        runId,
        phaseId: options.phaseId,
        sourceSha: options.expectedSourceSha,
        worktreeIdentitySha256: scope.worktreeIdentitySha256,
        gitCommonIdentitySha256: scope.gitCommonIdentitySha256,
        workflowLeaseId: holder.leaseId,
        workflowFenceId: holder.fenceId,
        leaseAttestationSha256: holder.leaseAttestationSha256,
        executionRuntime: holder.executionRuntime,
        gsdVersion: holder.gsdVersion,
        modelProfile: holder.modelProfile,
        authorizationProfile: "signed_exact_bundle",
        commandBundleSha256,
        termination,
        telemetryCommitted,
        publicationVerified,
        cleanupRequired: !telemetryCommitted || !publicationVerified || postflightCode !== null,
        containment: "original_process_group_only",
        pilotEligible: false,
        routingEvidenceEligible: false,
        ...(postflightCode !== null
          ? { code: "telemetry_postflight_failed", postflightCode }
          : telemetryCommitted
            ? result.descendantLeakDetected
              ? { code: "telemetry_descendant_process_leak" }
              : childOutcome === "pass"
                ? { code: "telemetry_containment_limited" }
                : {}
            : { code: "telemetry_commit_failed" }),
      });
      return { receipt };
    },
  );
  if (governed.status === "needs_reconciliation") {
    return {
      schemaVersion: 2,
      kind: "workflow_telemetry_reconciliation",
      status: "needs_reconciliation",
      cleanupRequired: true,
      writerFenceReleased: false,
      writerCleanupCode: governed.writerCleanupCode,
      signedReceipt: governed.receipt,
    };
  }
  return governed.receipt;
}

export async function verifyWorkflowTelemetryReceipt(options) {
  requireCondition(RUN_ID_PATTERN.test(options.expectedRunId ?? ""), "telemetry_receipt_expected_run_id_required");
  requireCondition(SAFE_ID_PATTERN.test(options.expectedPhaseId ?? ""), "telemetry_receipt_expected_phase_id_required");
  requireCondition(
    ["limited_observation", "fail", "needs_reconciliation"].includes(options.expectedStatus),
    "telemetry_receipt_expected_status_required",
  );
  requireCondition(
    options.expectedChildOutcome === "pass" || options.expectedChildOutcome === "fail",
    "telemetry_receipt_expected_child_outcome_required",
  );
  const receipt = options.receipt;
  requireCondition(receipt && typeof receipt === "object" && !Array.isArray(receipt), "telemetry_receipt_invalid");
  requireCondition(receipt.schemaVersion === 2 && receipt.kind === "workflow_telemetry_receipt", "telemetry_receipt_invalid");
  requireCondition(receipt.authorizationProfile === "signed_exact_bundle", "telemetry_receipt_invalid");
  requireCondition(/^[0-9a-f]{64}$/.test(receipt.commandBundleSha256 ?? ""), "telemetry_receipt_invalid");
  requireCondition(/^[0-9a-f]{64}$/.test(receipt.receiptSha256 ?? ""), "telemetry_receipt_invalid");
  requireCondition(/^[A-Za-z0-9_-]+$/.test(receipt.receiptSignature ?? ""), "telemetry_receipt_invalid");
  requireCondition(sha256(JSON.stringify(receiptPayload(receipt))) === receipt.receiptSha256, "telemetry_receipt_tampered");
  const scope = resolveWorkflowProjectScope({ projectRoot: options.projectRoot });
  requireCondition(receipt.runId === options.expectedRunId, "telemetry_receipt_run_id_mismatch");
  requireCondition(receipt.phaseId === options.expectedPhaseId, "telemetry_receipt_phase_id_mismatch");
  requireCondition(receipt.status === options.expectedStatus, "telemetry_receipt_status_mismatch");
  requireCondition(receipt.childOutcome === options.expectedChildOutcome, "telemetry_receipt_child_outcome_mismatch");
  if (receipt.status === "limited_observation") {
    requireCondition(
      receipt.childOutcome === "pass" &&
        receipt.telemetryCommitted === true &&
        receipt.publicationVerified === true &&
        receipt.cleanupRequired === false,
      "telemetry_receipt_status_invalid",
    );
  } else if (receipt.status === "fail") {
    requireCondition(
      receipt.childOutcome === "fail" &&
        receipt.telemetryCommitted === true &&
        receipt.publicationVerified === true &&
        receipt.cleanupRequired === false,
      "telemetry_receipt_status_invalid",
    );
  } else {
    requireCondition(receipt.cleanupRequired === true, "telemetry_receipt_status_invalid");
  }
  requireCondition(receipt.pilotEligible === false, "telemetry_receipt_status_invalid");
  requireCondition(receipt.routingEvidenceEligible === false, "telemetry_receipt_status_invalid");
  requireCondition(receipt.worktreeIdentitySha256 === scope.worktreeIdentitySha256, "telemetry_receipt_worktree_mismatch");
  requireCondition(receipt.gitCommonIdentitySha256 === scope.gitCommonIdentitySha256, "telemetry_receipt_git_common_mismatch");
  requireCondition(receipt.sourceSha === options.expectedSourceSha, "telemetry_receipt_source_mismatch");
  const sourceShaBefore = resolveSourceSha(scope.projectRoot);
  requireCondition(sourceShaBefore === options.expectedSourceSha, "telemetry_receipt_live_source_mismatch");
  requireCondition(receipt.commandBundleSha256 === options.expectedBundleSha256, "telemetry_receipt_bundle_mismatch");
  requireCondition(receipt.workflowLeaseId === options.expectedWorkflowLeaseId, "telemetry_receipt_lease_id_mismatch");
  requireCondition(receipt.executionRuntime === options.expectedRuntime, "telemetry_receipt_runtime_mismatch");
  requireCondition(receipt.gsdVersion === options.expectedGsdVersion, "telemetry_receipt_gsd_version_mismatch");
  requireCondition(receipt.modelProfile === options.expectedModelProfile, "telemetry_receipt_model_profile_mismatch");
  const attestation = await verifyWorkflowLeaseSignature({
    projectRoot: scope.projectRoot,
    leaseId: receipt.workflowLeaseId,
    attestationSha256: receipt.leaseAttestationSha256,
    payload: receiptSignaturePayload(receipt),
    signature: receipt.receiptSignature,
  }).catch(() => fail("telemetry_receipt_signature_invalid"));
  requireCondition(attestation.executionRuntime === receipt.executionRuntime, "telemetry_receipt_holder_mismatch");
  requireCondition(attestation.gsdVersion === receipt.gsdVersion, "telemetry_receipt_holder_mismatch");
  requireCondition(attestation.modelProfile === receipt.modelProfile, "telemetry_receipt_holder_mismatch");
  requireCondition(resolveSourceSha(scope.projectRoot) === sourceShaBefore, "telemetry_receipt_live_source_changed");
  return receipt;
}

export async function verifyWorkflowTelemetryRecord(options) {
  requireCondition(RUN_ID_PATTERN.test(options.expectedRunId ?? ""), "telemetry_record_expected_run_id_required");
  requireCondition(SAFE_ID_PATTERN.test(options.expectedPhaseId ?? ""), "telemetry_record_expected_phase_id_required");
  requireCondition(
    options.expectedState === "completed" || options.expectedState === "needs_reconciliation",
    "telemetry_record_expected_final_state_required",
  );
  requireCondition(
    options.expectedChildOutcome === "pass" || options.expectedChildOutcome === "fail",
    "telemetry_record_expected_child_outcome_required",
  );
  const scope = resolveWorkflowProjectScope({ projectRoot: options.projectRoot });
  const target = path.join(
    scope.commonDir,
    "nutrition-workflow",
    "telemetry",
    `${options.expectedPhaseId}-${options.expectedRunId}.json`,
  );
  requireCondition(
    typeof options.recordPath === "string" && path.isAbsolute(options.recordPath) && path.resolve(options.recordPath) === target,
    "telemetry_record_path_mismatch",
  );
  const snapshot = await stableRecordSnapshot(target);
  const record = snapshot.value;
  requireCondition(record.schemaVersion === 2 && record.kind === "workflow_telemetry_record", "telemetry_record_invalid");
  requireCondition(record.authorizationProfile === "signed_exact_bundle", "telemetry_record_invalid");
  requireCondition(/^[0-9a-f]{64}$/.test(record.recordSha256 ?? ""), "telemetry_record_invalid");
  requireCondition(/^[A-Za-z0-9_-]+$/.test(record.recordSignature ?? ""), "telemetry_record_invalid");
  requireCondition(sha256(JSON.stringify(recordPayload(record))) === record.recordSha256, "telemetry_record_tampered");
  requireCondition(record.runId === options.expectedRunId, "telemetry_record_run_id_mismatch");
  requireCondition(record.phaseId === options.expectedPhaseId, "telemetry_record_phase_id_mismatch");
  requireCondition(record.state === options.expectedState, "telemetry_record_state_mismatch");
  requireCondition(record.childOutcome === options.expectedChildOutcome, "telemetry_record_child_outcome_mismatch");
  requireCondition(record.state !== "running", "telemetry_record_not_final");
  if (record.state === "completed") {
    requireCondition(record.sourceShaAfter === options.expectedSourceSha, "telemetry_record_source_mismatch");
    requireCondition(record.processGroup?.quiescent === true, "telemetry_record_process_group_not_quiescent");
  } else {
    requireCondition(record.code === "telemetry_postflight_failed", "telemetry_record_state_invalid");
  }
  requireCondition(record.commandBundleSha256 === options.expectedBundleSha256, "telemetry_record_bundle_mismatch");
  requireCondition(record.sourceShaBefore === options.expectedSourceSha, "telemetry_record_source_mismatch");
  requireCondition(record.workflowLeaseId === options.expectedWorkflowLeaseId, "telemetry_record_lease_id_mismatch");
  requireCondition(record.executionRuntime === options.expectedRuntime, "telemetry_record_runtime_mismatch");
  requireCondition(record.gsdVersion === options.expectedGsdVersion, "telemetry_record_gsd_version_mismatch");
  requireCondition(record.modelProfile === options.expectedModelProfile, "telemetry_record_model_profile_mismatch");
  const sourceShaBefore = resolveSourceSha(scope.projectRoot);
  requireCondition(sourceShaBefore === options.expectedSourceSha, "telemetry_record_live_source_mismatch");
  requireCondition(record.worktreeIdentitySha256 === scope.worktreeIdentitySha256, "telemetry_record_worktree_mismatch");
  requireCondition(record.gitCommonIdentitySha256 === scope.gitCommonIdentitySha256, "telemetry_record_git_common_mismatch");
  const attestation = await verifyWorkflowLeaseSignature({
    projectRoot: scope.projectRoot,
    leaseId: record.workflowLeaseId,
    attestationSha256: record.leaseAttestationSha256,
    payload: recordSignaturePayload(record),
    signature: record.recordSignature,
  }).catch(() => fail("telemetry_record_signature_invalid"));
  requireCondition(attestation.executionRuntime === record.executionRuntime, "telemetry_record_holder_mismatch");
  requireCondition(attestation.gsdVersion === record.gsdVersion, "telemetry_record_holder_mismatch");
  requireCondition(attestation.modelProfile === record.modelProfile, "telemetry_record_holder_mismatch");
  const finalSnapshot = await readRecordSnapshot(target);
  requireCondition(
    finalSnapshot.dev === snapshot.dev &&
      finalSnapshot.ino === snapshot.ino &&
      finalSnapshot.rawSha256 === snapshot.rawSha256,
    "telemetry_record_changed",
  );
  requireCondition(resolveSourceSha(scope.projectRoot) === sourceShaBefore, "telemetry_record_live_source_changed");
  return record;
}

function parseCli(argv) {
  const separator = argv.indexOf("--");
  requireCondition(separator > 0 && separator < argv.length - 1, "telemetry_usage_error");
  const optionArgs = argv.slice(0, separator);
  const command = argv.slice(separator + 1);
  const values = {};
  const artifacts = [];
  const events = [];
  const allowed = new Set(["project-root", "token-file", "runtime", "phase", "command-label", "reasoning-effort", "timeout-seconds", "source-sha", "bundle-sha256", "metrics", "artifact", "event"]);
  for (const arg of optionArgs) {
    const match = arg.match(/^--([^=]+)=(.*)$/s);
    requireCondition(match && allowed.has(match[1]), "telemetry_usage_error");
    if (match[1] === "artifact") artifacts.push(match[2]);
    else if (match[1] === "event") events.push(match[2]);
    else {
      requireCondition(!Object.hasOwn(values, match[1]), "telemetry_usage_error");
      values[match[1]] = match[2];
    }
  }
  for (const key of ["project-root", "token-file", "runtime", "phase", "command-label", "reasoning-effort", "timeout-seconds", "source-sha"]) {
    requireCondition(typeof values[key] === "string" && values[key].length > 0, "telemetry_usage_error");
  }
  requireCondition(/^\d+$/.test(values["timeout-seconds"]), "telemetry_usage_error");
  return { values, artifacts, events, command };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  try {
    const { values, artifacts, events, command } = parseCli(process.argv.slice(2));
    const result = await runInstrumentedWorkflow({
      projectRoot: values["project-root"],
      tokenFile: values["token-file"],
      expectedRuntime: values.runtime,
      phaseId: values.phase,
      commandLabel: values["command-label"],
      reasoningEffort: values["reasoning-effort"],
      timeoutSeconds: Number(values["timeout-seconds"]),
      expectedSourceSha: values["source-sha"],
      expectedBundleSha256: values["bundle-sha256"],
      metricsPath: values.metrics,
      artifacts,
      events,
      command,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode =
      result.status === "pass"
        ? 0
        : result.status === "fail" && result.termination.kind === "exit_code" && result.termination.value !== 0
          ? result.termination.value
          : 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "workflow_telemetry_error",
        code: error instanceof WorkflowTelemetryError ? error.code : error?.code ?? "telemetry_unexpected_error",
      })}\n`,
    );
    process.exitCode = 1;
  }
}
