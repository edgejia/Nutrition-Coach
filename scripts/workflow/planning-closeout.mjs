#!/usr/bin/env node

import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { checkArtifactProvenance } from "./artifact-provenance.mjs";
import { resolveCanonicalPlanningRoot } from "./project-scope.mjs";
import { checkVerificationSeal } from "./verification-seal.mjs";
import { getWorkflowLeaseStatus, verifyWorkflowLeaseSignature, withWorkflowWriterFence } from "./workflow-lease.mjs";

const MILESTONE_PATTERN = /^v\d+(?:\.\d+)+$/;
const TRANSIENT_DIRS = ["quick", "debug", "forensics", "todos", "notes", "threads", "seeds", "research"];
const CACHE_FILES = new Set([".DS_Store", "Thumbs.db"]);
const ARCHIVE_FILES = ["ROADMAP.md", "REQUIREMENTS.md", "MILESTONE-AUDIT.md"];
const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/;
const PROVENANCE_ARTIFACT_PATTERN = /^\d+(?:\.\d+)?(?:-\d+)?-(?:PLAN|SUMMARY|VERIFICATION)\.md$/;
const PROVENANCE_FRONTMATTER_KEYS = [
  "workflow_provenance_schema",
  "artifact_payload_sha256",
  "artifact_source_sha",
  "artifact_gsd_version",
  "artifact_execution_runtime",
  "artifact_model_profile",
  "artifact_lease_id",
  "artifact_lease_attestation_sha256",
  "artifact_provenance_signature",
];
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MAX_JOURNAL_BYTES = 1024 * 1024;

function completedMilestoneState(milestone) {
  return `# Project State\n\nMilestone ${milestone} complete\n\nAwaiting next milestone.\n`;
}

function archivedMilestoneRoadmap(milestone) {
  return `# Roadmap\n\n- ${milestone} archived\n`;
}

function hasExactTerminalMilestoneIndexEntry(content, milestone) {
  const escapedMilestone = milestone.replaceAll(".", "\\.");
  const simpleEntry = `- ${milestone} complete`;
  const shippedEntry = new RegExp(
    `^## ${escapedMilestone}(?: [^\\r\\n]*\\S)? \\(Shipped: \\d{4}-\\d{2}-\\d{2}\\)$`,
  );
  const recordPrefix = new RegExp(`^(?:- |## )${escapedMilestone}(?:\\s|$)`);
  const records = content.split(/\r?\n/).filter((line) => recordPrefix.test(line));
  if (records.length !== 1) return false;
  const contradictoryStatus = /\b(?:active|incomplete|planned|blocked|cancelled)\b|\bnot\s+(?:complete|shipped)\b/i;
  return !contradictoryStatus.test(records[0]) && (records[0] === simpleEntry || shippedEntry.test(records[0]));
}

function requireCondition(condition, code) {
  if (!condition) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}

function relative(root, candidate) {
  return path.relative(root, candidate).split(path.sep).join("/");
}

async function exists(candidate) {
  try {
    await fs.lstat(candidate);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

function stableStatIdentity(stat) {
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

function sameStableStat(left, right) {
  return JSON.stringify(stableStatIdentity(left)) === JSON.stringify(stableStatIdentity(right));
}

async function readStableFileSnapshot(candidate, options = {}) {
  const code = options.code ?? "closeout_file_snapshot_changed";
  let handle;
  try {
    handle = await fs.open(candidate, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (error) {
    if (options.required === false && error && typeof error === "object" && error.code === "ENOENT") return null;
    requireCondition(
      false,
      error && typeof error === "object" && error.code === "ENOENT"
        ? (options.missingCode ?? code)
        : error && typeof error === "object" && error.code === "ELOOP"
          ? "closeout_symlink_rejected"
          : code,
    );
  }
  let before;
  let after;
  let bytes;
  try {
    before = await handle.stat({ bigint: true });
    requireCondition(before.isFile(), code);
    if (options.maxBytes !== undefined) {
      requireCondition(before.size > 0n && before.size <= BigInt(options.maxBytes), code);
    }
    bytes = await handle.readFile();
    after = await handle.stat({ bigint: true });
    requireCondition(sameStableStat(before, after), code);
    if (options.maxBytes !== undefined) requireCondition(bytes.length <= options.maxBytes, code);
  } finally {
    await handle.close().catch(() => undefined);
  }
  const linked = await fs.lstat(candidate, { bigint: true }).catch((error) => {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  });
  requireCondition(
    linked?.isFile() && !linked.isSymbolicLink() && linked.dev === after.dev && linked.ino === after.ino,
    code,
  );
  return {
    bytes,
    rawSha256: createHash("sha256").update(bytes).digest("hex"),
    dev: after.dev.toString(),
    ino: after.ino.toString(),
    identity: stableStatIdentity(after),
  };
}

async function stableDirectoryIdentity(candidate, code = "closeout_tree_snapshot_changed") {
  const stat = await fs.lstat(candidate, { bigint: true }).catch(() => null);
  requireCondition(stat?.isDirectory() && !stat.isSymbolicLink(), code);
  return stableStatIdentity(stat);
}

async function assertStableDirectory(candidate, expected, code = "closeout_tree_snapshot_changed") {
  const observed = await stableDirectoryIdentity(candidate, code);
  requireCondition(JSON.stringify(observed) === JSON.stringify(expected), code);
}

async function hashFile(candidate) {
  return (await readStableFileSnapshot(candidate)).rawSha256;
}

async function readPlainFileOrEmpty(candidate) {
  const stat = await fs.lstat(candidate).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) return "";
  return (await readStableFileSnapshot(candidate)).bytes.toString("utf8");
}

function resolveSourceSha(projectRoot) {
  let value;
  try {
    value = execFileSync("git", ["rev-parse", "HEAD"], { cwd: path.resolve(projectRoot), encoding: "utf8" }).trim();
  } catch {
    requireCondition(false, "closeout_project_git_required");
  }
  requireCondition(SOURCE_SHA_PATTERN.test(value), "closeout_live_source_sha_invalid");
  return value;
}

function resolveGitCommonDir(projectRoot) {
  let value;
  try {
    value = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: path.resolve(projectRoot),
      encoding: "utf8",
    }).trim();
  } catch {
    requireCondition(false, "closeout_project_git_required");
  }
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(projectRoot, value);
}

function withinProject(candidate, projectRoot) {
  const relativePath = path.relative(path.resolve(projectRoot), path.resolve(candidate));
  return relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath);
}

async function listTree(root, options = {}) {
  const includeIdentity = options.includeIdentity === true;
  const entries = [];
  async function visit(current, base, expectedDirectory = null) {
    const directoryIdentity = await stableDirectoryIdentity(current);
    if (expectedDirectory !== null) {
      requireCondition(
        JSON.stringify(directoryIdentity) === JSON.stringify(expectedDirectory),
        "closeout_tree_snapshot_changed",
      );
    }
    if (includeIdentity && base === "") {
      entries.push({ path: "", type: "directory", identity: directoryIdentity });
    }
    const children = await fs.readdir(current, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name, "en"));
    for (const child of children) {
      const absolute = path.join(current, child.name);
      const rel = base ? path.posix.join(base, child.name) : child.name;
      const stat = await fs.lstat(absolute, { bigint: true });
      requireCondition(!stat.isSymbolicLink(), "closeout_symlink_rejected");
      if (stat.isDirectory()) {
        const identity = stableStatIdentity(stat);
        entries.push({ path: rel, type: "directory", ...(includeIdentity ? { identity } : {}) });
        await visit(absolute, rel, identity);
      } else if (stat.isFile()) {
        const snapshot = await readStableFileSnapshot(absolute);
        if (includeIdentity) {
          requireCondition(snapshot.identity.nlink === "1", "closeout_hardlink_rejected");
        }
        entries.push({
          path: rel,
          type: "file",
          sha256: snapshot.rawSha256,
          ...(includeIdentity ? { identity: snapshot.identity } : {}),
        });
      } else {
        requireCondition(false, "closeout_special_file_rejected");
      }
    }
    await assertStableDirectory(current, directoryIdentity);
  }
  await visit(root, "");
  return entries;
}

async function planningTreeEvidence(root) {
  const freshnessEntries = await listTree(root, { includeIdentity: true });
  const contentEntries = freshnessEntries
    .filter((entry) => entry.path !== "")
    .map(({ identity: _identity, ...entry }) => entry);
  return {
    contentSha256: createHash("sha256").update(JSON.stringify(contentEntries)).digest("hex"),
    freshnessSha256: createHash("sha256").update(JSON.stringify(freshnessEntries)).digest("hex"),
  };
}

async function identical(source, destination) {
  const sourceStat = await fs.lstat(source);
  const destinationStat = await fs.lstat(destination);
  if (sourceStat.isFile() && destinationStat.isFile()) {
    return (await hashFile(source)) === (await hashFile(destination));
  }
  if (sourceStat.isDirectory() && destinationStat.isDirectory()) {
    return JSON.stringify(await listTree(source)) === JSON.stringify(await listTree(destination));
  }
  return false;
}

async function pathIdentity(candidate) {
  const stat = await fs.lstat(candidate);
  requireCondition(!stat.isSymbolicLink(), "closeout_symlink_rejected");
  if (stat.isFile()) return { type: "file", sha256: await hashFile(candidate) };
  if (stat.isDirectory()) {
    return {
      type: "directory",
      sha256: createHash("sha256").update(JSON.stringify(await listTree(candidate))).digest("hex"),
    };
  }
  requireCondition(false, "closeout_special_file_rejected");
}

function sameIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function hasArtifactProvenanceFrontmatter(content) {
  if (!content.startsWith("---\n")) return false;
  const end = content.indexOf("\n---", 4);
  if (end === -1) return false;
  const frontmatter = content.slice(4, end);
  return PROVENANCE_FRONTMATTER_KEYS.some((key) => new RegExp(`^${key}:`, "m").test(frontmatter));
}

function flatMappings(root, milestone) {
  const milestones = path.join(root, "milestones");
  const archive = path.join(milestones, milestone);
  return [
    [path.join(milestones, `${milestone}-ROADMAP.md`), path.join(archive, "ROADMAP.md")],
    [path.join(milestones, `${milestone}-REQUIREMENTS.md`), path.join(archive, "REQUIREMENTS.md")],
    [path.join(milestones, `${milestone}-MILESTONE-AUDIT.md`), path.join(archive, "MILESTONE-AUDIT.md")],
    [path.join(root, `${milestone}-MILESTONE-AUDIT.md`), path.join(archive, "MILESTONE-AUDIT.md")],
    [path.join(root, `${milestone}-${milestone}-MILESTONE-AUDIT.md`), path.join(archive, "MILESTONE-AUDIT.md")],
    [path.join(milestones, `${milestone}-phases`), path.join(archive, "phases")],
  ];
}

async function cacheOnlyDirectory(directory) {
  const files = [];
  for (const entry of await listTree(directory)) {
    if (entry.type === "directory") continue;
    const name = path.posix.basename(entry.path);
    const parent = path.posix.basename(path.posix.dirname(entry.path));
    if (CACHE_FILES.has(name) || ([".cache", "cache"].includes(parent) && /^[0-9a-f]{64}\.json$/.test(name))) {
      files.push(path.join(directory, entry.path));
    } else {
      return { safe: false, files };
    }
  }
  return { safe: true, files };
}

