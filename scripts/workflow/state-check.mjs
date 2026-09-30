#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { runAuthoritativeGit } from "../git-authority.mjs";

const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const PHASE_DIRECTORY_PATTERN = /^\d+(?:\.\d+)?-[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PLAN_PATTERN = /^\d+(?:\.\d+)?-\d+-PLAN\.md$/;
const SUMMARY_PATTERN = /^\d+(?:\.\d+)?-\d+-SUMMARY\.md$/;
const PHASE_AUXILIARY_PATTERN =
  /^\d+(?:\.\d+)?-(?:AI-SPEC|CHECKPOINT|CONTEXT|DISCUSSION(?:-LOG)?|EVAL-REVIEW|PATTERNS|PREFLIGHT|R03-DIAGNOSTIC|RESEARCH|REVIEW|SECURITY|SPEC|UI-SPEC|UAT|VALIDATION|VERIFICATION)\.md$/;
const SUMMARY_STATUSES = new Set([
  "active",
  "blocked",
  "complete",
  "completed",
  "done",
  "executing",
  "in progress",
  "not started",
  "paused",
  "pending",
  "planned",
  "planning",
  "ready to execute",
  "ready to plan",
]);

function evidenceError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireCondition(condition, code) {
  if (!condition) throw evidenceError(code);
}

function errorCode(error, fallback) {
  return typeof error?.code === "string" ? error.code : fallback;
}

function resolveScope(projectRoot, requestedPlanningRoot) {
  requireCondition(typeof projectRoot === "string" && projectRoot.length > 0, "planning_evidence_scope_invalid");
  const requested = path.resolve(projectRoot);
  const rootStat = fs.lstatSync(requested);
  requireCondition(rootStat.isDirectory() && !rootStat.isSymbolicLink(), "planning_evidence_scope_invalid");
  requireCondition(fs.realpathSync.native(requested) === requested, "planning_evidence_scope_invalid");

  const gitTopLevel = runAuthoritativeGit(["rev-parse", "--show-toplevel"], {
    cwd: requested,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  requireCondition(fs.realpathSync.native(gitTopLevel) === requested, "planning_evidence_scope_invalid");

  const planningRoot = path.join(requested, ".planning");
  requireCondition(path.resolve(requestedPlanningRoot) === planningRoot, "planning_evidence_scope_invalid");
  return { projectRoot: requested, planningRoot };
}

function sourceSha(projectRoot) {
  const value = runAuthoritativeGit(["rev-parse", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  requireCondition(SOURCE_SHA_PATTERN.test(value), "planning_evidence_source_sha_invalid");
  return value;
}

function statIdentity(stat) {
  return {
    dev: stat.dev.toString(),
    ino: stat.ino.toString(),
    nlink: stat.nlink.toString(),
    mode: stat.mode.toString(),
    size: stat.size.toString(),
    mtimeNs: stat.mtimeNs.toString(),
    ctimeNs: stat.ctimeNs.toString(),
  };
}

function sameIdentity(left, right) {
  return JSON.stringify(statIdentity(left)) === JSON.stringify(statIdentity(right));
}

function readStableFile(filePath, expectedStat) {
  const descriptor = fs.openSync(filePath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    requireCondition(before.isFile() && sameIdentity(before, expectedStat), "planning_evidence_tree_changed_during_read");
    requireCondition(before.size <= BigInt(MAX_FILE_BYTES), "planning_evidence_file_limit_exceeded");
    const content = Buffer.alloc(Number(before.size));
    let position = 0;
    while (position < content.length) {
      const read = fs.readSync(descriptor, content, position, content.length - position, position);
      requireCondition(read > 0, "planning_evidence_tree_changed_during_read");
      position += read;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    requireCondition(sameIdentity(before, after), "planning_evidence_tree_changed_during_read");
    return content;
  } finally {
    fs.closeSync(descriptor);
  }
}

function captureSnapshot(root) {
  const entries = [];
  const files = new Map();
  const directories = new Set();
  const children = new Map();
  let totalBytes = 0;

  function addChild(parent, name, type) {
    const values = children.get(parent) ?? [];
    values.push({ name, type });
    children.set(parent, values);
  }

  function visit(current, relative) {
    requireCondition(entries.length < MAX_ENTRIES, "planning_evidence_entry_limit_exceeded");
    const before = fs.lstatSync(current, { bigint: true });
    requireCondition(!before.isSymbolicLink(), "planning_evidence_tree_unsafe");

    if (before.isDirectory()) {
      requireCondition(fs.realpathSync.native(current) === current, "planning_evidence_tree_unsafe");
      directories.add(relative);
      entries.push({ path: relative, type: "directory", ...statIdentity(before) });
      const names = fs.readdirSync(current).sort((left, right) => left.localeCompare(right, "en"));
      for (const name of names) {
        requireCondition(!/[\r\n]/.test(name), "planning_evidence_tree_unsafe");
        const childRelative = relative ? path.posix.join(relative, name) : name;
        const type = visit(path.join(current, name), childRelative);
        addChild(relative, name, type);
      }
      const after = fs.lstatSync(current, { bigint: true });
      requireCondition(sameIdentity(before, after), "planning_evidence_tree_changed_during_read");
      return "directory";
    }

    requireCondition(before.isFile() && before.nlink === 1n, "planning_evidence_tree_unsafe");
    const content = readStableFile(current, before);
    totalBytes += content.length;
    requireCondition(totalBytes <= MAX_TOTAL_BYTES, "planning_evidence_total_limit_exceeded");
    const sha256 = createHash("sha256").update(content).digest("hex");
    files.set(relative, { content, sha256 });
    entries.push({ path: relative, type: "file", ...statIdentity(before), sha256 });
    return "file";
  }

  visit(root, "");
  for (const values of children.values()) {
    values.sort((left, right) => left.name.localeCompare(right.name, "en"));
  }
  entries.sort((left, right) => left.path.localeCompare(right.path, "en"));
  return {
    treeSha256: createHash("sha256").update(`${JSON.stringify(entries)}\n`).digest("hex"),
    files,
    directories,
    children,
  };
}

function captureStableSnapshot(root) {
  const first = captureSnapshot(root);
  const second = captureSnapshot(root);
  requireCondition(first.treeSha256 === second.treeSha256, "planning_evidence_changed_during_snapshot");
  return second;
}

function summaryStatus(content) {
  const lines = content.toString("utf8").split(/\r?\n/);
  if (lines[0] !== "---") return null;
  const end = lines.indexOf("---", 1);
  if (end === -1) return null;
  const values = [];
  for (const line of lines.slice(1, end)) {
    const match = line.match(/^status:\s*(.*?)\s*$/);
    if (match) values.push(match[1]);
  }
  if (values.length !== 1) return null;
  const raw = values[0];
  const quoted = raw.match(/^(["'])(.*)\1$/);
  const normalized = (quoted ? quoted[2] : raw).trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return SUMMARY_STATUSES.has(normalized) ? normalized : null;
}

function validateActiveTree(snapshot) {
  const errors = [];
  if (!snapshot.directories.has("phases")) {
    return [{ code: "planning_evidence_phases_root_missing" }];
  }

  for (const entry of snapshot.children.get("phases") ?? []) {
    if (entry.type === "file" && entry.name === ".gitkeep") {
      if (snapshot.files.get("phases/.gitkeep")?.content.length !== 0) {
        errors.push({ code: "planning_evidence_unknown_phases_entry", entry: entry.name });
      }
      continue;
    }
    if (entry.type !== "directory" || !PHASE_DIRECTORY_PATTERN.test(entry.name)) {
      errors.push({ code: "planning_evidence_unknown_phases_entry", entry: entry.name });
      continue;
    }

    const phasePath = `phases/${entry.name}`;
    for (const child of snapshot.children.get(phasePath) ?? []) {
      const relative = `${phasePath}/${child.name}`;
      if (child.type === "directory" && child.name === "attempts") continue;
      if (child.type !== "file") {
        errors.push({ code: "planning_evidence_unknown_phase_entry", phase: entry.name, entry: child.name });
        continue;
      }
      if (child.name === ".gitkeep" && snapshot.files.get(relative)?.content.length === 0) continue;
      if (PLAN_PATTERN.test(child.name) || PHASE_AUXILIARY_PATTERN.test(child.name)) continue;
      if (SUMMARY_PATTERN.test(child.name)) {
        if (summaryStatus(snapshot.files.get(relative).content) === null) {
          errors.push({ code: "planning_evidence_summary_status_invalid", phase: entry.name, entry: child.name });
        }
        continue;
      }
      errors.push({ code: "planning_evidence_unknown_phase_entry", phase: entry.name, entry: child.name });
    }
  }
  return errors;
}

export function checkWorkflowState(planningRoot, options = {}) {
  let scope;
  try {
    scope = resolveScope(options.projectRoot ?? path.dirname(path.resolve(planningRoot)), planningRoot);
  } catch (error) {
    return {
      schemaVersion: 1,
      kind: "planning_evidence_check",
      status: "fail",
      errors: [{ code: errorCode(error, "planning_evidence_scope_invalid") }],
    };
  }

  let initialSha;
  let initialSnapshot;
  try {
    initialSha = sourceSha(scope.projectRoot);
    initialSnapshot = captureStableSnapshot(scope.planningRoot);
  } catch (error) {
    return {
      schemaVersion: 1,
      kind: "planning_evidence_check",
      status: "fail",
      errors: [{ code: errorCode(error, "planning_evidence_tree_unsafe") }],
    };
  }

  const errors = validateActiveTree(initialSnapshot);
  options.testCheckpoint?.("before_final_freshness_check");

  try {
    const finalSha = sourceSha(scope.projectRoot);
    const finalSnapshot = captureStableSnapshot(scope.planningRoot);
    if (finalSha !== initialSha || finalSnapshot.treeSha256 !== initialSnapshot.treeSha256) {
      errors.push({ code: "planning_evidence_changed_during_check" });
    }
  } catch (error) {
    errors.push({ code: errorCode(error, "planning_evidence_changed_during_check") });
  }

  return {
    schemaVersion: 1,
    kind: "planning_evidence_check",
    status: errors.length === 0 ? "pass" : "fail",
    sourceSha: initialSha,
    planningTreeSha256: initialSnapshot.treeSha256,
    errors,
  };
}

function parseCli(argv) {
  if (argv.length !== 1 || !argv[0].startsWith("--project-root=")) {
    throw new Error("usage");
  }
  const value = argv[0].slice("--project-root=".length);
  if (!value) throw new Error("usage");
  return path.resolve(value);
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : null;
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  let result;
  try {
    const projectRoot = parseCli(process.argv.slice(2));
    result = checkWorkflowState(path.join(projectRoot, ".planning"), { projectRoot });
  } catch {
    result = {
      schemaVersion: 1,
      kind: "planning_evidence_check",
      status: "fail",
      errors: [{ code: "usage_error" }],
    };
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
  process.exitCode = result.status === "pass" ? 0 : 1;
}
