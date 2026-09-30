#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

function gitOutput(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
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
    } else if (current && line.startsWith("prunable ")) current.prunable = true;
    else if (!line.trim() && current) {
      records.push(current);
      current = null;
    }
  }
  if (current) records.push(current);
  return records.filter((record) => record.root);
}

async function removeStaleFile(target, expectedParent) {
  if (path.resolve(path.dirname(target)) !== path.resolve(expectedParent)) {
    throw new Error(`refusing to remove outside expected parent: ${target}`);
  }
  let parentStat;
  try {
    parentStat = await fs.promises.lstat(expectedParent);
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink()) {
    throw new Error(`refusing to remove through non-physical parent: ${expectedParent}`);
  }
  try {
    const stat = await fs.promises.lstat(target);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`refusing to remove non-regular file at ${target}`);
    }
    const parentAfter = await fs.promises.lstat(expectedParent);
    if (parentAfter.dev !== parentStat.dev || parentAfter.ino !== parentStat.ino) {
      throw new Error(`refusing to remove after parent replacement: ${expectedParent}`);
    }
    await fs.promises.unlink(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function requirePrimarySource(sourcePath) {
  const stat = await fs.promises.lstat(sourcePath).catch((error) => {
    if (error?.code === "ENOENT") throw new Error(`primary AGENTS.md is missing: ${sourcePath}`);
    throw error;
  });
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`primary AGENTS.md must be a regular file: ${sourcePath}`);
  }
  return fs.promises.readFile(sourcePath);
}

async function linkSecondaryAgent(worktreeRoot, sourcePath) {
  const target = path.join(worktreeRoot, "AGENTS.md");
  const stat = await fs.promises.lstat(target).catch((error) => {
    if (error?.code === "ENOENT") return null;
    throw error;
  });
  if (stat?.isSymbolicLink()) {
    const currentTarget = await fs.promises.readlink(target);
    if (path.resolve(worktreeRoot, currentTarget) === sourcePath) return false;
  }
  if (stat) await removeStaleFile(target, worktreeRoot);
  await fs.promises.symlink(sourcePath, target);
  return true;
}

export async function syncWorktreeAgents({ projectRoot = process.cwd() } = {}) {
  const cwd = physicalPath(projectRoot);
  const commonDir = physicalPath(gitOutput(["rev-parse", "--git-common-dir"], cwd));
  const primaryRoot = path.dirname(commonDir);
  const sourcePath = path.join(primaryRoot, "AGENTS.md");
  const sourceBytes = await requirePrimarySource(sourcePath);
  const commonLocal = path.join(commonDir, "codex-local");
  await removeStaleFile(path.join(commonLocal, "AGENTS.md"), commonLocal);

  const records = parseWorktreeList(gitOutput(["worktree", "list", "--porcelain"], cwd));
  const skippedWorktrees = records.filter((record) => record.prunable).map((record) => record.root);
  const worktrees = [];
  const linked = [];
  for (const record of records.filter((candidate) => !candidate.prunable)) {
    let worktreeRoot;
    try {
      worktreeRoot = physicalPath(record.root);
    } catch (error) {
      if (error?.code === "ENOENT") {
        skippedWorktrees.push(record.root);
        continue;
      }
      throw error;
    }
    worktrees.push(record.root);
    if (worktreeRoot === primaryRoot) continue;
    if (await linkSecondaryAgent(worktreeRoot, sourcePath)) linked.push(path.join(worktreeRoot, "AGENTS.md"));
  }

  return {
    commonDir,
    primaryRoot,
    sourcePath,
    sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
    worktrees,
    skippedWorktrees,
    linked,
  };
}

function parseProjectRoot(argv) {
  if (argv.length === 0) return process.cwd();
  if (argv.length !== 1 || !argv[0].startsWith("--project-root=")) {
    throw new Error("usage: sync-worktree-agents [--project-root=<path>]");
  }
  const value = argv[0].slice("--project-root=".length);
  if (!value) throw new Error("--project-root requires a path");
  return value;
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  syncWorktreeAgents({ projectRoot: parseProjectRoot(process.argv.slice(2)) })
    .then((result) => process.stdout.write(`${JSON.stringify(result)}\n`))
    .catch((error) => {
      console.error(`[sync-worktree-agents] ${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    });
}
