process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  CommandReceiptError,
  classifySpawnTermination,
  publishFailedCommandReceipt,
  publishPassedCommandReceipt,
  reserveCommandReceiptPath,
  resolveCommandReceiptPathOutsideProject,
  stableCommandWorkspaceFingerprint,
  verifyCommandReceipt,
} from "../../scripts/workflow/command-receipt.mjs";
import { acquireWorkflowLease } from "../../scripts/workflow/workflow-lease.mjs";

const SOURCE_SHA = "a84370bf0c207b2d3305156ce5baf13c0335f02e";
const RUN_ID = "11111111-1111-4111-8111-111111111111";
const WORKSPACE_SHA = "b".repeat(64);
const RECEIPT_BINDING = {
  runId: RUN_ID,
  workspaceBeforeSha256: WORKSPACE_SHA,
  workspaceAfterSha256: WORKSPACE_SHA,
} as const;
const tempDirs = new Set<string>();

async function tempDir() {
  const directory = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), "nutrition-command-receipt-")));
  tempDirs.add(directory);
  return directory;
}

function loggedReceipt(output: string) {
  const prefix = "[release-check] Receipt: ";
  const line = output.split(/\r?\n/).find((value) => value.startsWith(prefix));
  assert.ok(line, output);
  return JSON.parse(line.slice(prefix.length));
}

