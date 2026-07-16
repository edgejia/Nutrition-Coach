#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { fingerprintTree } from "./tree-fingerprint.mjs";
import { checkWorkflowState } from "./state-check.mjs";

const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const PILOT_ID_PATTERN = /^GSDP-[0-9]{8}-[0-9]{2}$/;
const SEED_PREFIX = "tests/fixtures/workflow/gsd-pilot-seed";
const MAX_SEED_FILE_BYTES = 1024 * 1024;
const MAX_SEED_TOTAL_BYTES = 8 * 1024 * 1024;
const GIT_ROUTING_ENV = Object.freeze([
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  "GIT_COMMON_DIR",
  "GIT_DIR",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_WORK_TREE",
]);
const SEED_MANIFEST = Object.freeze([
  { path: "PROJECT.md", mode: "100644", sha256: "ab7b01fe3f7e34d6d4a094b08a30f1e38627d74ad2284db47210d4b1a7ece97d" },
  { path: "REQUIREMENTS.md", mode: "100644", sha256: "de0a86a69f2936214786177f6165623a959b5297984eeac3fc1d0002666cf580" },
  { path: "ROADMAP.md", mode: "100644", sha256: "019cfe4eeb11bb3051dc401df7314a036279d1597c52ff7bebb291cf8834ce9c" },
  { path: "STATE.md", mode: "100644", sha256: "b4962844cf8241534d24375266cf8fe1fabf31565028b97e12202259873847df" },
  { path: "config.json", mode: "100644", sha256: "0363f6dade86d067312811b369ae3ee2249e6d98db81ac807ec6bf1a15e533eb" },
  { path: "phases/999-workflow-hardening-pilot/999-CONTEXT.md", mode: "100644", sha256: "b86493ceec05cf645d94f4a114766ec058918267c740003534348c39a6258b2b" },
]);
const SEED_MANIFEST_SHA256 = createHash("sha256").update(JSON.stringify(SEED_MANIFEST)).digest("hex");

function sanitizedGitEnvironment() {
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith("GIT_")),
  );
  environment.GIT_CONFIG_NOSYSTEM = "1";
  environment.GIT_CONFIG_GLOBAL = process.platform === "win32" ? "NUL" : "/dev/null";
  return environment;
}

export class GsdPilotSeedError extends Error {
  constructor(code) {
    super(code);
    this.name = "GsdPilotSeedError";
    this.code = code;
  }
}

function fail(code) {
  throw new GsdPilotSeedError(code);
}

function requireCondition(condition, code) {
  if (!condition) fail(code);
}

function pathsOverlap(left, right) {
  const relative = path.relative(left, right);
  const reverse = path.relative(right, left);
  return relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative)) ||
    (!reverse.startsWith("..") && !path.isAbsolute(reverse));
}

