#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function gitOutput(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function physicalPath(candidate) {
  return fs.realpathSync.native(path.resolve(candidate));
}

function parseWorktreeList(output) {
  const records = [];
  let current = null;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      if (current) records.push(current);
      current = { root: line.slice("worktree ".length).trim(), prunable: false };
    } else if (current && line.startsWith("prunable ")) {
      current.prunable = true;
    } else if (!line.trim() && current) {
      records.push(current);
      current = null;
    }
  }
  if (current) records.push(current);
  return records.filter((record) => record.root);
}

function samePath(left, right) {
  return physicalPath(left) === physicalPath(right);
}

async function removeIfPresent(target, expectedParent) {
  const parent = path.dirname(target);
  if (expectedParent && path.resolve(parent) !== path.resolve(expectedParent)) {
    throw new Error(`refusing to remove outside expected parent: ${target}`);
  }
  let parentStat;
  try {
    parentStat = await fs.promises.lstat(parent);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error(`refusing to remove through non-physical parent: ${parent}`);
  }
  try {
    const stat = await fs.promises.lstat(target);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      throw new Error(`refusing to remove directory at ${target}`);
    }
    if (stat.isSymbolicLink()) throw new Error(`refusing to remove symlink at ${target}`);
    if (!stat.isFile()) throw new Error(`refusing to remove non-regular file at ${target}`);
    const parentAfter = await fs.promises.lstat(parent);
    if (parentAfter.dev !== parentStat.dev || parentAfter.ino !== parentStat.ino) {
      throw new Error(`refusing to remove after parent replacement: ${parent}`);
    }
    await fs.promises.unlink(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function ensurePrimarySource(sourcePath) {
  let stat;
  try {
    stat = await fs.promises.lstat(sourcePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`primary AGENTS.md is missing: ${sourcePath}`);
    }
    throw error;
  }

  if (stat.isSymbolicLink()) throw new Error(`primary AGENTS.md must not be a symlink: ${sourcePath}`);
  if (!stat.isFile()) throw new Error(`primary AGENTS.md is not a regular file: ${sourcePath}`);
  return fs.promises.readFile(sourcePath);
}

async function linkSecondaryAgent(worktreeRoot, sourcePath) {
  const target = path.join(worktreeRoot, "AGENTS.md");
  let stat;
  try {
    stat = await fs.promises.lstat(target);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (stat?.isSymbolicLink()) {
    const currentTarget = await fs.promises.readlink(target);
    if (path.resolve(worktreeRoot, currentTarget) === sourcePath) return false;
  }

  if (stat) await removeIfPresent(target, worktreeRoot);
  await fs.promises.symlink(sourcePath, target);
  return true;
}

/**
 * Make the ignored primary checkout AGENTS.md authoritative for every linked
 * worktree. The Git common directory is discovered from Git itself so this
 * works from a primary, linked, or detached worktree without shared absolute
 * paths.
 */
export async function syncWorktreeAgents({ projectRoot = process.cwd() } = {}) {
  const cwd = physicalPath(projectRoot);
  const commonDir = physicalPath(gitOutput(["rev-parse", "--git-common-dir"], cwd));
  const primaryRoot = path.dirname(commonDir);
  const sourcePath = path.join(primaryRoot, "AGENTS.md");
  const sourceBytes = await ensurePrimarySource(sourcePath);

  // A previous hook used this common-dir file as the source, creating a
  // split-brain policy. Remove only that exact stale duplicate.
  const commonLocal = path.join(commonDir, "codex-local");
  await removeIfPresent(path.join(commonLocal, "AGENTS.md"), commonLocal);

  const worktreeRecords = parseWorktreeList(gitOutput(["worktree", "list", "--porcelain"], cwd));
  const worktreeRoots = worktreeRecords.filter((record) => !record.prunable).map((record) => record.root);
  const skippedWorktrees = worktreeRecords.filter((record) => record.prunable).map((record) => record.root);
  const changed = [];
  for (const listedRoot of worktreeRoots) {
    let worktreeRoot;
    try {
      worktreeRoot = physicalPath(listedRoot);
    } catch (error) {
      if (error?.code === "ENOENT") {
        skippedWorktrees.push(listedRoot);
        continue;
      }
      throw error;
    }
    if (samePath(worktreeRoot, primaryRoot)) {
      const stat = await fs.promises.lstat(sourcePath);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`primary AGENTS.md must remain a regular file: ${sourcePath}`);
      }
      continue;
    }
    if (await linkSecondaryAgent(worktreeRoot, sourcePath)) changed.push(path.join(worktreeRoot, "AGENTS.md"));
  }

  return {
    commonDir,
    primaryRoot,
    sourcePath,
    sourceSha256: (await import("node:crypto")).createHash("sha256").update(sourceBytes).digest("hex"),
    worktrees: worktreeRoots,
    skippedWorktrees,
    linked: changed,
  };
}

function parseProjectRoot(argv) {
  const value = argv.find((argument) => argument.startsWith("--project-root="));
  if (!value) return process.cwd();
  const projectRoot = value.slice("--project-root=".length);
  if (!projectRoot) throw new Error("--project-root requires a path");
  return projectRoot;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  syncWorktreeAgents({ projectRoot: parseProjectRoot(process.argv.slice(2)) })
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    })
    .catch((error) => {
      console.error(`[sync-worktree-agents] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