async function planNormalization(root, milestone) {
  const operations = [];
  const errors = [];
  const reservedDestinations = new Map();
  for (const [source, destination] of flatMappings(root, milestone)) {
    if (!(await exists(source))) continue;
    if (await exists(destination)) {
      if (await identical(source, destination)) {
        operations.push({
          type: "remove_duplicate",
          path: relative(root, source),
          sourceIdentity: await pathIdentity(source),
          sourceManifest: (await fs.lstat(source)).isDirectory() ? await listTree(source) : null,
          destination: relative(root, destination),
          destinationIdentity: await pathIdentity(destination),
        });
      } else {
        errors.push({ code: "closeout_archive_collision", source: relative(root, source), destination: relative(root, destination) });
      }
    } else {
      const reserved = reservedDestinations.get(destination);
      if (!reserved) {
        reservedDestinations.set(destination, source);
        operations.push({
          type: "move",
          source: relative(root, source),
          destination: relative(root, destination),
          sourceIdentity: await pathIdentity(source),
        });
      } else if (await identical(source, reserved)) {
        operations.push({
          type: "remove_duplicate",
          path: relative(root, source),
          sourceIdentity: await pathIdentity(source),
          sourceManifest: (await fs.lstat(source)).isDirectory() ? await listTree(source) : null,
          destination: relative(root, destination),
          destinationIdentity: await pathIdentity(reserved),
        });
      } else {
        errors.push({
          code: "closeout_planned_destination_collision",
          sources: [relative(root, reserved), relative(root, source)].sort((left, right) => left.localeCompare(right, "en")),
          destination: relative(root, destination),
        });
      }
    }
  }

  for (const name of TRANSIENT_DIRS) {
    const directory = path.join(root, name);
    if (!(await exists(directory))) continue;
    const candidate = await cacheOnlyDirectory(directory);
    if (candidate.safe) {
      operations.push({
        type: "remove_cache_tree",
        path: relative(root, directory),
        sourceIdentity: await pathIdentity(directory),
        sourceManifest: await listTree(directory),
      });
    } else {
      errors.push({ code: "closeout_human_decision_required", path: relative(root, directory) });
    }
  }

  const statePath = path.join(root, "STATE.md");
  const roadmapPath = path.join(root, "ROADMAP.md");
  const milestonesPath = path.join(root, "MILESTONES.md");
  const state = (await exists(statePath)) ? await readPlainFileOrEmpty(statePath) : null;
  const roadmap = (await exists(roadmapPath)) ? await readPlainFileOrEmpty(roadmapPath) : null;
  const milestones = (await exists(milestonesPath)) ? await readPlainFileOrEmpty(milestonesPath) : null;
  if (state === null || roadmap === null || milestones === null) {
    errors.push({ code: "closeout_root_document_missing" });
  } else {
    if (state !== completedMilestoneState(milestone)) {
      const lines = state.split(/\r?\n/).filter((line) => line.trim().length > 0);
      const safeSimpleState =
        lines.length <= 8 &&
        lines[0] === "# Project State" &&
        lines[1] === `Milestone ${milestone} complete` &&
        lines.slice(2).every((line) =>
          /^(?:Status:\s*(?:executing|in_progress|blocked)|Resume file:\s*\S+|Awaiting next milestone\.?)$/i.test(line),
        );
      if (safeSimpleState) {
        const replacement = completedMilestoneState(milestone);
        operations.push({
          type: "rewrite_root_document",
          path: "STATE.md",
          template: "completed_milestone_state_v1",
          sourceIdentity: await pathIdentity(statePath),
          replacementSha256: createHash("sha256").update(replacement).digest("hex"),
        });
      } else {
        errors.push({ code: "closeout_state_human_decision_required", path: "STATE.md" });
      }
    }
    if (roadmap !== archivedMilestoneRoadmap(milestone)) {
      const lines = roadmap.split(/\r?\n/).filter((line) => line.trim().length > 0);
      const safeSimpleRoadmap =
        lines.length <= 8 &&
        lines[0] === "# Roadmap" &&
        lines[1] === `- ${milestone} archived` &&
        lines.slice(2).every((line) => line === `- ${milestone} archived` || /^### Phase \d+(?:\.\d+)?:/.test(line) || /^- \[[ x]\]/.test(line));
      if (safeSimpleRoadmap) {
        const replacement = archivedMilestoneRoadmap(milestone);
        operations.push({
          type: "rewrite_root_document",
          path: "ROADMAP.md",
          template: "archived_milestone_roadmap_v1",
          sourceIdentity: await pathIdentity(roadmapPath),
          replacementSha256: createHash("sha256").update(replacement).digest("hex"),
        });
      } else {
        errors.push({ code: "closeout_roadmap_human_decision_required", path: "ROADMAP.md" });
      }
    }
    if (!hasExactTerminalMilestoneIndexEntry(milestones, milestone)) {
      errors.push({ code: "closeout_milestones_human_decision_required", path: "MILESTONES.md" });
    }
  }

  for (const phaseRoot of [path.join(root, "milestones", `${milestone}-phases`)]) {
    if (!(await exists(phaseRoot))) continue;
    for (const entry of await listTree(phaseRoot)) {
      if (entry.type !== "file" || !PROVENANCE_ARTIFACT_PATTERN.test(path.posix.basename(entry.path))) continue;
      const artifact = path.join(phaseRoot, entry.path);
      const content = (await readStableFileSnapshot(artifact)).bytes.toString("utf8");
      if (hasArtifactProvenanceFrontmatter(content)) {
        errors.push({
          code: "closeout_prearchive_provenance_forbidden",
          path: relative(root, artifact),
        });
      }
    }
  }

  operations.sort((left, right) => {
    const leftKey = `${left.type}:${left.source ?? left.path}:${left.destination ?? ""}`;
    const rightKey = `${right.type}:${right.source ?? right.path}:${right.destination ?? ""}`;
    return leftKey.localeCompare(rightKey, "en");
  });
  errors.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  return { operations, errors };
}

function replacementForOperation(operation, milestone) {
  if (operation.template === "completed_milestone_state_v1") {
    return completedMilestoneState(milestone);
  }
  if (operation.template === "archived_milestone_roadmap_v1") {
    return archivedMilestoneRoadmap(milestone);
  }
  requireCondition(false, "closeout_rewrite_template_invalid");
}

async function syncDirectory(directory) {
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function journalTimestamp(now = new Date()) {
  requireCondition(now instanceof Date && !Number.isNaN(now.valueOf()), "closeout_journal_time_invalid");
  return now.toISOString();
}

function closeoutPlanPayload(value) {
  return {
    milestone: value.milestone,
    operations: value.operations,
    errors: value.errors,
    sourceSha: value.sourceSha,
    planningRoot: value.planningRoot,
    worktreeIdentitySha256: value.worktreeIdentitySha256,
    gitCommonIdentitySha256: value.gitCommonIdentitySha256,
    initialTreeSha256: value.initialTreeSha256,
  };
}

function closeoutPlanSha256(value) {
  return createHash("sha256").update(JSON.stringify(closeoutPlanPayload(value))).digest("hex");
}

function journalPayload(value) {
  return {
    schemaVersion: value.schemaVersion,
    kind: value.kind,
    state: value.state,
    journalId: value.journalId,
    milestone: value.milestone,
    planSha256: value.planSha256,
    sourceSha: value.sourceSha,
    planningRoot: value.planningRoot,
    worktreeIdentitySha256: value.worktreeIdentitySha256,
    gitCommonIdentitySha256: value.gitCommonIdentitySha256,
    initialTreeManifest: value.initialTreeManifest,
    initialTreeSha256: value.initialTreeSha256,
    operations: value.operations,
    nextOperationIndex: value.nextOperationIndex,
    operationStage: value.operationStage,
    activeLeaseId: value.activeLeaseId,
    activeFenceId: value.activeFenceId,
    leaseAttestationSha256: value.leaseAttestationSha256,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function journalSignaturePayload(value) {
  return { ...journalPayload(value), journalSha256: value.journalSha256 };
}

function withJournalDigest(value, holder) {
  const next = {
    ...value,
    activeLeaseId: holder.leaseId,
    activeFenceId: holder.fenceId,
    leaseAttestationSha256: holder.leaseAttestationSha256,
  };
  next.journalSha256 = createHash("sha256").update(JSON.stringify(journalPayload(next))).digest("hex");
  next.journalSignature = holder.signPayload(journalSignaturePayload(next));
  return next;
}

function validateJournalPath(value) {
  requireCondition(
    typeof value === "string" &&
      value.length > 0 &&
      !path.posix.isAbsolute(value) &&
      path.posix.normalize(value) === value &&
      value !== ".." &&
      !value.startsWith("../"),
    "closeout_journal_operation_invalid",
  );
}

function validateJournalIdentity(value) {
  requireCondition(
    value &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify(["sha256", "type"]) &&
      ["file", "directory"].includes(value.type) &&
      SHA256_PATTERN.test(value.sha256),
    "closeout_journal_operation_invalid",
  );
}

function validateJournalManifest(value, allowNull) {
  if (allowNull && value === null) return;
  requireCondition(Array.isArray(value), "closeout_journal_operation_invalid");
  let previous = null;
  for (const entry of value) {
    const expectedKeys = entry?.type === "directory" ? ["path", "type"] : ["path", "sha256", "type"];
    requireCondition(
      entry &&
        ["file", "directory"].includes(entry.type) &&
        JSON.stringify(Object.keys(entry).sort()) === JSON.stringify(expectedKeys),
      "closeout_journal_operation_invalid",
    );
    validateJournalPath(entry.path);
    if (entry.type === "file") requireCondition(SHA256_PATTERN.test(entry.sha256), "closeout_journal_operation_invalid");
    requireCondition(previous === null || previous.localeCompare(entry.path, "en") < 0, "closeout_journal_operation_invalid");
    previous = entry.path;
  }
}

function validateJournalOperation(operation) {
  requireCondition(operation && typeof operation === "object" && typeof operation.type === "string", "closeout_journal_operation_invalid");
  const expectedKeys = {
    move: ["destination", "source", "sourceIdentity", "type"],
    remove_duplicate: ["destination", "destinationIdentity", "path", "sourceIdentity", "sourceManifest", "type"],
    remove_cache_tree: ["path", "sourceIdentity", "sourceManifest", "type"],
    rewrite_root_document: ["path", "replacementSha256", "sourceIdentity", "template", "type"],
  }[operation.type];
  requireCondition(
    expectedKeys && JSON.stringify(Object.keys(operation).sort()) === JSON.stringify(expectedKeys),
    "closeout_journal_operation_invalid",
  );
  validateJournalPath(operation.source ?? operation.path);
  if (operation.destination !== undefined) validateJournalPath(operation.destination);
  validateJournalIdentity(operation.sourceIdentity);
  if (operation.destinationIdentity !== undefined) validateJournalIdentity(operation.destinationIdentity);
  if (operation.sourceManifest !== undefined) {
    validateJournalManifest(operation.sourceManifest, operation.type === "remove_duplicate");
  }
  if (operation.type === "rewrite_root_document") {
    requireCondition(
      ["completed_milestone_state_v1", "archived_milestone_roadmap_v1"].includes(operation.template) &&
        SHA256_PATTERN.test(operation.replacementSha256),
      "closeout_journal_operation_invalid",
    );
  }
}

function validateJournal(value) {
  const expectedKeys = [
    "activeFenceId",
    "activeLeaseId",
    "createdAt",
    "gitCommonIdentitySha256",
    "initialTreeManifest",
    "initialTreeSha256",
    "journalId",
    "journalSignature",
    "journalSha256",
    "kind",
    "leaseAttestationSha256",
    "milestone",
    "nextOperationIndex",
    "operations",
    "operationStage",
    "planSha256",
    "planningRoot",
    "schemaVersion",
    "sourceSha",
    "state",
    "updatedAt",
    "worktreeIdentitySha256",
  ].sort();
  requireCondition(
    value && JSON.stringify(Object.keys(value).sort()) === JSON.stringify(expectedKeys),
    "closeout_journal_invalid",
  );
  requireCondition(value.schemaVersion === 1 && value.kind === "planning_closeout_journal", "closeout_journal_invalid");
  requireCondition(["prepared", "applying", "committed"].includes(value.state), "closeout_journal_invalid");
  requireCondition(/^[0-9a-f-]{36}$/.test(value.journalId), "closeout_journal_invalid");
  requireCondition(MILESTONE_PATTERN.test(value.milestone), "closeout_journal_invalid");
  requireCondition(SHA256_PATTERN.test(value.planSha256), "closeout_journal_invalid");
  requireCondition(SOURCE_SHA_PATTERN.test(value.sourceSha), "closeout_journal_invalid");
  requireCondition(typeof value.planningRoot === "string" && value.planningRoot.length > 0, "closeout_journal_invalid");
  requireCondition(SHA256_PATTERN.test(value.worktreeIdentitySha256), "closeout_journal_invalid");
  requireCondition(SHA256_PATTERN.test(value.gitCommonIdentitySha256), "closeout_journal_invalid");
  validateJournalManifest(value.initialTreeManifest, false);
  requireCondition(SHA256_PATTERN.test(value.initialTreeSha256), "closeout_journal_invalid");
  requireCondition(
    createHash("sha256").update(JSON.stringify(value.initialTreeManifest)).digest("hex") === value.initialTreeSha256,
    "closeout_journal_initial_tree_mismatch",
  );
  requireCondition(Array.isArray(value.operations), "closeout_journal_invalid");
  for (const operation of value.operations) validateJournalOperation(operation);
  requireCondition(
    Number.isInteger(value.nextOperationIndex) &&
      value.nextOperationIndex >= 0 &&
      value.nextOperationIndex <= value.operations.length,
    "closeout_journal_invalid",
  );
  requireCondition(
    value.operationStage === null || value.operationStage === "quarantine_verified",
    "closeout_journal_invalid",
  );
  if (value.operationStage === "quarantine_verified") {
    requireCondition(
      value.state === "applying" &&
        value.nextOperationIndex < value.operations.length &&
        ["remove_duplicate", "remove_cache_tree"].includes(value.operations[value.nextOperationIndex].type),
      "closeout_journal_invalid",
    );
  }
  requireCondition(/^[0-9a-f-]{36}$/.test(value.activeLeaseId), "closeout_journal_invalid");
  requireCondition(/^[0-9a-f-]{36}$/.test(value.activeFenceId), "closeout_journal_invalid");
  requireCondition(SHA256_PATTERN.test(value.leaseAttestationSha256), "closeout_journal_invalid");
  requireCondition(/^[A-Za-z0-9_-]+$/.test(value.journalSignature), "closeout_journal_invalid");
  requireCondition(Number.isFinite(Date.parse(value.createdAt)) && Number.isFinite(Date.parse(value.updatedAt)), "closeout_journal_invalid");
  requireCondition(SHA256_PATTERN.test(value.journalSha256), "closeout_journal_invalid");
  requireCondition(
    createHash("sha256").update(JSON.stringify(journalPayload(value))).digest("hex") === value.journalSha256,
    "closeout_journal_tampered",
  );
  requireCondition(
    closeoutPlanSha256({
      milestone: value.milestone,
      operations: value.operations,
      errors: [],
      sourceSha: value.sourceSha,
      planningRoot: value.planningRoot,
      worktreeIdentitySha256: value.worktreeIdentitySha256,
      gitCommonIdentitySha256: value.gitCommonIdentitySha256,
      initialTreeSha256: value.initialTreeSha256,
    }) === value.planSha256,
    "closeout_journal_plan_mismatch",
  );
  requireCondition(value.state !== "prepared" || value.nextOperationIndex === 0, "closeout_journal_invalid");
  requireCondition(
    value.state !== "committed" || value.nextOperationIndex === value.operations.length,
    "closeout_journal_invalid",
  );
  requireCondition(
    !["prepared", "committed"].includes(value.state) || value.operationStage === null,
    "closeout_journal_invalid",
  );
  return value;
}

async function verifyJournalSignature(projectRoot, journal) {
  await verifyWorkflowLeaseSignature({
    projectRoot,
    leaseId: journal.activeLeaseId,
    attestationSha256: journal.leaseAttestationSha256,
    payload: journalSignaturePayload(journal),
    signature: journal.journalSignature,
  });
  return journal;
}

async function ensureJournalDirectory(projectRoot) {
  const governance = path.join(resolveGitCommonDir(projectRoot), "nutrition-workflow");
  const governanceStat = await fs.lstat(governance).catch(() => null);
  requireCondition(governanceStat?.isDirectory() && !governanceStat.isSymbolicLink(), "closeout_governance_directory_unsafe");
  const directory = path.join(governance, "closeout-journals");
  await fs.mkdir(directory, { mode: 0o700 }).catch((error) => {
    if (!(error && typeof error === "object" && error.code === "EEXIST")) throw error;
  });
  const stat = await fs.lstat(directory).catch(() => null);
  requireCondition(stat?.isDirectory() && !stat.isSymbolicLink(), "closeout_journal_directory_unsafe");
  await syncDirectory(governance);
  return directory;
}

function journalPathFor(directory, milestone, planSha256, worktreeIdentitySha256) {
  requireCondition(
    MILESTONE_PATTERN.test(milestone) && SHA256_PATTERN.test(planSha256) && SHA256_PATTERN.test(worktreeIdentitySha256),
    "closeout_journal_identity_invalid",
  );
  return path.join(directory, `${worktreeIdentitySha256}-${milestone}-${planSha256}.json`);
}

async function readJournalSnapshot(filePath, required = true) {
  const snapshot = await readStableFileSnapshot(filePath, {
    required,
    maxBytes: MAX_JOURNAL_BYTES,
    code: "closeout_journal_unsafe",
    missingCode: "closeout_journal_missing",
  });
  if (snapshot === null) return null;
  const raw = snapshot.bytes.toString("utf8");
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    requireCondition(false, "closeout_journal_invalid");
  }
  const journal = validateJournal(value);
  requireCondition(raw === `${JSON.stringify(journal, null, 2)}\n`, "closeout_journal_noncanonical");
  return { journal, rawSha256: snapshot.rawSha256, dev: snapshot.dev, ino: snapshot.ino };
}

async function readJournal(filePath, required = true) {
  const snapshot = await readJournalSnapshot(filePath, required);
  return snapshot?.journal ?? null;
}

async function journalLedgerSnapshot(directory, projectRoot) {
  const ledger = [];
  const directoryIdentity = await stableDirectoryIdentity(directory, "closeout_journal_directory_unsafe");
  const entries = await fs.readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));
  for (const entry of entries) {
    if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith(".json")) {
      requireCondition(false, "closeout_journal_directory_unsafe");
    }
    const snapshot = await readJournalSnapshot(path.join(directory, entry.name));
    const journal = await verifyJournalSignature(projectRoot, snapshot.journal);
    requireCondition(
      entry.name === path.basename(journalPathFor(directory, journal.milestone, journal.planSha256, journal.worktreeIdentitySha256)),
      "closeout_journal_filename_mismatch",
    );
    ledger.push({
      name: entry.name,
      path: path.join(directory, entry.name),
      journal,
      rawSha256: snapshot.rawSha256,
      dev: snapshot.dev,
      ino: snapshot.ino,
    });
  }
  await assertStableDirectory(directory, directoryIdentity, "closeout_journal_directory_unsafe");
  return ledger;
}