function runGit(root, args) {
  return execFileSync("git", ["--no-optional-locks", "--no-replace-objects", ...args], {
    cwd: root,
    encoding: "utf8",
    env: sanitizedGitEnvironment(),
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function runGitBuffer(root, args) {
  return execFileSync("git", ["--no-optional-locks", "--no-replace-objects", ...args], {
    cwd: root,
    encoding: "buffer",
    env: sanitizedGitEnvironment(),
    maxBuffer: MAX_SEED_TOTAL_BYTES * 2,
    stdio: ["ignore", "pipe", "ignore"],
  });
}

async function gitCommonDir(root) {
  const raw = runGit(root, ["rev-parse", "--git-common-dir"]);
  return fs.realpath(path.isAbsolute(raw) ? raw : path.resolve(root, raw));
}

async function requireStandaloneProjectRepository(projectRoot, commonDir) {
  const expectedGitDir = path.join(projectRoot, ".git");
  const gitDirStat = await fs.lstat(expectedGitDir).catch(() => null);
  const gitDirReal = await fs.realpath(expectedGitDir).catch(() => null);
  requireCondition(
    gitDirStat?.isDirectory() &&
      !gitDirStat.isSymbolicLink() &&
      gitDirReal === expectedGitDir &&
      commonDir === expectedGitDir,
    "pilot_project_repository_layout_unsafe",
  );
  const linkedWorktrees = path.join(commonDir, "worktrees");
  const linkedStat = await fs.lstat(linkedWorktrees).catch(() => null);
  if (linkedStat !== null) {
    requireCondition(
      linkedStat.isDirectory() &&
        !linkedStat.isSymbolicLink() &&
        (await fs.readdir(linkedWorktrees)).length === 0,
      "pilot_project_repository_layout_unsafe",
    );
  }
}

async function requireCanonicalDeclaredDirectory(candidate, code) {
  const declared = path.resolve(candidate);
  const stat = await fs.lstat(declared).catch(() => null);
  const real = await fs.realpath(declared).catch(() => null);
  requireCondition(stat?.isDirectory() && !stat.isSymbolicLink() && real === declared, code);
  return real;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

async function stableFileSnapshot(filePath, code) {
  let handle;
  try {
    handle = await fs.open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const before = await handle.stat({ bigint: true });
    requireCondition(before.isFile() && before.size <= 1024n, code);
    const raw = await handle.readFile();
    const after = await handle.stat({ bigint: true });
    const current = await fs.lstat(filePath, { bigint: true }).catch(() => null);
    requireCondition(
      before.dev === after.dev && before.ino === after.ino && before.size === after.size &&
        before.nlink === after.nlink && before.mode === after.mode &&
        before.mtimeNs === after.mtimeNs && before.ctimeNs === after.ctimeNs &&
        current?.isFile() && !current.isSymbolicLink() && current.dev === after.dev && current.ino === after.ino &&
        current.size === after.size && current.nlink === after.nlink && current.mode === after.mode &&
        current.mtimeNs === after.mtimeNs &&
        current.ctimeNs === after.ctimeNs,
      code,
    );
    return {
      raw,
      sha256: sha256(raw),
      dev: after.dev.toString(),
      ino: after.ino.toString(),
      nlink: after.nlink.toString(),
      mode: after.mode.toString(),
      size: after.size.toString(),
      mtimeNs: after.mtimeNs.toString(),
      ctimeNs: after.ctimeNs.toString(),
    };
  } catch (error) {
    if (error instanceof GsdPilotSeedError) throw error;
    fail(code);
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

function sameStableSnapshot(left, right) {
  return left.sha256 === right.sha256 &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.nlink === right.nlink &&
    left.mode === right.mode &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.ctimeNs === right.ctimeNs;
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    requireCondition(stat.isDirectory(), "pilot_seed_sync_target_unsafe");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncTree(candidate) {
  const stat = await fs.lstat(candidate);
  requireCondition(!stat.isSymbolicLink(), "pilot_seed_sync_target_unsafe");
  if (stat.isFile()) {
    const handle = await fs.open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    return;
  }
  requireCondition(stat.isDirectory(), "pilot_seed_sync_target_unsafe");
  for (const child of (await fs.readdir(candidate)).sort((left, right) => left.localeCompare(right, "en"))) {
    await syncTree(path.join(candidate, child));
  }
  await syncDirectory(candidate);
}

async function installTreeExclusive(source, destination) {
  const sourceStat = await fs.lstat(source);
  requireCondition(!sourceStat.isSymbolicLink(), "pilot_seed_publish_unsafe");
  try {
    if (sourceStat.isFile()) {
      await fs.link(source, destination);
      const published = await fs.lstat(destination);
      requireCondition(
        published.isFile() && published.dev === sourceStat.dev && published.ino === sourceStat.ino,
        "pilot_seed_publish_mismatch",
      );
      const handle = await fs.open(destination, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.unlink(source);
      await syncDirectory(path.dirname(destination));
      await syncDirectory(path.dirname(source));
      return;
    }
    requireCondition(sourceStat.isDirectory(), "pilot_seed_publish_unsafe");
    await fs.mkdir(destination, { mode: sourceStat.mode & 0o7777 });
  } catch (error) {
    if (error && typeof error === "object" && ["EEXIST", "ENOTEMPTY"].includes(error.code)) {
      fail("pilot_seed_publish_collision");
    }
    throw error;
  }
  for (const child of (await fs.readdir(source)).sort((left, right) => left.localeCompare(right, "en"))) {
    await installTreeExclusive(path.join(source, child), path.join(destination, child));
  }
  await syncDirectory(destination);
  await fs.rmdir(source);
  await syncDirectory(path.dirname(source));
}

async function acquirePilotSeedLock(projectRoot, pilotId, sourceSha) {
  const lockPath = path.join(projectRoot, ".nutrition-gsd-pilot-seed.lock");
  const ownerKey = randomBytes(32).toString("hex");
  const ownerKeySha256 = sha256(ownerKey);
  const record = `${JSON.stringify({
    schemaVersion: 1,
    kind: "nutrition_gsd_pilot_seed_lock",
    pilotId,
    sourceSha,
    ownerKeySha256,
  })}\n`;
  let handle;
  try {
    handle = await fs.open(lockPath, "wx", 0o600);
    await handle.writeFile(record, "utf8");
    await handle.sync();
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") fail("pilot_seed_lock_exists");
    throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
  await syncDirectory(projectRoot);
  const snapshot = await stableFileSnapshot(lockPath, "pilot_seed_lock_changed");
  requireCondition(snapshot.nlink === "1" && snapshot.raw.toString("utf8") === record, "pilot_seed_lock_changed");
  return { path: lockPath, snapshot, record, ownerKey };
}

async function releasePilotSeedLock(lock, projectRoot) {
  requireCondition(typeof lock.ownerKey === "string" && lock.ownerKey.length === 64, "pilot_seed_lock_changed");
  await syncDirectory(projectRoot);
  const current = await stableFileSnapshot(lock.path, "pilot_seed_lock_changed");
  let record;
  try {
    record = JSON.parse(current.raw.toString("utf8"));
  } catch {
    fail("pilot_seed_lock_changed");
  }
  requireCondition(
    current.nlink === "1" &&
      sameStableSnapshot(current, lock.snapshot) &&
      current.raw.toString("utf8") === lock.record &&
      record?.schemaVersion === 1 &&
      record?.kind === "nutrition_gsd_pilot_seed_lock" &&
      record?.ownerKeySha256 === sha256(lock.ownerKey),
    "pilot_seed_lock_changed",
  );
  try {
    // Terminal operation: every validation and durability preflight is complete before this unlink.
    await fs.unlink(lock.path);
  } catch {
    fail("pilot_seed_lock_release_failed");
  }
}

async function copyCommittedSeed(sourceRoot, target, sourceSha) {
  const listing = runGitBuffer(sourceRoot, ["ls-tree", "-r", "-z", "--full-tree", sourceSha, "--", SEED_PREFIX]);
  const records = listing.toString("utf8").split("\0").filter(Boolean);
  requireCondition(records.length === SEED_MANIFEST.length, "pilot_seed_manifest_mismatch");
  let totalBytes = 0;
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const expected = SEED_MANIFEST[index];
    const match = record.match(/^([0-9]{6}) (blob) ([0-9a-f]{40})\t(.+)$/s);
    requireCondition(match !== null, "pilot_seed_source_unsafe");
    const [, gitMode, , objectId, gitPath] = match;
    const relative = path.posix.relative(SEED_PREFIX, gitPath);
    requireCondition(
      relative === expected.path && gitMode === expected.mode,
      "pilot_seed_manifest_mismatch",
    );
    const bytes = runGitBuffer(sourceRoot, ["cat-file", "blob", objectId]);
    requireCondition(sha256(bytes) === expected.sha256, "pilot_seed_manifest_mismatch");
    requireCondition(bytes.length <= MAX_SEED_FILE_BYTES, "pilot_seed_source_unsafe");
    requireCondition(
      !/(^|\D)115(\D|$)|v3\.4\.1/i.test(`${relative}\n${bytes.toString("utf8")}`),
      "pilot_seed_forbidden_state_reference",
    );
    totalBytes += bytes.length;
    requireCondition(totalBytes <= MAX_SEED_TOTAL_BYTES, "pilot_seed_source_unsafe");
    const destination = path.join(target, ...relative.split("/"));
    await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const handle = await fs.open(destination, "wx", 0o644);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
}

export async function createGsdPilotSeed(options) {
  const optionKeys = Object.keys(options).sort();
  const expectedOptionKeys = [
    "confirm", "confirmSourceSha", "expectedBranch", "pilotId", "projectRoot", "sourceRoot",
    ...(options.testCheckpoint === undefined ? [] : ["testCheckpoint"]),
  ].sort();
  requireCondition(JSON.stringify(optionKeys) === JSON.stringify(expectedOptionKeys), "pilot_seed_scope_override_forbidden");
  requireCondition(options.testCheckpoint === undefined || typeof options.testCheckpoint === "function", "pilot_seed_scope_override_forbidden");
  requireCondition(typeof options.projectRoot === "string" && path.isAbsolute(options.projectRoot), "pilot_project_root_invalid");
  requireCondition(typeof options.sourceRoot === "string" && path.isAbsolute(options.sourceRoot), "pilot_source_root_invalid");
  requireCondition(PILOT_ID_PATTERN.test(options.pilotId ?? ""), "pilot_id_invalid");
  requireCondition(SOURCE_SHA_PATTERN.test(options.confirmSourceSha ?? ""), "pilot_source_sha_invalid");
  requireCondition(typeof options.expectedBranch === "string" && options.expectedBranch.length > 0, "pilot_expected_branch_invalid");
  requireCondition(
    options.confirm === `CREATE_SYNTHETIC_GSD_PILOT:${options.pilotId}:999:${options.confirmSourceSha}`,
    "pilot_seed_confirmation_mismatch",
  );
  requireCondition(
    GIT_ROUTING_ENV.every((name) => process.env[name] === undefined),
    "pilot_git_environment_unsafe",
  );
  const sourceRoot = await requireCanonicalDeclaredDirectory(options.sourceRoot, "pilot_source_root_unsafe");
  const projectRoot = await requireCanonicalDeclaredDirectory(options.projectRoot, "pilot_project_root_unsafe");
  requireCondition(!pathsOverlap(sourceRoot, projectRoot), "pilot_worktree_paths_overlap");
  const sourceCommonDir = await gitCommonDir(sourceRoot);
  const projectCommonDir = await gitCommonDir(projectRoot);
  requireCondition(sourceCommonDir !== projectCommonDir, "pilot_must_use_independent_git_common_dir");
  await requireStandaloneProjectRepository(projectRoot, projectCommonDir);
  requireCondition(
    !pathsOverlap(sourceCommonDir, projectRoot) &&
      !pathsOverlap(projectCommonDir, sourceRoot) &&
      !pathsOverlap(sourceCommonDir, projectCommonDir),
    "pilot_repository_boundaries_overlap",
  );
  const sourceInitial = {
    head: runGit(sourceRoot, ["rev-parse", "HEAD"]),
    branch: runGit(sourceRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    remotes: runGit(sourceRoot, ["remote", "-v"]),
    status: runGit(sourceRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
  };
  requireCondition(sourceInitial.head === options.confirmSourceSha, "pilot_source_sha_mismatch");
  requireCondition(sourceInitial.status === "", "pilot_source_not_clean");
  const projectInitial = {
    head: runGit(projectRoot, ["rev-parse", "HEAD"]),
    branch: runGit(projectRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    remotes: runGit(projectRoot, ["remote", "-v"]),
    status: runGit(projectRoot, ["status", "--porcelain=v1", "--untracked-files=all"]),
  };
  requireCondition(projectInitial.head === options.confirmSourceSha, "pilot_project_sha_mismatch");
  requireCondition(projectInitial.branch === options.expectedBranch, "pilot_project_branch_mismatch");
  requireCondition(projectInitial.remotes === "", "pilot_remote_present");
  const markerPath = path.join(projectRoot, ".nutrition-gsd-pilot-root");
  const markerStat = await fs.lstat(markerPath).catch(() => null);
  requireCondition(markerStat?.isFile() && !markerStat.isSymbolicLink() && markerStat.size <= 1024, "pilot_marker_missing_or_unsafe");
  let marker;
  const markerSnapshot = await stableFileSnapshot(markerPath, "pilot_marker_missing_or_unsafe");
  try {
    marker = JSON.parse(markerSnapshot.raw.toString("utf8"));
  } catch {
    fail("pilot_marker_invalid");
  }
  requireCondition(
    marker?.schemaVersion === 1 &&
      marker?.kind === "nutrition_gsd_pilot_root" &&
      marker?.pilotId === options.pilotId &&
      marker?.sourceSha === options.confirmSourceSha,
    "pilot_marker_mismatch",
  );
  const planningRoot = path.join(projectRoot, ".planning");
  requireCondition((await fs.lstat(planningRoot).catch(() => null)) === null, "pilot_planning_already_exists");
  requireCondition(
    projectInitial.status === "?? .nutrition-gsd-pilot-root",
    "pilot_project_status_unexpected",
  );
  if (typeof options.testCheckpoint === "function") await options.testCheckpoint("before_seed_snapshot");
  requireCondition(runGit(sourceRoot, ["rev-parse", "HEAD"]) === sourceInitial.head, "pilot_source_changed");
  requireCondition(runGit(sourceRoot, ["status", "--porcelain=v1", "--untracked-files=all"]) === "", "pilot_source_changed");
  requireCondition(runGit(projectRoot, ["rev-parse", "HEAD"]) === projectInitial.head, "pilot_project_changed");
  requireCondition(runGit(projectRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]) === projectInitial.branch, "pilot_project_changed");
  requireCondition(runGit(projectRoot, ["remote", "-v"]) === projectInitial.remotes, "pilot_project_changed");
  const seedLock = await acquirePilotSeedLock(projectRoot, options.pilotId, options.confirmSourceSha);
  let lockReleased = false;
  const tempPlanningRoot = path.join(projectRoot, `.planning.tmp-${randomUUID()}`);
  let tempCreated = false;
  let complete = false;
  let published = false;
  let fingerprint;
  try {
    await fs.mkdir(tempPlanningRoot, { mode: 0o700 });
    tempCreated = true;
    await copyCommittedSeed(sourceRoot, tempPlanningRoot, options.confirmSourceSha);
    fingerprint = await fingerprintTree({ root: tempPlanningRoot });
    await syncTree(tempPlanningRoot);
    requireCondition((await fs.lstat(planningRoot).catch(() => null)) === null, "pilot_planning_already_exists");
    if (typeof options.testCheckpoint === "function") await options.testCheckpoint("before_seed_publish");
    try {
      await fs.mkdir(planningRoot, { mode: 0o700 });
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EEXIST") fail("pilot_seed_publish_collision");
      throw error;
    }
    published = true;
    await syncDirectory(projectRoot);
    for (const child of (await fs.readdir(tempPlanningRoot)).sort((left, right) => left.localeCompare(right, "en"))) {
      await installTreeExclusive(path.join(tempPlanningRoot, child), path.join(planningRoot, child));
    }
    await syncDirectory(planningRoot);
    await fs.rmdir(tempPlanningRoot);
    await syncDirectory(projectRoot);
    requireCondition(checkWorkflowState(planningRoot).status === "pass", "pilot_seed_state_invalid");
    if (typeof options.testCheckpoint === "function") await options.testCheckpoint("after_seed_publish");
    const expectedLockedStatus = [
      projectInitial.status,
      "?? .nutrition-gsd-pilot-seed.lock",
    ].sort((left, right) => left.localeCompare(right, "en")).join("\n");
    const verifyTerminalEvidence = async () => {
      const finalFingerprint = await fingerprintTree({ root: planningRoot });
      requireCondition(
        finalFingerprint.entryCount === fingerprint.entryCount &&
          finalFingerprint.totalBytes === fingerprint.totalBytes &&
          finalFingerprint.treeSha256 === fingerprint.treeSha256,
        "pilot_seed_published_fingerprint_changed",
      );
      const finalMarker = await stableFileSnapshot(markerPath, "pilot_marker_changed");
      requireCondition(sameStableSnapshot(finalMarker, markerSnapshot), "pilot_marker_changed");
      requireCondition(
        (await requireCanonicalDeclaredDirectory(options.sourceRoot, "pilot_source_root_unsafe")) === sourceRoot,
        "pilot_source_changed",
      );
      requireCondition(
        (await requireCanonicalDeclaredDirectory(options.projectRoot, "pilot_project_root_unsafe")) === projectRoot,
        "pilot_project_changed",
      );
      const currentSourceCommonDir = await gitCommonDir(sourceRoot);
      const currentProjectCommonDir = await gitCommonDir(projectRoot);
      requireCondition(currentSourceCommonDir === sourceCommonDir, "pilot_source_changed");
      requireCondition(currentProjectCommonDir === projectCommonDir, "pilot_project_changed");
      await requireStandaloneProjectRepository(projectRoot, currentProjectCommonDir);
      requireCondition(
        !pathsOverlap(currentSourceCommonDir, projectRoot) &&
          !pathsOverlap(currentProjectCommonDir, sourceRoot) &&
          !pathsOverlap(currentSourceCommonDir, currentProjectCommonDir),
        "pilot_repository_boundaries_overlap",
      );
      requireCondition(runGit(sourceRoot, ["rev-parse", "HEAD"]) === sourceInitial.head, "pilot_source_changed");
      requireCondition(runGit(sourceRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]) === sourceInitial.branch, "pilot_source_changed");
      requireCondition(runGit(sourceRoot, ["remote", "-v"]) === sourceInitial.remotes, "pilot_source_changed");
      requireCondition(runGit(sourceRoot, ["status", "--porcelain=v1", "--untracked-files=all"]) === "", "pilot_source_changed");
      requireCondition(runGit(projectRoot, ["rev-parse", "HEAD"]) === projectInitial.head, "pilot_project_changed");
      requireCondition(runGit(projectRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]) === projectInitial.branch, "pilot_project_changed");
      requireCondition(runGit(projectRoot, ["remote", "-v"]) === projectInitial.remotes, "pilot_project_changed");
      requireCondition(
        runGit(projectRoot, ["status", "--porcelain=v1", "--untracked-files=all"]) === expectedLockedStatus,
        "pilot_project_changed",
      );
    };
    await verifyTerminalEvidence();
    if (typeof options.testCheckpoint === "function") await options.testCheckpoint("before_seed_lock_release");
    await verifyTerminalEvidence();
    await releasePilotSeedLock(seedLock, projectRoot);
    lockReleased = true;
    complete = true;
  } finally {
    if (!complete && !published) {
      if (tempCreated) await fs.rm(tempPlanningRoot, { recursive: true, force: true });
      if (!lockReleased) await releasePilotSeedLock(seedLock, projectRoot);
    }
  }
  return {
    schemaVersion: 1,
    kind: "gsd_pilot_seed_receipt",
    status: "pass",
    pilotId: options.pilotId,
    sourceSha: options.confirmSourceSha,
    syntheticPhase: "999",
    entryCount: fingerprint.entryCount,
    planningTreeSha256: fingerprint.treeSha256,
    seedManifestSha256: SEED_MANIFEST_SHA256,
  };
}

function parseCli(argv) {
  const values = {};
  const allowed = new Set(["project-root", "source-root", "pilot-id", "confirm-source-sha", "expected-branch", "confirm"]);
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/s);
    requireCondition(match && allowed.has(match[1]) && !Object.hasOwn(values, match[1]), "pilot_seed_usage_error");
    values[match[1]] = match[2];
  }
  requireCondition([...allowed].every((key) => typeof values[key] === "string" && values[key].length > 0), "pilot_seed_usage_error");
  return values;
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  try {
    const values = parseCli(process.argv.slice(2));
    const result = await createGsdPilotSeed({
      projectRoot: values["project-root"],
      sourceRoot: values["source-root"],
      pilotId: values["pilot-id"],
      confirmSourceSha: values["confirm-source-sha"],
      expectedBranch: values["expected-branch"],
      confirm: values.confirm,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        schemaVersion: 1,
        kind: "gsd_pilot_seed_error",
        code: error instanceof GsdPilotSeedError ? error.code : error?.code ?? "pilot_seed_unexpected_error",
      })}\n`,
    );
    process.exitCode = 1;
  }
}
