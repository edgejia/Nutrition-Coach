/**
 * Redacted JSON artifact writer for the deterministic verification harness.
 *
 * Satisfies VERI-03: on both pass and fail, every scenario run leaves
 * machine-readable evidence under `tests/harness/artifacts/<scenario>/latest/`
 * with sensitive values stripped before disk write.
 *
 * Redaction rules (applied recursively to the full artifact graph):
 *   - `x-device-id` header values  → "[REDACTED]"
 *   - `deviceId=<value>` URL query params  → "deviceId=[REDACTED]"
 *   - Paths containing `/uploads/` or upload staging directories  → "[REDACTED_PATH]"
 *   - Image data URIs, bearer tokens, and OpenAI-style API keys  → "[REDACTED]"
 *   - Object keys containing `deviceId` in camelCase, snake_case, or kebab-case  → "[REDACTED]"
 *   - Raw prompt/message/provider/tool/final-assistant/database snapshot payload keys are omitted
 *   - Internal tool identifiers in string metadata  → "[REDACTED_TOOL]"
 */

import fs from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  ScenarioErrorCategory,
  ScenarioMetadata,
  ScenarioPolicyDbInvariantMetadata,
  ScenarioPolicyFactMetadata,
  ScenarioVisibleOutcomeMetadata,
  ScenarioResult,
  ScenarioStepResult,
} from "./scenario-types.js";

export const METADATA_ARTIFACT_SCHEMA_VERSION = 1;

export interface ScenarioFailureEnvelope {
  scenarioId: string;
  category: "artifact_allowlist_violation";
  fieldPath: string;
}

export interface RunnerFailureEnvelope {
  schemaVersion: 1;
  result: "failure";
  stage: "boot" | "seed" | "listen" | "scenario" | "close" | "interrupt";
  category: "boot_failed" | "seed_failed" | "listen_failed" | "scenario_failed" | "close_failed" | "interrupted";
  owner: "runner";
  closeCalls: 0 | 1;
  cleanup: "complete" | "incomplete";
  interrupted: boolean;
}

export class ArtifactSchemaViolation extends Error {
  readonly category = "artifact_allowlist_violation" as const;
  readonly fieldPath: string;

  constructor(fieldPath: string) {
    super("Artifact metadata violates the positive allowlist");
    this.name = "ArtifactSchemaViolation";
    this.fieldPath = fieldPath;
  }
}

export class ArtifactPublicationConflict extends Error {
  readonly category = "publication_conflict" as const;

  constructor() {
    super("Artifact publication lost the cooperative writer lock");
    this.name = "ArtifactPublicationConflict";
  }
}

/** Explicit publication checkpoints used only by disposable process controls. */
export interface ArtifactPublicationTestControl {
  /** Called after the PID-bearing temp directory exists but before owner.json. */
  afterTemporaryLockCreate?: () => void;
  /** Called after owner.json is durable but before the lock becomes visible. */
  beforeLockPublish?: () => void;
  afterLock?: () => void;
  afterTemporaryGeneration?: () => void;
  afterGenerationRename?: () => void;
  /** Called after legacy latest content is moved aside and before pointer creation. */
  afterLegacyMigration?: () => void;
  /** Called immediately before the atomic latest pointer rename. */
  beforePointerRename?: () => void;
  /** Called after pointer rename and before the durability fsync. */
  afterPointerRename?: () => void;
  beforeDirectoryFsync?: (stage:
    | "lock-temp"
    | "lock-root"
    | "generation-temp"
    | "generation-root"
    | "legacy-root"
    | "pointer-root"
    | "cleanup-root") => void;
  beforeCleanupOperation?: (operation:
    | "remove-temporary-lock"
    | "remove-temporary-generation"
    | "remove-generation"
    | "remove-pointer"
    | "restore-legacy-index"
    | "restore-legacy-latest"
    | "remove-pointer-temp"
    | "remove-legacy-index"
    | "remove-legacy-latest"
    | "remove-lock") => void;
}

export interface ScenarioArtifactWriteOptions {
  publicationTestControl?: ArtifactPublicationTestControl;
}

const METADATA_KEYS = new Set([
  "scenarioId",
  "scenarioName",
  "status",
  "startedAt",
  "finishedAt",
  "durationMs",
  "counts",
  "assertions",
  "files",
  "trace",
  "policyFacts",
  "policyDbInvariants",
  "visibleOutcomes",
  "errorCategory",
]);
const TRACE_KEYS = new Set(["eventNames", "counts"]);
const FILE_KEYS = new Set(["path", "sha256", "byteLength"]);
const SAFE_METADATA_KEY = /^[a-z][a-zA-Z0-9_:-]*$/;
const SAFE_IDENTIFIER = /^[a-z0-9][a-z0-9_.:-]*$/i;
const UUID_LIKE = /(?:^|[^0-9a-f])[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}(?:$|[^0-9a-f])/i;
const FORBIDDEN_METADATA_MAP_KEYS = new Set([
  "mealid",
  "foodname",
  "deviceid",
  "userid",
  "assetid",
  "imageassetid",
  "imageurl",
  "sessiontoken",
  "resumetoken",
  "authorization",
  "cookie",
  "prompt",
  "message",
  "reply",
  "replytext",
  "assistantreply",
  "response",
  "content",
  "transcript",
  "sse",
  "rawsse",
  "rawtranscript",
  "events",
  "data",
  "providerpayload",
  "payload",
  "dom",
]);
const SHA256 = /^[0-9a-f]{64}$/i;
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const TRACE_EVENT_NAMES = new Set([
  "status",
  "chunk",
  "done",
  "error",
  "close",
  "boot",
  "seed",
  "listen",
  "scenario",
  "interrupt",
]);
const ERROR_CATEGORIES = new Set<ScenarioErrorCategory>([
  "assertion_failed",
  "boot_failed",
  "seed_failed",
  "listen_failed",
  "scenario_failed",
  "close_failed",
  "interrupted",
  "artifact_allowlist_violation",
]);
const POLICY_FACT_KEYS = new Set(["step", "tool", "policyClass", "decision", "ruleId"]);
const POLICY_DB_INVARIANT_KEYS = new Set([
  "step",
  "mealCountBefore",
  "mealCountAfter",
  "targetsChanged",
  "pendingConsumed",
  "pendingPreserved",
  "dailySummaryPublishCount",
  "goalsPublishCount",
  "proposalCardCount",
  "actionEventCount",
  "mutationOutcomeCount",
  "proposalCardPresent",
  "proposalCardKindMatches",
  "proposalCardProposalIdMatches",
]);
const VISIBLE_OUTCOME_KEYS = new Set(["step", "keyLabels", "meaning"]);
const POLICY_CLASSES = new Set(["direct-execute", "execute-and-report", "clarify-first", "confirm-first"]);
const POLICY_DECISIONS = new Set(["allowed", "blocked"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safePathSegment(key: string): string {
  return SAFE_METADATA_KEY.test(key) ? key : "[unknown]";
}

function isSafeMetadataIdentifier(value: unknown): value is string {
  return (
    typeof value === "string" &&
    SAFE_IDENTIFIER.test(value) &&
    !UUID_LIKE.test(value) &&
    !/^sk-[a-z0-9_-]+$/i.test(value)
  );
}

function violation(pathText: string): never {
  throw new ArtifactSchemaViolation(pathText);
}

function requireExactKeys(value: Record<string, unknown>, allowed: Set<string>, pathText: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      violation(`${pathText}.${safePathSegment(key)}`);
    }
  }
}