async function findMatchingJournals(directory, projectRoot, worktreeIdentitySha256, milestone) {
  return (await journalLedgerSnapshot(directory, projectRoot)).filter(
    ({ journal }) => journal.worktreeIdentitySha256 === worktreeIdentitySha256 && journal.milestone === milestone,
  );
}

function workflowLeaseStatusIdentity(value) {
  return {
    status: value.status,
    code: value.code ?? null,
    active: value.active,
    expired: value.expired ?? null,
    readyForWriter: value.readyForWriter,
    leaseId: value.leaseId ?? null,
    leaseDigest: value.leaseDigest ?? null,
    operationId: value.operationId ?? null,
    operationDigest: value.operationDigest ?? null,
    writerFenceId: value.writerFenceId ?? null,
    writerFenceDigest: value.writerFenceDigest ?? null,
  };
}

function journalLedgerIdentity(ledger) {
  return ledger.map(({ name, journal, rawSha256, dev, ino }) => ({
    name,
    journalSha256: journal.journalSha256,
    rawSha256,
    dev,
    ino,
  }));
}

async function provenanceExternalEvidenceIdentity(projectRoot, receiptPaths) {
  const receipts = [];
  const leaseIds = new Set();
  for (const receiptPath of [...receiptPaths].sort((left, right) => left.localeCompare(right, "en"))) {
    let snapshot;
    try {
      snapshot = await readStableFileSnapshot(receiptPath, { code: "closeout_provenance_evidence_unsafe" });
    } catch (error) {
      receipts.push({ path: path.resolve(receiptPath), error: error?.code ?? "closeout_provenance_evidence_unsafe" });
      continue;
    }
    let receipt;
    try {
      receipt = JSON.parse(snapshot.bytes.toString("utf8"));
    } catch {
      receipt = null;
    }
    if (typeof receipt?.workflowLeaseId === "string" && /^[0-9a-f-]{36}$/.test(receipt.workflowLeaseId)) {
      leaseIds.add(receipt.workflowLeaseId);
    }
    receipts.push({ path: path.resolve(receiptPath), rawSha256: snapshot.rawSha256, dev: snapshot.dev, ino: snapshot.ino });
  }
  const attestations = [];
  const directory = path.join(resolveGitCommonDir(projectRoot), "nutrition-workflow", "lease-attestations");
  for (const leaseId of [...leaseIds].sort((left, right) => left.localeCompare(right, "en"))) {
    const attestationPath = path.join(directory, `${leaseId}.json`);
    try {
      const snapshot = await readStableFileSnapshot(attestationPath, { code: "closeout_provenance_evidence_unsafe" });
      attestations.push({ path: attestationPath, rawSha256: snapshot.rawSha256, dev: snapshot.dev, ino: snapshot.ino });
    } catch (error) {
      attestations.push({ path: attestationPath, error: error?.code ?? "closeout_provenance_evidence_unsafe" });
    }
  }
  return { receipts, attestations };
}

function sameJournalSnapshot(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.rawSha256 === right.rawSha256;
}

async function requireJournalSnapshotCurrent(filePath, expected) {
  const observed = await readJournalSnapshot(filePath);
  requireCondition(sameJournalSnapshot(observed, expected), "closeout_journal_changed");
  return observed;
}

async function reconcileJournalTemps(directory, projectRoot, holder) {
  const recovered = [];
  const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((left, right) =>
    left.name.localeCompare(right.name, "en"),
  );
  for (const entry of entries) {
    if (entry.name.endsWith(".json")) continue;
    const match = entry.name.match(/^\.(.+\.json)\.tmp-([0-9a-f-]{36})$/);
    requireCondition(entry.isFile() && !entry.isSymbolicLink() && match !== null, "closeout_journal_directory_unsafe");
    const tempPath = path.join(directory, entry.name);
    const tempSnapshot = await readJournalSnapshot(tempPath);
    const tempJournal = await verifyJournalSignature(projectRoot, tempSnapshot.journal);
    const expectedName = path.basename(
      journalPathFor(directory, tempJournal.milestone, tempJournal.planSha256, tempJournal.worktreeIdentitySha256),
    );
    requireCondition(match[1] === expectedName, "closeout_journal_temp_identity_mismatch");
    const targetPath = path.join(directory, expectedName);
    const targetSnapshot = await readJournalSnapshot(targetPath, false);
    if (targetSnapshot === null) {
      requireCondition(tempJournal.state === "prepared" && tempJournal.nextOperationIndex === 0, "closeout_journal_temp_ambiguous");
      await requireJournalSnapshotCurrent(tempPath, tempSnapshot);
      await holder.assertCurrent();
      await fs.link(tempPath, targetPath).catch((error) => {
        requireCondition(!(error && typeof error === "object" && error.code === "EEXIST"), "closeout_journal_changed");
        throw error;
      });
      await syncDirectory(directory);
      await requireJournalSnapshotCurrent(tempPath, tempSnapshot);
      await holder.assertCurrent();
      await fs.unlink(tempPath);
      recovered.push({ action: "publish_prepared_journal", journalSha256: tempJournal.journalSha256 });
    } else {
      const verifiedTarget = await verifyJournalSignature(projectRoot, targetSnapshot.journal);
      requireCondition(
        verifiedTarget.journalId === tempJournal.journalId &&
          verifiedTarget.milestone === tempJournal.milestone &&
          verifiedTarget.planSha256 === tempJournal.planSha256 &&
          verifiedTarget.sourceSha === tempJournal.sourceSha &&
          verifiedTarget.planningRoot === tempJournal.planningRoot &&
          verifiedTarget.worktreeIdentitySha256 === tempJournal.worktreeIdentitySha256 &&
          verifiedTarget.gitCommonIdentitySha256 === tempJournal.gitCommonIdentitySha256 &&
          verifiedTarget.initialTreeSha256 === tempJournal.initialTreeSha256 &&
          JSON.stringify(verifiedTarget.operations) === JSON.stringify(tempJournal.operations),
        "closeout_journal_temp_ambiguous",
      );
      await requireJournalSnapshotCurrent(targetPath, targetSnapshot);
      await requireJournalSnapshotCurrent(tempPath, tempSnapshot);
      await holder.assertCurrent();
      await fs.unlink(tempPath);
      recovered.push({ action: "discard_unpublished_successor", journalSha256: tempJournal.journalSha256 });
    }
    await syncDirectory(directory);
  }
  return recovered;
}

