import { lstatSync, realpathSync } from "node:fs";
import path from "node:path";
import { resolveWorkflowProjectScope } from "./workflow-lease.mjs";

const MILESTONE_PATTERN = /^v\d+(?:\.\d+)+$/;
const PHASE_ID_PATTERN = /^\d+(?:\.\d+)?$/;
const PHASE_DIRECTORY_PATTERN = /^(\d+(?:\.\d+)?)(?:-|$)/;
const ARTIFACT_PATTERN = /^(\d+(?:\.\d+)?)(?:-(\d+))?-(PLAN|SUMMARY|VERIFICATION)\.md$/;

export class WorkflowProjectScopeError extends Error {
  constructor(code) {
    super(code);
    this.name = "WorkflowProjectScopeError";
    this.code = code;
  }
}

function fail(code) {
  throw new WorkflowProjectScopeError(code);
}

function requireCondition(condition, code) {
  if (!condition) fail(code);
}

function requireCanonicalPlainDirectory(candidate, code) {
  let stat;
  let real;
  try {
    stat = lstatSync(candidate);
    real = realpathSync(candidate);
  } catch {
    fail(code);
  }
  requireCondition(stat.isDirectory() && !stat.isSymbolicLink() && real === candidate, code);
}

function requireCanonicalPlainFile(candidate, code) {
  let stat;
  try {
    stat = lstatSync(candidate);
  } catch {
    fail(code);
  }
  requireCondition(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, code);
}

function posixRelative(root, candidate) {
  return path.relative(root, candidate).split(path.sep).join("/");
}

export function resolveCanonicalPlanningRoot(options) {
  const scope = resolveWorkflowProjectScope({ projectRoot: options.projectRoot });
  const expected = path.join(scope.projectRoot, ".planning");
  requireCondition(
    typeof options.planningRoot === "string" && path.resolve(options.planningRoot) === expected,
    "workflow_planning_root_override_forbidden",
  );
  requireCanonicalPlainDirectory(expected, "workflow_planning_root_missing_or_unsafe");
  return { ...scope, planningRoot: expected, planningRootRelative: ".planning" };
}

export function resolveCanonicalPlanningConfig(options) {
  requireCondition(typeof options.configPath === "string" && options.configPath.length > 0, "workflow_planning_config_override_forbidden");
  const gitScope = resolveWorkflowProjectScope({ projectRoot: options.projectRoot });
  const scope = resolveCanonicalPlanningRoot({
    projectRoot: gitScope.projectRoot,
    planningRoot: path.join(gitScope.projectRoot, ".planning"),
  });
  const expected = path.join(scope.planningRoot, "config.json");
  requireCondition(path.resolve(options.configPath) === expected, "workflow_planning_config_override_forbidden");
  requireCanonicalPlainFile(expected, "workflow_planning_config_missing_or_unsafe");
  return { ...scope, configPath: expected, configRelative: ".planning/config.json" };
}

export function resolveCanonicalPhaseRoot(options) {
  requireCondition(PHASE_ID_PATTERN.test(options.phaseId ?? ""), "workflow_phase_id_invalid");
  const candidate = path.resolve(options.phaseRoot);
  const gitScope = resolveWorkflowProjectScope({ projectRoot: options.projectRoot });
  const scope = resolveCanonicalPlanningRoot({
    projectRoot: gitScope.projectRoot,
    planningRoot: path.join(gitScope.projectRoot, ".planning"),
  });
  requireCanonicalPlainDirectory(candidate, "workflow_phase_root_missing_or_unsafe");
  const relative = posixRelative(scope.planningRoot, candidate);
  const segments = relative.split("/");
  const active = segments.length === 2 && segments[0] === "phases";
  const archived =
    segments.length === 4 &&
    segments[0] === "milestones" &&
    MILESTONE_PATTERN.test(segments[1]) &&
    segments[2] === "phases";
  requireCondition(active || archived, "workflow_phase_root_override_forbidden");
  const directoryPhaseId = segments.at(-1)?.match(PHASE_DIRECTORY_PATTERN)?.[1];
  requireCondition(directoryPhaseId === options.phaseId, "workflow_phase_root_identity_mismatch");
  return { ...scope, phaseRoot: candidate, phaseRootRelative: `.planning/${relative}`, phaseId: options.phaseId };
}

export function resolveCanonicalPlanningArtifact(options) {
  requireCondition(typeof options.artifact === "string" && options.artifact.length > 0, "artifact_path_invalid");
  const scope = resolveWorkflowProjectScope({ projectRoot: options.projectRoot });
  const artifact = path.isAbsolute(options.artifact)
    ? path.resolve(options.artifact)
    : path.resolve(scope.projectRoot, options.artifact);
  const match = path.basename(artifact).match(ARTIFACT_PATTERN);
  requireCondition(match !== null, "artifact_type_not_supported");
  const [, phaseId, planNumber, artifactKindRaw] = match;
  const artifactKind = artifactKindRaw.toLowerCase();
  requireCondition(
    (artifactKind === "verification" && planNumber === undefined) ||
      ((artifactKind === "plan" || artifactKind === "summary") && planNumber !== undefined),
    "artifact_type_not_supported",
  );
  const phase = resolveCanonicalPhaseRoot({ projectRoot: scope.projectRoot, phaseRoot: path.dirname(artifact), phaseId });
  if (options.requireExisting !== false) {
    requireCanonicalPlainFile(artifact, "artifact_missing_or_unsafe");
  }
  return {
    ...phase,
    root: scope.projectRoot,
    absolute: artifact,
    relative: posixRelative(scope.projectRoot, artifact),
    artifactKind,
  };
}