function requireSafeMap(
  value: unknown,
  pathText: string,
  valueType: "count" | "assertion",
): Record<string, number | boolean> {
  if (!isRecord(value)) {
    violation(pathText);
  }
  const output: Record<string, number | boolean> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!SAFE_METADATA_KEY.test(key)) {
      violation(`${pathText}.[unknown]`);
    }
    const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (FORBIDDEN_METADATA_MAP_KEYS.has(normalized)) {
      violation(`${pathText}.${key}`);
    }
    if (valueType === "count") {
      if (typeof entry !== "number" || !Number.isSafeInteger(entry) || entry < 0) {
        violation(`${pathText}.${key}`);
      }
      output[key] = entry;
    } else {
      if (typeof entry !== "boolean" && (typeof entry !== "number" || !Number.isFinite(entry))) {
        violation(`${pathText}.${key}`);
      }
      output[key] = entry;
    }
  }
  return output;
}

function validateTrace(value: unknown, pathText: string): NonNullable<ScenarioMetadata["trace"]> {
  if (!isRecord(value)) {
    violation(pathText);
  }
  requireExactKeys(value, TRACE_KEYS, pathText);
  if (!Array.isArray(value.eventNames) || value.eventNames.some((name) => !TRACE_EVENT_NAMES.has(name))) {
    violation(`${pathText}.eventNames`);
  }
  const counts = requireSafeMap(value.counts, `${pathText}.counts`, "count");
  return { eventNames: [...value.eventNames] as string[], counts: counts as Record<string, number> };
}

function requireSafeIdentifier(value: unknown, pathText: string): string {
  if (!isSafeMetadataIdentifier(value)) {
    violation(pathText);
  }
  return value;
}

function validatePolicyFacts(value: unknown, pathText: string): ScenarioPolicyFactMetadata[] {
  if (!Array.isArray(value)) {
    violation(pathText);
  }
  return value.map((entry, index) => {
    const itemPath = `${pathText}[${index}]`;
    if (!isRecord(entry)) {
      violation(itemPath);
    }
    requireExactKeys(entry, POLICY_FACT_KEYS, itemPath);
    const policyClass = requireSafeIdentifier(entry.policyClass, `${itemPath}.policyClass`);
    const decision = requireSafeIdentifier(entry.decision, `${itemPath}.decision`);
    if (!POLICY_CLASSES.has(policyClass)) violation(`${itemPath}.policyClass`);
    if (!POLICY_DECISIONS.has(decision)) violation(`${itemPath}.decision`);
    return {
      step: requireSafeIdentifier(entry.step, `${itemPath}.step`),
      tool: requireSafeIdentifier(entry.tool, `${itemPath}.tool`),
      policyClass: policyClass as ScenarioPolicyFactMetadata["policyClass"],
      decision: decision as ScenarioPolicyFactMetadata["decision"],
      ruleId: requireSafeIdentifier(entry.ruleId, `${itemPath}.ruleId`),
    };
  });
}

function validatePolicyDbInvariants(value: unknown, pathText: string): ScenarioPolicyDbInvariantMetadata[] {
  if (!Array.isArray(value)) {
    violation(pathText);
  }
  return value.map((entry, index) => {
    const itemPath = `${pathText}[${index}]`;
    if (!isRecord(entry)) {
      violation(itemPath);
    }
    requireExactKeys(entry, POLICY_DB_INVARIANT_KEYS, itemPath);
    const output: ScenarioPolicyDbInvariantMetadata = {
      step: requireSafeIdentifier(entry.step, `${itemPath}.step`),
    };
    for (const key of [
      "mealCountBefore",
      "mealCountAfter",
      "dailySummaryPublishCount",
      "goalsPublishCount",
      "proposalCardCount",
      "actionEventCount",
      "mutationOutcomeCount",
    ] as const) {
      if (entry[key] !== undefined) {
        if (typeof entry[key] !== "number" || !Number.isSafeInteger(entry[key]) || entry[key] < 0) {
          violation(`${itemPath}.${key}`);
        }
        output[key] = entry[key];
      }
    }
    for (const key of ["targetsChanged", "pendingConsumed", "pendingPreserved"] as const) {
      if (entry[key] !== undefined) {
        if (typeof entry[key] !== "boolean") violation(`${itemPath}.${key}`);
        output[key] = entry[key];
      }
    }
    for (const key of [
      "proposalCardPresent",
      "proposalCardKindMatches",
      "proposalCardProposalIdMatches",
    ] as const) {
      if (entry[key] !== undefined) {
        if (typeof entry[key] !== "boolean") violation(`${itemPath}.${key}`);
        output[key] = entry[key];
      }
    }
    return output;
  });
}

function validateVisibleOutcomes(value: unknown, pathText: string): ScenarioVisibleOutcomeMetadata[] {
  if (!Array.isArray(value)) {
    violation(pathText);
  }
  return value.map((entry, index) => {
    const itemPath = `${pathText}[${index}]`;
    if (!isRecord(entry)) {
      violation(itemPath);
    }
    requireExactKeys(entry, VISIBLE_OUTCOME_KEYS, itemPath);
    const output: ScenarioVisibleOutcomeMetadata = {
      step: requireSafeIdentifier(entry.step, `${itemPath}.step`),
    };
    for (const key of ["keyLabels", "meaning"] as const) {
      if (entry[key] !== undefined) {
        const values = requireSafeMap(entry[key], `${itemPath}.${key}`, "assertion");
        const booleans: Record<string, boolean> = {};
        for (const [field, value] of Object.entries(values)) {
          if (typeof value !== "boolean") violation(`${itemPath}.${key}.${field}`);
          booleans[field] = value;
        }
        output[key] = booleans;
      }
    }
    return output;
  });
}

