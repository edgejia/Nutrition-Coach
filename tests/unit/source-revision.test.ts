import { execFile, spawn, type ChildProcess } from "node:child_process";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { promisify } from "node:util";
import { after, afterEach, describe, it } from "node:test";
import { parseSourceRevision, SOURCE_REVISION_PATTERN } from "../../server/lib/source-revision.js";

const execFileAsync = promisify(execFile);
const VALID_SHA = "0123456789abcdef0123456789abcdef01234567";
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const WRAPPER_PATH = path.join(REPO_ROOT, "scripts/run-with-source-sha.mjs");
const TSX_IMPORT_PATH = path.join(REPO_ROOT, "node_modules/tsx/dist/loader.mjs");
const temporaryDirectories: string[] = [];

const ADVERSARIAL_SOURCE_WRAPPER_CASES = [
  ["pre_launch_dirtiness", "reject before allocation, launch, or publication"],
  ["signal_during_snapshot_setup", "original signal; no allocation, launch, or publication"],
  ["non_manifest_handled_signal_exit_zero", "original signal, never code zero"],
  ["manifest_handled_signal_exit_zero", "original signal; preserve output and manifest"],
  ["ignored_first_repeated_signal", "forward first once, escalate once, report first signal"],
  ["signal_exit_race", "wrapper cancellation dominates child exit zero"],
  ["signal_after_child_success_before_publish", "original signal; preserve output and manifest"],
  ["persistent_post_launch_mutation", "fail closed without publication"],
  ["transient_restored_post_launch_mutation", "fail closed without publication"],
  ["child_originated_snapshot_mutation", "fail closed without publication"],
  ["spawn_error", "category-only failure without publication"],
  ["numeric_failure", "preserve numeric exit without publication"],
  ["child_signal_termination", "preserve child signal without publication"],
  ["ordinary_success", "publish snapshot output and exact one-field manifest"],
  ["timeout_after_deadline", "bounded forward/escalate cleanup with no publication"],
] as const;

type WrapperResult = {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
};

type WrapperProbe = {
  child: ChildProcess;
  completion: Promise<WrapperResult>;
  waitForMessage: (type: string, timeoutMs?: number) => Promise<Record<string, unknown>>;
};

async function makeTemporaryDirectory() {
  const directory = await mkdtemp(path.join(tmpdir(), "nutrition-source-revision-"));
  temporaryDirectories.push(directory);
  return directory;
}

async function runWrapper(args: string[], cwd = REPO_ROOT) {
  return execFileAsync(
    process.execPath,
    ["--import", TSX_IMPORT_PATH, WRAPPER_PATH, ...args],
    { cwd },
  );
}

async function makeTemporaryGitRepository() {
  const parent = await makeTemporaryDirectory();
  const directory = path.join(parent, "repo");
  await mkdir(directory);
  await writeFile(path.join(directory, ".gitignore"), "*.json\n*.marker\ndist/\n", "utf8");
  await writeFile(path.join(directory, "README.md"), "committed readme\n", "utf8");
  await writeFile(path.join(directory, "tracked.txt"), "committed input\n", "utf8");
  await execFileAsync("git", ["init"], { cwd: directory });
  await execFileAsync("git", ["config", "user.name", "Nutrition Coach Test"], { cwd: directory });
  await execFileAsync("git", ["config", "user.email", "test@nutrition-coach.invalid"], {
    cwd: directory,
  });
  await execFileAsync("git", ["add", ".gitignore", "README.md", "tracked.txt"], { cwd: directory });
  await execFileAsync("git", ["commit", "-m", "test fixture"], { cwd: directory });
  return directory;
}

async function makeCaseTmpdir(directory: string) {
  const caseTmpdir = path.join(path.dirname(directory), "tmp");
  await mkdir(caseTmpdir);
  return caseTmpdir;
}

function spawnWrapperProbe(
  args: string[],
  cwd: string,
  caseTmpdir: string,
  ipc = false,
): WrapperProbe {
  const child = spawn(
    process.execPath,
    ["--import", TSX_IMPORT_PATH, WRAPPER_PATH, ...args],
    {
      cwd,
      env: { ...process.env, TMPDIR: caseTmpdir, TSX_DISABLE_CACHE: "1" },
      stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr?.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const messages: Record<string, unknown>[] = [];
  child.on("message", (message) => {
    if (message && typeof message === "object") {
      messages.push(message as Record<string, unknown>);
    }
  });

  const completion = new Promise<WrapperResult>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  });

  return {
    child,
    completion,
    async waitForMessage(type, timeoutMs = 5_000) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const index = messages.findIndex((message) => message.type === type);
        if (index !== -1) {
          return messages.splice(index, 1)[0];
        }
        await delay(10);
      }
      throw new Error(`Timed out waiting for wrapper IPC message: ${type}`);
    },
  };
}

