#!/usr/bin/env node

import { execFileSync, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  watch,
} from "node:fs";
import {
  cp,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { parseSourceRevision } from "../server/lib/source-revision.js";

const ARGUMENT_ERROR = "Source revision wrapper arguments are invalid.";
const COMMAND_ERROR = "Source revision child command could not be started.";
const SOURCE_INPUT_ERROR = "Source repository inputs are not clean.";
const SOURCE_DRIFT_ERROR = "Source repository changed during the build.";
const BUILD_OUTPUT_ERROR = "Source revision build output is unavailable.";
const MANIFEST_PATH_ERROR = "Source revision manifest path is invalid.";

class WrapperCancellationError extends Error {
  constructor() {
    super("Source revision wrapper was cancelled.");
  }
}

function parseArguments(argv) {
  let manifestPath;
  let cursor = 0;

  if (argv[cursor] === "--manifest") {
    manifestPath = argv[cursor + 1];
    if (!manifestPath) {
      throw new Error(ARGUMENT_ERROR);
    }
    cursor += 2;
  }

  if (argv[cursor] !== "--" || cursor + 1 >= argv.length) {
    throw new Error(ARGUMENT_ERROR);
  }

  return {
    manifestPath,
    command: argv[cursor + 1],
    commandArgs: argv.slice(cursor + 2),
  };
}

function resolveSourceSha(checkoutRoot = process.cwd()) {
  const output = execFileSync("git", ["rev-parse", "HEAD"], {
    cwd: checkoutRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return parseSourceRevision(output.trim());
}

function assertCleanSourceInputs(checkoutRoot = process.cwd()) {
  let output;
  try {
    output = execFileSync(
      "git",
      ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
      { cwd: checkoutRoot, stdio: ["ignore", "pipe", "ignore"] },
    );
  } catch {
    throw new Error(SOURCE_INPUT_ERROR);
  }

  if (output.length !== 0) {
    throw new Error(SOURCE_INPUT_ERROR);
  }
}

function listTrackedPaths(checkoutRoot) {
  try {
    const output = execFileSync("git", ["ls-files", "-z"], {
      cwd: checkoutRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return output.split("\0").filter(Boolean);
  } catch {
    throw new Error(SOURCE_INPUT_ERROR);
  }
}

function resolveManifestLocation(checkoutRoot, manifestPath) {
  const requestedManifest = path.resolve(checkoutRoot, manifestPath);
  const missingSegments = [];
  let existingAncestor = requestedManifest;
  while (!existsSync(existingAncestor)) {
    const parent = path.dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw new Error(MANIFEST_PATH_ERROR);
    }
    missingSegments.unshift(path.basename(existingAncestor));
    existingAncestor = parent;
  }
  const resolvedManifest = path.join(realpathSync(existingAncestor), ...missingSegments);
  const relativeManifest = path.relative(checkoutRoot, resolvedManifest);
  if (
    relativeManifest === "" ||
    relativeManifest === ".." ||
    relativeManifest.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativeManifest)
  ) {
    throw new Error(MANIFEST_PATH_ERROR);
  }
  return { resolvedManifest, relativeManifest };
}

function createManifestTransactionTestHooks() {
  if (typeof process.send !== "function") {
    return {
      enabled: false,
      configure: async () => {},
      pause: async () => {},
      signalLatched: () => {},
      dispose: () => {},
      reportCleanup: async () => {},
    };
  }

  let configuredBarrier;
  let configuredResolve;
  let releaseResolve;
  const configured = new Promise((resolve) => {
    configuredResolve = resolve;
  });
  const onMessage = (message) => {
    if (!message || typeof message !== "object") {
      return;
    }
    if (message.type === "wrapper_test_configure" && typeof message.barrier === "string") {
      configuredBarrier = message.barrier;
      configuredResolve();
      process.send?.({ type: "wrapper_test_configured" });
      return;
    }
    if (message.type === "wrapper_test_release" && message.barrier === configuredBarrier) {
      releaseResolve?.();
    }
  };
  process.on("message", onMessage);
  process.send({ type: "wrapper_test_hooks_ready" });

  return {
    enabled: true,
    async configure() {
      await configured;
    },
    async pause(barrier) {
      if (configuredBarrier !== barrier) {
        return;
      }
      process.send?.({ type: "wrapper_test_barrier", barrier });
      await new Promise((resolve) => {
        releaseResolve = resolve;
      });
      releaseResolve = undefined;
    },
    signalLatched(signal) {
      process.send?.({ type: "wrapper_test_signal_latched", signal });
    },
    dispose() {
      process.removeListener("message", onMessage);
    },
    reportCleanup(state) {
      return new Promise((resolve) => {
        process.send?.({ type: "wrapper_test_cleanup", state }, () => resolve());
      });
    },
  };
}

function createWrapperCancellationController(testHooks) {
  let firstSignal;
  let liveChild;
  let firstForwarded = false;
  let escalated = false;
  let publicationCommitted = false;
  let disposed = false;

  const handleSignal = (signal) => {
    if (!firstSignal) {
      firstSignal = signal;
      testHooks.signalLatched(signal);
      if (liveChild && !firstForwarded) {
        firstForwarded = true;
        liveChild.kill(signal);
      }
      return;
    }
    if (liveChild && !escalated) {
      escalated = true;
      liveChild.kill("SIGKILL");
    }
  };
  const onSigint = () => handleSignal("SIGINT");
  const onSigterm = () => handleSignal("SIGTERM");
  process.on("SIGINT", onSigint);
  process.on("SIGTERM", onSigterm);

  return {
    get firstSignal() {
      return firstSignal;
    },
    get childAttached() {
      return Boolean(liveChild);
    },
    get disposed() {
      return disposed;
    },
    attachChild(child) {
      if (liveChild) {
        throw new Error(COMMAND_ERROR);
      }
      liveChild = child;
    },
    detachChild(child) {
      if (liveChild === child) {
        liveChild = undefined;
      }
    },
    throwIfCancelled() {
      if (firstSignal && !publicationCommitted) {
        throw new WrapperCancellationError();
      }
    },
    commitPublication() {
      if (firstSignal) {
        throw new WrapperCancellationError();
      }
      publicationCommitted = true;
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      process.removeListener("SIGINT", onSigint);
      process.removeListener("SIGTERM", onSigterm);
    },
  };
}

function trackedPathFingerprint(root, relativePath) {
  try {
    const absolutePath = path.join(root, relativePath);
    const entry = lstatSync(absolutePath, { bigint: true });
    const metadata = `${entry.mode & 0o777n}:${entry.size}:${entry.mtimeNs}:${entry.ctimeNs}`;
    if (entry.isSymbolicLink()) {
      return `link:${metadata}:${readlinkSync(absolutePath)}`;
    }
    if (!entry.isFile()) {
      return `other:${metadata}`;
    }
    return `file:${metadata}:${createHash("sha256").update(readFileSync(absolutePath)).digest("hex")}`;
  } catch {
    return "missing";
  }
}

function createSourceDriftMonitor(root, trackedPaths, verifyBytes = false) {
  const tracked = new Set(trackedPaths.map((entry) => entry.split(path.sep).join("/")));
  const directories = new Set(trackedPaths.map((entry) => path.dirname(entry)));
  const watchers = [];
  let changed = false;
  let watcherFailed = false;
  let disposed = false;
  const baseline = new Map(
    trackedPaths.map((entry) => [entry, trackedPathFingerprint(root, entry)]),
  );
  const trackedBytesChanged = () =>
    [...baseline].some(
      ([entry, fingerprint]) => trackedPathFingerprint(root, entry) !== fingerprint,
    );

  const latch = () => {
    changed = true;
  };
  for (const relativeDirectory of directories) {
    const absoluteDirectory = path.resolve(root, relativeDirectory);
    try {
      const watcher = watch(absoluteDirectory, { persistent: false }, (_event, filename) => {
        if (filename === null) {
          if (trackedBytesChanged()) {
            latch();
          }
          return;
        }
        const relativePath = path
          .join(relativeDirectory, filename.toString())
          .split(path.sep)
          .join("/");
        if (tracked.has(relativePath) && trackedBytesChanged()) {
          latch();
        }
      });
      watcher.on("error", () => {
        watcherFailed = true;
        latch();
      });
      watchers.push(watcher);
    } catch {
      watcherFailed = true;
      latch();
    }
  }

  return {
    get disposed() {
      return disposed;
    },
    armAfterMaterialization() {
      changed = watcherFailed;
    },
    assertUnchanged() {
      if (changed) {
        throw new Error(SOURCE_DRIFT_ERROR);
      }
      if (verifyBytes && trackedBytesChanged()) {
        throw new Error(SOURCE_DRIFT_ERROR);
      }
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      for (const watcher of watchers) {
        watcher.close();
      }
    },
  };
}

function runChildWithSignalForwarding(
  command,
  commandArgs,
  sourceSha,
  cwd,
  cancellationController,
) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(command, commandArgs, {
        cwd,
        stdio: "inherit",
        env: { ...process.env, SOURCE_SHA: sourceSha },
      });
      cancellationController.attachChild(child);
    } catch {
      reject(new Error(COMMAND_ERROR));
      return;
    }

    let settled = false;
    const finish = (callback) => {
      if (settled) {
        return;
      }
      settled = true;
      cancellationController.detachChild(child);
      callback();
    };
    child.once("error", () => finish(() => reject(new Error(COMMAND_ERROR))));
    child.once("close", (code, signal) => finish(() => resolve({ code, signal })));
  });
}