function validateFiles(value: unknown, pathText: string): NonNullable<ScenarioMetadata["files"]> {
  if (!Array.isArray(value)) {
    violation(pathText);
  }
  return value.map((entry, index) => {
    const itemPath = `${pathText}[${index}]`;
    if (!isRecord(entry)) {
      violation(itemPath);
    }
    requireExactKeys(entry, FILE_KEYS, itemPath);
    if (
      typeof entry.path !== "string" ||
      path.isAbsolute(entry.path) ||
      entry.path.includes("..") ||
      entry.path.includes("\\") ||
      entry.path.includes("\0") ||
      UUID_LIKE.test(entry.path) ||
      /(?:^|\/)api\/assets(?:\/|$)/i.test(entry.path) ||
      /(?:^|\/)(?:uploads|upload-staging)(?:\/|$)/i.test(entry.path)
    ) {
      violation(`${itemPath}.path`);
    }
    if (typeof entry.sha256 !== "string" || !SHA256.test(entry.sha256)) {
      violation(`${itemPath}.sha256`);
    }
    if (typeof entry.byteLength !== "number" || !Number.isSafeInteger(entry.byteLength) || entry.byteLength < 0) {
      violation(`${itemPath}.byteLength`);
    }
    return {
      path: entry.path,
      sha256: entry.sha256.toLowerCase(),
      byteLength: entry.byteLength,
    };
  });
}

/** Validate and clone the strict positive metadata-only artifact input. */
export function validateScenarioMetadata(value: ScenarioMetadata): ScenarioMetadata {
  if (!isRecord(value)) {
    violation("metadata");
  }
  requireExactKeys(value, METADATA_KEYS, "metadata");
  if (!isSafeMetadataIdentifier(value.scenarioId)) {
    violation("metadata.scenarioId");
  }
  if (!isSafeMetadataIdentifier(value.scenarioName)) {
    violation("metadata.scenarioName");
  }
  if (value.status !== "pass" && value.status !== "fail") {
    violation("metadata.status");
  }
  for (const key of ["startedAt", "finishedAt"] as const) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || !ISO_TIMESTAMP.test(value[key]) || Number.isNaN(Date.parse(value[key])))) {
      violation(`metadata.${key}`);
    }
  }
  if (value.durationMs !== undefined && (!Number.isSafeInteger(value.durationMs) || value.durationMs < 0)) {
    violation("metadata.durationMs");
  }
  if (value.counts !== undefined) {
    value.counts = requireSafeMap(value.counts, "metadata.counts", "count") as Record<string, number>;
  }
  if (value.assertions !== undefined) {
    value.assertions = requireSafeMap(value.assertions, "metadata.assertions", "assertion") as Record<string, boolean | number>;
  }
  if (value.files !== undefined) {
    value.files = validateFiles(value.files, "metadata.files");
  }
  if (value.trace !== undefined) {
    value.trace = validateTrace(value.trace, "metadata.trace");
  }
  if (value.policyFacts !== undefined) {
    value.policyFacts = validatePolicyFacts(value.policyFacts, "metadata.policyFacts");
  }
  if (value.policyDbInvariants !== undefined) {
    value.policyDbInvariants = validatePolicyDbInvariants(value.policyDbInvariants, "metadata.policyDbInvariants");
  }
  if (value.visibleOutcomes !== undefined) {
    value.visibleOutcomes = validateVisibleOutcomes(value.visibleOutcomes, "metadata.visibleOutcomes");
  }
  if (value.errorCategory !== undefined && !ERROR_CATEGORIES.has(value.errorCategory)) {
    violation("metadata.errorCategory");
  }
  return structuredClone(value);
}

function safeStepName(value: string, pathText: string): string {
  if (!isSafeMetadataIdentifier(value)) {
    violation(pathText);
  }
  return value;
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

const DEFAULT_ARTIFACTS_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "artifacts",
);

function getArtifactsRoot(): string {
  return process.env.HARNESS_ARTIFACTS_DIR ?? DEFAULT_ARTIFACTS_ROOT;
}

function validateScenarioPathName(scenarioName: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(scenarioName) || UUID_LIKE.test(scenarioName)) {
    throw new Error("Invalid scenario name");
  }
}

function realArtifactsRoot(create: boolean): string {
  const configured = path.resolve(getArtifactsRoot());
  if (create) fs.mkdirSync(configured, { recursive: true });
  const stat = fs.statSync(configured);
  if (!stat.isDirectory()) throw new Error("Scenario artifact path is invalid");
  return fs.realpathSync(configured);
}

function resolveScenarioRoot(scenarioName: string, create: boolean): string {
  validateScenarioPathName(scenarioName);
  const root = realArtifactsRoot(create);
  const candidate = path.join(root, scenarioName);
  const existing = lstatIfPresent(candidate);
  if (existing === undefined) {
    if (!create) throw new Error("Scenario artifact path is invalid");
    fs.mkdirSync(candidate);
  } else if (existing.isSymbolicLink() || !existing.isDirectory()) {
    throw new Error("Scenario artifact path is invalid");
  }
  const resolved = fs.realpathSync(candidate);
  if (path.dirname(resolved) !== root) {
    throw new Error("Scenario artifact path is invalid");
  }
  return resolved;
}