async function createJournalExclusive(filePath, value, holder) {
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${randomUUID()}`);
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  const tempSnapshot = await readJournalSnapshot(temp);
  requireCondition(tempSnapshot.journal.journalSha256 === value.journalSha256, "closeout_journal_changed");
  try {
    await requireJournalSnapshotCurrent(temp, tempSnapshot);
    await holder.assertCurrent();
    await fs.link(temp, filePath).catch((error) => {
      requireCondition(!(error && typeof error === "object" && error.code === "EEXIST"), "closeout_journal_exists");
      throw error;
    });
    await syncDirectory(path.dirname(filePath));
  } finally {
    if (await exists(temp)) {
      await requireJournalSnapshotCurrent(temp, tempSnapshot);
      await holder.assertCurrent();
      await fs.unlink(temp);
    }
    await syncDirectory(path.dirname(filePath));
  }
}

async function updateJournal(filePath, current, changes, holder, projectRoot, now) {
  const observedSnapshot = await readJournalSnapshot(filePath);
  const observed = await verifyJournalSignature(projectRoot, observedSnapshot.journal);
  requireCondition(observed.journalSha256 === current.journalSha256, "closeout_journal_changed");
  const next = withJournalDigest({
    ...current,
    ...changes,
    updatedAt: journalTimestamp(now),
  }, holder);
  const temp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tmp-${randomUUID()}`);
  const handle = await fs.open(temp, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  const tempSnapshot = await readJournalSnapshot(temp);
  requireCondition(tempSnapshot.journal.journalSha256 === next.journalSha256, "closeout_journal_changed");
  try {
    const beforeRenameSnapshot = await requireJournalSnapshotCurrent(filePath, observedSnapshot);
    const beforeRename = await verifyJournalSignature(projectRoot, beforeRenameSnapshot.journal);
    requireCondition(beforeRename.journalSha256 === current.journalSha256, "closeout_journal_changed");
    await requireJournalSnapshotCurrent(filePath, observedSnapshot);
    await holder.assertCurrent();
    await fs.rename(temp, filePath);
    await syncDirectory(path.dirname(filePath));
    const published = await readJournalSnapshot(filePath);
    requireCondition(published.journal.journalSha256 === next.journalSha256, "closeout_journal_changed");
  } finally {
    if (await exists(temp)) {
      await requireJournalSnapshotCurrent(temp, tempSnapshot);
      await holder.assertCurrent();
      await fs.unlink(temp);
    }
  }
  return next;
}

async function requireOperationIdentity(root, operation) {
  const sourcePath = path.join(root, operation.source ?? operation.path);
  requireCondition(await exists(sourcePath), "closeout_operation_source_missing");
  requireCondition(sameIdentity(await pathIdentity(sourcePath), operation.sourceIdentity), "closeout_operation_source_changed");
}

function quarantinePath(root, planSha256, operationIndex) {
  requireCondition(SHA256_PATTERN.test(planSha256) && Number.isInteger(operationIndex), "closeout_quarantine_identity_invalid");
  return path.join(root, ".closeout-quarantine", planSha256, String(operationIndex));
}

async function quarantineState(candidate) {
  const stat = await fs.lstat(candidate).catch((error) => {
    if (error && typeof error === "object" && error.code === "ENOENT") return null;
    throw error;
  });
  if (stat === null) return "absent";
  requireCondition(!stat.isSymbolicLink() && (stat.isFile() || stat.isDirectory()), "closeout_quarantine_unsafe");
  return "present";
}

async function ensureQuarantineParent(root, planSha256) {
  const directories = [path.join(root, ".closeout-quarantine"), path.join(root, ".closeout-quarantine", planSha256)];
  for (const directory of directories) {
    let stat = await fs.lstat(directory).catch((error) => {
      if (error && typeof error === "object" && error.code === "ENOENT") return null;
      throw error;
    });
    if (stat === null) {
      await fs.mkdir(directory, { mode: 0o700 });
      await syncDirectory(path.dirname(directory));
      stat = await fs.lstat(directory);
    }
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), "closeout_quarantine_unsafe");
  }
}

async function ensurePlainDirectoryPath(root, directory) {
  const rel = path.relative(root, directory);
  requireCondition(rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel)), "closeout_directory_outside_root");
  let current = root;
  for (const component of rel.split(path.sep).filter(Boolean)) {
    const parent = current;
    current = path.join(current, component);
    let stat = await fs.lstat(current).catch((error) => {
      if (error && typeof error === "object" && error.code === "ENOENT") return null;
      throw error;
    });
    if (stat === null) {
      await fs.mkdir(current, { mode: 0o700 });
      await syncDirectory(parent);
      stat = await fs.lstat(current);
    }
    requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), "closeout_directory_unsafe");
  }
}

async function quarantineMatchesManifest(candidate, manifest, sourceIdentity) {
  const stat = await fs.lstat(candidate);
  if (stat.isFile() && !stat.isSymbolicLink()) {
    return manifest === null && sameIdentity(await pathIdentity(candidate), sourceIdentity);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink() || !Array.isArray(manifest)) return false;
  const observed = await listTree(candidate);
  return sameIdentity(await pathIdentity(candidate), sourceIdentity) && JSON.stringify(observed) === JSON.stringify(manifest);
}

function journalUnaffectedTree(manifest, journal) {
  const affectedRoots = [];
  const quarantineContainers = new Set([
    ".closeout-quarantine",
    `.closeout-quarantine/${journal.planSha256}`,
  ]);
  for (const [index, operation] of journal.operations.entries()) {
    const operationRoots = [operation.source ?? operation.path];
    if (operation.destination !== undefined) operationRoots.push(operation.destination);
    if (operation.type === "rewrite_root_document") {
      const directory = path.posix.dirname(operation.path);
      const tempName = `.${path.posix.basename(operation.path)}.closeout-${journal.planSha256}-${index}.tmp`;
      operationRoots.push(directory === "." ? tempName : path.posix.join(directory, tempName));
    }
    const quarantine = `.closeout-quarantine/${journal.planSha256}/${index}`;
    operationRoots.push(quarantine);
    for (const root of operationRoots) {
      affectedRoots.push(root);
      const parts = root.split("/");
      for (let depth = 1; depth < parts.length; depth += 1) {
        quarantineContainers.add(parts.slice(0, depth).join("/"));
      }
    }
  }
  return manifest.filter((entry) =>
    !quarantineContainers.has(entry.path) &&
    !affectedRoots.some((root) => entry.path === root || entry.path.startsWith(`${root}/`)),
  );
}

async function requireJournalUnrelatedTreeUnchanged(root, journal) {
  const current = (await listTree(root)).sort((left, right) => left.path.localeCompare(right.path, "en"));
  requireCondition(
    JSON.stringify(journalUnaffectedTree(current, journal)) ===
      JSON.stringify(journalUnaffectedTree(journal.initialTreeManifest, journal)),
    "closeout_journal_unrelated_tree_changed",
  );
}

function transformedInitialPath(entryPath, operations) {
  for (const operation of operations) {
    const source = operation.source ?? operation.path;
    if (operation.type === "move" && (entryPath === source || entryPath.startsWith(`${source}/`))) {
      return `${operation.destination}${entryPath.slice(source.length)}`;
    }
    if (
      ["remove_duplicate", "remove_cache_tree"].includes(operation.type) &&
      (entryPath === source || entryPath.startsWith(`${source}/`))
    ) {
      return null;
    }
  }
  return entryPath;
}

function archiveSidecarEntry(entryPath) {
  return TRANSIENT_DIRS.includes(entryPath.split("/")[0]);
}

function exactPhaseSealAddition(entryPath, observedEntry, expectedByPath) {
  const components = entryPath.split("/");
  if (observedEntry.type !== "file" || components.length !== 3 || components[0] !== "phases") return false;
  const phaseId = components[1].match(/^(\d+(?:\.\d+)?)(?:-|$)/)?.[1];
  return (
    phaseId !== undefined &&
    components[2] === `${phaseId}-SEAL.json` &&
    expectedByPath.get(`phases/${components[1]}`)?.type === "directory"
  );
}

async function archiveTreeEvolution(root, journal, milestone, projectRoot) {
  const archivePrefix = `milestones/${milestone}`;
  const expected = [];
  for (const entry of journal.initialTreeManifest) {
    const transformed = transformedInitialPath(entry.path, journal.operations);
    if (transformed === null || !transformed.startsWith(`${archivePrefix}/`)) continue;
    const entryPath = transformed.slice(archivePrefix.length + 1);
    expected.push({ ...entry, path: entryPath });
  }
  const destination = path.join(root, archivePrefix);
  const signedSidecars = new Set(
    expected.filter((entry) => archiveSidecarEntry(entry.path)).map((entry) => entry.path.split("/")[0]),
  );
  const observed = (await listTree(destination)).filter(
    (entry) => !archiveSidecarEntry(entry.path) || signedSidecars.has(entry.path.split("/")[0]),
  );
  const expectedByPath = new Map(expected.map((entry) => [entry.path, entry]));
  const observedByPath = new Map(observed.map((entry) => [entry.path, entry]));
  const evolvedProvenance = [];

  if (expectedByPath.size !== expected.length || observedByPath.size !== observed.length) {
    return { matches: false, evolvedProvenance: [] };
  }

  for (const [entryPath, expectedEntry] of expectedByPath) {
    const observedEntry = observedByPath.get(entryPath);
    if (!observedEntry || observedEntry.type !== expectedEntry.type) return { matches: false, evolvedProvenance: [] };
    if (expectedEntry.type !== "file" || observedEntry.sha256 === expectedEntry.sha256) continue;
    if (!PROVENANCE_ARTIFACT_PATTERN.test(path.posix.basename(entryPath))) {
      return { matches: false, evolvedProvenance: [] };
    }
    evolvedProvenance.push({
      artifact: relative(projectRoot, path.join(destination, entryPath)),
      expectedPayloadSha256: expectedEntry.sha256,
    });
  }
  for (const [entryPath, observedEntry] of observedByPath) {
    if (expectedByPath.has(entryPath)) continue;
    if (!exactPhaseSealAddition(entryPath, observedEntry, expectedByPath)) {
      return { matches: false, evolvedProvenance: [] };
    }
  }
  return { matches: true, evolvedProvenance };
}

async function operationState(root, operation, milestone, planSha256, operationIndex) {
  const sourcePath = path.join(root, operation.source ?? operation.path);
  const sourceExists = await exists(sourcePath);
  if (operation.type === "move") {
    const destination = path.join(root, operation.destination);
    const destinationExists = await exists(destination);
    if (sourceExists && !destinationExists && sameIdentity(await pathIdentity(sourcePath), operation.sourceIdentity)) {
      return "pending";
    }
    if (!sourceExists && destinationExists && sameIdentity(await pathIdentity(destination), operation.sourceIdentity)) {
      return "applied";
    }
    return "ambiguous";
  }
  if (operation.type === "remove_duplicate") {
    const destination = path.join(root, operation.destination);
    const destinationExists = await exists(destination);
    const quarantine = quarantinePath(root, planSha256, operationIndex);
    const quarantineStatus = await quarantineState(quarantine);
    const destinationMatches =
      destinationExists && sameIdentity(await pathIdentity(destination), operation.destinationIdentity);
    if (sourceExists && quarantineStatus === "absent" && destinationMatches && sameIdentity(await pathIdentity(sourcePath), operation.sourceIdentity)) {
      return (await identical(sourcePath, destination)) ? "pending" : "ambiguous";
    }
    if (
      !sourceExists &&
      quarantineStatus === "present" &&
      destinationMatches &&
      (await quarantineMatchesManifest(quarantine, operation.sourceManifest, operation.sourceIdentity))
    ) {
      return "quarantined";
    }
    if (!sourceExists && quarantineStatus === "absent" && destinationMatches) return "applied";
    return "ambiguous";
  }
  if (operation.type === "remove_cache_tree") {
    const quarantineStatus = await quarantineState(quarantinePath(root, planSha256, operationIndex));
    if (
      !sourceExists &&
      quarantineStatus === "present" &&
      (await quarantineMatchesManifest(
        quarantinePath(root, planSha256, operationIndex),
        operation.sourceManifest,
        operation.sourceIdentity,
      ))
    ) {
      return "quarantined";
    }
    if (!sourceExists && quarantineStatus === "absent") return "applied";
    if (quarantineStatus !== "absent") return "ambiguous";
    if (!sameIdentity(await pathIdentity(sourcePath), operation.sourceIdentity)) return "ambiguous";
    return (await cacheOnlyDirectory(sourcePath)).safe ? "pending" : "ambiguous";
  }
  if (operation.type === "rewrite_root_document") {
    if (!sourceExists) return "ambiguous";
    const identity = await pathIdentity(sourcePath);
    if (sameIdentity(identity, operation.sourceIdentity)) return "pending";
    const replacement = replacementForOperation(operation, milestone);
    const replacementIdentity = {
      type: "file",
      sha256: createHash("sha256").update(replacement).digest("hex"),
    };
    return sameIdentity(identity, replacementIdentity) ? "applied" : "ambiguous";
  }
  requireCondition(false, "closeout_operation_invalid");
}

