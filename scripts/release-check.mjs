#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";

const YARN_BIN = process.platform === "win32" ? "yarn.cmd" : "yarn";

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
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
    execFileSync("git", ["rev-parse", "--verify", ref], { stdio: "ignore" });
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

function runStep(label, args) {
  console.log(`\n[release-check] ${label}`);
  const result = spawnSync(YARN_BIN, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const args = process.argv.slice(2);
const baseInfo = resolveBaseRef(args);
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

if (changedFiles.length > 0) {
  console.log(`[release-check] Changed files considered: ${changedFiles.length}`);
} else {
  console.log("[release-check] No changed files detected; running core release gates anyway");
}

runStep("TypeScript gate", ["tsc", "--noEmit"]);
runStep("Full test suite", ["test"]);
if (touchesServerBoundary) {
  console.log(
    "\n[release-check] Note: server route/service changes detected; yarn test already includes the integration suite.",
  );
}

runStep("Frontend build", ["build"]);

console.log("\n[release-check] PASS");