function resolvedLatestPointer(root: string, requirePointer: boolean): string | undefined {
  const pointer = path.join(root, "latest");
  const pointerStat = lstatIfPresent(pointer);
  if (pointerStat === undefined) {
    if (requirePointer) throw new Error("Published artifact pointer is invalid");
    return undefined;
  }
  if (!pointerStat.isSymbolicLink()) {
    if (!requirePointer && pointerStat.isDirectory()) return pointer;
    throw new Error("Published artifact pointer is invalid");
  }
  let resolved: string;
  try {
    resolved = fs.realpathSync(pointer);
  } catch {
    throw new Error("Published artifact pointer is invalid");
  }
  if (path.dirname(resolved) !== root || !/^generation-[a-f0-9-]+$/i.test(path.basename(resolved))) {
    throw new Error("Published artifact pointer is invalid");
  }
  return resolved;
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readPointerToken(root: string): string {
  const pointer = resolvedLatestPointer(root, false);
  if (pointer === undefined) return "";
  const indexPath = path.join(root, "latest", "index.json");
  return fs.readFileSync(indexPath, "utf8");
}

function fsyncFile(filePath: string): void {
  const handle = fs.openSync(filePath, "r");
  try {
    fs.fsyncSync(handle);
  } finally {
    fs.closeSync(handle);
  }
}

function fsyncDirectory(directory: string): void {
  try {
    const handle = fs.openSync(directory, "r");
    try {
      fs.fsyncSync(handle);
    } finally {
      fs.closeSync(handle);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // Windows does not expose durable directory handles consistently. These
    // codes specifically mean the platform rejected the directory fsync
    // operation; all other open/fsync errors remain publication failures.
    if (process.platform === "win32" && (code === "EINVAL" || code === "ENOTSUP" || code === "EPERM")) {
      return;
    }
    throw error;
  }
}

function fsyncPublicationDirectory(
  directory: string,
  stage: Parameters<NonNullable<ArtifactPublicationTestControl["beforeDirectoryFsync"]>>[0],
  testControl?: ArtifactPublicationTestControl,
): void {
  testControl?.beforeDirectoryFsync?.(stage);
  fsyncDirectory(directory);
}

function garbageCollectGenerationResidue(root: string): void {
  const latestPresent = lstatIfPresent(path.join(root, "latest")) !== undefined;
  const resolvedPointer = latestPresent ? resolvedLatestPointer(root, false) : undefined;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (
      !entry.name.startsWith(".generation-") &&
      !entry.name.startsWith("generation-") &&
      !entry.name.startsWith(".latest-") &&
      !entry.name.startsWith(".legacy-latest-") &&
      !entry.name.startsWith(".publication-lock-")
    ) {
      continue;
    }
    if (entry.name.startsWith("generation-") && path.join(root, entry.name) === resolvedPointer) {
      continue;
    }
    if (entry.name.startsWith(".publication-lock-")) {
      // A sibling may be paused after writing durable owner metadata but
      // before atomically publishing .publication.lock. Never reap a live
      // owner window; only dead/malformed temp locks are residue.
      const owner = readPendingLockOwner(path.join(root, entry.name));
      if (owner !== undefined && processIsAlive(owner.pid)) continue;
    }
    // A legacy source may be the only recoverable prior pointer after a
    // killed owner. Keep it while latest is absent; successful publication
    // performs the cleanup after the new pointer is durable.
    if (entry.name.startsWith(".legacy-latest-") && !latestPresent) continue;
    fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
  }
}

/**
 * Recover a complete legacy pointer left behind if a writer was killed after
 * migration but before its replacement pointer became durable. This runs
 * while the publication lock is held and before residue cleanup.
 */
function recoverLegacyLatestResidue(
  root: string,
  testControl?: ArtifactPublicationTestControl,
): void {
  if (lstatIfPresent(path.join(root, "latest")) !== undefined) return;
  const candidates = fs.readdirSync(root)
    .filter((entry) => entry.startsWith(".legacy-latest-") && !entry.endsWith(".index.json"));
  if (candidates.length !== 1) return;
  const legacyBase = path.join(root, candidates[0]!);
  const legacyIndex = `${legacyBase}.index.json`;
  const latest = path.join(root, "latest");
  const latestIndex = path.join(root, "latest.index.json");
  try {
    fs.renameSync(legacyBase, latest);
    if (lstatIfPresent(legacyIndex) !== undefined) {
      fs.renameSync(legacyIndex, latestIndex);
    }
    fsyncDirectory(root);
  } catch (error) {
    // Roll back a partial move so a later attempt can recover one complete
    // source, rather than leaving latest and latest.index mixed.
    try {
      if (lstatIfPresent(latest) !== undefined && lstatIfPresent(legacyBase) === undefined) {
        runCleanupOperation(testControl, "restore-legacy-latest", () => {
          fs.renameSync(latest, legacyBase);
        });
      }
    } catch { /* preserve the recovery failure below */ }
    try {
      if (lstatIfPresent(latestIndex) !== undefined && lstatIfPresent(legacyIndex) === undefined) {
        runCleanupOperation(testControl, "restore-legacy-index", () => {
          fs.renameSync(latestIndex, legacyIndex);
        });
      }
    } catch { /* preserve the recovery failure below */ }
    throw error;
  }
}

interface LegacyLatestMigration {
  latest?: string;
  index?: string;
}

type CleanupOperation = Parameters<NonNullable<ArtifactPublicationTestControl["beforeCleanupOperation"]>>[0];

function runCleanupOperation(
  testControl: ArtifactPublicationTestControl | undefined,
  operation: CleanupOperation,
  action: () => void,
): boolean {
  try {
    testControl?.beforeCleanupOperation?.(operation);
  } catch {
    // Fault controls model the first cleanup attempt failing. The unhooked
    // operation below is the bounded recovery attempt.
  }
  try {
    action();
    return true;
  } catch {
    try {
      action();
      return true;
    } catch {
      // Cleanup residue is recoverable on the next lock owner. Never mask a
      // primary publication error or turn a durable commit into failure.
      return false;
    }
  }
}

function lstatIfPresent(filePath: string): fs.Stats | undefined {
  try {
    return fs.lstatSync(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function migrateLegacyLatest(
  root: string,
  testControl?: ArtifactPublicationTestControl,
): LegacyLatestMigration | undefined {
  const pointer = path.join(root, "latest");
  const staleIndex = path.join(root, "latest.index.json");
  const pointerStat = lstatIfPresent(pointer);
  const staleIndexStat = lstatIfPresent(staleIndex);
  // Retain a rollback source for either a legacy directory or an existing
  // modern symlink until the replacement pointer is durably published.
  const shouldMovePointer = pointerStat !== undefined;
  if (!shouldMovePointer && staleIndexStat === undefined) return undefined;

  const legacyBase = path.join(root, `.legacy-latest-${randomUUID()}`);
  const migration: LegacyLatestMigration = {};
  try {
    if (shouldMovePointer) {
      fs.renameSync(pointer, legacyBase);
      migration.latest = legacyBase;
    }
    if (staleIndexStat !== undefined) {
      const legacyIndex = `${legacyBase}.index.json`;
      fs.renameSync(staleIndex, legacyIndex);
      migration.index = legacyIndex;
    }
    return migration;
  } catch (error) {
    restoreLegacyLatest(root, migration, testControl);
    throw error;
  }
}

function restoreLegacyLatest(
  root: string,
  migration: LegacyLatestMigration | undefined,
  testControl?: ArtifactPublicationTestControl,
): void {
  if (migration === undefined) return;
  if (migration.index !== undefined) {
    runCleanupOperation(testControl, "restore-legacy-index", () => {
      fs.renameSync(migration.index!, path.join(root, "latest.index.json"));
    });
  }
  if (migration.latest !== undefined) {
    runCleanupOperation(testControl, "restore-legacy-latest", () => {
      fs.renameSync(migration.latest!, path.join(root, "latest"));
    });
  }
}

interface PublicationOwner {
  pid: number;
  token: string;
}

interface PublicationLock {
  path: string;
  ownerToken: string;
}

const activePublicationOwners = new Map<string, string>();
const MAX_OS_PID = 0x7fffffff;
const PUBLICATION_OWNER_TOKEN = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

function isValidProcessId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= MAX_OS_PID;
}

function processIsAlive(pid: number): boolean {
  if (!isValidProcessId(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM proves a process occupies the PID even though it is not
    // signalable. ESRCH, range/type errors, and unknown failures do not prove
    // liveness and must not strand a recoverable lock.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readPublicationOwner(lock: string): PublicationOwner | undefined {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(lock, "owner.json"), "utf8")) as {
      pid?: unknown;
      token?: unknown;
    };
    if (isValidProcessId(parsed.pid) && typeof parsed.token === "string" && PUBLICATION_OWNER_TOKEN.test(parsed.token)) {
      return { pid: parsed.pid, token: parsed.token };
    }
  } catch {
    // Missing or malformed owner metadata is stale residue. Atomic lock
    // publication means a live owner is never observed in this state.
  }
  return undefined;
}

function readPendingLockOwner(lock: string): PublicationOwner | undefined {
  const metadataOwner = readPublicationOwner(lock);
  if (metadataOwner !== undefined) return metadataOwner;
  const match = /^\.publication-lock-(\d+)-([a-f0-9-]+)\.tmp$/i.exec(path.basename(lock));
  if (!match) return undefined;
  const encoded = Number(match[1]);
  return isValidProcessId(encoded) && PUBLICATION_OWNER_TOKEN.test(match[2]!)
    ? { pid: encoded, token: match[2]! }
    : undefined;
}

function isExactActiveOwner(root: string, owner: PublicationOwner): boolean {
  return owner.pid === process.pid && activePublicationOwners.get(root) === owner.token;
}

function releasePublicationLock(
  root: string,
  lock: string,
  testControl?: ArtifactPublicationTestControl,
  expectedOwnerToken?: string,
): void {
  if (expectedOwnerToken !== undefined && readPublicationOwner(lock)?.token !== expectedOwnerToken) {
    return;
  }
  const removed = runCleanupOperation(testControl, "remove-lock", () => {
    if (expectedOwnerToken !== undefined && readPublicationOwner(lock)?.token !== expectedOwnerToken) {
      return;
    }
    fs.rmSync(lock, { recursive: true, force: true });
  });
  if (removed) return;
  try {
    if (lstatIfPresent(lock) === undefined) return;
  } catch {
    return;
  }
  try {
    if (expectedOwnerToken !== undefined && readPublicationOwner(lock)?.token !== expectedOwnerToken) {
      return;
    }
    // If the directory itself cannot be removed, invalidate its live-owner
    // identity so the next writer can recover it instead of being stranded
    // behind this process's still-live PID.
    const ownerPath = path.join(lock, "owner.json");
    fs.writeFileSync(ownerPath, JSON.stringify({ pid: 0 }), "utf8");
    fsyncFile(ownerPath);
    fsyncDirectory(root);
  } catch {
    // A filesystem that rejects both removal and marker invalidation cannot
    // be repaired in-process; the primary result remains authoritative.
  }
}

function acquirePublicationLock(root: string, testControl?: ArtifactPublicationTestControl): PublicationLock {
  const lock = path.join(root, ".publication.lock");
  if (activePublicationOwners.has(root)) {
    throw new ArtifactPublicationConflict();
  }

  // The per-publication token distinguishes worker threads that share one PID
  // and also identifies the owner before owner.json exists. PID reuse remains
  // a bounded platform residual because Node exposes no portable process-start
  // identity; a reused live PID may conservatively delay stale cleanup once.
  const ownerToken = randomUUID();
  const temporaryLock = path.join(root, `.publication-lock-${process.pid}-${ownerToken}.tmp`);
  const createAndPublish = (): boolean => {
    fs.mkdirSync(temporaryLock);
    let lockPublished = false;
    try {
      testControl?.afterTemporaryLockCreate?.();
      const ownerPath = path.join(temporaryLock, "owner.json");
      fs.writeFileSync(ownerPath, JSON.stringify({ pid: process.pid, token: ownerToken }), "utf8");
      fsyncFile(ownerPath);
      fsyncPublicationDirectory(temporaryLock, "lock-temp", testControl);
      testControl?.beforeLockPublish?.();
      // A rename of a directory onto an existing directory fails without
      // replacing it, so exactly one pre-populated owner can win.
      fs.renameSync(temporaryLock, lock);
      lockPublished = true;
      fsyncPublicationDirectory(root, "lock-root", testControl);
      return true;
    } catch (error) {
      if (lockPublished) {
        releasePublicationLock(root, lock, testControl, ownerToken);
      } else {
        runCleanupOperation(
          testControl,
          "remove-temporary-lock",
          () => fs.rmSync(temporaryLock, { recursive: true, force: true }),
        );
      }
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "EEXIST" || code === "ENOTEMPTY") {
        return false;
      }
      throw error;
    }
  };

  let published = false;
  try {
    published = createAndPublish();
  } catch (error) {
    if (error instanceof ArtifactPublicationConflict) throw error;
    throw error;
  }

  if (!published) {
    const owner = readPublicationOwner(lock);
    if (owner !== undefined && (isExactActiveOwner(root, owner) || processIsAlive(owner.pid))) {
      throw new ArtifactPublicationConflict();
    }
    // Missing/dead owner metadata is bounded stale residue. Remove only the
    // stale lock, then retry the same atomic publish once.
    releasePublicationLock(root, lock, testControl);
    try {
      published = createAndPublish();
    } catch (error) {
      if (error instanceof ArtifactPublicationConflict) throw error;
      throw error;
    }
    if (!published) throw new ArtifactPublicationConflict();
  }

  activePublicationOwners.set(root, ownerToken);
  return { path: lock, ownerToken };
}

function publishArtifactFiles(
  scenarioName: string,
  files: Record<string, string>,
  testControl?: ArtifactPublicationTestControl,
): void {
  const root = resolveScenarioRoot(scenarioName, true);
  const lock = acquirePublicationLock(root, testControl);

  const generationId = randomUUID();
  const temporaryGeneration = path.join(root, `.generation-${generationId}.tmp`);
  const generation = path.join(root, `generation-${generationId}`);
  const pointer = path.join(root, "latest");
  const pointerTemp = path.join(root, `.latest-${generationId}.tmp`);
  let published = false;
  let pointerReplaced = false;
  let legacyMigration: LegacyLatestMigration | undefined;
  try {
    testControl?.afterLock?.();
    recoverLegacyLatestResidue(root, testControl);
    garbageCollectGenerationResidue(root);
    const tokenBefore = readPointerToken(root);
    fs.mkdirSync(temporaryGeneration);
    testControl?.afterTemporaryGeneration?.();
    const manifest: Record<string, { sha256: string; byteLength: number }> = {};
    for (const [fileName, content] of Object.entries(files)) {
      if (!/^[a-z0-9][a-z0-9.-]*\.json$/i.test(fileName)) {
        throw new Error(`Invalid artifact file name: ${fileName}`);
      }
      const target = path.join(temporaryGeneration, fileName);
      fs.writeFileSync(target, content, "utf8");
      fsyncFile(target);
      manifest[fileName] = {
        sha256: sha256Text(content),
        byteLength: Buffer.byteLength(content),
      };
    }
    const index = JSON.stringify({
      schemaVersion: METADATA_ARTIFACT_SCHEMA_VERSION,
      generation: generationId,
      files: manifest,
    }, null, 2);
    const indexPath = path.join(temporaryGeneration, "index.json");
    fs.writeFileSync(indexPath, index, "utf8");
    fsyncFile(indexPath);
    fsyncPublicationDirectory(temporaryGeneration, "generation-temp", testControl);
    fs.renameSync(temporaryGeneration, generation);
    testControl?.afterGenerationRename?.();
    fsyncPublicationDirectory(root, "generation-root", testControl);

    const tokenAfter = readPointerToken(root);
    if (tokenAfter !== tokenBefore) {
      throw new ArtifactPublicationConflict();
    }
    legacyMigration = migrateLegacyLatest(root, testControl);
    // Keep the migrated rollback source until the replacement pointer has
    // been renamed and fsynced. A fault before that point must restore it.
    fsyncPublicationDirectory(root, "legacy-root", testControl);
    testControl?.afterLegacyMigration?.();
    fs.symlinkSync(path.relative(root, generation), pointerTemp, "dir");
    testControl?.beforePointerRename?.();
    fs.renameSync(pointerTemp, pointer);
    pointerReplaced = true;
    testControl?.afterPointerRename?.();
    fsyncPublicationDirectory(root, "pointer-root", testControl);
    published = true;
  } finally {
    try {
      if (!published) {
        runCleanupOperation(testControl, "remove-temporary-generation", () => {
          fs.rmSync(temporaryGeneration, { recursive: true, force: true });
        });
        runCleanupOperation(testControl, "remove-generation", () => {
          fs.rmSync(generation, { recursive: true, force: true });
        });
        if (pointerReplaced) {
          // A rename followed by a durability fault is not a committed
          // publication. Remove the new pointer before restoring its source.
          runCleanupOperation(testControl, "remove-pointer", () => {
            fs.rmSync(pointer, { recursive: true, force: true });
          });
        }
        restoreLegacyLatest(root, legacyMigration, testControl);
        runCleanupOperation(testControl, "remove-pointer-temp", () => {
          fs.rmSync(pointerTemp, { force: true });
        });
      } else {
        if (legacyMigration?.latest !== undefined) {
          runCleanupOperation(testControl, "remove-legacy-latest", () => {
            fs.rmSync(legacyMigration!.latest!, { recursive: true, force: true });
          });
        }
        if (legacyMigration?.index !== undefined) {
          runCleanupOperation(testControl, "remove-legacy-index", () => {
            fs.rmSync(legacyMigration!.index!, { force: true });
          });
        }
        // Once pointer-root fsync succeeds, cleanup errors are recoverable
        // residue and must not report a committed latest as failed.
        try {
          garbageCollectGenerationResidue(root);
          fsyncPublicationDirectory(root, "cleanup-root", testControl);
        } catch {
          // The next lock owner performs the same bounded residue sweep.
        }
      }
    } finally {
      releasePublicationLock(root, lock.path, testControl, lock.ownerToken);
      if (activePublicationOwners.get(root) === lock.ownerToken) {
        activePublicationOwners.delete(root);
      }
    }
  }
}

export function readPublishedArtifact(scenarioName: string, fileName: string): string {
  if (!/^[a-z0-9][a-z0-9.-]*\.json$/i.test(fileName)) {
    throw new Error("Invalid artifact file name");
  }
  const root = resolveScenarioRoot(scenarioName, false);
  const resolvedPointer = resolvedLatestPointer(root, true)!;
  const indexPath = path.join(resolvedPointer, "index.json");
  const index = JSON.parse(fs.readFileSync(indexPath, "utf8")) as {
    generation?: string;
    files?: Record<string, { sha256?: string; byteLength?: number }>;
  };
  const entry = index.files?.[fileName];
  if (!entry || typeof entry.sha256 !== "string" || typeof entry.byteLength !== "number") {
    throw new Error("Published artifact is not present in the manifest");
  }
  if (typeof index.generation !== "string" || !/^[-a-f0-9]+$/i.test(index.generation)) {
    throw new Error("Published artifact generation is invalid");
  }
  if (path.basename(resolvedPointer) !== `generation-${index.generation}`) {
    throw new Error("Published artifact pointer mismatch");
  }
  const content = fs.readFileSync(path.join(resolvedPointer, fileName), "utf8");
  if (sha256Text(content) !== entry.sha256 || Buffer.byteLength(content) !== entry.byteLength) {
    throw new Error("Published artifact manifest mismatch");
  }
  return content;
}

export function writeRunnerFailureArtifacts(
  scenarioName: string,
  envelope: RunnerFailureEnvelope,
): void {
  publishArtifactFiles(scenarioName, {
    "failure.json": JSON.stringify(envelope, null, 2),
  });
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const REDACTED = "[REDACTED]";
const REDACTED_PATH = "[REDACTED_PATH]";
const REDACTED_TOOL = "[REDACTED_TOOL]";

/**
 * Recursively walk a JSON-serialisable value and apply redaction rules.
 * Returns a new deep-redacted copy — the original is not mutated.
 */
export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === "object") {
    return redactObject(value as Record<string, unknown>);
  }
  return value;
}

function redactString(s: string): string {
  // Redact any path referencing the uploads directory (absolute or relative)
  if (/\/uploads\//.test(s) || /\/upload-staging\//i.test(s)) {
    return REDACTED_PATH;
  }
  if (/^data:image\/[a-z0-9.+-]+;base64,/i.test(s)) {
    return REDACTED;
  }
  // Redact sensitive query parameter values in URLs.
  s = s.replace(
    /((?:deviceId|guest_session|guest_session_resume|guestSession|guestSessionResume|sessionToken|resumeToken|token)=)[^&\s"']+/gi,
    `$1${REDACTED}`,
  );
  s = s.replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, `Bearer ${REDACTED}`);
  s = s.replace(/\bsk-[A-Za-z0-9_-]+/g, REDACTED);
  return redactInternalToolIdentifiers(s);
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const normalized = normalizeKey(key);
    const promptMetadata = normalized === "prompt" ? redactPromptMetadata(val) : undefined;
    if (promptMetadata !== undefined) {
      result[key] = promptMetadata;
    } else if (RAW_TEXT_KEYS.has(normalized) || shouldOmitKey(key)) {
      continue;
    } else if (shouldRedactKey(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = redact(val);
    }
  }
  return result;
}

function shouldRedactKey(key: string): boolean {
  const normalized = normalizeKey(key);
  if (SAFE_ERROR_METADATA_KEYS.has(normalized)) {
    return false;
  }
  return normalized.includes("deviceid") || normalized.includes("error");
}

function shouldOmitKey(key: string): boolean {
  const normalized = normalizeKey(key);
  return (
    OMITTED_KEYS.has(normalized) ||
    normalized === "expectedpatterns" ||
    normalized === "matchedterms" ||
    (normalized.startsWith("matched") && normalized.endsWith("patterns"))
  );
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isSafePromptMetadata(value: unknown): boolean {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.prototype.hasOwnProperty.call(value, "version") &&
    Object.prototype.hasOwnProperty.call(value, "sectionIds")
  );
}

function redactPromptMetadata(value: unknown): Record<string, unknown> | undefined {
  if (!isSafePromptMetadata(value)) {
    return undefined;
  }
  const prompt = value as { version: unknown; sectionIds: unknown };
  return {
    version: safeTraceIdentifier(prompt.version),
    sectionIds: Array.isArray(prompt.sectionIds)
      ? prompt.sectionIds.map(safeTraceIdentifier)
      : REDACTED,
  };
}

function safeTraceIdentifier(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9][a-z0-9._:-]*$/i.test(value)
    ? value
    : REDACTED;
}