async function applyOperation(
  root,
  operation,
  holder,
  milestone,
  planSha256,
  operationIndex,
  options,
  markQuarantineVerified,
) {
  await holder.assertCurrent();
  const initialState = await operationState(root, operation, milestone, planSha256, operationIndex);
  requireCondition(initialState === "pending" || initialState === "quarantined", "closeout_operation_not_applicable");
  if (initialState === "pending") await requireOperationIdentity(root, operation);
  if (typeof options.testMutationCheckpoint === "function") {
    await options.testMutationCheckpoint({ operationIndex, operationType: operation.type });
  }
  if (operation.type === "move") {
    const source = path.join(root, operation.source);
    const destination = path.join(root, operation.destination);
    requireCondition(!(await exists(destination)), "closeout_destination_appeared");
    await ensurePlainDirectoryPath(root, path.dirname(destination));
    await requireOperationIdentity(root, operation);
    requireCondition(!(await exists(destination)), "closeout_destination_appeared");
    await holder.assertCurrent();
    await fs.rename(source, destination);
    await syncDirectory(path.dirname(source));
    await syncDirectory(path.dirname(destination));
  } else if (operation.type === "remove_duplicate") {
    const destination = path.join(root, operation.destination);
    requireCondition(await exists(destination), "closeout_duplicate_destination_missing");
    requireCondition(
      sameIdentity(await pathIdentity(destination), operation.destinationIdentity),
      "closeout_duplicate_destination_changed",
    );
    const source = path.join(root, operation.path);
    const quarantine = quarantinePath(root, planSha256, operationIndex);
    if (initialState === "pending") {
      requireCondition(await identical(source, destination), "closeout_duplicate_no_longer_identical");
      await ensureQuarantineParent(root, planSha256);
      requireCondition((await quarantineState(quarantine)) === "absent", "closeout_quarantine_collision");
      await requireOperationIdentity(root, operation);
      requireCondition((await quarantineState(quarantine)) === "absent", "closeout_quarantine_collision");
      await holder.assertCurrent();
      await fs.rename(source, quarantine);
      await syncDirectory(path.dirname(source));
      await syncDirectory(path.dirname(quarantine));
    }
    if (options.testFaultStage === `after_quarantine:${operationIndex}`) {
      const error = new Error("closeout_injected_after_quarantine");
      error.code = "closeout_injected_after_quarantine";
      throw error;
    }
    requireCondition(
      await quarantineMatchesManifest(quarantine, operation.sourceManifest, operation.sourceIdentity),
      "closeout_quarantine_manifest_changed",
    );
    await markQuarantineVerified();
    requireCondition(
      await quarantineMatchesManifest(quarantine, operation.sourceManifest, operation.sourceIdentity),
      "closeout_quarantine_manifest_changed",
    );
    await holder.assertCurrent();
    await fs.rm(quarantine, { recursive: true, force: false });
    await syncDirectory(path.dirname(quarantine));
  } else if (operation.type === "remove_cache_tree") {
    const directory = path.join(root, operation.path);
    const quarantine = quarantinePath(root, planSha256, operationIndex);
    if (initialState === "pending") {
      const candidate = await cacheOnlyDirectory(directory);
      requireCondition(candidate.safe, "closeout_cache_tree_changed");
      await ensureQuarantineParent(root, planSha256);
      requireCondition((await quarantineState(quarantine)) === "absent", "closeout_quarantine_collision");
      await requireOperationIdentity(root, operation);
      requireCondition((await quarantineState(quarantine)) === "absent", "closeout_quarantine_collision");
      await holder.assertCurrent();
      await fs.rename(directory, quarantine);
      await syncDirectory(path.dirname(directory));
      await syncDirectory(path.dirname(quarantine));
    }
    if (options.testFaultStage === `after_quarantine:${operationIndex}`) {
      const error = new Error("closeout_injected_after_quarantine");
      error.code = "closeout_injected_after_quarantine";
      throw error;
    }
    requireCondition(
      await quarantineMatchesManifest(quarantine, operation.sourceManifest, operation.sourceIdentity),
      "closeout_quarantine_manifest_changed",
    );
    await markQuarantineVerified();
    requireCondition(
      await quarantineMatchesManifest(quarantine, operation.sourceManifest, operation.sourceIdentity),
      "closeout_quarantine_manifest_changed",
    );
    await holder.assertCurrent();
    await fs.rm(quarantine, { recursive: true, force: false });
    await syncDirectory(path.dirname(quarantine));
  } else if (operation.type === "rewrite_root_document") {
    const destination = path.join(root, operation.path);
    const replacement = replacementForOperation(operation, milestone);
    requireCondition(
      createHash("sha256").update(replacement).digest("hex") === operation.replacementSha256,
      "closeout_rewrite_digest_invalid",
    );
    const temp = path.join(
      path.dirname(destination),
      `.${path.basename(destination)}.closeout-${planSha256}-${operationIndex}.tmp`,
    );
    if (await exists(temp)) {
      const tempStat = await fs.lstat(temp);
      requireCondition(
        tempStat.isFile() &&
          !tempStat.isSymbolicLink() &&
          (await hashFile(temp)) === operation.replacementSha256,
        "closeout_rewrite_temp_unsafe",
      );
    } else {
      const handle = await fs.open(temp, "wx", 0o600);
      try {
        await handle.writeFile(replacement, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await syncDirectory(path.dirname(temp));
    }
    if (options.testFaultStage === `after_rewrite_temp:${operationIndex}`) {
      const error = new Error("closeout_injected_after_rewrite_temp");
      error.code = "closeout_injected_after_rewrite_temp";
      throw error;
    }
    const rewriteTempIdentity = await pathIdentity(temp);
    requireCondition(
      rewriteTempIdentity.type === "file" && rewriteTempIdentity.sha256 === operation.replacementSha256,
      "closeout_rewrite_temp_unsafe",
    );
    await requireOperationIdentity(root, operation);
    try {
      await requireOperationIdentity(root, operation);
      requireCondition(sameIdentity(await pathIdentity(temp), rewriteTempIdentity), "closeout_rewrite_temp_unsafe");
      await holder.assertCurrent();
      await fs.rename(temp, destination);
      await syncDirectory(path.dirname(destination));
    } finally {
      if (await exists(temp)) {
        requireCondition(sameIdentity(await pathIdentity(temp), rewriteTempIdentity), "closeout_rewrite_temp_unsafe");
        await holder.assertCurrent();
        await fs.unlink(temp);
      }
    }
  } else {
    requireCondition(false, "closeout_operation_invalid");
  }
  requireCondition(
    (await operationState(root, operation, milestone, planSha256, operationIndex)) === "applied",
    "closeout_operation_postcondition_failed",
  );
}

async function cleanupQuarantine(root, planSha256, holder) {
  const planRoot = path.join(root, ".closeout-quarantine", planSha256);
  if (await exists(planRoot)) {
    requireCondition((await fs.readdir(planRoot)).length === 0, "closeout_quarantine_not_empty");
    await holder.assertCurrent();
    await fs.rmdir(planRoot);
    await syncDirectory(path.dirname(planRoot));
  }
  const quarantineRoot = path.dirname(planRoot);
  if (await exists(quarantineRoot) && (await fs.readdir(quarantineRoot)).length === 0) {
    requireCondition((await fs.readdir(quarantineRoot)).length === 0, "closeout_quarantine_not_empty");
    await holder.assertCurrent();
    await fs.rmdir(quarantineRoot);
    await syncDirectory(path.dirname(quarantineRoot));
  }
}

export async function normalizePlanningCloseout(options) {
  requireCondition(typeof options.projectRoot === "string", "closeout_project_root_required");
  const scope = resolveCanonicalPlanningRoot(options);
  options = { ...options, projectRoot: scope.projectRoot, planningRoot: scope.planningRoot };
  const root = scope.planningRoot;
  requireCondition(MILESTONE_PATTERN.test(options.milestone), "closeout_milestone_invalid");
  const sourceShaBefore = resolveSourceSha(scope.projectRoot);
  const currentTreeManifest = (await listTree(root)).sort((left, right) => left.path.localeCompare(right.path, "en"));
  const currentTreeSha256 = createHash("sha256").update(JSON.stringify(currentTreeManifest)).digest("hex");
  const currentPlan = await planNormalization(root, options.milestone);
  const currentPlanSha256 = closeoutPlanSha256({
    milestone: options.milestone,
    operations: currentPlan.operations,
    errors: currentPlan.errors,
    sourceSha: sourceShaBefore,
    planningRoot: scope.planningRootRelative,
    worktreeIdentitySha256: scope.worktreeIdentitySha256,
    gitCommonIdentitySha256: scope.gitCommonIdentitySha256,
    initialTreeSha256: currentTreeSha256,
  });
  const currentBase = {
    schemaVersion: 1,
    kind: "planning_closeout_normalization",
    milestone: options.milestone,
    dryRun: options.dryRun === true,
    status: currentPlan.errors.length === 0 ? "pass" : "fail",
    operations: currentPlan.operations,
    errors: currentPlan.errors,
    planSha256: currentPlanSha256,
    sourceSha: sourceShaBefore,
    worktreeIdentitySha256: scope.worktreeIdentitySha256,
    gitCommonIdentitySha256: scope.gitCommonIdentitySha256,
    planningTreeSha256: currentTreeSha256,
  };
  if (options.dryRun === true) return currentBase;
  requireCondition(SHA256_PATTERN.test(options.confirmPlanSha256 ?? ""), "closeout_plan_confirmation_required");
  requireCondition(options.sourceSha === sourceShaBefore, "closeout_source_sha_mismatch");
  const worktreeIdentitySha256 = scope.worktreeIdentitySha256;
  const planningRootRelative = scope.planningRootRelative;
  return withWorkflowWriterFence(
    {
      projectRoot: options.projectRoot,
      tokenFile: options.tokenFile,
      expectedRuntime: options.expectedRuntime,
      purpose: "workflow_command",
      maxDurationSeconds: options.maxDurationSeconds ?? 60,
      now: options.now,
      fenceId: options.fenceId,
    },
    async (holder) => {
      const appliedOperations = [];
      const recoveredOperations = [];
      let journal = null;
      let journalPath = null;
      let resumed = false;
      let recoveredJournalTemps = [];
      let base = currentBase;
      try {
        if (typeof options.testCheckpoint === "function") await options.testCheckpoint("after_writer_fence");
        requireCondition(resolveSourceSha(options.projectRoot) === sourceShaBefore, "closeout_source_sha_changed");
        await holder.assertCurrent();
        const journalDirectory = await ensureJournalDirectory(options.projectRoot);
        recoveredJournalTemps = await reconcileJournalTemps(journalDirectory, options.projectRoot, holder);
        const journals = await findMatchingJournals(
          journalDirectory,
          options.projectRoot,
          worktreeIdentitySha256,
          options.milestone,
        );
        const incomplete = journals.filter(({ journal: candidate }) => candidate.state !== "committed");
        requireCondition(incomplete.length <= 1, "closeout_multiple_incomplete_journals");
        if (incomplete.length === 1) {
          requireCondition(
            incomplete[0].journal.planSha256 === options.confirmPlanSha256,
            "closeout_journal_in_progress",
          );
          ({ path: journalPath, journal } = incomplete[0]);
          resumed = true;
        } else {
          const samePlan = journals.find(({ journal: candidate }) => candidate.planSha256 === options.confirmPlanSha256);
          if (samePlan) {
            ({ path: journalPath, journal } = samePlan);
            resumed = true;
          }
        }

        if (journal) {
          requireCondition(journal.sourceSha === sourceShaBefore, "closeout_journal_source_mismatch");
          requireCondition(journal.planningRoot === planningRootRelative, "closeout_journal_root_mismatch");
          requireCondition(
            journal.worktreeIdentitySha256 === worktreeIdentitySha256,
            "closeout_journal_worktree_mismatch",
          );
          requireCondition(
            journal.gitCommonIdentitySha256 === scope.gitCommonIdentitySha256,
            "closeout_journal_git_common_mismatch",
          );
          await requireJournalUnrelatedTreeUnchanged(root, journal);
          base = {
            ...currentBase,
            dryRun: false,
            status: "pass",
            operations: journal.operations,
            errors: [],
            planSha256: journal.planSha256,
          };
        } else {
          const fencedPlan = await planNormalization(root, options.milestone);
          const fencedTreeManifest = (await listTree(root)).sort((left, right) => left.path.localeCompare(right.path, "en"));
          const fencedTreeSha256 = createHash("sha256").update(JSON.stringify(fencedTreeManifest)).digest("hex");
          const fencedPlanSha256 = closeoutPlanSha256({
            milestone: options.milestone,
            operations: fencedPlan.operations,
            errors: fencedPlan.errors,
            sourceSha: sourceShaBefore,
            planningRoot: planningRootRelative,
            worktreeIdentitySha256,
            gitCommonIdentitySha256: scope.gitCommonIdentitySha256,
            initialTreeSha256: fencedTreeSha256,
          });
          requireCondition(fencedPlanSha256 === currentPlanSha256, "closeout_plan_changed_before_fence");
          requireCondition(fencedTreeSha256 === currentTreeSha256, "closeout_tree_changed_before_fence");
          requireCondition(
            options.confirmPlanSha256 === currentPlanSha256,
            "closeout_plan_confirmation_mismatch",
          );
          if (currentPlan.errors.length > 0) {
            return {
              ...currentBase,
              writerFenceId: holder.fenceId,
              writerFenceReleased: true,
              cleanupRequired: false,
              appliedOperations,
              recoveredOperations,
              recoveredJournalTemps,
              journal: null,
            };
          }
          journalPath = journalPathFor(
            journalDirectory,
            options.milestone,
            currentPlanSha256,
            worktreeIdentitySha256,
          );
          const createdAt = journalTimestamp(options.now);
          journal = withJournalDigest(
            {
              schemaVersion: 1,
              kind: "planning_closeout_journal",
              state: "prepared",
              journalId: randomUUID(),
              milestone: options.milestone,
              planSha256: currentPlanSha256,
              sourceSha: sourceShaBefore,
              planningRoot: planningRootRelative,
              worktreeIdentitySha256,
              gitCommonIdentitySha256: scope.gitCommonIdentitySha256,
              initialTreeManifest: fencedTreeManifest,
              initialTreeSha256: fencedTreeSha256,
              operations: currentPlan.operations,
              nextOperationIndex: 0,
              operationStage: null,
              createdAt,
              updatedAt: createdAt,
            },
            holder,
          );
          await createJournalExclusive(journalPath, journal, holder);
          if (options.testFaultStage === "after_journal_create") {
            const error = new Error("closeout_injected_after_journal_create");
            error.code = "closeout_injected_after_journal_create";
            throw error;
          }
        }

        for (let index = 0; index < journal.operations.length; index += 1) {
          requireCondition(resolveSourceSha(options.projectRoot) === sourceShaBefore, "closeout_source_sha_changed");
          await holder.assertCurrent();
          await requireJournalUnrelatedTreeUnchanged(root, journal);
          const operation = journal.operations[index];
          const state = await operationState(
            root,
            operation,
            options.milestone,
            journal.planSha256,
            index,
          );
          if (index < journal.nextOperationIndex) {
            requireCondition(state === "applied", "closeout_journal_applied_operation_changed");
            continue;
          }
          requireCondition(["pending", "quarantined", "applied"].includes(state), "closeout_operation_state_ambiguous");
          const destructive = ["remove_duplicate", "remove_cache_tree"].includes(operation.type);
          if (state === "applied" && destructive) {
            requireCondition(
              journal.operationStage === "quarantine_verified",
              "closeout_destructive_commit_evidence_missing",
            );
          }
          if (journal.operationStage === "quarantine_verified") {
            requireCondition(destructive && ["quarantined", "applied"].includes(state), "closeout_operation_state_ambiguous");
          } else {
            journal = await updateJournal(
              journalPath,
              journal,
              { state: "applying", nextOperationIndex: index, operationStage: null },
              holder,
              options.projectRoot,
              options.now,
            );
          }
          if (state === "pending" || state === "quarantined") {
            const markQuarantineVerified = async () => {
              if (journal.operationStage === "quarantine_verified") return;
              journal = await updateJournal(
                journalPath,
                journal,
                { state: "applying", nextOperationIndex: index, operationStage: "quarantine_verified" },
                holder,
                options.projectRoot,
                options.now,
              );
            };
            await applyOperation(
              root,
              operation,
              holder,
              options.milestone,
              journal.planSha256,
              index,
              options,
              markQuarantineVerified,
            );
            appliedOperations.push(operation);
          } else {
            recoveredOperations.push(operation);
          }
          requireCondition(resolveSourceSha(options.projectRoot) === sourceShaBefore, "closeout_source_sha_changed");
          await holder.assertCurrent();
          if (options.testFaultStage === `after_effect:${index}`) {
            const error = new Error("closeout_injected_after_effect");
            error.code = "closeout_injected_after_effect";
            throw error;
          }
          journal = await updateJournal(
            journalPath,
            journal,
            { state: "applying", nextOperationIndex: index + 1, operationStage: null },
            holder,
            options.projectRoot,
            options.now,
          );
        }
        await cleanupQuarantine(root, journal.planSha256, holder);
        requireCondition(resolveSourceSha(options.projectRoot) === sourceShaBefore, "closeout_source_sha_changed");
        await holder.assertCurrent();
        if (journal.state !== "committed") {
          journal = await updateJournal(
            journalPath,
            journal,
            { state: "committed", nextOperationIndex: journal.operations.length, operationStage: null },
            holder,
            options.projectRoot,
            options.now,
          );
        }
        return {
          ...base,
          writerFenceId: holder.fenceId,
          writerFenceReleased: true,
          cleanupRequired: false,
          appliedOperations,
          recoveredOperations,
          resumed,
          recoveredJournalTemps,
          journal: {
            journalId: journal.journalId,
            state: journal.state,
            planSha256: journal.planSha256,
            journalSha256: journal.journalSha256,
            nextOperationIndex: journal.nextOperationIndex,
          },
        };
      } catch (error) {
        if (journalPath) {
          try {
            journal = await verifyJournalSignature(options.projectRoot, await readJournal(journalPath));
          } catch {
            // Preserve the last verified in-memory checkpoint; strict follow-up will fail closed on disk corruption.
          }
        }
        return {
          ...base,
          status: journal ? "needs_reconciliation" : "fail",
          code: typeof error?.code === "string" ? error.code : "closeout_apply_failed",
          writerFenceId: holder.fenceId,
          writerFenceReleased: true,
          cleanupRequired: journal !== null,
          appliedOperations,
          recoveredOperations,
          resumed,
          recoveredJournalTemps,
          journal: journal
            ? {
                journalId: journal.journalId,
                state: journal.state,
                planSha256: journal.planSha256,
                journalSha256: journal.journalSha256,
                nextOperationIndex: journal.nextOperationIndex,
              }
            : null,
        };
      }
    },
  );
}

async function filesRecursive(directory) {
  if (!(await exists(directory))) return [];
  const files = [];
  async function visit(current, expectedDirectory = null) {
    const directoryIdentity = await stableDirectoryIdentity(current, "closeout_tree_snapshot_changed");
    if (expectedDirectory !== null) {
      requireCondition(
        JSON.stringify(directoryIdentity) === JSON.stringify(expectedDirectory),
        "closeout_tree_snapshot_changed",
      );
    }
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const stat = await fs.lstat(absolute, { bigint: true });
      if (stat.isSymbolicLink()) {
        files.push({ path: absolute, unsafe: true });
      } else if (stat.isDirectory()) {
        await visit(absolute, stableStatIdentity(stat));
      } else if (stat.isFile()) {
        await readStableFileSnapshot(absolute);
        files.push({ path: absolute, unsafe: false });
      } else {
        files.push({ path: absolute, unsafe: true });
      }
    }
    await assertStableDirectory(current, directoryIdentity, "closeout_tree_snapshot_changed");
  }
  await visit(directory);
  return files;
}

function frontmatterStatus(content) {
  if (!content.startsWith("---\n")) return { status: null, count: 0 };
  const end = content.indexOf("\n---", 4);
  if (end === -1) return { status: null, count: 0 };
  const statusLines = content.slice(4, end).split(/\r?\n/).filter((line) => /^status\s*:/i.test(line));
  const match = statusLines[0]?.match(/^status:\s*(?:(['"])([^'"\n]+)\1|([^'"\n]+))\s*$/i) ?? null;
  return {
    status: match?.[2]?.trim().toLowerCase() ?? match?.[3]?.trim().toLowerCase() ?? null,
    count: statusLines.length,
  };
}

function addIssue(collection, code, details = {}) {
  collection.push({ code, ...details });
}

async function checkPlanningCloseoutCore(options, verificationHolder = null) {
  requireCondition(typeof options.projectRoot === "string", "closeout_project_root_required");
  const scope = resolveCanonicalPlanningRoot(options);
  options = { ...options, projectRoot: scope.projectRoot, planningRoot: scope.planningRoot };
  const root = scope.planningRoot;
  const milestone = options.milestone;
  requireCondition(MILESTONE_PATTERN.test(milestone), "closeout_milestone_invalid");
  const liveSourceSha = resolveSourceSha(scope.projectRoot);
  if (options.strict === true) {
    requireCondition(SOURCE_SHA_PATTERN.test(options.sourceSha ?? ""), "closeout_source_sha_required");
    requireCondition(VERSION_PATTERN.test(options.expectedGsdVersion ?? ""), "closeout_gsd_version_required");
    requireCondition(Array.isArray(options.provenanceReceiptPaths), "closeout_provenance_receipts_required");
    requireCondition(liveSourceSha === options.sourceSha, "closeout_live_source_sha_mismatch");
    requireCondition(verificationHolder !== null, "closeout_verification_fence_required");
  }
  const archive = path.join(root, "milestones", milestone);
  const errors = [];
  const warnings = [];
  let planningTreeSha256 = null;
  let planningTreeFreshnessSha256 = null;
  try {
    const planningTree = await planningTreeEvidence(root);
    planningTreeSha256 = planningTree.contentSha256;
    planningTreeFreshnessSha256 = planningTree.freshnessSha256;
  } catch (error) {
    addIssue(errors, "closeout_planning_tree_snapshot_invalid", { snapshotCode: error?.code ?? "unexpected" });
  }
  const transaction = {
    journalCount: 0,
    committedJournalCount: 0,
    journalSha256: [],
    journalLedger: [],
    leaseIdentity: null,
    writerReady: null,
  };
  let strictJournalDirectory = null;
  let strictJournalDirectoryIdentity = null;
  let strictJournalLedger = null;
  let strictLeaseIdentity = null;
  let strictSealIdentity = null;
  let strictProvenanceInput = null;
  let strictProvenanceIdentity = null;
  const evolvedDirectoryProvenance = [];

  if (options.strict === true) {
    try {
      const leaseStatus = await getWorkflowLeaseStatus({ projectRoot: scope.projectRoot });
      strictLeaseIdentity = workflowLeaseStatusIdentity(leaseStatus);
      strictSealIdentity = {
        workflowLeaseId: leaseStatus.leaseId,
        executionRuntime: leaseStatus.executionRuntime,
        gsdVersion: leaseStatus.gsdVersion,
        modelProfile: leaseStatus.modelProfile,
      };
      transaction.leaseIdentity = strictLeaseIdentity;
      transaction.writerReady =
        leaseStatus.leaseId === verificationHolder.leaseId &&
        leaseStatus.writerFenceId === verificationHolder.fenceId &&
        leaseStatus.writerFenceDigest === verificationHolder.fenceDigest;
      if (!transaction.writerReady) {
        addIssue(errors, "closeout_workflow_writer_blocked", { leaseCode: leaseStatus.code });
      }
    } catch (error) {
      addIssue(errors, "closeout_workflow_lease_status_invalid", { leaseCode: error?.code ?? "unexpected" });
    }
    const journalDirectory = path.join(resolveGitCommonDir(scope.projectRoot), "nutrition-workflow", "closeout-journals");
    strictJournalDirectory = journalDirectory;
    try {
      const stat = await fs.lstat(journalDirectory);
      requireCondition(stat.isDirectory() && !stat.isSymbolicLink(), "closeout_journal_directory_unsafe");
      strictJournalDirectoryIdentity = await stableDirectoryIdentity(journalDirectory, "closeout_journal_directory_unsafe");
      const ledger = await journalLedgerSnapshot(journalDirectory, scope.projectRoot);
      strictJournalLedger = journalLedgerIdentity(ledger);
      transaction.journalLedger = strictJournalLedger;
      const journals = ledger.filter(
        ({ journal }) => journal.worktreeIdentitySha256 === scope.worktreeIdentitySha256 && journal.milestone === milestone,
      );
      transaction.journalCount = journals.length;
      transaction.committedJournalCount = journals.filter(({ journal }) => journal.state === "committed").length;
      transaction.journalSha256 = journals.map(({ journal }) => journal.journalSha256).sort();
      if (journals.length === 0) addIssue(errors, "closeout_journal_missing");
      for (const { journal } of journals) {
        if (
          journal.sourceSha !== options.sourceSha ||
          journal.planningRoot !== scope.planningRootRelative ||
          journal.worktreeIdentitySha256 !== scope.worktreeIdentitySha256 ||
          journal.gitCommonIdentitySha256 !== scope.gitCommonIdentitySha256
        ) {
          addIssue(errors, "closeout_journal_scope_mismatch", { planSha256: journal.planSha256 });
          continue;
        }
        if (journal.state !== "committed") {
          addIssue(errors, "closeout_journal_incomplete", {
            planSha256: journal.planSha256,
            state: journal.state,
            nextOperationIndex: journal.nextOperationIndex,
          });
          continue;
        }
        const archiveEvolution = await archiveTreeEvolution(root, journal, milestone, scope.projectRoot);
        if (!archiveEvolution.matches) {
          addIssue(errors, "closeout_journal_postcondition_changed", {
            planSha256: journal.planSha256,
            reason: "archive_tree_evolution_mismatch",
          });
        } else {
          evolvedDirectoryProvenance.push(...archiveEvolution.evolvedProvenance);
        }
        for (let index = 0; index < journal.operations.length; index += 1) {
          const operation = journal.operations[index];
          let stillApplied;
          if (operation.type === "move") {
            const destination = path.join(root, operation.destination);
            stillApplied = !(await exists(path.join(root, operation.source))) && (await exists(destination));
            if (stillApplied && operation.sourceIdentity.type === "file") {
              stillApplied = sameIdentity(await pathIdentity(destination), operation.sourceIdentity);
            } else if (stillApplied && operation.sourceIdentity.type === "directory") {
              stillApplied = archiveEvolution.matches;
            }
          } else {
            stillApplied = (await operationState(root, operation, milestone, journal.planSha256, index)) === "applied";
          }
          if (!stillApplied) {
            addIssue(errors, "closeout_journal_postcondition_changed", {
              planSha256: journal.planSha256,
              operationIndex: index,
            });
          }
        }
      }
    } catch (error) {
      addIssue(errors, "closeout_journal_invalid", { journalCode: error?.code ?? "unexpected" });
    }
  }

  if (await exists(path.join(root, ".closeout-quarantine"))) {
    addIssue(errors, "closeout_transaction_staging_remains", { path: ".closeout-quarantine" });
  }
  const planningTreeFiles = await filesRecursive(root);
  for (const entry of planningTreeFiles) {
    if (entry.unsafe) {
      addIssue(errors, "closeout_planning_tree_unsafe", { path: relative(root, entry.path) });
      continue;
    }
    if (/\.closeout-[0-9a-f]{64}-\d+\.tmp$/.test(path.basename(entry.path))) {
      addIssue(errors, "closeout_transaction_staging_remains", { path: relative(root, entry.path) });
    }
  }

  for (const fileName of ["STATE.md", "ROADMAP.md", "MILESTONES.md"]) {
    const stat = await fs.lstat(path.join(root, fileName)).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      addIssue(errors, "closeout_root_document_unsafe", { path: fileName });
    }
  }

  for (const [source] of flatMappings(root, milestone)) {
    if (await exists(source)) {
      addIssue(errors, "closeout_flat_archive_remains", { path: relative(root, source) });
    }
  }
  for (const fileName of ARCHIVE_FILES) {
    const candidate = path.join(archive, fileName);
    const stat = await fs.lstat(candidate).catch(() => null);
    if (!stat?.isFile() || stat.isSymbolicLink()) {
      addIssue(errors, "closeout_archive_file_missing", { path: `milestones/${milestone}/${fileName}` });
    }
  }
  const archivePhases = path.join(archive, "phases");
  let phaseEntries = [];
  if (await exists(archivePhases)) {
    const entries = await fs.readdir(archivePhases, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        addIssue(errors, "closeout_archive_phase_entry_unsafe", { path: relative(root, path.join(archivePhases, entry.name)) });
      } else {
        phaseEntries.push(entry);
      }
    }
  }
  if (phaseEntries.length === 0) {
    addIssue(errors, "closeout_archive_phases_missing");
  }

  const rootPhases = path.join(root, "phases");
  if (await exists(rootPhases)) {
    const residual = (await fs.readdir(rootPhases, { withFileTypes: true })).filter(
      (entry) => !(entry.name === ".gitkeep" && entry.isFile() && !entry.isSymbolicLink()),
    );
    if (residual.length > 0) {
      addIssue(errors, "closeout_active_phases_remain", { phases: residual.map((entry) => entry.name).sort() });
    }
  }
  for (const name of TRANSIENT_DIRS) {
    const directory = path.join(root, name);
    if (await exists(directory)) {
      addIssue(errors, "closeout_root_transient_remains", { path: name });
    }
  }

  const state = await readPlainFileOrEmpty(path.join(root, "STATE.md"));
  if (state !== completedMilestoneState(milestone)) {
    addIssue(errors, "closeout_state_terminal_template_mismatch");
  }
  if (!new RegExp(`Milestone\\s+${milestone.replaceAll(".", "\\.")}\\s+complete`, "i").test(state)) {
    addIssue(errors, "closeout_state_not_complete");
  }
  if (!/Awaiting next milestone/i.test(state)) {
    addIssue(errors, "closeout_state_not_awaiting_next_milestone");
  }
  if (/^status:\s*(?:executing|in_progress|blocked)\s*$/im.test(state) || /Resume file:/i.test(state)) {
    addIssue(errors, "closeout_state_stale_active_instruction");
  }

  const rootRoadmap = await readPlainFileOrEmpty(path.join(root, "ROADMAP.md"));
  if (rootRoadmap !== archivedMilestoneRoadmap(milestone)) {
    addIssue(errors, "closeout_roadmap_terminal_template_mismatch");
  }
  for (const phase of phaseEntries) {
    const phaseId = phase.name.match(/^(\d+(?:\.\d+)?)/)?.[1];
    if (phaseId && new RegExp(`^### Phase ${phaseId.replaceAll(".", "\\.")}:`, "m").test(rootRoadmap)) {
      addIssue(errors, "closeout_roadmap_stale_phase_heading", { phase: phaseId });
    }
  }
  const milestones = await readPlainFileOrEmpty(path.join(root, "MILESTONES.md"));
  if (!hasExactTerminalMilestoneIndexEntry(milestones, milestone)) {
    addIssue(errors, "closeout_milestones_index_missing");
  }

  for (const name of TRANSIENT_DIRS) {
    const sidecar = path.join(archive, name);
    if (!(await exists(sidecar))) continue;
    const sidecarStat = await fs.lstat(sidecar).catch(() => null);
    const readmePath = path.join(sidecar, "README.md");
    const readmeStat = await fs.lstat(readmePath).catch(() => null);
    if (!sidecarStat?.isDirectory() || sidecarStat.isSymbolicLink() || !readmeStat?.isFile() || readmeStat.isSymbolicLink()) {
      addIssue(errors, "closeout_sidecar_unsafe", { path: relative(root, sidecar) });
      continue;
    }
    const sidecarEntries = await filesRecursive(sidecar);
    if (sidecarEntries.some((entry) => entry.unsafe)) {
      addIssue(errors, "closeout_sidecar_unsafe", { path: relative(root, sidecar) });
      continue;
    }
    const readme = (await readStableFileSnapshot(readmePath)).bytes.toString("utf8");
    const heading = readme.match(/^# Retained Local Context\s*$/m);
    const rationale = heading ? readme.slice((heading.index ?? 0) + heading[0].length).trim() : "";
    if (!heading || rationale.length === 0) {
      addIssue(errors, "closeout_sidecar_rationale_missing", { path: relative(root, sidecar) });
    }
  }

  const archiveFiles = await filesRecursive(archivePhases);
  let provenance = {
    expectedGsdVersion: options.expectedGsdVersion ?? null,
    artifacts: [],
    verifiedRecords: 0,
  };
  if (options.strict === true) {
    const provenanceArtifacts = archiveFiles
      .filter((entry) => !entry.unsafe && PROVENANCE_ARTIFACT_PATTERN.test(path.basename(entry.path)))
      .map((entry) => relative(path.resolve(options.projectRoot), entry.path))
      .sort((left, right) => left.localeCompare(right, "en"));
    provenance = {
      expectedGsdVersion: options.expectedGsdVersion,
      artifacts: provenanceArtifacts,
      verifiedRecords: 0,
    };
    if (options.provenanceReceiptPaths.length !== provenanceArtifacts.length) {
      addIssue(errors, "closeout_provenance_receipt_cardinality_mismatch", {
        artifacts: provenanceArtifacts.length,
        receipts: options.provenanceReceiptPaths.length,
      });
    } else if (provenanceArtifacts.length === 0) {
      addIssue(errors, "closeout_provenance_artifacts_missing");
    } else {
      strictProvenanceInput = {
        projectRoot: options.projectRoot,
        artifacts: provenanceArtifacts,
        receiptPaths: [...options.provenanceReceiptPaths],
        expectedSourceSha: options.sourceSha,
        expectedGsdVersion: options.expectedGsdVersion,
        expectedRuntime: options.expectedRuntime,
      };
      const externalBeforeProvenanceCheck = await provenanceExternalEvidenceIdentity(
        options.projectRoot,
        strictProvenanceInput.receiptPaths,
      );
      const provenanceCheck = await checkArtifactProvenance(strictProvenanceInput);
      const externalAfterProvenanceCheck = await provenanceExternalEvidenceIdentity(
        options.projectRoot,
        strictProvenanceInput.receiptPaths,
      );
      if (JSON.stringify(externalBeforeProvenanceCheck) !== JSON.stringify(externalAfterProvenanceCheck)) {
        addIssue(errors, "closeout_provenance_evidence_changed_during_check");
      }
      strictProvenanceIdentity = JSON.stringify({
        status: provenanceCheck.status,
        records: provenanceCheck.records,
        findings: provenanceCheck.findings,
        external: externalAfterProvenanceCheck,
      });
      provenance.verifiedRecords = provenanceCheck.records.length;
      const provenanceByArtifact = new Map(
        provenanceCheck.records.map((record) => [record.artifact, record]),
      );
      for (const expected of evolvedDirectoryProvenance) {
        const record = provenanceByArtifact.get(expected.artifact);
        if (!record || record.artifactPayloadSha256 !== expected.expectedPayloadSha256) {
          addIssue(errors, "closeout_journal_postcondition_changed", {
            artifact: expected.artifact,
            reason: "archive_provenance_payload_mismatch",
          });
        }
      }
      for (const finding of provenanceCheck.findings) {
        addIssue(errors, "closeout_artifact_provenance_invalid", {
          artifact: finding.artifact,
          provenanceCode: finding.code,
        });
      }
    }
  }
  const phaseIds = phaseEntries.map((entry) => entry.name.match(/^(\d+(?:\.\d+)?)/)?.[1]).filter(Boolean);
  if (new Set(phaseIds).size !== phaseIds.length) addIssue(errors, "closeout_duplicate_phase_identity");
  for (const phase of phaseEntries) {
    const phaseId = phase.name.match(/^(\d+(?:\.\d+)?)/)?.[1];
    if (!phaseId) {
      addIssue(warnings, "closeout_phase_identity_invalid", { phase: phase.name });
      continue;
    }
    const phaseDirectory = path.join(archivePhases, phase.name);
    const directFiles = (await fs.readdir(phaseDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right, "en"));
    const summaries = directFiles.filter((name) => new RegExp(`^${phaseId.replaceAll(".", "\\.")}-\\d+-SUMMARY\\.md$`).test(name));
    if (summaries.length === 0) {
      addIssue(warnings, "closeout_phase_summary_missing", { phase: phase.name });
    }
    const requiredNames = [`${phaseId}-VALIDATION.md`, `${phaseId}-VERIFICATION.md`];
    for (const requiredName of requiredNames) {
      if (!directFiles.includes(requiredName)) {
        addIssue(warnings, "closeout_phase_artifact_missing", { phase: phase.name, artifact: requiredName });
      }
    }
    const sealName = `${phaseId}-SEAL.json`;
    if (!directFiles.includes(sealName)) {
      addIssue(warnings, "closeout_phase_artifact_missing", { phase: phase.name, artifact: sealName });
      continue;
    }
    const optionalUat = `${phaseId}-UAT.md`;
    const requiredInputs = [...summaries, ...(directFiles.includes(optionalUat) ? [optionalUat] : []), ...requiredNames];
    if (summaries.length > 0 && requiredNames.every((name) => directFiles.includes(name))) {
      const seal = await checkVerificationSeal({
        root: phaseDirectory,
        projectRoot: options.projectRoot,
        sealPath: sealName,
        requiredInputs,
        expectedPhaseId: phaseId,
        expectedSourceSha: options.sourceSha,
        expectedRuntime: strictSealIdentity?.executionRuntime,
        expectedGsdVersion: strictSealIdentity?.gsdVersion,
        expectedModelProfile: strictSealIdentity?.modelProfile,
        expectedWorkflowLeaseId: strictSealIdentity?.workflowLeaseId,
      });
      if (seal.status !== "pass") {
        addIssue(errors, "closeout_verification_stale", {
          path: relative(root, path.join(phaseDirectory, sealName)),
          sealCode: seal.code,
        });
      }
    }
  }
  for (const entry of archiveFiles) {
    const rel = relative(root, entry.path);
    if (entry.unsafe) {
      addIssue(errors, "closeout_archive_symlink_rejected", { path: rel });
      continue;
    }
    const name = path.basename(entry.path);
    const parsedStatus = frontmatterStatus((await readStableFileSnapshot(entry.path)).bytes.toString("utf8"));
    if (parsedStatus.count > 1) {
      addIssue(errors, "closeout_frontmatter_status_duplicate", { path: rel });
      continue;
    }
    const status = parsedStatus.status;
    if (name.endsWith("-SUMMARY.md") && status !== "complete") {
      addIssue(errors, "closeout_summary_status_nonterminal", { path: rel, status: status ?? "missing" });
    } else if (name.endsWith("-UAT.md") && status !== "complete") {
      addIssue(errors, "closeout_uat_status_human_decision_required", { path: rel, status: status ?? "missing" });
    } else if (name.endsWith("-VALIDATION.md") && !["validated", "complete"].includes(status ?? "")) {
      addIssue(errors, "closeout_validation_status_nonterminal", { path: rel, status: status ?? "missing" });
    } else if (name.endsWith("-VERIFICATION.md")) {
      if (!["passed", "complete", "human_needed"].includes(status ?? "")) {
        addIssue(errors, "closeout_verification_status_nonterminal", { path: rel, status: status ?? "missing" });
      } else if (status === "human_needed") {
        addIssue(warnings, "closeout_verification_human_decision_required", { path: rel });
      }
      const sealPath = rel.replace(/-VERIFICATION\.md$/, "-SEAL.json");
      if (!(await exists(path.join(root, sealPath)))) {
        addIssue(errors, "closeout_verification_seal_missing", { path: sealPath });
      }
    }
  }

  if (typeof options.testCheckpoint === "function") await options.testCheckpoint("before_final_freshness_check");
  if (options.strict === true && verificationHolder !== null) {
    try {
      await verificationHolder.assertCurrent();
    } catch {
      addIssue(errors, "closeout_verification_fence_changed_during_check");
    }
  }
  try {
    const finalTree = await planningTreeEvidence(root);
    if (
      resolveSourceSha(scope.projectRoot) !== liveSourceSha ||
      finalTree.contentSha256 !== planningTreeSha256 ||
      finalTree.freshnessSha256 !== planningTreeFreshnessSha256
    ) {
      addIssue(errors, "closeout_evidence_changed_during_check");
    }
  } catch {
    addIssue(errors, "closeout_evidence_changed_during_check");
  }
  if (strictProvenanceInput !== null && strictProvenanceIdentity !== null) {
    try {
      const externalBeforeFinalProvenanceCheck = await provenanceExternalEvidenceIdentity(
        options.projectRoot,
        strictProvenanceInput.receiptPaths,
      );
      const finalProvenanceCheck = await checkArtifactProvenance(strictProvenanceInput);
      const externalAfterFinalProvenanceCheck = await provenanceExternalEvidenceIdentity(
        options.projectRoot,
        strictProvenanceInput.receiptPaths,
      );
      const finalProvenanceIdentity = JSON.stringify({
        status: finalProvenanceCheck.status,
        records: finalProvenanceCheck.records,
        findings: finalProvenanceCheck.findings,
        external: externalAfterFinalProvenanceCheck,
      });
      if (
        JSON.stringify(externalBeforeFinalProvenanceCheck) !== JSON.stringify(externalAfterFinalProvenanceCheck) ||
        finalProvenanceIdentity !== strictProvenanceIdentity
      ) {
        addIssue(errors, "closeout_provenance_evidence_changed_during_check");
      }
    } catch {
      addIssue(errors, "closeout_provenance_evidence_changed_during_check");
    }
  }
  if (
    options.strict === true &&
    strictLeaseIdentity !== null &&
    strictJournalDirectory !== null &&
    strictJournalDirectoryIdentity !== null &&
    strictJournalLedger !== null
  ) {
    try {
      await verificationHolder.assertCurrent();
      const finalLeaseIdentity = workflowLeaseStatusIdentity(
        await getWorkflowLeaseStatus({ projectRoot: scope.projectRoot }),
      );
      const finalJournalLedger = journalLedgerIdentity(
        await journalLedgerSnapshot(strictJournalDirectory, scope.projectRoot),
      );
      const finalJournalDirectoryIdentity = await stableDirectoryIdentity(
        strictJournalDirectory,
        "closeout_journal_directory_unsafe",
      );
      if (
        JSON.stringify(finalLeaseIdentity) !== JSON.stringify(strictLeaseIdentity) ||
        JSON.stringify(finalJournalDirectoryIdentity) !== JSON.stringify(strictJournalDirectoryIdentity) ||
        JSON.stringify(finalJournalLedger) !== JSON.stringify(strictJournalLedger)
      ) {
        addIssue(errors, "closeout_transaction_evidence_changed_during_check");
      }
    } catch {
      addIssue(errors, "closeout_transaction_evidence_changed_during_check");
    }
  }
  errors.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  warnings.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right), "en"));
  const failed = errors.length > 0 || (options.strict === true && warnings.length > 0);
  return {
    schemaVersion: 1,
    kind: "planning_closeout_check",
    milestone,
    strict: options.strict === true,
    status: failed ? "fail" : "pass",
    sourceSha: liveSourceSha,
    worktreeIdentitySha256: scope.worktreeIdentitySha256,
    gitCommonIdentitySha256: scope.gitCommonIdentitySha256,
    planningTreeSha256,
    planningTreeFreshnessSha256,
    errors,
    warnings,
    provenance,
    transaction,
  };
}