async function makeSignedFixture() {
  const container = await tempDir();
  const projectRoot = path.join(container, "project");
  await fs.mkdir(projectRoot);
  await fs.writeFile(path.join(projectRoot, "fixture.txt"), "fixture\n");
  for (const args of [
    ["init", "-b", "main"],
    ["config", "user.email", "workflow-test@example.invalid"],
    ["config", "user.name", "Workflow Test"],
    ["add", "."],
    ["commit", "-m", "fixture"],
  ]) {
    const result = spawnSync("git", args, { cwd: projectRoot, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
  }
  const sourceSha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).stdout.trim();
  const tokenFile = path.join(container, "private", "token.json");
  const lease = await acquireWorkflowLease({
    projectRoot,
    tokenFile,
    executionRuntime: "codex",
    gsdVersion: "1.7.0",
    modelProfile: "sol-high",
    ttlSeconds: 600,
  });
  const workspaceSha256 = stableCommandWorkspaceFingerprint(projectRoot);
  return {
    container,
    projectRoot,
    tokenFile,
    lease,
    sourceSha,
    workspaceSha256,
    authority: { projectRoot, tokenFile, expectedRuntime: "codex" },
  };
}

async function makeFakeYarn(directory: string) {
  const fake = path.join(directory, "yarn");
  await fs.writeFile(
    fake,
    `#!/bin/sh
printf '%s\\n' "$1" >> "$FAKE_YARN_LOG"
if [ -n "$FAKE_YARN_MUTATE" ] && [ "$1" = "tsc" ]; then
  printf '%s\\n' 'changed during gates' > "$FAKE_YARN_MUTATE"
fi
if [ -n "$FAKE_YARN_SLEEP" ] && [ "$1" = "tsc" ]; then
  if [ -n "$FAKE_YARN_IGNORE_SIGTERM" ]; then
    trap '' TERM
  fi
  sleep "$FAKE_YARN_SLEEP"
fi
if [ -n "$FAKE_YARN_LEAK_PID" ] && [ "$1" = "tsc" ]; then
  (trap '' TERM; sleep 30) &
  printf '%s\n' "$!" > "$FAKE_YARN_LEAK_PID"
  exit 0
fi
if [ "$1" = "$FAKE_YARN_FAIL" ]; then
  printf '%s\\n' 'active timeout keeps the current day open' 'cookie=session-secret' >&2
  exit 17
fi
exit 0
`,
    { mode: 0o700 },
  );
  await fs.chmod(fake, 0o700);
  return fake;
}

afterEach(async () => {
  for (const directory of tempDirs) {
    await fs.rm(directory, { recursive: true, force: true });
  }
  tempDirs.clear();
});

describe("structured command receipts", () => {
  it("uses process termination identity and never guesses timeout from command output", async () => {
    const rawOutput = [
      "active timeout keeps the current day open",
      "not ok 42 - unrelated assertion",
      "cookie=session-secret",
      "/private/workspace/database.sqlite",
    ].join("\n");
    const result = { status: 1, signal: null, stdout: rawOutput, stderr: rawOutput };
    const receipt = await publishFailedCommandReceipt({
      commandId: "release-check",
      ...RECEIPT_BINDING,
      sourceSha: SOURCE_SHA,
      gate: "full_test_suite",
      result,
      rawOutput,
      cwd: "/private/workspace",
      env: { COOKIE: "session-secret" },
      now: new Date("2026-07-15T06:00:00.000Z"),
    });

    assert.deepEqual(receipt, {
      schemaVersion: 1,
      kind: "workflow_command_receipt",
      commandId: "release-check",
      runId: RUN_ID,
      sourceSha: SOURCE_SHA,
      workspaceBeforeSha256: WORKSPACE_SHA,
      workspaceAfterSha256: WORKSPACE_SHA,
      workspaceStable: true,
      gate: "full_test_suite",
      outcome: "failed",
      termination: { kind: "exit_code", value: 1 },
      sanitizedCode: "test_unclassified_failure",
      observedAt: "2026-07-15T14:00:00.000+08:00",
    });
    const serialized = JSON.stringify(receipt);
    assert.doesNotMatch(serialized, /timeout_or_cancelled|not ok|session-secret|private\/workspace|database\.sqlite/);
  });

  it("classifies real timeout and signal metadata without reading text", () => {
    assert.deepEqual(classifySpawnTermination({ error: { code: "ETIMEDOUT" }, status: null, signal: "SIGTERM" }), {
      kind: "timeout",
      value: "TIMEOUT",
    });
    assert.deepEqual(classifySpawnTermination({ status: null, signal: "SIGTERM" }), {
      kind: "signal",
      value: "SIGTERM",
    });
    assert.deepEqual(classifySpawnTermination({ status: null, signal: "SIGXCPU" }), {
      kind: "signal",
      value: "SIGXCPU",
    });
    assert.deepEqual(classifySpawnTermination({ status: null, signal: "SIGUNLISTED" }), {
      kind: "signal",
      value: "SIGNAL_OTHER",
    });
  });

  it("keeps unsigned classification in memory and rejects every unsigned persistence request", async () => {
    const directory = await tempDir();
    const receiptPath = path.join(directory, "receipt.json");
    const options = {
      commandId: "release-check",
      ...RECEIPT_BINDING,
      sourceSha: SOURCE_SHA,
      gate: "typescript_gate",
      result: { status: 2, signal: null },
      now: new Date("2026-07-15T06:05:00.000Z"),
    };
    const receipt = await publishFailedCommandReceipt(options);
    assert.equal(receipt.schemaVersion, 1);
    await assert.rejects(
      publishFailedCommandReceipt({ ...options, receiptPath, reservation: {} }),
      (error: unknown) => error instanceof CommandReceiptError && error.code === "receipt_signing_authority_required",
    );
    await assert.rejects(
      reserveCommandReceiptPath(receiptPath, {
        commandId: "release-check",
        runId: RUN_ID,
        sourceSha: SOURCE_SHA,
        workspaceBeforeSha256: WORKSPACE_SHA,
      }),
      (error: unknown) => error instanceof CommandReceiptError && error.code === "receipt_signing_authority_required",
    );
    await assert.rejects(fs.access(receiptPath));
    await makeFakeYarn(directory);
    const childLog = path.join(directory, "unsigned-child.log");
    const cli = spawnSync(
      process.execPath,
      ["scripts/release-check.mjs", "--base=HEAD", `--receipt=${receiptPath}`],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TZ: "Asia/Taipei",
          PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
          FAKE_YARN_FAIL: "never",
          FAKE_YARN_LOG: childLog,
        },
        encoding: "utf8",
      },
    );
    assert.equal(cli.status, 2, `${cli.stdout}${cli.stderr}`);
    assert.match(cli.stderr, /--receipt requires both --workflow-token and --workflow-runtime/);
    await assert.rejects(fs.access(receiptPath));
    await assert.rejects(fs.access(childLog));
  });

  it("checks every existing ancestor before creating a missing receipt directory", async () => {
    const fixture = await makeSignedFixture();
    const physical = path.join(fixture.container, "physical");
    const linked = path.join(fixture.container, "linked");
    await fs.mkdir(physical);
    await fs.symlink(physical, linked);
    await assert.rejects(
      reserveCommandReceiptPath(path.join(linked, "missing", "receipt.json"), {
        commandId: "release-check",
        runId: RUN_ID,
        sourceSha: fixture.sourceSha,
        workspaceBeforeSha256: WORKSPACE_SHA,
        ...fixture.authority,
      }),
      (error: unknown) => error instanceof CommandReceiptError && error.code === "receipt_parent_unsafe",
    );
    await assert.rejects(fs.access(path.join(physical, "missing")));
  });

  it("never publishes full release evidence from dry-run and still records a real timezone failure", async () => {
    const directory = await tempDir();
    const forbiddenPath = path.join(directory, "dry-run.json");
    const rejected = spawnSync(
      process.execPath,
      ["scripts/release-check.mjs", "--dry-run", "--base=HEAD", `--receipt=${forbiddenPath}`],
      { cwd: process.cwd(), env: { ...process.env, TZ: "Asia/Taipei" }, encoding: "utf8" },
    );
    assert.equal(rejected.status, 2, `${rejected.stdout}${rejected.stderr}`);
    await assert.rejects(fs.access(forbiddenPath));
    assert.doesNotMatch(`${rejected.stdout}${rejected.stderr}`, /release_check_passed/);

    const dryRun = spawnSync(process.execPath, ["scripts/release-check.mjs", "--dry-run", "--base=HEAD"], {
      cwd: process.cwd(),
      env: { ...process.env, TZ: "Asia/Taipei" },
      encoding: "utf8",
    });
    assert.equal(dryRun.status, 0, `${dryRun.stdout}${dryRun.stderr}`);

    const failure = spawnSync(
      process.execPath,
      ["scripts/release-check.mjs", "--base=HEAD"],
      { cwd: process.cwd(), env: { ...process.env, TZ: "UTC" }, encoding: "utf8" },
    );
    assert.equal(failure.status, 1, `${failure.stdout}${failure.stderr}`);
    const failureReceipt = loggedReceipt(failure.stderr);
    assert.equal(failureReceipt.schemaVersion, 1);
    assert.equal(failureReceipt.gate, "timezone_contract");
    assert.equal(failureReceipt.outcome, "failed");
    assert.equal(failureReceipt.sanitizedCode, "timezone_contract_failed");
    assert.match(failureReceipt.runId, /^[0-9a-f-]{36}$/);
    assert.equal(failureReceipt.workspaceStable, true);
  });

  it("binds each real release-check child failure to the first failing gate and stops later gates", async () => {
    const directory = await tempDir();
    await makeFakeYarn(directory);
    const cases = [
      { command: "tsc", gate: "typescript_gate", sanitizedCode: "typescript_gate_failed", calls: ["tsc"] },
      { command: "test", gate: "full_test_suite", sanitizedCode: "test_unclassified_failure", calls: ["tsc", "test"] },
      {
        command: "matrix:gen:check",
        gate: "capability_matrix",
        sanitizedCode: "capability_matrix_failed",
        calls: ["tsc", "test", "matrix:gen:check"],
      },
      {
        command: "behavior-matrix:gen:check",
        gate: "behavior_matrix",
        sanitizedCode: "behavior_matrix_failed",
        calls: ["tsc", "test", "matrix:gen:check", "behavior-matrix:gen:check"],
      },
      {
        command: "build",
        gate: "frontend_build",
        sanitizedCode: "frontend_build_failed",
        calls: ["tsc", "test", "matrix:gen:check", "behavior-matrix:gen:check", "build"],
      },
    ] as const;

    for (const scenario of cases) {
      const logPath = path.join(directory, `${scenario.gate}.log`);
      const result = spawnSync(
        process.execPath,
        ["scripts/release-check.mjs", "--base=HEAD"],
        {
          cwd: process.cwd(),
          env: {
            ...process.env,
            TZ: "Asia/Taipei",
            PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
            FAKE_YARN_FAIL: scenario.command,
            FAKE_YARN_LOG: logPath,
          },
          encoding: "utf8",
        },
      );
      assert.equal(result.status, 17, `${result.stdout}${result.stderr}`);
      assert.deepEqual((await fs.readFile(logPath, "utf8")).trim().split("\n"), scenario.calls);
      const receipt = loggedReceipt(result.stderr);
      assert.equal(receipt.schemaVersion, 1);
      assert.equal(receipt.gate, scenario.gate);
      assert.equal(receipt.sanitizedCode, scenario.sanitizedCode);
      assert.deepEqual(receipt.termination, { kind: "exit_code", value: 17 });
      assert.doesNotMatch(JSON.stringify(receipt), /active timeout|session-secret|timeout_or_cancelled/);
      assert.doesNotMatch(`${result.stdout}${result.stderr}`, /active timeout|session-secret/);
    }
  });

  it("emits a timeout receipt before the outer CI job deadline", async () => {
    const directory = await tempDir();
    await makeFakeYarn(directory);
    const logPath = path.join(directory, "timeout.log");
    // The deadline must leave headroom for the fake-yarn shell to spawn and log
    // on a loaded machine; 500ms raced the child start and flaked with ENOENT.
    const result = spawnSync(process.execPath, ["scripts/release-check.mjs", "--base=HEAD"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TZ: "Asia/Taipei",
        PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_YARN_FAIL: "never",
        FAKE_YARN_LOG: logPath,
        FAKE_YARN_SLEEP: "10",
        NUTRITION_RELEASE_CHECK_DEADLINE_MS: "2000",
      },
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    const receipt = loggedReceipt(result.stderr);
    assert.equal(receipt.gate, "typescript_gate");
    assert.deepEqual(receipt.termination, { kind: "timeout", value: "TIMEOUT" });
    assert.equal(receipt.sanitizedCode, "typescript_gate_failed");
    assert.deepEqual((await fs.readFile(logPath, "utf8")).trim().split("\n"), ["tsc"]);
  });

  it("keeps the timeout failure when a child ignores SIGTERM and then exits zero", async () => {
    const directory = await tempDir();
    await makeFakeYarn(directory);
    const logPath = path.join(directory, "ignore-sigterm.log");
    const result = spawnSync(process.execPath, ["scripts/release-check.mjs", "--base=HEAD"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TZ: "Asia/Taipei",
        PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_YARN_FAIL: "never",
        FAKE_YARN_LOG: logPath,
        FAKE_YARN_SLEEP: "10",
        FAKE_YARN_IGNORE_SIGTERM: "1",
        NUTRITION_RELEASE_CHECK_DEADLINE_MS: "2000",
      },
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    const receipt = loggedReceipt(result.stderr);
    assert.equal(receipt.gate, "typescript_gate");
    assert.deepEqual(receipt.termination, { kind: "timeout", value: "TIMEOUT" });
    assert.equal(receipt.outcome, "failed");
    assert.deepEqual((await fs.readFile(logPath, "utf8")).trim().split("\n"), ["tsc"]);
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /\[release-check\] PASS/);
  });

  it("fails and quiesces the original process group when an exit-zero child leaks a descendant", async () => {
    const directory = await tempDir();
    await makeFakeYarn(directory);
    const logPath = path.join(directory, "descendant-leak.log");
    const pidPath = path.join(directory, "descendant.pid");
    const result = spawnSync(process.execPath, ["scripts/release-check.mjs", "--base=HEAD"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TZ: "Asia/Taipei",
        PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_YARN_FAIL: "never",
        FAKE_YARN_LOG: logPath,
        FAKE_YARN_LEAK_PID: pidPath,
      },
      encoding: "utf8",
      timeout: 8_000,
    });
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    const receipt = loggedReceipt(result.stderr);
    assert.equal(receipt.gate, "typescript_gate");
    assert.deepEqual(receipt.termination, { kind: "process_group_leak", value: "PROCESS_GROUP_LEAK" });
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /\[release-check\] PASS/);
    const leakedPid = Number((await fs.readFile(pidPath, "utf8")).trim());
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.throws(
      () => process.kill(leakedPid, 0),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "ESRCH",
    );
  });

  it("includes postflight in the absolute deadline and prints no PASS before receipt completion", async () => {
    const fixture = await makeSignedFixture();
    await makeFakeYarn(fixture.container);
    const result = spawnSync(process.execPath, [path.resolve("scripts/release-check.mjs"), "--base=HEAD"], {
      cwd: fixture.projectRoot,
      env: {
        ...process.env,
        TZ: "Asia/Taipei",
        PATH: `${fixture.container}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_YARN_FAIL: "never",
        FAKE_YARN_LOG: path.join(fixture.container, "postflight.log"),
        NUTRITION_RELEASE_CHECK_DEADLINE_MS: "3000",
        NUTRITION_RELEASE_CHECK_POSTFLIGHT_DELAY_MS: "3600",
      },
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    const receipt = loggedReceipt(result.stderr);
    assert.equal(receipt.gate, "release_deadline");
    assert.deepEqual(receipt.termination, { kind: "timeout", value: "TIMEOUT" });
    assert.doesNotMatch(`${result.stdout}${result.stderr}`, /\[release-check\] PASS/);
  });

  it("rejects ambient Git routing before resolving scope or spawning a gate child", async () => {
    const directory = await tempDir();
    await makeFakeYarn(directory);
    const childLog = path.join(directory, "ambient-git-child.log");
    const result = spawnSync(process.execPath, ["scripts/release-check.mjs", "--base=HEAD"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        TZ: "Asia/Taipei",
        GIT_DIR: path.join(directory, "foreign.git"),
        PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_YARN_LOG: childLog,
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 2, `${result.stdout}${result.stderr}`);
    assert.match(result.stderr, /ambient Git routing environment is forbidden/);
    await assert.rejects(fs.access(childLog));
  });

  it("pins Git and child execution to the canonical project root from a subdirectory", async () => {
    const fixture = await makeSignedFixture();
    const nested = path.join(fixture.projectRoot, "nested", "invocation");
    await fs.mkdir(nested, { recursive: true });
    await makeFakeYarn(fixture.container);
    const logPath = path.join(fixture.container, "subdirectory.log");
    const result = spawnSync(process.execPath, [path.resolve("scripts/release-check.mjs"), "--base=HEAD"], {
      cwd: nested,
      env: {
        ...process.env,
        TZ: "Asia/Taipei",
        PATH: `${fixture.container}${path.delimiter}${process.env.PATH ?? ""}`,
        FAKE_YARN_FAIL: "never",
        FAKE_YARN_LOG: logPath,
        FAKE_YARN_MUTATE: path.join(fixture.projectRoot, "fixture.txt"),
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
    const receipt = loggedReceipt(result.stderr);
    assert.equal(receipt.gate, "workspace_stability");
    assert.equal(receipt.workspaceStable, false);
    assert.notEqual(receipt.workspaceBeforeSha256, receipt.workspaceAfterSha256);
    assert.deepEqual((await fs.readFile(logPath, "utf8")).trim().split("\n"), [
      "tsc",
      "test",
      "matrix:gen:check",
      "behavior-matrix:gen:check",
      "build",
    ]);
  });

  it("rejects a symlinked receipt ancestor that physically resolves into the checkout", async () => {
    const directory = await tempDir();
    const linked = path.join(directory, "linked-checkout");
    await fs.symlink(process.cwd(), linked);
    const targetName = `.receipt-path-escape-${process.pid}.json`;
    const target = path.join(process.cwd(), targetName);
    await assert.rejects(
      resolveCommandReceiptPathOutsideProject(path.join(linked, targetName), process.cwd()),
      (error: unknown) =>
        error instanceof CommandReceiptError && ["receipt_parent_unsafe", "receipt_path_inside_project"].includes(error.code),
    );
    await assert.rejects(fs.access(target));
  });

  it("rejects Git-common and case-folded physical receipt aliases", async (t) => {
    const fixture = await makeSignedFixture();
    const linkedRoot = path.join(fixture.container, "scope-linked-worktree");
    const linked = spawnSync("git", ["worktree", "add", "-q", "-b", "scope-linked", linkedRoot], {
      cwd: fixture.projectRoot,
      encoding: "utf8",
    });
    assert.equal(linked.status, 0, linked.stderr);
    await assert.rejects(
      resolveCommandReceiptPathOutsideProject(
        path.join(fixture.projectRoot, ".git", "forbidden-receipt.json"),
        linkedRoot,
      ),
      (error: unknown) =>
        error instanceof CommandReceiptError && error.code === "receipt_path_inside_git_common_dir",
    );

    const alias = path.join(
      path.dirname(fixture.projectRoot),
      path.basename(fixture.projectRoot).toUpperCase(),
    );
    const physical = await fs.realpath(alias).catch(() => null);
    if (physical !== fixture.projectRoot) {
      t.diagnostic("case-sensitive filesystem: Git-common assertion completed");
      return;
    }
    await assert.rejects(
      resolveCommandReceiptPathOutsideProject(path.join(alias, "case-receipt.json"), fixture.projectRoot),
      (error: unknown) =>
        error instanceof CommandReceiptError && error.code === "receipt_path_inside_project",
    );
  });

  it("reserves a unique receipt before children and never reuses an old green receipt for a new run", async () => {
    const fixture = await makeSignedFixture();
    const receiptPath = path.join(fixture.container, "receipts", "single-use.json");
    const reserve = () =>
      reserveCommandReceiptPath(receiptPath, {
        commandId: "release-check",
        runId: RUN_ID,
        sourceSha: fixture.sourceSha,
        workspaceBeforeSha256: WORKSPACE_SHA,
        ...fixture.authority,
      });
    const original = await reserve();
    await assert.rejects(
      reserve(),
      (error: unknown) => error instanceof CommandReceiptError && error.code === "receipt_destination_exists",
    );
    assert.deepEqual(JSON.parse(await fs.readFile(receiptPath, "utf8")), original);
  });

  it("fails the final reservation CAS when the evidence changes at the deterministic boundary", async () => {
    const fixture = await makeSignedFixture();
    const receiptPath = path.join(fixture.container, "receipts", "cas.json");
    const reservation = await reserveCommandReceiptPath(receiptPath, {
      commandId: "release-check",
      runId: RUN_ID,
      sourceSha: fixture.sourceSha,
      workspaceBeforeSha256: WORKSPACE_SHA,
      ...fixture.authority,
    });
    await assert.rejects(
      publishPassedCommandReceipt({
        commandId: "release-check",
        ...RECEIPT_BINDING,
        sourceSha: fixture.sourceSha,
        receiptPath,
        reservation,
        ...fixture.authority,
        testHook: async (stage: string) => {
          if (stage === "before_receipt_commit_cas") await fs.appendFile(receiptPath, " ");
        },
      }),
      (error: unknown) => error instanceof CommandReceiptError && error.code === "receipt_reservation_changed",
    );
    assert.match(await fs.readFile(receiptPath, "utf8"), /\n $/);
  });

  it("persists an end-to-end release-check receipt only through holder authority", async () => {
    const fixture = await makeSignedFixture();
    await makeFakeYarn(fixture.container);
    const receiptPath = path.join(fixture.container, "receipts", "release-check.json");
    const logPath = path.join(fixture.container, "release-check.log");
    const result = spawnSync(
      process.execPath,
      [
        path.resolve("scripts/release-check.mjs"),
        "--base=HEAD",
        `--receipt=${receiptPath}`,
        `--run-id=${RUN_ID}`,
        `--workflow-token=${fixture.tokenFile}`,
        "--workflow-runtime=codex",
      ],
      {
        cwd: fixture.projectRoot,
        env: {
          ...process.env,
          TZ: "Asia/Taipei",
          PATH: `${fixture.container}${path.delimiter}${process.env.PATH ?? ""}`,
          FAKE_YARN_FAIL: "never",
          FAKE_YARN_LOG: logPath,
        },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`);
    const persisted = JSON.parse(await fs.readFile(receiptPath, "utf8"));
    assert.equal(persisted.schemaVersion, 2);
    assert.equal(persisted.workflowLeaseId, fixture.lease.leaseId);
    assert.equal(persisted.outcome, "passed");
    await verifyCommandReceipt({
      projectRoot: fixture.projectRoot,
      receiptPath,
      expectedSourceSha: fixture.sourceSha,
      expectedRunId: RUN_ID,
      expectedOutcome: "passed",
      expectedWorkspaceBeforeSha256: persisted.workspaceBeforeSha256,
      expectedWorkspaceAfterSha256: persisted.workspaceAfterSha256,
      expectedWorkflowLeaseId: fixture.lease.leaseId,
      expectedRuntime: "codex",
      expectedGsdVersion: "1.7.0",
      expectedModelProfile: "sol-high",
    });
    await assert.rejects(
      verifyCommandReceipt({
        projectRoot: fixture.projectRoot,
        receiptPath,
        expectedSourceSha: fixture.sourceSha,
        expectedRunId: "22222222-2222-4222-8222-222222222222",
        expectedOutcome: "passed",
        expectedWorkspaceBeforeSha256: fixture.workspaceSha256,
        expectedWorkspaceAfterSha256: fixture.workspaceSha256,
        expectedWorkflowLeaseId: fixture.lease.leaseId,
        expectedRuntime: "codex",
        expectedGsdVersion: "1.7.0",
        expectedModelProfile: "sol-high",
      }),
      (error: unknown) => error instanceof CommandReceiptError && error.code === "receipt_run_id_mismatch",
    );
  });

  it("turns a child-induced workspace mutation into a non-pass receipt", async () => {
    const directory = await tempDir();
    await makeFakeYarn(directory);
    const logPath = path.join(directory, "workspace-drift.log");
    const marker = path.join(process.cwd(), `.release-check-drift-${process.pid}`);
    try {
      const result = spawnSync(process.execPath, ["scripts/release-check.mjs", "--base=HEAD"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          TZ: "Asia/Taipei",
          PATH: `${directory}${path.delimiter}${process.env.PATH ?? ""}`,
          FAKE_YARN_FAIL: "never",
          FAKE_YARN_LOG: logPath,
          FAKE_YARN_MUTATE: marker,
        },
        encoding: "utf8",
      });
      assert.equal(result.status, 1, `${result.stdout}${result.stderr}`);
      const receipt = loggedReceipt(result.stderr);
      assert.equal(receipt.schemaVersion, 1);
      assert.equal(receipt.outcome, "failed");
      assert.equal(receipt.gate, "workspace_stability");
      assert.equal(receipt.sanitizedCode, "workspace_changed_during_release_check");
      assert.equal(receipt.workspaceStable, false);
      assert.notEqual(receipt.workspaceBeforeSha256, receipt.workspaceAfterSha256);
    } finally {
      await fs.rm(marker, { force: true });
    }
  });

  it("signs strict source/worktree/holder-bound evidence and rejects tampering", async () => {
    const fixture = await makeSignedFixture();
    const { container, projectRoot, sourceSha, lease, authority } = fixture;
    const receiptPath = path.join(container, "receipts", "release.json");
    const reservation = await reserveCommandReceiptPath(receiptPath, {
      commandId: "release-check",
      runId: RUN_ID,
      sourceSha,
      workspaceBeforeSha256: fixture.workspaceSha256,
      ...authority,
    });
    const receipt = await publishPassedCommandReceipt({
      commandId: "release-check",
      runId: RUN_ID,
      sourceSha,
      workspaceBeforeSha256: fixture.workspaceSha256,
      workspaceAfterSha256: fixture.workspaceSha256,
      receiptPath,
      reservation,
      ...authority,
    });
    assert.equal(receipt.schemaVersion, 2);
    assert.equal(receipt.workflowLeaseId, lease.leaseId);
    assert.match(receipt.receiptSignature as string, /^[A-Za-z0-9_-]+$/);
    await verifyCommandReceipt({
      projectRoot,
      receiptPath,
      expectedSourceSha: sourceSha,
      expectedRunId: RUN_ID,
      expectedOutcome: "passed",
      expectedWorkspaceBeforeSha256: fixture.workspaceSha256,
      expectedWorkspaceAfterSha256: fixture.workspaceSha256,
      expectedWorkflowLeaseId: lease.leaseId,
      expectedRuntime: "codex",
      expectedGsdVersion: "1.7.0",
      expectedModelProfile: "sol-high",
    });
    const cli = spawnSync(
      process.execPath,
      [
        path.resolve("scripts/workflow/command-receipt.mjs"),
        "verify",
        `--project-root=${projectRoot}`,
        `--receipt=${receiptPath}`,
        `--source-sha=${sourceSha}`,
        `--run-id=${RUN_ID}`,
        "--outcome=passed",
        `--workspace-before-sha256=${fixture.workspaceSha256}`,
        `--workspace-after-sha256=${fixture.workspaceSha256}`,
        `--lease-id=${lease.leaseId}`,
        "--runtime=codex",
        "--gsd-version=1.7.0",
        "--model-profile=sol-high",
      ],
      { encoding: "utf8" },
    );
    assert.equal(cli.status, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).receiptSha256, receipt.receiptSha256);
    const linkedRoot = path.join(container, "linked-worktree");
    spawnSync("git", ["worktree", "add", "-q", "-b", "receipt-replay", linkedRoot, sourceSha], { cwd: projectRoot });
    await assert.rejects(
      verifyCommandReceipt({
        projectRoot: linkedRoot,
        receiptPath,
        expectedSourceSha: sourceSha,
        expectedRunId: RUN_ID,
        expectedOutcome: "passed",
        expectedWorkspaceBeforeSha256: fixture.workspaceSha256,
        expectedWorkspaceAfterSha256: fixture.workspaceSha256,
        expectedWorkflowLeaseId: lease.leaseId,
        expectedRuntime: "codex",
        expectedGsdVersion: "1.7.0",
        expectedModelProfile: "sol-high",
      }),
      (error: unknown) => error instanceof CommandReceiptError && error.code === "receipt_worktree_identity_mismatch",
    );

    const tampered = JSON.parse(await fs.readFile(receiptPath, "utf8"));
    tampered.outcome = "failed";
    await fs.writeFile(receiptPath, `${JSON.stringify(tampered, null, 2)}\n`);
    await assert.rejects(
      verifyCommandReceipt({
        projectRoot,
        receiptPath,
        expectedSourceSha: sourceSha,
        expectedRunId: RUN_ID,
        expectedOutcome: "passed",
        expectedWorkspaceBeforeSha256: fixture.workspaceSha256,
        expectedWorkspaceAfterSha256: fixture.workspaceSha256,
        expectedWorkflowLeaseId: lease.leaseId,
        expectedRuntime: "codex",
        expectedGsdVersion: "1.7.0",
        expectedModelProfile: "sol-high",
      }),
      (error: unknown) => error instanceof CommandReceiptError && error.code === "receipt_tampered",
    );
  });

  it("authenticates a caller-bound failed receipt but never returns a pass decision or CLI exit zero", async () => {
    const fixture = await makeSignedFixture();
    const receiptPath = path.join(fixture.container, "receipts", "failed.json");
    const reservation = await reserveCommandReceiptPath(receiptPath, {
      commandId: "release-check",
      runId: RUN_ID,
      sourceSha: fixture.sourceSha,
      workspaceBeforeSha256: fixture.workspaceSha256,
      ...fixture.authority,
    });
    await publishFailedCommandReceipt({
      commandId: "release-check",
      runId: RUN_ID,
      sourceSha: fixture.sourceSha,
      workspaceBeforeSha256: fixture.workspaceSha256,
      workspaceAfterSha256: fixture.workspaceSha256,
      gate: "typescript_gate",
      result: { status: 1, signal: null },
      receiptPath,
      reservation,
      ...fixture.authority,
    });
    const common = {
      projectRoot: fixture.projectRoot,
      receiptPath,
      expectedSourceSha: fixture.sourceSha,
      expectedRunId: RUN_ID,
      expectedWorkspaceBeforeSha256: fixture.workspaceSha256,
      expectedWorkspaceAfterSha256: fixture.workspaceSha256,
      expectedWorkflowLeaseId: fixture.lease.leaseId,
      expectedRuntime: "codex",
      expectedGsdVersion: "1.7.0",
      expectedModelProfile: "sol-high",
    };
    assert.equal((await verifyCommandReceipt({ ...common, expectedOutcome: "failed" })).outcome, "failed");
    await assert.rejects(
      verifyCommandReceipt({ ...common, expectedOutcome: "passed" }),
      (error: unknown) => error instanceof CommandReceiptError && error.code === "receipt_outcome_mismatch",
    );
    const cli = spawnSync(
      process.execPath,
      [
        path.resolve("scripts/workflow/command-receipt.mjs"),
        "verify",
        `--project-root=${fixture.projectRoot}`,
        `--receipt=${receiptPath}`,
        `--source-sha=${fixture.sourceSha}`,
        `--run-id=${RUN_ID}`,
        "--outcome=failed",
        `--workspace-before-sha256=${fixture.workspaceSha256}`,
        `--workspace-after-sha256=${fixture.workspaceSha256}`,
        `--lease-id=${fixture.lease.leaseId}`,
        "--runtime=codex",
        "--gsd-version=1.7.0",
        "--model-profile=sol-high",
      ],
      { encoding: "utf8" },
    );
    assert.equal(cli.status, 1, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).outcome, "failed");
  });
});