const RAW_TEXT_KEYS = new Set([
  "message",
  "prompt",
  "reply",
  "response",
  "systemprompt",
  "userprompt",
]);
const SAFE_ERROR_METADATA_KEYS = new Set([
  "errorname",
  "errortype",
  "errorcode",
  "providererrorcount",
]);

const OMITTED_KEYS = new Set([
  "apikey",
  "arguments",
  "assistantmessage",
  "assistantmessages",
  "authorization",
  "bearer",
  "body",
  "content",
  "cookie",
  "assistantcontent",
  "fallbackcontent",
  "finalanswer",
  "finalassistantcontent",
  "guestsession",
  "historysnapshot",
  "headers",
  "imagebase64",
  "imagedata",
  "imagedatauri",
  "messages",
  "mealssnapshot",
  "aftermeals",
  "aftertargets",
  "beforemeals",
  "beforetargets",
  "committedfacts",
  "committedtargets",
  "deletedmeal",
  "allowedmealnames",
  "assistantmealnames",
  "checkedmealnames",
  "datekey",
  "foodname",
  "imageassetid",
  "imageurl",
  "inventedmeals",
  "items",
  "loggedat",
  "loggedmeal",
  "mealid",
  "mealrevisionid",
  "normalizedfacts",
  "openaiapikey",
  "persistence",
  "persistedrevision",
  "providerpayload",
  "prompttext",
  "rawarguments",
  "rawmessages",
  "rawprompt",
  "rawproviderpayload",
  "rawsse",
  "rawsseframes",
  "rawssetranscript",
  "rawstreamframes",
  "rawtoolresult",
  "sessiontoken",
  "setcookie",
  "ssetranscript",
  "streamframes",
  "token",
  "tools",
  "toolarguments",
  "toolresult",
  "uploadstagingpath",
  "usermealtext",
  "rawusermessage",
  "persistedmeal",
  "receiptloggedmeal",
  "receiptpayload",
  "responseloggedmeal",
  "seededmeal",
  "usermessage",
  "updatedmeal",
]);

