import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  WorkflowTelemetryError,
  runInstrumentedWorkflow,
  verifyWorkflowTelemetryReceipt,
  verifyWorkflowTelemetryRecord,
  workflowCommandBundleSha256,
} from "../../scripts/workflow/workflow-telemetry.mjs";
import { acquireWorkflowLease } from "../../scripts/workflow/workflow-lease.mjs";

const SOURCE_SHA = "a84370bf0c207b2d3305156ce5baf13c0335f02e";
const RUN_ID = "22222222-2222-4222-8222-222222222222";
const tempDirs = new Set<string>();

async function makeFixture(liveClock = false) {
  const created = await fs.mkdtemp(path.join(os.tmpdir(), "nutrition-workflow-telemetry-"));
  const root = await fs.realpath(created);
  tempDirs.add(root);
  const projectRoot = path.join(root, "project");
  const tokenFile = path.join(root, "private", "token.json");
  await fs.mkdir(path.join(projectRoot, "phase"), { recursive: true });
  await fs.writeFile(path.join(projectRoot, "phase/1-01-PLAN.md"), "plan bytes\n");
  await fs.writeFile(path.join(projectRoot, "phase/1-01-SUMMARY.md"), "summary bytes\n");
  execFileSync("git", ["init", "-b", "main"], { cwd: projectRoot, stdio: "ignore" });
  execFileSync("git", ["config", "commit.gpgsign", "false"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.email", "workflow-test@example.invalid"], { cwd: projectRoot });
  execFileSync("git", ["config", "user.name", "Workflow Test"], { cwd: projectRoot });
  execFileSync("git", ["add", "."], { cwd: projectRoot });
  execFileSync("git", ["commit", "-m", "fixture"], { cwd: projectRoot, stdio: "ignore" });
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
  const commonDir = path.join(projectRoot, ".git");
  const lease = await acquireWorkflowLease({
    projectRoot,
    commonDir,
    tokenFile,
    executionRuntime: "codex",
    gsdVersion: "1.7.0",
    modelProfile: "sol-high",
    ttlSeconds: liveClock ? 3600 : 600,
    now: liveClock ? new Date() : new Date("2026-07-15T00:00:00Z"),
  });
  return { root, projectRoot, commonDir, tokenFile, sourceSha, leaseId: lease.leaseId };
}

function base(fixture: Awaited<ReturnType<typeof makeFixture>>) {
  return {
    projectRoot: fixture.projectRoot,
    tokenFile: fixture.tokenFile,
    expectedRuntime: "codex",
    phaseId: "synthetic-1",
    commandLabel: "maintenance_check",
    reasoningEffort: "high",
    timeoutSeconds: 30,
    expectedSourceSha: fixture.sourceSha,
    artifacts: ["phase/1-01-PLAN.md", "phase/1-01-SUMMARY.md"],
    events: ["retry", "repair", "retry"],
    command: [process.execPath, "-e", "process.exit(0)", "cookie=session-secret"],
    now: new Date("2026-07-15T00:01:00Z"),
    finishNow: new Date("2026-07-15T00:01:01Z"),
  };
}

afterEach(async () => {
  for (const root of tempDirs) await fs.rm(root, { recursive: true, force: true });
  tempDirs.clear();
});

describe("privacy-safe workflow telemetry", () => {
  it("records measured metadata and unavailable-null metrics without argv, paths, output, or secrets", async () => {
    const fixture = await makeFixture();
    const options = { ...base(fixture), runId: RUN_ID };
    const bundleSha256 = workflowCommandBundleSha256(options);
    const receipt = await runInstrumentedWorkflow(options);
    assert.equal(receipt.status, "limited_observation");
    assert.equal(receipt.code, "telemetry_containment_limited");
    assert.equal(receipt.pilotEligible, false);
    assert.equal(receipt.telemetryCommitted, true);
    const recordPath = path.join(fixture.commonDir, "nutrition-workflow/telemetry", `synthetic-1-${RUN_ID}.json`);
    const raw = await fs.readFile(recordPath, "utf8");
    const record = JSON.parse(raw);
    assert.equal(record.state, "completed");
    assert.equal(record.authorizationProfile, "signed_exact_bundle");
    assert.equal(record.commandBundleSha256, bundleSha256);
    assert.match(record.recordSignature, /^[A-Za-z0-9_-]+$/);
    assert.match(receipt.receiptSignature as string, /^[A-Za-z0-9_-]+$/);
    assert.equal(record.sourceShaBefore, fixture.sourceSha);
    assert.equal(record.sourceShaAfter, fixture.sourceSha);
    assert.match(record.worktreeIdentitySha256, /^[0-9a-f]{64}$/);
    assert.match(record.gitCommonIdentitySha256, /^[0-9a-f]{64}$/);
    assert.equal(receipt.worktreeIdentitySha256, record.worktreeIdentitySha256);
    assert.equal(receipt.gitCommonIdentitySha256, record.gitCommonIdentitySha256);
    assert.deepEqual(record.declaredEvents, { retry: 2, replan: 0, repair: 1 });
    assert.deepEqual(record.metrics.toolCallCount, {
      availability: "unavailable",
      sourceClaim: null,
      attribution: null,
      value: null,
      routingEvidenceEligible: false,
    });
    assert.equal(record.measuredBefore.declaredArtifactCount, 2);
    assert.ok(record.measuredAfter.artifactBytes > record.measuredAfter.planBytes);
    assert.equal((await fs.stat(recordPath)).mode & 0o777, 0o600);
    assert.doesNotMatch(raw, /cookie=session-secret|process\.exit|phase\/1-01|holder-token|prompt|transcript|argv/);
    assert.doesNotMatch(raw, new RegExp(fixture.root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    await verifyWorkflowTelemetryRecord({
      projectRoot: fixture.projectRoot,
      recordPath,
      expectedSourceSha: fixture.sourceSha,
      expectedRunId: RUN_ID,
      expectedPhaseId: "synthetic-1",
      expectedState: "completed",
      expectedChildOutcome: "pass",
      expectedBundleSha256: bundleSha256,
      expectedWorkflowLeaseId: fixture.leaseId,
      expectedRuntime: "codex",
      expectedGsdVersion: "1.7.0",
      expectedModelProfile: "sol-high",
    });
    await verifyWorkflowTelemetryReceipt({
      projectRoot: fixture.projectRoot,
      receipt,
      expectedSourceSha: fixture.sourceSha,
      expectedRunId: RUN_ID,
      expectedPhaseId: "synthetic-1",
      expectedStatus: "limited_observation",
      expectedChildOutcome: "pass",
      expectedBundleSha256: bundleSha256,
      expectedRuntime: "codex",
      expectedGsdVersion: "1.7.0",
      expectedModelProfile: "sol-high",
      expectedWorkflowLeaseId: fixture.leaseId,
    });
    await assert.rejects(
      verifyWorkflowTelemetryReceipt({
        projectRoot: fixture.projectRoot,
        receipt,
        expectedSourceSha: fixture.sourceSha,
        expectedRunId: "33333333-3333-4333-8333-333333333333",
        expectedPhaseId: "synthetic-1",
        expectedStatus: "limited_observation",
        expectedChildOutcome: "pass",
        expectedBundleSha256: bundleSha256,
        expectedRuntime: "codex",
        expectedGsdVersion: "1.7.0",
        expectedModelProfile: "sol-high",
        expectedWorkflowLeaseId: fixture.leaseId,
      }),
      (error: unknown) =>
        error instanceof WorkflowTelemetryError && error.code === "telemetry_receipt_run_id_mismatch",
    );
    const copiedRecord = path.join(fixture.root, "copied-record.json");
    await fs.copyFile(recordPath, copiedRecord);
    await assert.rejects(
      verifyWorkflowTelemetryRecord({
        projectRoot: fixture.projectRoot,
        recordPath: copiedRecord,
        expectedSourceSha: fixture.sourceSha,
        expectedRunId: RUN_ID,
        expectedPhaseId: "synthetic-1",
        expectedState: "completed",
        expectedChildOutcome: "pass",
        expectedBundleSha256: bundleSha256,
        expectedWorkflowLeaseId: fixture.leaseId,
        expectedRuntime: "codex",
        expectedGsdVersion: "1.7.0",
        expectedModelProfile: "sol-high",
      }),
      (error: unknown) =>
        error instanceof WorkflowTelemetryError && error.code === "telemetry_record_path_mismatch",
    );
  });

  it("rejects an authenticated running record as final evidence before the child starts", async () => {
    const fixture = await makeFixture();
    const options = { ...base(fixture), runId: RUN_ID };
    const bundleSha256 = workflowCommandBundleSha256(options);
    let runningRejected = false;
    const receipt = await runInstrumentedWorkflow({
      ...options,
      testHook: async (stage: string, recordPath: string) => {
        if (stage !== "after_running_record_publication") return;
        await assert.rejects(
          verifyWorkflowTelemetryRecord({
            projectRoot: fixture.projectRoot,
            recordPath,
            expectedSourceSha: fixture.sourceSha,
            expectedRunId: RUN_ID,
            expectedPhaseId: "synthetic-1",
            expectedState: "completed",
            expectedChildOutcome: "pass",
            expectedBundleSha256: bundleSha256,
            expectedWorkflowLeaseId: fixture.leaseId,
            expectedRuntime: "codex",
            expectedGsdVersion: "1.7.0",
            expectedModelProfile: "sol-high",
          }),
          (error: unknown) =>
            error instanceof WorkflowTelemetryError && error.code === "telemetry_record_state_mismatch",
        );
        runningRejected = true;
      },
    });
    assert.equal(runningRejected, true);
    assert.equal(receipt.status, "limited_observation");
  });

  it("labels exact-schema caller metrics as non-attributed and ineligible for routing evidence", async () => {
    const fixture = await makeFixture();
    const metricsPath = path.join(fixture.root, "metrics.json");
    await fs.writeFile(
      metricsPath,
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "workflow_runtime_metrics",
        source: "codex_usage_api",
        agentSessionCount: 2,
        toolCallCount: 17,
        inputTokens: 1234,
        outputTokens: 456,
      })}\n`,
      { mode: 0o600 },
    );
    await runInstrumentedWorkflow({ ...base(fixture), metricsPath, runId: RUN_ID });
    const record = JSON.parse(
      await fs.readFile(path.join(fixture.commonDir, "nutrition-workflow/telemetry", `synthetic-1-${RUN_ID}.json`), "utf8"),
    );
    assert.deepEqual(record.metrics.inputTokens, {
      availability: "caller_declared",
      sourceClaim: "codex_usage_api",
      attribution: "not_run_delta_verified",
      value: 1234,
      routingEvidenceEligible: false,
    });
    assert.equal(record.metrics.toolCallCount.value, 17);
  });

  it("rejects unknown secret-shaped metrics, symlinks, and counter overflow before running the child", async () => {
    const fixture = await makeFixture();
    const marker = path.join(fixture.root, "child-ran");
    const invalid = path.join(fixture.root, "invalid-metrics.json");
    await fs.writeFile(
      invalid,
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "workflow_runtime_metrics",
        source: "codex_usage_api",
        agentSessionCount: 1,
        toolCallCount: 1,
        inputTokens: 1,
        outputTokens: 1,
        prompt: "secret",
      })}\n`,
    );
    await assert.rejects(
      runInstrumentedWorkflow({
        ...base(fixture),
        metricsPath: invalid,
        command: [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
      }),
      (error: unknown) => error instanceof WorkflowTelemetryError && error.code === "telemetry_metrics_unknown_or_missing_field",
    );
    await assert.rejects(fs.access(marker));

    const overflow = JSON.parse(await fs.readFile(invalid, "utf8"));
    delete overflow.prompt;
    overflow.inputTokens = 1_000_000_001;
    await fs.writeFile(invalid, `${JSON.stringify(overflow)}\n`);
    await assert.rejects(
      runInstrumentedWorkflow({ ...base(fixture), metricsPath: invalid }),
      (error: unknown) => error instanceof WorkflowTelemetryError && error.code === "telemetry_counter_invalid",
    );

    const target = path.join(fixture.root, "target-metrics.json");
    await fs.rename(invalid, target);
    await fs.symlink(target, invalid);
    await assert.rejects(
      runInstrumentedWorkflow({ ...base(fixture), metricsPath: invalid }),
      (error: unknown) => error instanceof WorkflowTelemetryError && error.code === "telemetry_metrics_file_unsafe",
    );
  });

  it("uses immutable run IDs so a collision fails before a second child executes", async () => {
    const fixture = await makeFixture();
    await runInstrumentedWorkflow({ ...base(fixture), runId: RUN_ID });
    const marker = path.join(fixture.root, "collision-child-ran");
    await assert.rejects(
      runInstrumentedWorkflow({
        ...base(fixture),
        runId: RUN_ID,
        command: [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
      }),
      (error: unknown) => error instanceof WorkflowTelemetryError && error.code === "telemetry_record_exists",
    );
    await assert.rejects(fs.access(marker));
  });

  it("records exact non-zero child termination without capturing child output", async () => {
    const fixture = await makeFixture();
    const receipt = await runInstrumentedWorkflow({
      ...base(fixture),
      runId: RUN_ID,
      command: [process.execPath, "-e", "process.stderr.write('private output'); process.exit(23)"],
    });
    assert.equal(receipt.status, "fail");
    assert.deepEqual(receipt.termination, { kind: "exit_code", value: 23 });
    const raw = await fs.readFile(
      path.join(fixture.commonDir, "nutrition-workflow/telemetry", `synthetic-1-${RUN_ID}.json`),
      "utf8",
    );
    assert.doesNotMatch(raw, /private output/);
  });

  it("fails the wrapper when the child outcome passes but the completed record cannot commit", async () => {
    const fixture = await makeFixture();
    const recordPath = path.join(fixture.commonDir, "nutrition-workflow/telemetry", `synthetic-1-${RUN_ID}.json`);
    const receipt = await runInstrumentedWorkflow({
      ...base(fixture),
      runId: RUN_ID,
      command: [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(recordPath)}, 'tampered')`],
    });
    assert.equal(receipt.childOutcome, "pass");
    assert.equal(receipt.status, "needs_reconciliation");
    assert.equal(receipt.telemetryCommitted, false);
    assert.equal(receipt.code, "telemetry_commit_failed");
    assert.equal(await fs.readFile(recordPath, "utf8"), "tampered");
  });

  it("returns signed reconciliation when the published record changes before final recheck", async () => {
    const fixture = await makeFixture();
    const receipt = await runInstrumentedWorkflow({
      ...base(fixture),
      runId: RUN_ID,
      testHook: async (stage: string, recordPath: string) => {
        if (stage === "after_record_publication") await fs.appendFile(recordPath, " ");
      },
    });
    assert.equal(receipt.status, "needs_reconciliation");
    assert.equal(receipt.telemetryCommitted, true);
    assert.equal(receipt.publicationVerified, false);
    assert.equal(receipt.postflightCode, "telemetry_record_changed_after_publication");
    assert.match(receipt.receiptSignature as string, /^[A-Za-z0-9_-]+$/);
  });

  it("rejects a metrics source claim that does not match the lease runtime", async () => {
    const fixture = await makeFixture();
    const metricsPath = path.join(fixture.root, "claude-metrics.json");
    await fs.writeFile(
      metricsPath,
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "workflow_runtime_metrics",
        source: "claude_usage_api",
        agentSessionCount: 1,
        toolCallCount: 1,
        inputTokens: 1,
        outputTokens: 1,
      })}\n`,
    );
    await assert.rejects(
      runInstrumentedWorkflow({ ...base(fixture), metricsPath }),
      (error: unknown) => error instanceof WorkflowTelemetryError && error.code === "telemetry_metrics_runtime_mismatch",
    );
  });

  it("measures declared artifacts both before and after the bounded child", async () => {
    const fixture = await makeFixture();
    const createdArtifact = path.join(fixture.projectRoot, "phase/2-01-PLAN.md");
    const receipt = await runInstrumentedWorkflow({
      ...base(fixture),
      runId: RUN_ID,
      artifacts: ["phase/2-01-PLAN.md"],
      command: [
        process.execPath,
        "-e",
        `require('node:fs').writeFileSync(${JSON.stringify(createdArtifact)}, 'new plan')`,
      ],
    });
    assert.equal(receipt.status, "limited_observation");
    const record = JSON.parse(
      await fs.readFile(
        path.join(fixture.commonDir, "nutrition-workflow/telemetry", `synthetic-1-${RUN_ID}.json`),
        "utf8",
      ),
    );
    assert.equal(record.measuredBefore.missingArtifactCount, 1);
    assert.equal(record.measuredAfter.missingArtifactCount, 0);
    assert.ok(record.measuredAfter.planBytes > 0);
    assert.doesNotMatch(JSON.stringify(record), /phase\/2-01-PLAN|nutrition-workflow-telemetry/);
  });

  it("enforces a bounded child timeout and records the process-level timeout", async () => {
    const fixture = await makeFixture();
    const lateMarker = path.join(fixture.root, "grandchild-survived-timeout");
    const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(lateMarker)}, 'late'), 1800); setInterval(() => {}, 1000)`;
    const receipt = await runInstrumentedWorkflow({
      ...base(fixture),
      runId: RUN_ID,
      timeoutSeconds: 1,
      command: [
        process.execPath,
        "-e",
        `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }); setInterval(() => {}, 1000)`,
      ],
    });
    assert.equal(receipt.status, "fail");
    assert.equal(receipt.childOutcome, "fail");
    assert.deepEqual(receipt.termination, { kind: "timeout", value: 1 });
    assert.equal(receipt.telemetryCommitted, true);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    await assert.rejects(fs.access(lateMarker));
    const record = JSON.parse(
      await fs.readFile(path.join(fixture.commonDir, "nutrition-workflow/telemetry", `synthetic-1-${RUN_ID}.json`), "utf8"),
    );
    assert.deepEqual(record.processGroup, {
      isolation: "posix_process_group_limited",
      scope: "original_process_group_only",
      registered: true,
      descendantLeakDetected: false,
      quiescent: true,
      pilotEligible: false,
    });
  });

  it("fails and kills a background descendant even when the direct child exits zero", async () => {
    const fixture = await makeFixture();
    const lateMarker = path.join(fixture.root, "grandchild-survived-clean-exit");
    const grandchild = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(lateMarker)}, 'late'), 1200); setInterval(() => {}, 1000)`;
    const receipt = await runInstrumentedWorkflow({
      ...base(fixture),
      runId: RUN_ID,
      command: [
        process.execPath,
        "-e",
        `const child = require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], { stdio: 'ignore' }); child.unref()`,
      ],
    });
    assert.equal(receipt.status, "fail");
    assert.equal(receipt.childOutcome, "fail");
    assert.equal(receipt.code, "telemetry_descendant_process_leak");
    await new Promise((resolve) => setTimeout(resolve, 1300));
    await assert.rejects(fs.access(lateMarker));
  });

  it("commits a safe reconciliation record when post-child artifact measurement fails", async () => {
    const fixture = await makeFixture();
    const outside = path.join(fixture.root, "postflight-outside");
    await fs.mkdir(outside);
    const phase = path.join(fixture.projectRoot, "phase");
    const receipt = await runInstrumentedWorkflow({
      ...base(fixture),
      runId: RUN_ID,
      command: [
        process.execPath,
        "-e",
        `const fs = require('node:fs'); fs.rmSync(${JSON.stringify(phase)}, { recursive: true }); fs.symlinkSync(${JSON.stringify(outside)}, ${JSON.stringify(phase)})`,
      ],
    });
    assert.equal(receipt.status, "needs_reconciliation");
    assert.equal(receipt.childOutcome, "pass");
    assert.equal(receipt.telemetryCommitted, true);
    assert.equal(receipt.code, "telemetry_postflight_failed");
    assert.equal(receipt.postflightCode, "telemetry_artifact_path_unsafe");
    assert.equal(receipt.cleanupRequired, true);
    const record = JSON.parse(
      await fs.readFile(path.join(fixture.commonDir, "nutrition-workflow/telemetry", `synthetic-1-${RUN_ID}.json`), "utf8"),
    );
    assert.equal(record.state, "needs_reconciliation");
    assert.equal(record.postflightCode, "telemetry_artifact_path_unsafe");
    assert.equal(Object.hasOwn(record, "measuredAfter"), false);
  });

  it("rejects a symlinked artifact parent before the child executes", async () => {
    const fixture = await makeFixture();
    const outside = path.join(fixture.root, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "9-01-PLAN.md"), "outside");
    await fs.symlink(outside, path.join(fixture.projectRoot, "linked"));
    const marker = path.join(fixture.root, "unsafe-child-ran");
    await assert.rejects(
      runInstrumentedWorkflow({
        ...base(fixture),
        artifacts: ["linked/9-01-PLAN.md"],
        command: [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
      }),
      (error: unknown) => error instanceof WorkflowTelemetryError && error.code === "telemetry_artifact_path_unsafe",
    );
    await assert.rejects(fs.access(marker));
  });

  it("reserves CLI stdout for one structured receipt and ignores child output", async () => {
    const fixture = await makeFixture(true);
    const script = path.resolve("scripts/workflow/workflow-telemetry.mjs");
    const child = spawnSync(
      process.execPath,
      [
        script,
        `--project-root=${fixture.projectRoot}`,
        `--token-file=${fixture.tokenFile}`,
        "--runtime=codex",
        "--phase=cli-1",
        "--command-label=maintenance_check",
        "--reasoning-effort=high",
        "--timeout-seconds=30",
        `--source-sha=${fixture.sourceSha}`,
        "--",
        process.execPath,
        "-e",
        "process.stdout.write('private child stdout'); process.stderr.write('private child stderr')",
      ],
      { encoding: "utf8" },
    );
    assert.equal(child.status, 1, child.stderr);
    const receipt = JSON.parse(child.stdout);
    assert.equal(receipt.status, "limited_observation");
    assert.doesNotMatch(child.stdout, /private child/);
    assert.equal(child.stderr, "");
  });

  it("rejects the legacy caller source override before running a child", async () => {
    const fixture = await makeFixture();
    const marker = path.join(fixture.root, "legacy-source-child-ran");
    await assert.rejects(
      runInstrumentedWorkflow({
        ...base(fixture),
        runId: RUN_ID,
        sourceSha: SOURCE_SHA,
        command: [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`],
      }),
      (error: unknown) =>
        error instanceof WorkflowTelemetryError && error.code === "telemetry_legacy_source_override_rejected",
    );
    await assert.rejects(fs.access(marker));
  });

  it("rejects caller-selected or nested project namespaces before spawning", async () => {
    const fixture = await makeFixture();
    const marker = path.join(fixture.root, "scope-child-ran");
    const command = [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`];
    await assert.rejects(
      runInstrumentedWorkflow({ ...base(fixture), commonDir: fixture.commonDir, command }),
      (error: unknown) =>
        error instanceof WorkflowTelemetryError && error.code === "telemetry_common_dir_override_rejected",
    );
    await assert.rejects(
      runInstrumentedWorkflow({ ...base(fixture), projectRoot: path.join(fixture.projectRoot, "phase"), command }),
      (error: unknown) => (error as Error & { code?: string }).code === "workflow_project_git_scope_invalid",
    );
    await assert.rejects(fs.access(marker));
  });

  it("rejects pilot execution and a wrong approved source before spawning", async () => {
    const fixture = await makeFixture();
    const marker = path.join(fixture.root, "blocked-child-ran");
    const command = [process.execPath, "-e", `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ran')`];
    await assert.rejects(
      runInstrumentedWorkflow({ ...base(fixture), commandLabel: "pilot", command }),
      (error: unknown) =>
        error instanceof WorkflowTelemetryError && error.code === "telemetry_pilot_containment_unavailable",
    );
    await assert.rejects(
      runInstrumentedWorkflow({ ...base(fixture), commandLabel: "verify", command }),
      (error: unknown) =>
        error instanceof WorkflowTelemetryError && error.code === "telemetry_command_label_invalid",
    );
    await assert.rejects(
      runInstrumentedWorkflow({ ...base(fixture), expectedBundleSha256: "0".repeat(64), command }),
      (error: unknown) =>
        error instanceof WorkflowTelemetryError && error.code === "telemetry_command_bundle_mismatch",
    );
    await assert.rejects(
      runInstrumentedWorkflow({ ...base(fixture), expectedSourceSha: "f".repeat(40), command }),
      (error: unknown) => error instanceof WorkflowTelemetryError && error.code === "telemetry_source_sha_mismatch",
    );
    await assert.rejects(fs.access(marker));
  });

  it("records needs-reconciliation when the child moves Git HEAD", async () => {
    const fixture = await makeFixture();
    const receipt = await runInstrumentedWorkflow({
      ...base(fixture),
      runId: RUN_ID,
      command: [
        process.execPath,
        "-e",
        "const fs=require('node:fs'); const cp=require('node:child_process'); fs.writeFileSync('head-drift.txt','drift\\n'); cp.execFileSync('git',['add','head-drift.txt']); cp.execFileSync('git',['commit','-m','head drift'],{stdio:'ignore'})",
      ],
    });
    assert.equal(receipt.status, "needs_reconciliation");
    assert.equal(receipt.postflightCode, "telemetry_source_sha_changed");
    const record = JSON.parse(
      await fs.readFile(path.join(fixture.commonDir, "nutrition-workflow/telemetry", `synthetic-1-${RUN_ID}.json`), "utf8"),
    );
    assert.equal(record.state, "needs_reconciliation");
    assert.notEqual(record.sourceShaAfterObserved, fixture.sourceSha);
  });

  it("never upgrades process-group-only observation to pass when a detached session can escape", async () => {
    const fixture = await makeFixture();
    const marker = path.join(fixture.root, "detached-session-escaped");
    const escaped = `setTimeout(() => require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'escaped'), 500)`;
    const receipt = await runInstrumentedWorkflow({
      ...base(fixture),
      runId: RUN_ID,
      command: [
        process.execPath,
        "-e",
        `const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(escaped)}],{detached:true,stdio:'ignore'}); child.unref()`,
      ],
    });
    assert.equal(receipt.status, "limited_observation");
    assert.equal(receipt.pilotEligible, false);
    assert.equal(receipt.routingEvidenceEligible, false);
    await new Promise((resolve) => setTimeout(resolve, 750));
    assert.equal(await fs.readFile(marker, "utf8"), "escaped");
  });
});