async function linkInstalledDependencies(checkoutRoot, snapshotRoot) {
  const installedRoot = path.join(checkoutRoot, "node_modules");
  if (!existsSync(installedRoot)) {
    return;
  }
  const snapshotModules = path.join(snapshotRoot, "node_modules");
  await mkdir(snapshotModules);
  for (const entry of await readdir(installedRoot)) {
    await symlink(path.join(installedRoot, entry), path.join(snapshotModules, entry));
  }
}

async function materializeCommittedSnapshot(checkoutRoot, sourceSha, transactionRoot) {
  const archivePath = path.join(transactionRoot, "source.tar");
  const snapshotRoot = path.join(transactionRoot, "snapshot");
  await mkdir(snapshotRoot);
  execFileSync(
    "git",
    ["archive", "--format=tar", `--output=${archivePath}`, sourceSha],
    { cwd: checkoutRoot, stdio: ["ignore", "ignore", "ignore"] },
  );
  execFileSync("tar", ["-xf", archivePath, "-C", snapshotRoot], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  await linkInstalledDependencies(checkoutRoot, snapshotRoot);
  return { archivePath, snapshotRoot };
}

function assertSubstantiveClientOutput(snapshotOutput) {
  try {
    const outputStat = lstatSync(snapshotOutput);
    const shellStat = lstatSync(path.join(snapshotOutput, "index.html"));
    if (
      outputStat.isSymbolicLink() ||
      !outputStat.isDirectory() ||
      shellStat.isSymbolicLink() ||
      !shellStat.isFile()
    ) {
      throw new Error(BUILD_OUTPUT_ERROR);
    }
  } catch {
    throw new Error(BUILD_OUTPUT_ERROR);
  }
}

async function stageSnapshotBuild(snapshotManifest, resolvedManifest, snapshotRoot, sourceSha) {
  const relativeManifest = path.relative(snapshotRoot, snapshotManifest);
  const relativeOutput = path.dirname(relativeManifest);
  const liveOutput = path.dirname(resolvedManifest);
  const rootManifestOnly = relativeOutput === ".";
  const stageTarget = rootManifestOnly
    ? path.join(liveOutput, `.${path.basename(resolvedManifest)}.${randomUUID()}.staging`)
    : path.join(path.dirname(liveOutput), `.${path.basename(liveOutput)}.${randomUUID()}.staging`);
  const backupTarget = rootManifestOnly
    ? path.join(liveOutput, `.${path.basename(resolvedManifest)}.${randomUUID()}.backup`)
    : path.join(path.dirname(liveOutput), `.${path.basename(liveOutput)}.${randomUUID()}.backup`);
  const snapshotOutput = rootManifestOnly ? snapshotManifest : path.join(snapshotRoot, relativeOutput);

  if (rootManifestOnly) {
    throw new Error(BUILD_OUTPUT_ERROR);
  }
  assertSubstantiveClientOutput(snapshotOutput);
  await mkdir(path.dirname(snapshotManifest), { recursive: true });
  await writeFile(snapshotManifest, `${JSON.stringify({ sourceSha })}\n`, "utf8");
  await mkdir(path.dirname(stageTarget), { recursive: true });
  await cp(snapshotOutput, stageTarget, { recursive: true, errorOnExist: true });
  return {
    liveTarget: liveOutput,
    stageTarget,
    backupTarget,
  };
}

function publishSnapshotBuild(
  publication,
  sourceSha,
  checkoutRoot,
  sharedMonitor,
  cancellationController,
) {
  // Linearization point: no await, promise continuation, timer, IPC callback, or event-loop yield.
  cancellationController.throwIfCancelled();
  sharedMonitor.assertUnchanged();
  if (resolveSourceSha(checkoutRoot) !== sourceSha) {
    throw new Error(SOURCE_DRIFT_ERROR);
  }
  assertCleanSourceInputs(checkoutRoot);
  sharedMonitor.assertUnchanged();
  sharedMonitor.dispose();
  cancellationController.throwIfCancelled();

  let priorMoved = false;
  let candidatePublished = false;
  try {
    if (existsSync(publication.liveTarget)) {
      renameSync(publication.liveTarget, publication.backupTarget);
      priorMoved = true;
    }
    renameSync(publication.stageTarget, publication.liveTarget);
    candidatePublished = true;
    if (priorMoved) {
      rmSync(publication.backupTarget, { recursive: true, force: true });
      priorMoved = false;
    }
    cancellationController.commitPublication();
    cancellationController.dispose();
  } catch (error) {
    if (candidatePublished && existsSync(publication.liveTarget)) {
      rmSync(publication.liveTarget, { recursive: true, force: true });
    }
    if (priorMoved && existsSync(publication.backupTarget)) {
      renameSync(publication.backupTarget, publication.liveTarget);
    }
    throw error;
  }
}

async function runManifestBuildFromCommittedSnapshot({
  checkoutRoot,
  manifestPath,
  command,
  commandArgs,
  sourceSha,
  cancellationController,
  testHooks,
  resourceState,
}) {
  const { resolvedManifest, relativeManifest } = resolveManifestLocation(
    checkoutRoot,
    manifestPath,
  );
  const trackedPaths = listTrackedPaths(checkoutRoot);
  let transactionRoot;
  let sharedMonitor;
  let snapshotMonitor;
  let publication;
  let committed = false;

  try {
    await testHooks.pause("signal_during_snapshot_setup");
    cancellationController.throwIfCancelled();

    sharedMonitor = createSourceDriftMonitor(checkoutRoot, trackedPaths, true);
    resourceState.monitorDisposed = false;
    transactionRoot = await mkdtemp(
      path.join(process.env.TMPDIR || tmpdir(), "nutrition-source-wrapper-"),
    );
    resourceState.transactionRoot = transactionRoot;
    cancellationController.throwIfCancelled();
    const snapshot = await materializeCommittedSnapshot(checkoutRoot, sourceSha, transactionRoot);
    cancellationController.throwIfCancelled();
    snapshotMonitor = createSourceDriftMonitor(snapshot.snapshotRoot, trackedPaths, true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    snapshotMonitor.armAfterMaterialization();
    cancellationController.throwIfCancelled();
    const result = await runChildWithSignalForwarding(
      command,
      commandArgs,
      sourceSha,
      snapshot.snapshotRoot,
      cancellationController,
    );
    cancellationController.throwIfCancelled();
    await new Promise((resolve) => setImmediate(resolve));
    sharedMonitor.assertUnchanged();
    snapshotMonitor.assertUnchanged();

    if (result.signal || result.code !== 0) {
      return result;
    }

    const snapshotManifest = path.join(snapshot.snapshotRoot, relativeManifest);
    publication = await stageSnapshotBuild(
      snapshotManifest,
      resolvedManifest,
      snapshot.snapshotRoot,
      sourceSha,
    );
    resourceState.stageTarget = publication.stageTarget;
    resourceState.backupTarget = publication.backupTarget;
    cancellationController.throwIfCancelled();
    sharedMonitor.assertUnchanged();
    snapshotMonitor.assertUnchanged();
    snapshotMonitor.dispose();
    snapshotMonitor = undefined;
    await rm(transactionRoot, { recursive: true, force: true });
    transactionRoot = undefined;
    resourceState.transactionRoot = undefined;
    cancellationController.throwIfCancelled();
    if (resolveSourceSha(checkoutRoot) !== sourceSha) {
      throw new Error(SOURCE_DRIFT_ERROR);
    }
    assertCleanSourceInputs(checkoutRoot);
    sharedMonitor.assertUnchanged();
    await testHooks.pause("signal_after_child_success_before_publish");
    cancellationController.throwIfCancelled();
    publishSnapshotBuild(
      publication,
      sourceSha,
      checkoutRoot,
      sharedMonitor,
      cancellationController,
    );
    resourceState.monitorDisposed = true;
    resourceState.stageTarget = undefined;
    resourceState.backupTarget = undefined;
    committed = true;
    return result;
  } finally {
    if (!committed) {
      snapshotMonitor?.dispose();
      sharedMonitor?.dispose();
      resourceState.monitorDisposed = true;
      if (publication?.stageTarget) {
        await rm(publication.stageTarget, { recursive: true, force: true });
      }
      if (publication?.backupTarget && existsSync(publication.backupTarget)) {
        await rm(publication.backupTarget, { recursive: true, force: true });
      }
      if (transactionRoot) {
        await rm(transactionRoot, { recursive: true, force: true });
      }
      resourceState.transactionRoot = undefined;
      resourceState.stageTarget = undefined;
      resourceState.backupTarget = undefined;
    }
  }
}

function isTransactionResidue(resourceState) {
  return [
    resourceState.transactionRoot,
    resourceState.stageTarget,
    resourceState.backupTarget,
  ].some((entry) => entry && existsSync(entry));
}

async function terminateWithSignal(signal) {
  process.kill(process.pid, signal);
  await new Promise(() => {});
}

async function main() {
  const { manifestPath, command, commandArgs } = parseArguments(process.argv.slice(2));
  const checkoutRoot = realpathSync(process.cwd());
  const testHooks = createManifestTransactionTestHooks();
  const cancellationController = createWrapperCancellationController(testHooks);
  const resourceState = { monitorDisposed: true };
  let result;

  try {
    if (manifestPath && testHooks.enabled) {
      await testHooks.configure();
    }
    cancellationController.throwIfCancelled();
    const sourceSha = resolveSourceSha(checkoutRoot);
    assertCleanSourceInputs(checkoutRoot);
    cancellationController.throwIfCancelled();

    if (manifestPath) {
      result = await runManifestBuildFromCommittedSnapshot({
        checkoutRoot,
        manifestPath,
        command,
        commandArgs,
        sourceSha,
        cancellationController,
        testHooks,
        resourceState,
      });
    } else {
      result = await runChildWithSignalForwarding(
        command,
        commandArgs,
        sourceSha,
        checkoutRoot,
        cancellationController,
      );
      cancellationController.throwIfCancelled();
    }
  } catch (error) {
    const firstSignal = cancellationController.firstSignal;
    cancellationController.dispose();
    testHooks.dispose();
    await testHooks.reportCleanup({
      controllerDisposed: cancellationController.disposed,
      childAttached: cancellationController.childAttached,
      monitorDisposed: resourceState.monitorDisposed,
      transactionResidue: isTransactionResidue(resourceState),
    });
    if (firstSignal) {
      await terminateWithSignal(firstSignal);
      return;
    }
    throw error;
  }

  const firstSignal = cancellationController.firstSignal;
  cancellationController.dispose();
  testHooks.dispose();
  await testHooks.reportCleanup({
    controllerDisposed: cancellationController.disposed,
    childAttached: cancellationController.childAttached,
    monitorDisposed: resourceState.monitorDisposed,
    transactionResidue: isTransactionResidue(resourceState),
  });
  if (firstSignal) {
    await terminateWithSignal(firstSignal);
    return;
  }
  if (result.signal) {
    await terminateWithSignal(result.signal);
    return;
  }
  if (result.code !== 0) {
    process.exitCode = result.code ?? 1;
  }
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof Error &&
    [
      ARGUMENT_ERROR,
      COMMAND_ERROR,
      SOURCE_INPUT_ERROR,
      SOURCE_DRIFT_ERROR,
      BUILD_OUTPUT_ERROR,
      MANIFEST_PATH_ERROR,
    ].includes(
      error.message,
    )
      ? error.message
      : BUILD_OUTPUT_ERROR;
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}