// ---------------------------------------------------------------------------
// Artifact writing
// ---------------------------------------------------------------------------

interface SummaryArtifact {
  scenarioName: string;
  ok: boolean;
  failedStep?: string;
  consoleSummary: string;
  totalSteps: number;
  passedSteps: number;
  stepNames: string[];
  writtenAt: string;
}

function buildSummary(scenarioName: string, result: ScenarioResult): SummaryArtifact {
  const passedSteps = result.steps.filter((s: ScenarioStepResult) => s.ok).length;
  const summary: SummaryArtifact = {
    scenarioName: redactIdentifier(scenarioName),
    ok: result.ok,
    consoleSummary: buildSafeConsoleSummary(scenarioName, result, passedSteps),
    totalSteps: result.steps.length,
    passedSteps,
    stepNames: result.steps.map((step) => redactIdentifier(step.name)),
    writtenAt: new Date().toISOString(),
  };
  if (result.failedStep !== undefined) {
    summary.failedStep = redactIdentifier(result.failedStep);
  }
  return summary;
}

function buildSafeConsoleSummary(
  scenarioName: string,
  result: ScenarioResult,
  passedSteps: number,
): string {
  const safeScenarioName = redactIdentifier(scenarioName);
  if (result.ok) {
    return `PASS ${safeScenarioName} ${passedSteps}/${result.steps.length}`;
  }
  return `FAIL ${safeScenarioName} ${redactIdentifier(result.failedStep ?? "unknown")}`;
}