async function waitForWrapper(probe: WrapperProbe, timeoutMs = 5_000) {
  return Promise.race([
    probe.completion,
    delay(timeoutMs, undefined, { ref: false }).then(() => {
      throw new Error("Timed out waiting for wrapper termination.");
    }),
  ]);
}

async function readIfPresent(filePath: string) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

async function assertCaseTmpdirEmpty(caseTmpdir: string) {
  assert.deepEqual(await readdir(caseTmpdir), []);
}

async function prepareLiveOutput(directory: string, manifestVariant: "missing" | "stale" = "stale") {
  const outputDirectory = path.join(directory, "dist/client");
  const outputPath = path.join(outputDirectory, "app.txt");
  const indexPath = path.join(outputDirectory, "index.html");
  const manifestPath = path.join(outputDirectory, "source-revision.json");
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(outputPath, "prior output\n", "utf8");
  await writeFile(indexPath, "<html>prior shell</html>\n", "utf8");
  if (manifestVariant === "stale") {
    await writeFile(manifestPath, "stale manifest\n", "utf8");
  }
  return { outputDirectory, outputPath, indexPath, manifestPath };
}

async function assertPriorPublicationPreserved(
  outputPath: string,
  manifestPath: string,
  manifestVariant: "missing" | "stale",
) {
  assert.equal(await readFile(outputPath, "utf8"), "prior output\n");
  assert.equal(
    await readFile(path.join(path.dirname(outputPath), "index.html"), "utf8"),
    "<html>prior shell</html>\n",
  );
  assert.equal(
    await readIfPresent(manifestPath),
    manifestVariant === "stale" ? "stale manifest\n" : undefined,
  );
}

async function assertDirtyRepositoryRejected(
  directory: string,
  rejectedPath: string,
  rejectedValue: string,
) {
  const markerPath = path.join(directory, "child-launched.marker");
  const outputDirectory = path.join(directory, "dist/client");
  await mkdir(outputDirectory, { recursive: true });
  const missingManifestPath = path.join(outputDirectory, "missing-manifest.json");
  const staleManifestPath = path.join(outputDirectory, "stale-manifest.json");
  await writeFile(staleManifestPath, "stale\n", "utf8");
  const childSource = `require("node:fs").writeFileSync(${JSON.stringify(markerPath)}, "launched")`;

  for (const manifestPath of [missingManifestPath, staleManifestPath]) {
    await assert.rejects(
      runWrapper(
        ["--manifest", manifestPath, "--", process.execPath, "-e", childSource],
        directory,
      ),
      (error: NodeJS.ErrnoException & { stderr?: string }) => {
        const stderr = error.stderr ?? "";
        assert.match(stderr, /Source repository inputs are not clean\./);
        assert.equal(stderr.includes(rejectedPath), false);
        assert.equal(stderr.includes(rejectedValue), false);
        return true;
      },
    );
  }

  await assert.rejects(readFile(markerPath, "utf8"), { code: "ENOENT" });
  await assert.rejects(readFile(missingManifestPath, "utf8"), { code: "ENOENT" });
  assert.equal(await readFile(staleManifestPath, "utf8"), "stale\n");
}

async function waitForFile(filePath: string, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      return await readFile(filePath, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    await delay(20);
  }
  throw new Error("Timed out waiting for subprocess readiness.");
}

function isProcessAlive(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

async function waitForProcessGone(pid: number, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return;
    }
    await delay(20);
  }
  throw new Error("Timed out waiting for subprocess termination.");
}

