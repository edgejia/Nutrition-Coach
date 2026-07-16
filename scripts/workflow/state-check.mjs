#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { resolveCanonicalPlanningRoot } from "./project-scope.mjs";

const SOURCE_SHA_PATTERN = /^[0-9a-f]{40}$/;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
const MAX_ENTRIES = 20_000;
const PHASE_DIRECTORY_PATTERN = /^(\d+(?:\.\d+)?)-[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PHASE_AUXILIARY_PATTERN = /^(\d+(?:\.\d+)?)-(?:AI-SPEC|CHECKPOINT|CONTEXT|DISCUSSION(?:-LOG)?|EVAL-REVIEW|PATTERNS|PREFLIGHT|R03-DIAGNOSTIC|RESEARCH|REVIEW|SECURITY|SPEC|UI-SPEC|UAT|VALIDATION|VERIFICATION)\.md$/;

function stateError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

function requireCondition(condition, code) {
  if (!condition) throw stateError(code);
}

function resolveSourceSha(projectRoot) {
  let sourceSha;
  try {
    sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: projectRoot, encoding: "utf8" }).trim();
  } catch {
    throw stateError("workflow_state_source_sha_invalid");
  }
  if (!SOURCE_SHA_PATTERN.test(sourceSha)) throw stateError("workflow_state_source_sha_invalid");
  return sourceSha;
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
    requireCondition(before.isFile() && sameIdentity(before, expectedStat), "workflow_state_tree_changed_during_read");
    requireCondition(before.size <= BigInt(MAX_FILE_BYTES), "workflow_state_tree_file_limit_exceeded");
    const size = Number(before.size);
    const content = Buffer.alloc(size);
    let position = 0;
    while (position < size) {
      const read = fs.readSync(descriptor, content, position, size - position, position);
      requireCondition(read > 0, "workflow_state_tree_changed_during_read");
      position += read;
    }
    const after = fs.fstatSync(descriptor, { bigint: true });
    requireCondition(sameIdentity(before, after), "workflow_state_tree_changed_during_read");
    return content;
  } finally {
    fs.closeSync(descriptor);
  }
}