function redactIdentifier(value: string): string {
  return isSafeMetadataIdentifier(value)
    ? redactInternalToolIdentifiers(value)
    : REDACTED;
}

function redactInternalToolIdentifiers(value: string): string {
  return value.replace(INTERNAL_TOOL_IDENTIFIER_PATTERN, REDACTED_TOOL);
}

const INTERNAL_TOOL_IDENTIFIER_PATTERN =
  /(?:log_food|update_meal|delete_meal|find_meals|get_daily_summary|update_goals|propose_goals|propose_meal_numeric_correction|propose_meal_estimate|plan_next_meal)/g;

/**
 * Write structured, redacted JSON artifacts for a completed scenario run.
 *
 * Files written:
 *   - `summary.json`         — ok, failedStep, consoleSummary, step counts
 *   - `steps.json`           — ordered step evidence (names, ok, actual/expected/error)
 *   - `snapshots.json`       — arbitrary artifact blobs from `result.artifacts`
 *   - `scenario-result.json` — redacted full scenario result for phase evidence indexes
 *
 * The `latest/` directory is replaced on every run so callers always find
 * the most recent evidence without managing timestamped directories.
 */
export async function writeScenarioArtifacts(
  scenarioName: string,
  result: ScenarioResult,
  options: ScenarioArtifactWriteOptions = {},
): Promise<void> {
  if (result.metadata === undefined) {
    const error = new ArtifactSchemaViolation("metadata");
    const safeScenarioId = isSafeMetadataIdentifier(scenarioName) ? scenarioName : "unknown";
    writeMetadataFailureEnvelope(scenarioName, {
      scenarioId: safeScenarioId,
      scenarioName: safeScenarioId,
      status: "fail",
      errorCategory: "artifact_allowlist_violation",
    }, error);
    throw error;
  }
  await writePositiveMetadataArtifacts(scenarioName, result, options);
}