async function runSignalForwardingProbe(signal: NodeJS.Signals) {
  const directory = await makeTemporaryGitRepository();
  const readyPath = path.join(directory, "child-ready.marker");
  const manifestPath = path.join(directory, "dist/client/signal-manifest.json");
  await mkdir(path.dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, "stale\n", "utf8");
  const childSource = [
    'const { writeFileSync } = require("node:fs");',
    `writeFileSync(${JSON.stringify(readyPath)}, String(process.pid));`,
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const wrapper = spawn(
    process.execPath,
    [
      "--import",
      TSX_IMPORT_PATH,
      WRAPPER_PATH,
      "--manifest",
      manifestPath,
      "--",
      process.execPath,
      "-e",
      childSource,
    ],
    { cwd: directory, stdio: "ignore" },
  );
  const wrapperCompletion = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      wrapper.once("error", reject);
      wrapper.once("close", (code, closeSignal) => resolve({ code, signal: closeSignal }));
    },
  );
  let childPid: number | undefined;

  try {
    childPid = Number(await waitForFile(readyPath));
    assert.ok(Number.isSafeInteger(childPid) && childPid > 0);
    assert.equal(wrapper.kill(signal), true);
    const result = await Promise.race([
      wrapperCompletion,
      delay(5_000, undefined, { ref: false }).then(() => {
        throw new Error("Timed out waiting for wrapper termination.");
      }),
    ]);
    await waitForProcessGone(childPid);

    assert.equal(result.code, null);
    assert.equal(result.signal, signal);
    assert.equal(await readFile(manifestPath, "utf8"), "stale\n");
  } finally {
    if (wrapper.exitCode === null && wrapper.signalCode === null) {
      wrapper.kill("SIGKILL");
    }
    if (childPid && isProcessAlive(childPid)) {
      process.kill(childPid, "SIGKILL");
      await waitForProcessGone(childPid).catch(() => undefined);
    }
  }
}

function snapshotBuildChildSource(extraSource = "") {
  return [
    'const { mkdirSync, readFileSync, writeFileSync } = require("node:fs");',
    extraSource,
    'mkdirSync("dist/client", { recursive: true });',
    'writeFileSync("dist/client/index.html", "<html>snapshot shell</html>\\n");',
    'writeFileSync("dist/client/app.txt", readFileSync("tracked.txt", "utf8"));',
  ]
    .filter(Boolean)
    .join("\n");
}

function invalidSnapshotBuildChildSource(
  shape: "missing" | "empty" | "directory-index" | "symlink-index",
) {
  if (shape === "missing") {
    return "process.exit(0);";
  }
  if (shape === "empty") {
    return 'require("node:fs").mkdirSync("dist/client", { recursive: true });';
  }
  if (shape === "directory-index") {
    return 'require("node:fs").mkdirSync("dist/client/index.html", { recursive: true });';
  }
  return [
    'const { mkdirSync, symlinkSync } = require("node:fs");',
    'mkdirSync("dist/client", { recursive: true });',
    'symlinkSync("../../tracked.txt", "dist/client/index.html");',
  ].join("\n");
}

async function runInvalidBuildOutputProbe(
  shape: "missing" | "empty" | "directory-index" | "symlink-index",
  manifestVariant: "missing" | "stale",
) {
  const directory = await makeTemporaryGitRepository();
  const caseTmpdir = await makeCaseTmpdir(directory);
  const publication = await prepareLiveOutput(directory, manifestVariant);
  const probe = spawnWrapperProbe(
    [
      "--manifest",
      publication.manifestPath,
      "--",
      process.execPath,
      "-e",
      invalidSnapshotBuildChildSource(shape),
    ],
    directory,
    caseTmpdir,
  );
  const result = await waitForWrapper(probe, 10_000);

  assert.deepEqual({ code: result.code, signal: result.signal }, { code: 1, signal: null });
  assert.equal(result.stderr, "Source revision build output is unavailable.\n");
  assert.equal(result.stderr.includes(directory), false);
  await assertPriorPublicationPreserved(
    publication.outputPath,
    publication.manifestPath,
    manifestVariant,
  );
  await assertCaseTmpdirEmpty(caseTmpdir);
}