export async function checkPlanningCloseout(options) {
  requireCondition(typeof options.projectRoot === "string", "closeout_project_root_required");
  if (options.strict !== true) return checkPlanningCloseoutCore(options);
  requireCondition(typeof options.tokenFile === "string" && options.tokenFile.length > 0, "closeout_token_file_required");
  requireCondition(["codex", "claude"].includes(options.expectedRuntime), "closeout_runtime_required");
  const scope = resolveCanonicalPlanningRoot(options);
  return withWorkflowWriterFence(
    {
      projectRoot: scope.projectRoot,
      tokenFile: options.tokenFile,
      expectedRuntime: options.expectedRuntime,
      purpose: "workflow_command",
      maxDurationSeconds: options.maxDurationSeconds ?? 300,
      now: options.now,
      fenceId: options.fenceId,
    },
    async (holder) => checkPlanningCloseoutCore({ ...options, projectRoot: scope.projectRoot }, holder),
  );
}

function parseCli(argv) {
  const [command, ...args] = argv;
  const values = {};
  const flags = new Set();
  const provenanceReceipts = [];
  const allowedValues = {
    normalize: new Set(["planning-root", "milestone", "project-root", "source-sha", "token-file", "runtime", "confirm-plan-sha256"]),
    check: new Set([
      "planning-root",
      "milestone",
      "project-root",
      "source-sha",
      "gsd-version",
      "provenance-receipt",
      "token-file",
      "runtime",
    ]),
  };
  const allowedFlags = {
    normalize: new Set(["dry-run"]),
    check: new Set(["strict"]),
  };
  requireCondition(command === "normalize" || command === "check", "closeout_usage_error");
  for (const arg of args) {
    if (!arg.startsWith("--")) requireCondition(false, "closeout_usage_error");
    const equals = arg.indexOf("=");
    if (equals === -1) {
      const flag = arg.slice(2);
      requireCondition(allowedFlags[command].has(flag) && !flags.has(flag), "closeout_usage_error");
      flags.add(flag);
    } else {
      const key = arg.slice(2, equals);
      requireCondition(allowedValues[command].has(key), "closeout_usage_error");
      const value = arg.slice(equals + 1);
      requireCondition(value.length > 0, "closeout_usage_error");
      if (command === "check" && key === "provenance-receipt") {
        provenanceReceipts.push(value);
      } else {
        requireCondition(!Object.hasOwn(values, key), "closeout_usage_error");
        values[key] = value;
      }
    }
  }
  requireCondition(
    typeof values["planning-root"] === "string" &&
      typeof values.milestone === "string" &&
      typeof values["project-root"] === "string" &&
      values["project-root"].length > 0,
    "closeout_usage_error",
  );
  if (command === "normalize" && flags.has("dry-run")) {
    requireCondition(
      Object.keys(values).every((key) => key === "planning-root" || key === "milestone" || key === "project-root"),
      "closeout_usage_error",
    );
  }
  if (command === "normalize" && !flags.has("dry-run")) {
    requireCondition(typeof values["project-root"] === "string" && values["project-root"].length > 0, "closeout_usage_error");
    requireCondition(SOURCE_SHA_PATTERN.test(values["source-sha"] ?? ""), "closeout_usage_error");
    requireCondition(typeof values["token-file"] === "string" && values["token-file"].length > 0, "closeout_usage_error");
    requireCondition(values.runtime === "codex" || values.runtime === "claude", "closeout_usage_error");
    requireCondition(/^[0-9a-f]{64}$/.test(values["confirm-plan-sha256"] ?? ""), "closeout_usage_error");
  }
  if (flags.has("strict")) {
    requireCondition(SOURCE_SHA_PATTERN.test(values["source-sha"] ?? ""), "closeout_usage_error");
    requireCondition(typeof values["project-root"] === "string" && values["project-root"].length > 0, "closeout_usage_error");
    requireCondition(VERSION_PATTERN.test(values["gsd-version"] ?? ""), "closeout_usage_error");
    requireCondition(provenanceReceipts.length > 0, "closeout_usage_error");
    requireCondition(typeof values["token-file"] === "string" && values["token-file"].length > 0, "closeout_usage_error");
    requireCondition(values.runtime === "codex" || values.runtime === "claude", "closeout_usage_error");
  } else if (command === "check") {
    requireCondition(
      Object.keys(values).every((key) => key === "planning-root" || key === "milestone" || key === "project-root") &&
        provenanceReceipts.length === 0,
      "closeout_usage_error",
    );
  }
  return { command, values, flags, provenanceReceipts };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  try {
    const { command, values, flags, provenanceReceipts } = parseCli(process.argv.slice(2));
    const result =
      command === "normalize"
        ? await normalizePlanningCloseout({
            planningRoot: values["planning-root"],
            milestone: values.milestone,
            dryRun: flags.has("dry-run"),
            projectRoot: values["project-root"],
            sourceSha: values["source-sha"],
            tokenFile: values["token-file"],
            expectedRuntime: values.runtime,
            confirmPlanSha256: values["confirm-plan-sha256"],
          })
        : await checkPlanningCloseout({
            planningRoot: values["planning-root"],
            milestone: values.milestone,
            strict: flags.has("strict"),
            sourceSha: values["source-sha"],
            projectRoot: values["project-root"],
            expectedGsdVersion: values["gsd-version"],
            provenanceReceiptPaths: provenanceReceipts,
            tokenFile: values["token-file"],
            expectedRuntime: values.runtime,
          });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exitCode = result.status === "pass" ? 0 : 1;
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({ schemaVersion: 1, kind: "planning_closeout_error", code: error?.code ?? "closeout_unexpected_error" })}\n`,
    );
    process.exitCode = 1;
  }
}