function writeJsonFile(dir: string, fileName: string, value: unknown): void {
  fs.writeFileSync(path.join(dir, fileName), JSON.stringify(value, null, 2), "utf-8");
}

function writeMetadataFailureEnvelope(
  scenarioName: string,
  metadata: ScenarioMetadata,
  error: ArtifactSchemaViolation,
): void {
  const scenarioId = isSafeMetadataIdentifier(metadata.scenarioId)
    ? metadata.scenarioId
    : (isSafeMetadataIdentifier(scenarioName) ? scenarioName : "unknown");
  const envelope: ScenarioFailureEnvelope = {
    scenarioId,
    category: "artifact_allowlist_violation",
    fieldPath: error.fieldPath,
  };
  publishArtifactFiles(scenarioName, {
    "failure.json": JSON.stringify(envelope, null, 2),
    "summary.json": JSON.stringify({
      scenarioId,
      status: "fail",
      errorCategory: "artifact_allowlist_violation",
    }, null, 2),
    "steps.json": JSON.stringify([], null, 2),
    "snapshots.json": JSON.stringify({}, null, 2),
    "scenario-result.json": JSON.stringify({
      schemaVersion: METADATA_ARTIFACT_SCHEMA_VERSION,
      scenarioId,
      status: "fail",
      errorCategory: "artifact_allowlist_violation",
    }, null, 2),
  });
}

async function writePositiveMetadataArtifacts(
  scenarioName: string,
  result: ScenarioResult,
  options: ScenarioArtifactWriteOptions,
): Promise<void> {
  const metadata = result.metadata!;
  try {
    const validated = validateScenarioMetadata(metadata);
    if (Object.keys(result.artifacts).length > 0) {
      violation("artifacts");
    }
    if (result.llmTrace !== undefined) {
      violation("llmTrace");
    }
    const steps = result.steps.map((step, index) => {
      const stepPath = `steps[${index}]`;
      if (step.actual !== undefined) {
        violation(`${stepPath}.actual`);
      }
      if (step.expected !== undefined) {
        violation(`${stepPath}.expected`);
      }
      if (step.error !== undefined) {
        violation(`${stepPath}.error`);
      }
      const safeName = safeStepName(step.name, `${stepPath}.name`);
      if (step.errorCategory !== undefined && !ERROR_CATEGORIES.has(step.errorCategory)) {
        violation(`${stepPath}.errorCategory`);
      }
      return {
        name: safeName,
        status: step.ok ? "pass" : "fail",
        ...(step.errorCategory !== undefined ? { errorCategory: step.errorCategory } : {}),
      };
    });
    const summary = {
      scenarioId: validated.scenarioId,
      scenarioName: validated.scenarioName,
      status: validated.status,
      ...(validated.startedAt !== undefined ? { startedAt: validated.startedAt } : {}),
      ...(validated.finishedAt !== undefined ? { finishedAt: validated.finishedAt } : {}),
      ...(validated.durationMs !== undefined ? { durationMs: validated.durationMs } : {}),
      ...(validated.counts !== undefined ? { counts: validated.counts } : {}),
      ...(validated.errorCategory !== undefined ? { errorCategory: validated.errorCategory } : {}),
      ...(validated.policyFacts !== undefined ? { policyFacts: validated.policyFacts } : {}),
      ...(validated.policyDbInvariants !== undefined ? { policyDbInvariants: validated.policyDbInvariants } : {}),
      ...(validated.visibleOutcomes !== undefined ? { visibleOutcomes: validated.visibleOutcomes } : {}),
    };
    const snapshots = {
      ...(validated.assertions !== undefined ? { assertions: validated.assertions } : {}),
      ...(validated.counts !== undefined ? { counts: validated.counts } : {}),
      ...(validated.files !== undefined ? { files: validated.files } : {}),
      ...(validated.trace !== undefined ? { trace: validated.trace } : {}),
      ...(validated.policyFacts !== undefined ? { policyFacts: validated.policyFacts } : {}),
      ...(validated.policyDbInvariants !== undefined ? { policyDbInvariants: validated.policyDbInvariants } : {}),
      ...(validated.visibleOutcomes !== undefined ? { visibleOutcomes: validated.visibleOutcomes } : {}),
    };
    const scenarioResult = {
      schemaVersion: METADATA_ARTIFACT_SCHEMA_VERSION,
      scenarioId: validated.scenarioId,
      scenarioName: validated.scenarioName,
      status: validated.status,
      ...(validated.assertions !== undefined ? { assertions: validated.assertions } : {}),
      ...(validated.counts !== undefined ? { counts: validated.counts } : {}),
      ...(validated.files !== undefined ? { files: validated.files } : {}),
      ...(validated.trace !== undefined ? { trace: validated.trace } : {}),
      ...(validated.policyFacts !== undefined ? { policyFacts: validated.policyFacts } : {}),
      ...(validated.policyDbInvariants !== undefined ? { policyDbInvariants: validated.policyDbInvariants } : {}),
      ...(validated.visibleOutcomes !== undefined ? { visibleOutcomes: validated.visibleOutcomes } : {}),
      ...(validated.errorCategory !== undefined ? { errorCategory: validated.errorCategory } : {}),
    };
    const files: Record<string, string> = {
      "summary.json": JSON.stringify(summary, null, 2),
      "steps.json": JSON.stringify(steps, null, 2),
      "snapshots.json": JSON.stringify(snapshots, null, 2),
      "scenario-result.json": JSON.stringify(scenarioResult, null, 2),
    };
    if (validated.trace !== undefined) {
      files["llm-trace.json"] = JSON.stringify({
        schemaVersion: METADATA_ARTIFACT_SCHEMA_VERSION,
        eventNames: validated.trace.eventNames,
        counts: validated.trace.counts,
      }, null, 2);
    }
    publishArtifactFiles(scenarioName, files, options.publicationTestControl);
  } catch (error) {
    if (!(error instanceof ArtifactSchemaViolation)) {
      throw error;
    }
    writeMetadataFailureEnvelope(scenarioName, metadata, error);
    throw error;
  }
}