async function runHandledExitZeroProbe(
  signal: NodeJS.Signals,
  mode: "manifest" | "non-manifest",
  manifestVariant: "missing" | "stale" = "stale",
) {
  const directory = await makeTemporaryGitRepository();
  const caseTmpdir = await makeCaseTmpdir(directory);
  const readyPath = path.join(directory, `${mode}-${signal}-ready.marker`);
  const ackPath = path.join(directory, `${mode}-${signal}-ack.marker`);
  const publication = await prepareLiveOutput(directory, manifestVariant);
  const childSource = [
    'const { writeFileSync } = require("node:fs");',
    `writeFileSync(${JSON.stringify(readyPath)}, String(process.pid));`,
    `process.on(${JSON.stringify(signal)}, () => {`,
    `  writeFileSync(${JSON.stringify(ackPath)}, "handled");`,
    "  setTimeout(() => process.exit(0), 30);",
    "});",
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const args =
    mode === "manifest"
      ? [
          "--manifest",
          publication.manifestPath,
          "--",
          process.execPath,
          "-e",
          childSource,
        ]
      : ["--", process.execPath, "-e", childSource];
  const probe = spawnWrapperProbe(args, directory, caseTmpdir);
  let childPid: number | undefined;

  try {
    childPid = Number(await waitForFile(readyPath));
    assert.equal(probe.child.kill(signal), true);
    assert.equal(await waitForFile(ackPath), "handled");
    const result = await waitForWrapper(probe);
    assert.deepEqual({ code: result.code, signal: result.signal }, { code: null, signal });
    assert.equal(result.stderr, "");
    await waitForProcessGone(childPid);
    if (mode === "manifest") {
      await assertPriorPublicationPreserved(
        publication.outputPath,
        publication.manifestPath,
        manifestVariant,
      );
    }
    await assertCaseTmpdirEmpty(caseTmpdir);
  } finally {
    if (probe.child.exitCode === null && probe.child.signalCode === null) {
      probe.child.kill("SIGKILL");
    }
    if (childPid && isProcessAlive(childPid)) {
      process.kill(childPid, "SIGKILL");
      await waitForProcessGone(childPid).catch(() => undefined);
    }
  }
}

async function runRepeatedSignalProbe(signal: NodeJS.Signals, waitPastDeadline = false) {
  const directory = await makeTemporaryGitRepository();
  const caseTmpdir = await makeCaseTmpdir(directory);
  const readyPath = path.join(directory, `repeat-${signal}-ready.marker`);
  const ackPath = path.join(directory, `repeat-${signal}-ack.marker`);
  const childSource = [
    'const { appendFileSync, writeFileSync } = require("node:fs");',
    `writeFileSync(${JSON.stringify(readyPath)}, String(process.pid));`,
    `process.on(${JSON.stringify(signal)}, () => appendFileSync(${JSON.stringify(ackPath)}, "forwarded\\n"));`,
    "setInterval(() => {}, 1000);",
  ].join("\n");
  const probe = spawnWrapperProbe(
    ["--", process.execPath, "-e", childSource],
    directory,
    caseTmpdir,
  );
  let childPid: number | undefined;

  try {
    childPid = Number(await waitForFile(readyPath));
    if (waitPastDeadline) {
      await assert.rejects(
        Promise.race([
          probe.completion,
          delay(150).then(() => {
            throw new Error("deadline elapsed");
          }),
        ]),
        /deadline elapsed/,
      );
    }
    assert.equal(probe.child.kill(signal), true);
    assert.equal(await waitForFile(ackPath), "forwarded\n");
    assert.equal(probe.child.kill(signal), true);
    probe.child.kill(signal);
    const result = await waitForWrapper(probe);
    assert.deepEqual({ code: result.code, signal: result.signal }, { code: null, signal });
    assert.equal(await readFile(ackPath, "utf8"), "forwarded\n");
    await waitForProcessGone(childPid);
    await assertCaseTmpdirEmpty(caseTmpdir);
  } finally {
    if (probe.child.exitCode === null && probe.child.signalCode === null) {
      probe.child.kill("SIGKILL");
    }
    if (childPid && isProcessAlive(childPid)) {
      process.kill(childPid, "SIGKILL");
      await waitForProcessGone(childPid).catch(() => undefined);
    }
  }
}

async function configureBarrier(probe: WrapperProbe, barrier: string) {
  await probe.waitForMessage("wrapper_test_hooks_ready");
  probe.child.send?.({ type: "wrapper_test_configure", barrier });
  await probe.waitForMessage("wrapper_test_configured");
  await Promise.race([
    probe.waitForMessage("wrapper_test_barrier", 10_000),
    probe.completion.then((result) => {
      throw new Error(`Wrapper exited before test barrier: ${result.stderr}`);
    }),
  ]);
}

async function runManifestBarrierProbe(
  barrier: "signal_during_snapshot_setup" | "signal_after_child_success_before_publish",
  signal: NodeJS.Signals,
) {
  const directory = await makeTemporaryGitRepository();
  const caseTmpdir = await makeCaseTmpdir(directory);
  const publication = await prepareLiveOutput(directory);
  const childMarker = path.join(directory, `${barrier}-child.marker`);
  const childSource = snapshotBuildChildSource(
    `writeFileSync(${JSON.stringify(childMarker)}, "launched");`,
  );
  const probe = spawnWrapperProbe(
    [
      "--manifest",
      publication.manifestPath,
      "--",
      process.execPath,
      "-e",
      childSource,
    ],
    directory,
    caseTmpdir,
    true,
  );

  try {
    await configureBarrier(probe, barrier);
    assert.equal(probe.child.kill(signal), true);
    const acknowledgement = await probe.waitForMessage("wrapper_test_signal_latched");
    assert.equal(acknowledgement.signal, signal);
    probe.child.send?.({ type: "wrapper_test_release", barrier });
    const cleanup = await probe.waitForMessage("wrapper_test_cleanup", 10_000);
    assert.deepEqual(cleanup.state, {
      controllerDisposed: true,
      childAttached: false,
      monitorDisposed: true,
      transactionResidue: false,
    });
    const result = await waitForWrapper(probe, 10_000);
    assert.deepEqual({ code: result.code, signal: result.signal }, { code: null, signal });
    await assertPriorPublicationPreserved(
      publication.outputPath,
      publication.manifestPath,
      "stale",
    );
    assert.equal(
      await readIfPresent(childMarker),
      barrier === "signal_during_snapshot_setup" ? undefined : "launched",
    );
    await assertCaseTmpdirEmpty(caseTmpdir);
  } finally {
    if (probe.child.exitCode === null && probe.child.signalCode === null) {
      probe.child.kill("SIGKILL");
    }
  }
}

async function runPostLaunchMutationProbe(kind: "persistent" | "transient") {
  const directory = await makeTemporaryGitRepository();
  const caseTmpdir = await makeCaseTmpdir(directory);
  const publication = await prepareLiveOutput(directory);
  const readyPath = path.join(directory, `${kind}-mutation-ready.marker`);
  const releasePath = path.join(directory, `${kind}-mutation-release.marker`);
  const childSource = [
    'const { existsSync, mkdirSync, readFileSync, writeFileSync } = require("node:fs");',
    `writeFileSync(${JSON.stringify(readyPath)}, readFileSync("tracked.txt", "utf8"));`,
    `const timer = setInterval(() => { if (existsSync(${JSON.stringify(releasePath)})) {`,
    "  clearInterval(timer);",
    '  mkdirSync("dist/client", { recursive: true });',
    '  writeFileSync("dist/client/app.txt", readFileSync("tracked.txt", "utf8"));',
    "}}, 10);",
  ].join("\n");
  const probe = spawnWrapperProbe(
    [
      "--manifest",
      publication.manifestPath,
      "--",
      process.execPath,
      "-e",
      childSource,
    ],
    directory,
    caseTmpdir,
  );

  await waitForFile(readyPath, 10_000);
  await writeFile(path.join(directory, "tracked.txt"), "mutated input\n", "utf8");
  if (kind === "transient") {
    await writeFile(path.join(directory, "tracked.txt"), "committed input\n", "utf8");
  }
  await delay(80);
  await writeFile(releasePath, "release", "utf8");
  const result = await waitForWrapper(probe, 10_000);
  assert.equal(result.code, 1);
  assert.equal(result.signal, null);
  assert.match(result.stderr, /Source repository changed during the build\./);
  assert.equal(await readFile(readyPath, "utf8"), "committed input\n");
  await assertPriorPublicationPreserved(
    publication.outputPath,
    publication.manifestPath,
    "stale",
  );
  await assertCaseTmpdirEmpty(caseTmpdir);
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

after(async () => {
  const testTmpdir = tmpdir();
  if (
    path.basename(testTmpdir) === "tmp" &&
    path.basename(path.dirname(testTmpdir)).startsWith("nutrition-coach-113-08.")
  ) {
    for (const entry of await readdir(testTmpdir)) {
      if (entry.startsWith("tsx-")) {
        await rm(path.join(testTmpdir, entry), { recursive: true, force: true });
      }
    }
  }
});

describe("source revision validation", () => {
  it("accepts exactly one lowercase 40-character hexadecimal SHA", () => {
    assert.match(VALID_SHA, SOURCE_REVISION_PATTERN);
    assert.equal(parseSourceRevision(VALID_SHA), VALID_SHA);
  });

  it("rejects malformed values without echoing them", () => {
    const rejectedValues = [
      undefined,
      "0123456",
      VALID_SHA.toUpperCase(),
      `${VALID_SHA.slice(0, 39)}g`,
      ` ${VALID_SHA}`,
      `${VALID_SHA} `,
      `${VALID_SHA}\n${VALID_SHA}`,
    ];

    for (const candidate of rejectedValues) {
      assert.throws(
        () => parseSourceRevision(candidate),
        (error) => {
          assert.ok(error instanceof Error);
          assert.equal(error.message, "Source revision is unavailable or invalid.");
          if (candidate) {
            assert.equal(error.message.includes(candidate), false);
          }
          return true;
        },
      );
    }
  });
});

describe("source revision command wrapper", () => {
  it("injects the selected checkout SHA into the child environment", async () => {
    const directory = await makeTemporaryGitRepository();
    const expectedSha = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: directory })).stdout.trim();
    const result = await runWrapper([
      "--",
      process.execPath,
      "-e",
      "process.stdout.write(process.env.SOURCE_SHA ?? '')",
    ], directory);

    assert.equal(result.stdout, expectedSha);
    assert.equal(result.stderr, "");
  });

  it("propagates child failure without printing the environment", async () => {
    const directory = await makeTemporaryGitRepository();
    await assert.rejects(
      runWrapper(["--", process.execPath, "-e", "process.exit(23)"], directory),
      (error: NodeJS.ErrnoException & { code?: number; stderr?: string }) => {
        assert.equal(error.code, 23);
        assert.equal(error.stderr ?? "", "");
        assert.equal((error.stderr ?? "").includes("SOURCE_SHA"), false);
        return true;
      },
    );
  });

  it("atomically replaces the manifest only after a successful child", async () => {
    const directory = await makeTemporaryGitRepository();
    const { manifestPath, outputPath } = await prepareLiveOutput(directory);

    await runWrapper(
      [
        "--manifest",
        manifestPath,
        "--",
        process.execPath,
        "-e",
        snapshotBuildChildSource(),
      ],
      directory,
    );

    const expectedSha = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: directory })).stdout.trim();
    assert.deepEqual(JSON.parse(await readFile(manifestPath, "utf8")), { sourceSha: expectedSha });
    assert.equal(await readFile(outputPath, "utf8"), "committed input\n");
  });

  it("does not write or refresh the manifest after child failure", async () => {
    for (const manifestVariant of ["missing", "stale"] as const) {
      const directory = await makeTemporaryGitRepository();
      const { manifestPath, outputPath } = await prepareLiveOutput(directory, manifestVariant);
      await assert.rejects(
        runWrapper(
          ["--manifest", manifestPath, "--", process.execPath, "-e", "process.exit(19)"],
          directory,
        ),
      );
      await assertPriorPublicationPreserved(outputPath, manifestPath, manifestVariant);
    }
  });

  for (const shape of ["missing", "empty", "directory-index", "symlink-index"] as const) {
    for (const manifestVariant of ["missing", "stale"] as const) {
      it(`rejects ${shape} client output with a ${manifestVariant} manifest before publication`, async () => {
        await runInvalidBuildOutputProbe(shape, manifestVariant);
      });
    }
  }

  it("rejects an unstaged tracked input before child launch or manifest mutation", async () => {
    const directory = await makeTemporaryGitRepository();
    const rejectedPath = "tracked.txt";
    const rejectedValue = "unstaged-private-value";
    await writeFile(path.join(directory, rejectedPath), `${rejectedValue}\n`, "utf8");

    await assertDirtyRepositoryRejected(directory, rejectedPath, rejectedValue);
  });

  it("rejects a staged tracked input before child launch or manifest mutation", async () => {
    const directory = await makeTemporaryGitRepository();
    const rejectedPath = "tracked.txt";
    const rejectedValue = "staged-private-value";
    await writeFile(path.join(directory, rejectedPath), `${rejectedValue}\n`, "utf8");
    await execFileAsync("git", ["add", rejectedPath], { cwd: directory });

    await assertDirtyRepositoryRejected(directory, rejectedPath, rejectedValue);
  });

  it("rejects a non-ignored untracked input before child launch or manifest mutation", async () => {
    const directory = await makeTemporaryGitRepository();
    const rejectedPath = "untracked-private-input.txt";
    const rejectedValue = "untracked-private-value";
    await writeFile(path.join(directory, rejectedPath), `${rejectedValue}\n`, "utf8");

    await assertDirtyRepositoryRejected(directory, rejectedPath, rejectedValue);
  });

  it("rejects an unstaged README change without a pathname exception", async () => {
    const directory = await makeTemporaryGitRepository();
    const rejectedPath = "README.md";
    const rejectedValue = "unstaged-readme-private-value";
    await writeFile(path.join(directory, rejectedPath), `${rejectedValue}\n`, "utf8");

    await assertDirtyRepositoryRejected(directory, rejectedPath, rejectedValue);
  });

  it("rejects a staged README change without a pathname exception", async () => {
    const directory = await makeTemporaryGitRepository();
    const rejectedPath = "README.md";
    const rejectedValue = "staged-readme-private-value";
    await writeFile(path.join(directory, rejectedPath), `${rejectedValue}\n`, "utf8");
    await execFileAsync("git", ["add", rejectedPath], { cwd: directory });

    await assertDirtyRepositoryRejected(directory, rejectedPath, rejectedValue);
  });

  it("forwards SIGTERM, waits for the child, and preserves signal termination", async () => {
    await runSignalForwardingProbe("SIGTERM");
  });

  it("forwards SIGINT, waits for the child, and preserves signal termination", async () => {
    await runSignalForwardingProbe("SIGINT");
  });

  it("freezes the complete D-26 adversarial result matrix", () => {
    assert.deepEqual(
      ADVERSARIAL_SOURCE_WRAPPER_CASES.map(([name]) => name),
      [
        "pre_launch_dirtiness",
        "signal_during_snapshot_setup",
        "non_manifest_handled_signal_exit_zero",
        "manifest_handled_signal_exit_zero",
        "ignored_first_repeated_signal",
        "signal_exit_race",
        "signal_after_child_success_before_publish",
        "persistent_post_launch_mutation",
        "transient_restored_post_launch_mutation",
        "child_originated_snapshot_mutation",
        "spawn_error",
        "numeric_failure",
        "child_signal_termination",
        "ordinary_success",
        "timeout_after_deadline",
      ],
    );
    for (const [name, expected] of ADVERSARIAL_SOURCE_WRAPPER_CASES) {
      assert.notEqual(name, "");
      assert.notEqual(expected, "");
    }
  });

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    it(`keeps ${signal} authoritative when a non-manifest child handles it and exits zero`, async () => {
      await runHandledExitZeroProbe(signal, "non-manifest");
    });

    for (const manifestVariant of ["missing", "stale"] as const) {
      it(`keeps ${signal} authoritative for a ${manifestVariant} manifest when the child exits zero`, async () => {
        await runHandledExitZeroProbe(signal, "manifest", manifestVariant);
      });
    }

    it(`forwards ${signal} once and escalates one repeated live-child signal`, async () => {
      await runRepeatedSignalProbe(signal);
    });
  }

  it("latches cancellation before manifest snapshot allocation or child launch", async () => {
    await runManifestBarrierProbe("signal_during_snapshot_setup", "SIGTERM");
  });

  it("blocks publication when cancellation arrives after child success at the final boundary", async () => {
    await runManifestBarrierProbe("signal_after_child_success_before_publish", "SIGINT");
  });

  it("fails closed after persistent shared-checkout mutation while the child reads the snapshot", async () => {
    await runPostLaunchMutationProbe("persistent");
  });

  it("fails closed after transient shared-checkout mutation is restored", async () => {
    await runPostLaunchMutationProbe("transient");
  });

  it("fails closed when the child mutates a tracked snapshot path", async () => {
    const directory = await makeTemporaryGitRepository();
    const caseTmpdir = await makeCaseTmpdir(directory);
    const publication = await prepareLiveOutput(directory);
    const childSource = snapshotBuildChildSource(
      'writeFileSync("tracked.txt", "child-originated mutation\\n");',
    );
    const probe = spawnWrapperProbe(
      [
        "--manifest",
        publication.manifestPath,
        "--",
        process.execPath,
        "-e",
        childSource,
      ],
      directory,
      caseTmpdir,
    );

    const result = await waitForWrapper(probe, 10_000);
    assert.equal(result.code, 1);
    assert.equal(result.signal, null);
    assert.match(result.stderr, /Source repository changed during the build\./);
    await assertPriorPublicationPreserved(
      publication.outputPath,
      publication.manifestPath,
      "stale",
    );
    await assertCaseTmpdirEmpty(caseTmpdir);
  });

  it("reports a spawn error by category and preserves prior publication", async () => {
    const directory = await makeTemporaryGitRepository();
    const caseTmpdir = await makeCaseTmpdir(directory);
    const publication = await prepareLiveOutput(directory);
    const probe = spawnWrapperProbe(
      ["--manifest", publication.manifestPath, "--", "missing-source-wrapper-command"],
      directory,
      caseTmpdir,
    );
    const result = await waitForWrapper(probe);

    assert.deepEqual({ code: result.code, signal: result.signal }, { code: 1, signal: null });
    assert.equal(result.stderr, "Source revision child command could not be started.\n");
    await assertPriorPublicationPreserved(
      publication.outputPath,
      publication.manifestPath,
      "stale",
    );
    await assertCaseTmpdirEmpty(caseTmpdir);
  });

  it("keeps numeric child failure numeric and leaves no transaction residue", async () => {
    const directory = await makeTemporaryGitRepository();
    const caseTmpdir = await makeCaseTmpdir(directory);
    const publication = await prepareLiveOutput(directory);
    const probe = spawnWrapperProbe(
      ["--manifest", publication.manifestPath, "--", process.execPath, "-e", "process.exit(29)"],
      directory,
      caseTmpdir,
    );
    const result = await waitForWrapper(probe);

    assert.deepEqual({ code: result.code, signal: result.signal }, { code: 29, signal: null });
    assert.equal(result.stderr, "");
    await assertPriorPublicationPreserved(
      publication.outputPath,
      publication.manifestPath,
      "stale",
    );
    await assertCaseTmpdirEmpty(caseTmpdir);
  });

  it("keeps child signal termination distinct and leaves no transaction residue", async () => {
    const directory = await makeTemporaryGitRepository();
    const caseTmpdir = await makeCaseTmpdir(directory);
    const publication = await prepareLiveOutput(directory);
    const probe = spawnWrapperProbe(
      [
        "--manifest",
        publication.manifestPath,
        "--",
        process.execPath,
        "-e",
        'process.kill(process.pid, "SIGTERM")',
      ],
      directory,
      caseTmpdir,
    );
    const result = await waitForWrapper(probe);

    assert.deepEqual(
      { code: result.code, signal: result.signal },
      { code: null, signal: "SIGTERM" },
    );
    await assertPriorPublicationPreserved(
      publication.outputPath,
      publication.manifestPath,
      "stale",
    );
    await assertCaseTmpdirEmpty(caseTmpdir);
  });

  it("publishes only committed-snapshot output and one exact SHA field on ordinary success", async () => {
    const directory = await makeTemporaryGitRepository();
    const caseTmpdir = await makeCaseTmpdir(directory);
    const publication = await prepareLiveOutput(directory);
    const expectedSha = (
      await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: directory })
    ).stdout.trim();
    const probe = spawnWrapperProbe(
      [
        "--manifest",
        publication.manifestPath,
        "--",
        process.execPath,
        "-e",
        snapshotBuildChildSource(),
      ],
      directory,
      caseTmpdir,
    );
    const result = await waitForWrapper(probe, 10_000);

    assert.deepEqual({ code: result.code, signal: result.signal }, { code: 0, signal: null });
    assert.equal(await readFile(publication.outputPath, "utf8"), "committed input\n");
    assert.deepEqual(JSON.parse(await readFile(publication.manifestPath, "utf8")), {
      sourceSha: expectedSha,
    });
    assert.deepEqual(await readdir(publication.outputDirectory), [
      "app.txt",
      "index.html",
      "source-revision.json",
    ]);
    await assertCaseTmpdirEmpty(caseTmpdir);
  });

  it("bounds a timed-out child through the existing first-signal and escalation path", async () => {
    await runRepeatedSignalProbe("SIGTERM", true);
  });
});

describe("package script provenance binding", () => {
  it("routes normal build and start entrypoints through the wrapper", async () => {
    const packageJson = JSON.parse(await readFile(path.join(REPO_ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };

    assert.equal(
      packageJson.scripts.build,
      "node --import tsx scripts/run-with-source-sha.mjs --manifest dist/client/source-revision.json -- vite build --config client/vite.config.ts",
    );
    assert.equal(
      packageJson.scripts.start,
      "node --import tsx scripts/run-with-source-sha.mjs -- node --import tsx server/index.ts",
    );
  });
});