function capturePlanningSnapshot(root) {
  const entries = [];
  const files = new Map();
  const directories = new Set();
  const children = new Map();
  let totalBytes = 0;

  function addChild(parent, name, type) {
    const current = children.get(parent) ?? [];
    current.push({ name, type });
    children.set(parent, current);
  }

  function visit(current, relative) {
    requireCondition(entries.length < MAX_ENTRIES, "workflow_state_tree_entry_limit_exceeded");
    const before = fs.lstatSync(current, { bigint: true });
    requireCondition(!before.isSymbolicLink(), "workflow_state_tree_unsafe");
    if (before.isDirectory()) {
      requireCondition(fs.realpathSync(current) === current, "workflow_state_tree_unsafe");
      directories.add(relative);
      entries.push({ path: relative, type: "directory", ...statIdentity(before) });
      const names = fs.readdirSync(current).sort((left, right) => left.localeCompare(right, "en"));
      for (const name of names) {
        requireCondition(!name.includes("\n") && !name.includes("\r"), "workflow_state_tree_unsafe");
        const childRelative = relative ? path.posix.join(relative, name) : name;
        const childType = visit(path.join(current, name), childRelative);
        addChild(relative, name, childType);
      }
      const after = fs.lstatSync(current, { bigint: true });
      requireCondition(sameIdentity(before, after), "workflow_state_tree_changed_during_read");
      return "directory";
    }
    requireCondition(before.isFile() && before.nlink === 1n, "workflow_state_tree_unsafe");
    const content = readStableFile(current, before);
    totalBytes += content.length;
    requireCondition(totalBytes <= MAX_TOTAL_BYTES, "workflow_state_tree_total_limit_exceeded");
    const sha256 = createHash("sha256").update(content).digest("hex");
    files.set(relative, { content, identity: statIdentity(before), sha256 });
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

function captureStablePlanningSnapshot(root) {
  const first = capturePlanningSnapshot(root);
  const second = capturePlanningSnapshot(root);
  requireCondition(first.treeSha256 === second.treeSha256, "workflow_state_changed_during_snapshot");
  return second;
}

function snapshotText(snapshot, relative) {
  return snapshot.files.get(relative)?.content.toString("utf8") ?? null;
}

function parseScalar(value) {
  const trimmed = value.trim();
  const first = trimmed[0];
  const last = trimmed.at(-1);
  const hasBoundaryQuote = first === "'" || first === '"' || last === "'" || last === '"';
  if (hasBoundaryQuote && (trimmed.length < 2 || first !== last || (first !== "'" && first !== '"'))) {
    return { valid: false, value: null };
  }
  const normalized = hasBoundaryQuote ? trimmed.slice(1, -1) : trimmed;
  if (/^-?\d+$/.test(normalized)) {
    const numeric = Number(normalized);
    return { valid: Number.isSafeInteger(numeric), value: numeric };
  }
  return { valid: true, value: normalized };
}

function frontmatterLineShape(line) {
  if (line.includes("\t")) return null;
  const indentation = line.match(/^ */)?.[0].length ?? 0;
  if (indentation % 2 !== 0) return null;
  const body = line.slice(indentation);
  const mapping = body.match(/^(['"]?)([A-Za-z0-9_-]+)\1:\s*(.*)$/);
  if (mapping) {
    return {
      indentation,
      type: "mapping",
      key: mapping[2],
      value: mapping[3],
      allowsChildren: mapping[3] === "",
    };
  }
  const listMapping = body.match(/^-\s+(['"]?)([A-Za-z0-9_-]+)\1:\s*(.*)$/);
  if (listMapping) {
    return {
      indentation,
      type: "list_mapping",
      key: listMapping[2],
      value: listMapping[3],
      allowsChildren: true,
    };
  }
  if (/^-\s+\S.*$/.test(body)) {
    return { indentation, type: "list_scalar", key: null, value: body.slice(2), allowsChildren: false };
  }
  return null;
}

function parseFrontmatter(content) {
  const value = {};
  const duplicates = [];
  const invalidLines = [];
  const opening = content?.match(/^---\r?\n/);
  if (!opening) return { value, duplicates, invalidLines, present: false, valid: false };
  const start = opening[0].length;
  const closing = content.slice(start).match(/\r?\n---(?:\r?\n|$)/);
  if (!closing || closing.index === undefined) return { value, duplicates, invalidLines, present: true, valid: false };
  let section = null;
  const lines = content.slice(start, start + closing.index).split(/\r?\n/);
  let previousShape = null;
  const containerTypes = new Map([[0, "mapping"]]);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    const shape = frontmatterLineShape(line);
    const indentationValid = shape !== null && (
      previousShape === null
        ? shape.indentation === 0
        : shape.indentation <= previousShape.indentation ||
          (shape.indentation === previousShape.indentation + 2 && previousShape.allowsChildren)
    );
    if (shape !== null && previousShape !== null && shape.indentation <= previousShape.indentation) {
      for (const indentation of [...containerTypes.keys()]) {
        if (indentation > shape.indentation) containerTypes.delete(indentation);
      }
    }
    const shapeContainerType = shape?.type.startsWith("list_") ? "list" : "mapping";
    const expectedContainerType = shape === null ? null : containerTypes.get(shape.indentation);
    const containerTypeValid = shape !== null && (expectedContainerType === undefined || expectedContainerType === shapeContainerType);
    if (!indentationValid || !containerTypeValid || (shape.indentation === 0 && shape.type !== "mapping")) {
      invalidLines.push(index + 1);
      section = null;
      previousShape = null;
      for (const indentation of [...containerTypes.keys()]) {
        if (indentation > 0) containerTypes.delete(indentation);
      }
      continue;
    }
    if (expectedContainerType === undefined) containerTypes.set(shape.indentation, shapeContainerType);
    previousShape = shape;
    if (shape.indentation === 0) {
      if (Object.hasOwn(value, shape.key)) {
        duplicates.push({ key: shape.key });
        section = null;
        continue;
      }
      const scalar = shape.value === "" ? { valid: true, value: {} } : parseScalar(shape.value);
      if (!scalar.valid) {
        invalidLines.push(index + 1);
        section = null;
        continue;
      }
      section = shape.value === "" ? shape.key : null;
      value[shape.key] = scalar.value;
      continue;
    }
    if (shape.indentation === 2 && shape.type === "mapping" && section && typeof value[section] === "object") {
      if (Object.hasOwn(value[section], shape.key)) {
        duplicates.push({ section, key: shape.key });
        continue;
      }
      const scalar = parseScalar(shape.value);
      if (!scalar.valid) {
        invalidLines.push(index + 1);
        continue;
      }
      value[section][shape.key] = scalar.value;
    }
  }
  return { value, duplicates, invalidLines, present: true, valid: invalidLines.length === 0 };
}

function stripHtmlComments(content) {
  return content.replace(/<!--[\s\S]*?(?:-->|$)/g, (comment) => comment.replace(/[^\r\n]/g, " "));
}

function canonicalSections(content, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...content.matchAll(new RegExp(`^## ${escaped}\\s*$`, "gmi"))];
  return matches.map((match) => {
    const start = match.index + match[0].length;
    const next = content.slice(start).search(/\n##\s+/);
    return content.slice(start, next === -1 ? content.length : start + next);
  });
}

function phaseIdFromName(value) {
  return value.match(/^(\d+(?:\.\d+)?)/)?.[1] ?? null;
}

function planIdFromName(value) {
  return value.match(/^(\d+(?:\.\d+)?-\d+)-PLAN\.md$/)?.[1] ?? null;
}

function summaryPlanIdFromName(value) {
  return value.match(/^(\d+(?:\.\d+)?-\d+)-SUMMARY\.md$/)?.[1] ?? null;
}

function sorted(values) {
  return [...values].sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}

function canonicalStatus(value) {
  const normalized = String(value ?? "").trim().toLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  if (["complete", "completed", "done"].includes(normalized)) return "complete";
  if (["executing", "in progress", "active", "ready to execute"].includes(normalized)) return "active";
  if (["not started", "pending", "planned", "planning", "ready to plan"].includes(normalized)) return "not_started";
  if (normalized === "blocked") return "blocked";
  if (normalized === "paused") return "paused";
  return null;
}

function canonicalBodyFact(section, label, pattern) {
  const matches = [];
  const malformed = [];
  const prefix = new RegExp(`^\\s*${label.replace(/\s+/g, "\\s+")}\\s*:`, "i");
  for (const line of section.split(/\r?\n/)) {
    if (!prefix.test(line)) continue;
    const match = line.match(pattern);
    if (match) matches.push(match);
    else malformed.push(line);
  }
  return { matches, malformed };
}

function parseState(content) {
  const errors = [];
  const frontmatter = parseFrontmatter(content);
  if (!frontmatter.valid) errors.push({ code: "state_frontmatter_invalid" });
  for (const duplicate of frontmatter.duplicates) {
    errors.push({ code: "state_frontmatter_duplicate_key", ...duplicate });
  }
  const visibleContent = stripHtmlComments(content);
  const currentSections = canonicalSections(visibleContent, "Current Position");
  const continuitySections = canonicalSections(visibleContent, "Session Continuity");
  if (currentSections.length > 1) errors.push({ code: "state_duplicate_current_position_section" });
  if (continuitySections.length > 1) errors.push({ code: "state_duplicate_session_continuity_section" });
  const currentPosition = currentSections[0] ?? "";
  const continuity = continuitySections[0] ?? "";
  const phaseFact = canonicalBodyFact(currentPosition, "Phase", /^Phase:\s*(\d+(?:\.\d+)?)\s+[—-]\s+(.+?)\s*$/i);
  const planFact = canonicalBodyFact(currentPosition, "Plan", /^Plan:\s*(\d+)\s+plans? ready\s*$/i);
  const statusFact = canonicalBodyFact(currentPosition, "Status", /^Status:\s*(.+?)\s*$/i);
  const progressFact = canonicalBodyFact(currentPosition, "Progress", /^Progress:\s*.*?\b(\d+)%\s*$/i);
  const stoppedFact = canonicalBodyFact(continuity, "Stopped at", /^Stopped at:\s*(.+?)\s*$/i);
  for (const [name, fact] of [
    ["phase", phaseFact],
    ["plan", planFact],
    ["status", statusFact],
    ["progress", progressFact],
  ]) {
    const matches = fact.matches;
    if (matches.length === 0) errors.push({ code: `state_current_position_${name}_missing` });
    if (matches.length > 1) errors.push({ code: `state_current_position_duplicate_${name}` });
    if (fact.malformed.length > 0) errors.push({ code: `state_current_position_${name}_malformed` });
  }
  const phaseLines = phaseFact.matches;
  const planLines = planFact.matches;
  const statusLines = statusFact.matches;
  const progressLines = progressFact.matches;
  const stoppedLines = stoppedFact.matches;
  if (stoppedLines.length === 0) errors.push({ code: "state_session_continuity_stopped_at_missing" });
  if (stoppedLines.length > 1) errors.push({ code: "state_session_continuity_duplicate_stopped_at" });
  if (stoppedFact.malformed.length > 0) errors.push({ code: "state_session_continuity_stopped_at_malformed" });
  if (statusLines.length === 1 && canonicalStatus(statusLines[0][1]) === null) {
    errors.push({ code: "state_current_position_status_invalid" });
  }
  const currentReady = planLines[0]?.[1];
  const continuityReady = stoppedLines[0]?.[1].match(/\b(\d+)\s+plans? ready\b/i)?.[1];
  return {
    errors,
    state: {
      currentPhase: String(frontmatter.value.current_phase ?? ""),
      currentPhaseName: String(frontmatter.value.current_phase_name ?? ""),
      status: canonicalStatus(frontmatter.value.status),
      stoppedAt: String(frontmatter.value.stopped_at ?? ""),
      totalPhases: Number(frontmatter.value.progress?.total_phases),
      completedPhases: Number(frontmatter.value.progress?.completed_phases),
      totalPlans: Number(frontmatter.value.progress?.total_plans),
      completedPlans: Number(frontmatter.value.progress?.completed_plans),
      percent: Number(frontmatter.value.progress?.percent),
      currentReady: currentReady === undefined ? null : Number(currentReady),
      continuityReady: continuityReady === undefined ? null : Number(continuityReady),
      bodyPhase: phaseLines[0]?.[1] ?? null,
      bodyPhaseName: phaseLines[0]?.[2]?.trim() ?? null,
      bodyStatus: canonicalStatus(statusLines[0]?.[1]),
      bodyPercent: progressLines[0]?.[1] === undefined ? null : Number(progressLines[0][1]),
      continuityStoppedAt: stoppedLines[0]?.[1]?.trim() ?? null,
    },
  };
}

function parseRoadmap(content) {
  content = stripHtmlComments(content);
  const headings = [...content.matchAll(/^### Phase (\d+(?:\.\d+)?):[^\n]*$/gm)];
  const phases = new Map();
  const errors = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const phaseId = heading[1];
    const phaseName = heading[0].replace(/^### Phase \d+(?:\.\d+)?:\s*/, "").trim();
    const start = heading.index + heading[0].length;
    const end = headings[index + 1]?.index ?? content.length;
    const section = content.slice(start, end);
    if (phases.has(phaseId)) errors.push({ code: "roadmap_duplicate_phase_identity", phase: phaseId });
    const declarations = [...section.matchAll(/^\*\*Plans\*\*:\s*(?:(\d+)\/(\d+)|(\d+)\s+plans?|TBD)(?:\s+plans?)?\s*(?:executed)?\s*$/gim)];
    if (declarations.length > 1) errors.push({ code: "roadmap_duplicate_declared_plan_count", phase: phaseId });
    const declared = declarations[0];
    const declaredTotal = !declared ? null : /TBD/i.test(declared[0]) ? "TBD" : Number(declared[2] ?? declared[3]);
    const declaredCompleted = declared?.[1] === undefined ? null : Number(declared[1]);
    if (
      declaredCompleted !== null &&
      (typeof declaredTotal !== "number" || declaredCompleted < 0 || declaredCompleted > declaredTotal)
    ) {
      errors.push({ code: "roadmap_declared_completed_plan_count_invalid", phase: phaseId });
    }
    const planChecks = new Map();
    for (const match of section.matchAll(/^- \[([ xX])\]\s+(\d+(?:\.\d+)?-\d+)-PLAN\.md\b/gm)) {
      if (planChecks.has(match[2])) errors.push({ code: "roadmap_duplicate_plan_identity", phase: phaseId, plan: match[2] });
      else planChecks.set(match[2], match[1].toLowerCase() === "x");
    }
    if (!phases.has(phaseId)) {
      phases.set(phaseId, { name: phaseName, declaredTotal, declaredCompleted, planChecks });
    }
  }

  const progress = new Map();
  const progressSections = canonicalSections(content, "Progress");
  if (progressSections.length > 1) errors.push({ code: "roadmap_duplicate_progress_section" });
  const progressSection = progressSections[0] ?? "";
  for (const line of progressSection.split(/\r?\n/)) {
    if (!/^\|/.test(line)) continue;
    const cells = line.split("|").slice(1, -1).map((cell) => cell.trim());
    const phaseMatch = cells[0]?.match(/^(\d+(?:\.\d+)?)(?:\.|\s)/);
    if (!phaseMatch) continue;
    const planMatch = cells[1]?.match(/^(\d+)\/(\d+|TBD)$/i);
    if (cells.length !== 4 || !planMatch) {
      errors.push({ code: "roadmap_progress_row_schema_invalid", phase: phaseMatch[1] });
      continue;
    }
    if (progress.has(phaseMatch[1])) errors.push({ code: "roadmap_duplicate_progress_identity", phase: phaseMatch[1] });
    else {
      progress.set(phaseMatch[1], {
        completed: Number(planMatch[1]),
        total: planMatch[2].toUpperCase() === "TBD" ? "TBD" : Number(planMatch[2]),
        status: canonicalStatus(cells[2]),
        completedAt: cells[3],
      });
    }
  }
  return { phases, progress, errors };
}

function isAllowedAuxiliaryFile(name, phaseId) {
  const match = name.match(PHASE_AUXILIARY_PATTERN);
  return match !== null && match[1] === phaseId;
}

function collectDisk(snapshot) {
  const phases = new Map();
  const errors = [];
  if (!snapshot.directories.has("phases")) {
    errors.push({ code: "disk_phases_root_missing_or_unsafe" });
    return { phases, errors };
  }

  for (const entry of snapshot.children.get("phases") ?? []) {
    if (entry.type === "file" && entry.name === ".gitkeep") {
      if (snapshot.files.get("phases/.gitkeep")?.content.length !== 0) errors.push({ code: "disk_unknown_phases_entry", entry: entry.name });
      continue;
    }
    if (entry.type !== "directory" || !PHASE_DIRECTORY_PATTERN.test(entry.name)) {
      errors.push({ code: "disk_unknown_phases_entry", entry: entry.name });
      continue;
    }
    const phaseId = phaseIdFromName(entry.name);
    const phaseDir = `phases/${entry.name}`;
    if (phases.has(phaseId)) {
      errors.push({ code: "disk_duplicate_phase_identity", phase: phaseId, directories: [phases.get(phaseId).directory, entry.name] });
      continue;
    }
    const planIds = new Set();
    const summaryIds = new Set();
    const completeSummaryIds = new Set();
    for (const file of snapshot.children.get(phaseDir) ?? []) {
      const relative = `${phaseDir}/${file.name}`;
      if (file.type === "directory" && file.name === "attempts") continue;
      if (file.type !== "file") {
        errors.push({ code: "disk_unknown_phase_entry", phase: phaseId, entry: file.name });
        continue;
      }
      if (file.name === ".gitkeep" && snapshot.files.get(relative)?.content.length === 0) continue;
      const planId = planIdFromName(file.name);
      if (planId) {
        if (!planId.startsWith(`${phaseId}-`)) errors.push({ code: "disk_plan_phase_mismatch", phase: phaseId, plan: planId });
        planIds.add(planId);
        continue;
      }
      const summaryId = summaryPlanIdFromName(file.name);
      if (summaryId) {
        summaryIds.add(summaryId);
        if (!summaryId.startsWith(`${phaseId}-`)) errors.push({ code: "disk_summary_phase_mismatch", phase: phaseId, plan: summaryId });
        const parsed = parseFrontmatter(snapshotText(snapshot, relative));
        if (!parsed.valid) errors.push({ code: "summary_frontmatter_invalid", phase: phaseId, plan: summaryId });
        for (const duplicate of parsed.duplicates) {
          errors.push({ code: "summary_frontmatter_duplicate_key", phase: phaseId, plan: summaryId, ...duplicate });
        }
        const summaryStatus = canonicalStatus(parsed.value.status);
        if (summaryStatus === null) errors.push({ code: "summary_status_invalid", phase: phaseId, plan: summaryId });
        if (summaryStatus === "complete") completeSummaryIds.add(summaryId);
        continue;
      }
      if (!isAllowedAuxiliaryFile(file.name, phaseId)) {
        errors.push({ code: "disk_unknown_phase_entry", phase: phaseId, entry: file.name });
      }
    }
    for (const summaryId of summaryIds) {
      if (!planIds.has(summaryId)) errors.push({ code: "disk_orphan_summary", phase: phaseId, plan: summaryId });
    }
    phases.set(phaseId, { directory: entry.name, planIds, completeSummaryIds });
  }
  return { phases, errors };
}

function pushError(errors, code, details = {}) {
  errors.push({ code, ...details });
}

function valuesMatch(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function checkWorkflowState(planningRoot, options = {}) {
  let scope;
  try {
    const resolvedRoot = path.resolve(planningRoot);
    const projectRoot = typeof options.projectRoot === "string" ? options.projectRoot : path.dirname(resolvedRoot);
    scope = resolveCanonicalPlanningRoot({ projectRoot, planningRoot: resolvedRoot });
  } catch (error) {
    return {
      schemaVersion: 1,
      kind: "workflow_state_check",
      status: "fail",
      errors: [{ code: typeof error?.code === "string" ? error.code : "workflow_state_scope_invalid" }],
    };
  }

  let snapshot;
  try {
    const sourceSha = resolveSourceSha(scope.projectRoot);
    snapshot = captureStablePlanningSnapshot(scope.planningRoot);
    scope = { ...scope, sourceSha, planningTreeSha256: snapshot.treeSha256 };
  } catch (error) {
    return {
      schemaVersion: 1,
      kind: "workflow_state_check",
      status: "fail",
      errors: [{ code: typeof error?.code === "string" ? error.code : "workflow_state_tree_unsafe" }],
    };
  }

  const scopeEvidence = {
    sourceSha: scope.sourceSha,
    planningTreeSha256: scope.planningTreeSha256,
    worktreeIdentitySha256: scope.worktreeIdentitySha256,
    gitCommonIdentitySha256: scope.gitCommonIdentitySha256,
  };
  const stateContent = snapshotText(snapshot, "STATE.md");
  const roadmapContent = snapshotText(snapshot, "ROADMAP.md");
  const errors = [];
  if (stateContent === null) pushError(errors, "state_file_missing");
  if (roadmapContent === null) pushError(errors, "roadmap_file_missing");
  if (errors.length > 0) return { schemaVersion: 1, kind: "workflow_state_check", status: "fail", ...scopeEvidence, errors };

  const parsedState = parseState(stateContent);
  const state = parsedState.state;
  const roadmap = parseRoadmap(roadmapContent);
  const diskResult = collectDisk(snapshot);
  const disk = diskResult.phases;
  errors.push(...parsedState.errors, ...roadmap.errors, ...diskResult.errors);
  const phaseIds = sorted(new Set([...roadmap.phases.keys(), ...disk.keys()]));
  const roadmapPhaseIds = [...roadmap.phases.keys()];
  if (!valuesMatch(roadmapPhaseIds, sorted(roadmapPhaseIds))) {
    pushError(errors, "roadmap_phase_order_invalid");
  }
  for (const phaseId of roadmap.progress.keys()) {
    if (!roadmap.phases.has(phaseId)) pushError(errors, "roadmap_progress_extra", { phase: phaseId });
  }

  for (const key of ["totalPhases", "completedPhases", "totalPlans", "completedPlans"]) {
    if (!Number.isInteger(state[key]) || state[key] < 0) pushError(errors, "state_progress_field_invalid", { field: key });
  }
  if (!Number.isInteger(state.percent) || state.percent < 0 || state.percent > 100) {
    pushError(errors, "state_progress_field_invalid", { field: "percent" });
  } else if (Number.isInteger(state.totalPlans) && state.totalPlans >= 0 && Number.isInteger(state.completedPlans)) {
    const expectedPercent = state.totalPlans === 0 ? 0 : Math.round((state.completedPlans / state.totalPlans) * 100);
    if (state.percent !== expectedPercent) pushError(errors, "state_progress_percent_mismatch", { state: state.percent, expected: expectedPercent });
  }
  if (!state.currentPhaseName) pushError(errors, "state_current_phase_name_missing");
  if (state.status === null) pushError(errors, "state_status_invalid");
  if (!state.stoppedAt) pushError(errors, "state_stopped_at_missing");
  if (state.currentReady === null) pushError(errors, "state_current_position_plan_count_missing");
  if (state.continuityReady === null) pushError(errors, "state_session_continuity_plan_count_missing");
  if (state.currentReady !== null && state.continuityReady !== null && state.currentReady !== state.continuityReady) {
    pushError(errors, "state_internal_plan_count_mismatch", { currentPosition: state.currentReady, sessionContinuity: state.continuityReady });
  }
  if (state.bodyPhase !== null && state.bodyPhase !== state.currentPhase) {
    pushError(errors, "state_current_position_phase_mismatch", { frontmatter: state.currentPhase, body: state.bodyPhase });
  }
  if (state.bodyPhaseName !== null && state.bodyPhaseName !== state.currentPhaseName) {
    pushError(errors, "state_current_position_phase_name_mismatch", { frontmatter: state.currentPhaseName, body: state.bodyPhaseName });
  }
  if (state.bodyStatus !== null && state.status !== null && state.bodyStatus !== state.status) {
    pushError(errors, "state_current_position_status_mismatch", { frontmatter: state.status, body: state.bodyStatus });
  }
  if (state.bodyPercent !== null && Number.isInteger(state.percent) && state.bodyPercent !== state.percent) {
    pushError(errors, "state_current_position_percent_mismatch", { frontmatter: state.percent, body: state.bodyPercent });
  }
  if (state.continuityStoppedAt !== null && state.stoppedAt && state.continuityStoppedAt !== state.stoppedAt) {
    pushError(errors, "state_session_continuity_stopped_at_mismatch");
  }

  for (const phaseId of phaseIds) {
    const roadmapPhase = roadmap.phases.get(phaseId);
    const diskPhase = disk.get(phaseId);
    if (!roadmapPhase || !diskPhase) {
      pushError(errors, "roadmap_disk_phase_set_mismatch", { phase: phaseId });
      continue;
    }
    const roadmapPlans = sorted(roadmapPhase.planChecks.keys());
    const diskPlans = sorted(diskPhase.planIds);
    if (!valuesMatch(roadmapPlans, diskPlans)) pushError(errors, "roadmap_disk_plan_set_mismatch", { phase: phaseId, roadmapPlans, diskPlans });
    if (roadmapPhase.declaredTotal === null) pushError(errors, "roadmap_declared_plan_count_missing", { phase: phaseId });
    else if (roadmapPhase.declaredTotal === "TBD") {
      if (diskPlans.length !== 0 || roadmapPlans.length !== 0) pushError(errors, "roadmap_declared_plan_count_mismatch", { phase: phaseId, declared: "TBD", disk: diskPlans.length });
    } else if (roadmapPhase.declaredTotal !== diskPlans.length) {
      pushError(errors, "roadmap_declared_plan_count_mismatch", { phase: phaseId, declared: roadmapPhase.declaredTotal, disk: diskPlans.length });
    }
    if (
      roadmapPhase.declaredCompleted !== null &&
      roadmapPhase.declaredCompleted !== diskPhase.completeSummaryIds.size
    ) {
      pushError(errors, "roadmap_declared_completed_plan_count_mismatch", {
        phase: phaseId,
        declared: roadmapPhase.declaredCompleted,
        disk: diskPhase.completeSummaryIds.size,
      });
    }
    for (const planId of sorted(new Set([...roadmapPhase.planChecks.keys(), ...diskPhase.completeSummaryIds]))) {
      const checked = roadmapPhase.planChecks.get(planId) === true;
      const summaryComplete = diskPhase.completeSummaryIds.has(planId);
      if (checked !== summaryComplete) pushError(errors, "roadmap_summary_completion_mismatch", { phase: phaseId, plan: planId, checked, summaryComplete });
    }
    const progress = roadmap.progress.get(phaseId);
    if (!progress) pushError(errors, "roadmap_progress_missing", { phase: phaseId });
    else if (progress.total === "TBD") {
      if (progress.completed !== 0 || roadmapPhase.declaredTotal !== "TBD" || diskPlans.length !== 0) {
        pushError(errors, "roadmap_progress_mismatch", { phase: phaseId, progressCompleted: progress.completed, progressTotal: "TBD", diskCompleted: diskPhase.completeSummaryIds.size, diskTotal: diskPlans.length });
      }
      if (progress.status !== "not_started" || progress.completedAt !== "-") {
        pushError(errors, "roadmap_progress_status_mismatch", { phase: phaseId });
      }
    } else {
      const completed = diskPhase.completeSummaryIds.size;
      if (progress.completed !== completed || progress.total !== diskPlans.length) {
        pushError(errors, "roadmap_progress_mismatch", { phase: phaseId, progressCompleted: progress.completed, progressTotal: progress.total, diskCompleted: completed, diskTotal: diskPlans.length });
      }
      const expectedStatus = progress.total > 0 && progress.completed === progress.total
        ? "complete"
        : progress.completed === 0
          ? "not_started"
          : "active";
      const completedCellValid = expectedStatus === "complete"
        ? /^\d{4}-\d{2}-\d{2}$/.test(progress.completedAt)
        : progress.completedAt === "-";
      if (progress.status !== expectedStatus || !completedCellValid) {
        pushError(errors, "roadmap_progress_status_mismatch", { phase: phaseId, expectedStatus });
      }
    }
  }

  const diskTotalPlans = [...disk.values()].reduce((total, phase) => total + phase.planIds.size, 0);
  const diskCompletedPlans = [...disk.values()].reduce((total, phase) => total + phase.completeSummaryIds.size, 0);
  const diskCompletedPhases = [...disk.values()].filter((phase) => phase.planIds.size > 0 && [...phase.planIds].every((planId) => phase.completeSummaryIds.has(planId))).length;
  if (state.totalPhases !== disk.size) pushError(errors, "state_total_phase_count_mismatch", { state: state.totalPhases, disk: disk.size });
  if (state.totalPlans !== diskTotalPlans) pushError(errors, "state_total_plan_count_mismatch", { state: state.totalPlans, disk: diskTotalPlans });
  if (state.completedPlans !== diskCompletedPlans) pushError(errors, "state_completed_plan_count_mismatch", { state: state.completedPlans, disk: diskCompletedPlans });
  if (state.completedPhases !== diskCompletedPhases) pushError(errors, "state_completed_phase_count_mismatch", { state: state.completedPhases, disk: diskCompletedPhases });
  const currentDisk = disk.get(state.currentPhase);
  if (!currentDisk) pushError(errors, "state_current_phase_missing", { phase: state.currentPhase });
  else {
    if (state.currentReady !== null && state.currentReady !== currentDisk.planIds.size) {
      pushError(errors, "state_current_plan_count_mismatch", { phase: state.currentPhase, state: state.currentReady, disk: currentDisk.planIds.size });
    }
    const currentComplete = currentDisk.planIds.size > 0 && currentDisk.completeSummaryIds.size === currentDisk.planIds.size;
    const allowedStatuses = currentComplete
      ? ["complete"]
      : currentDisk.completeSummaryIds.size > 0
        ? ["active"]
        : ["not_started", "active"];
    if (state.status !== null && !allowedStatuses.includes(state.status)) {
      pushError(errors, "state_status_progress_mismatch", {
        phase: state.currentPhase,
        state: state.status,
        diskCompleted: currentDisk.completeSummaryIds.size,
        diskTotal: currentDisk.planIds.size,
        allowedStatuses,
      });
    }
  }
  const currentRoadmap = roadmap.phases.get(state.currentPhase);
  if (currentRoadmap && state.currentPhaseName && currentRoadmap.name !== state.currentPhaseName) {
    pushError(errors, "state_roadmap_current_phase_name_mismatch", { phase: state.currentPhase });
  }

  let firstIncompletePhase = null;
  let incompleteSeen = false;
  for (const phaseId of phaseIds) {
    const phase = disk.get(phaseId);
    const complete = phase !== undefined && phase.planIds.size > 0 && phase.completeSummaryIds.size === phase.planIds.size;
    if (!complete) {
      if (firstIncompletePhase === null) firstIncompletePhase = phaseId;
      incompleteSeen = true;
    } else if (incompleteSeen) {
      pushError(errors, "phase_completion_out_of_order", { phase: phaseId, firstIncompletePhase });
    }
  }
  const expectedCurrentPhase = firstIncompletePhase ?? phaseIds.at(-1) ?? null;
  if (expectedCurrentPhase !== null && state.currentPhase !== expectedCurrentPhase) {
    pushError(errors, "state_current_phase_not_first_incomplete", {
      state: state.currentPhase,
      expected: expectedCurrentPhase,
    });
  }

  if (typeof options.testCheckpoint === "function") options.testCheckpoint("before_final_freshness_check");
  try {
    const finalSnapshot = captureStablePlanningSnapshot(scope.planningRoot);
    if (resolveSourceSha(scope.projectRoot) !== scope.sourceSha || finalSnapshot.treeSha256 !== scope.planningTreeSha256) {
      pushError(errors, "workflow_state_changed_during_check");
    }
  } catch {
    pushError(errors, "workflow_state_changed_during_check");
  }
  errors.sort((left, right) => {
    const code = left.code.localeCompare(right.code, "en");
    if (code !== 0) return code;
    return String(left.phase ?? "").localeCompare(String(right.phase ?? ""), "en", { numeric: true });
  });
  return {
    schemaVersion: 1,
    kind: "workflow_state_check",
    status: errors.length === 0 ? "pass" : "fail",
    ...scopeEvidence,
    errors,
    metrics: {
      phases: disk.size,
      completedPhases: diskCompletedPhases,
      plans: diskTotalPlans,
      completedPlans: diskCompletedPlans,
      currentPhase: state.currentPhase,
    },
  };
}

function parseCli(argv) {
  const rootArg = argv.find((arg) => arg.startsWith("--project-root="));
  if (!rootArg || argv.length !== 1) {
    process.stderr.write('{"schemaVersion":1,"kind":"workflow_state_check_error","code":"usage_error"}\n');
    process.exit(2);
  }
  return rootArg.slice("--project-root=".length);
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isDirectRun) {
  const projectRoot = parseCli(process.argv.slice(2));
  const result = checkWorkflowState(path.join(path.resolve(projectRoot), ".planning"), { projectRoot });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "pass" ? 0 : 1;
}
