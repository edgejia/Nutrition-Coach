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
  afterLock?: () => void;
  afterTemporaryGeneration?: () => void;
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
const POLICY_FACT_KEYS = new Set(["step", "tool", "policyClass", "decision", "ruleId", "proposalId"]);
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
    if (new Set([
      "reply",
      "replytext",
      "assistantreply",
      "transcript",
      "sse",
      "rawsse",
      "rawtranscript",
      "events",
      "data",
      "providerpayload",
      "dom",
    ]).has(normalized)) {
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
  if (typeof value !== "string" || !SAFE_IDENTIFIER.test(value)) {
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
      ...(entry.proposalId === undefined ? {} : { proposalId: requireSafeIdentifier(entry.proposalId, `${itemPath}.proposalId`) }),
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
      entry.path.includes("\0")
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
  if (typeof value.scenarioId !== "string" || !SAFE_IDENTIFIER.test(value.scenarioId)) {
    violation("metadata.scenarioId");
  }
  if (typeof value.scenarioName !== "string" || !SAFE_IDENTIFIER.test(value.scenarioName)) {
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
  if (!SAFE_IDENTIFIER.test(value)) {
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

function latestDir(scenarioName: string): string {
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(scenarioName)) {
    throw new Error(`Invalid scenario name: ${scenarioName}`);
  }

  const root = path.resolve(getArtifactsRoot());
  const dir = path.resolve(root, scenarioName, "latest");
  if (!dir.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Scenario artifact path escapes root: ${scenarioName}`);
  }
  return dir;
}

function scenarioRoot(scenarioName: string): string {
  return path.dirname(latestDir(scenarioName));
}

function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readPointerToken(root: string): string {
  const indexPath = path.join(root, "latest", "index.json");
  try {
    return fs.readFileSync(indexPath, "utf8");
  } catch {
    return "";
  }
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
  } catch {
    // Directory fsync is platform-dependent; file fsync and atomic rename remain required.
  }
}

function garbageCollectGenerationResidue(root: string): void {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.name.startsWith(".generation-") && !entry.name.startsWith(".latest-") && !entry.name.startsWith(".legacy-latest-")) {
      continue;
    }
    fs.rmSync(path.join(root, entry.name), { recursive: true, force: true });
  }
}

const activePublicationRoots = new Set<string>();

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function acquirePublicationLock(root: string): string {
  const lock = path.join(root, ".publication.lock");
  if (activePublicationRoots.has(root)) {
    throw new ArtifactPublicationConflict();
  }
  const tryCreate = (): boolean => {
    try {
      fs.mkdirSync(lock);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
  };

  if (!tryCreate()) {
    let ownerPid: number | undefined;
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(lock, "owner.json"), "utf8")) as { pid?: unknown };
      if (typeof parsed.pid === "number" && Number.isSafeInteger(parsed.pid) && parsed.pid > 0) {
        ownerPid = parsed.pid;
      }
    } catch {
      // Missing or malformed owner metadata is recoverable stale residue.
    }
    if (ownerPid !== undefined && ownerPid !== process.pid && processIsAlive(ownerPid)) {
      throw new ArtifactPublicationConflict();
    }
    fs.rmSync(lock, { recursive: true, force: true });
    if (!tryCreate()) {
      throw new ArtifactPublicationConflict();
    }
  }
  fs.writeFileSync(lock + "/owner.json", JSON.stringify({ pid: process.pid }), "utf8");
  activePublicationRoots.add(root);
  return lock;
}

function publishArtifactFiles(
  scenarioName: string,
  files: Record<string, string>,
  testControl?: ArtifactPublicationTestControl,
): void {
  const root = scenarioRoot(scenarioName);
  fs.mkdirSync(root, { recursive: true });
  const lock = acquirePublicationLock(root);

  const generationId = randomUUID();
  const temporaryGeneration = path.join(root, `.generation-${generationId}.tmp`);
  const generation = path.join(root, `generation-${generationId}`);
  const pointer = path.join(root, "latest");
  const pointerTemp = path.join(root, `.latest-${generationId}.tmp`);
  let published = false;
  let pointerReplaced = false;
  try {
    testControl?.afterLock?.();
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
    fsyncDirectory(temporaryGeneration);
    fs.renameSync(temporaryGeneration, generation);
    fsyncDirectory(root);

    const tokenAfter = readPointerToken(root);
    if (tokenAfter !== tokenBefore) {
      throw new ArtifactPublicationConflict();
    }
    fs.symlinkSync(path.relative(root, generation), pointerTemp, "dir");
    fs.renameSync(pointerTemp, pointer);
    pointerReplaced = true;
    fsyncDirectory(root);
    published = true;
  } finally {
    if (!published) {
      fs.rmSync(temporaryGeneration, { recursive: true, force: true });
      if (!pointerReplaced) {
        fs.rmSync(generation, { recursive: true, force: true });
      }
      fs.rmSync(pointerTemp, { force: true });
    }
    fs.rmSync(lock, { recursive: true, force: true });
    activePublicationRoots.delete(root);
  }
}

export function readPublishedArtifact(scenarioName: string, fileName: string): string {
  if (!/^[a-z0-9][a-z0-9.-]*\.json$/i.test(fileName)) {
    throw new Error("Invalid artifact file name");
  }
  const root = scenarioRoot(scenarioName);
  const pointer = path.join(root, "latest");
  const indexPath = path.join(pointer, "index.json");
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
  const resolvedPointer = fs.realpathSync(pointer);
  if (path.basename(resolvedPointer) !== `generation-${index.generation}`) {
    throw new Error("Published artifact pointer mismatch");
  }
  const content = fs.readFileSync(path.join(pointer, fileName), "utf8");
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
  return /^[a-z0-9][a-z0-9._:-]*$/i.test(value)
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
    const safeScenarioId = SAFE_IDENTIFIER.test(scenarioName) ? scenarioName : "unknown";
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
  const scenarioId = typeof metadata.scenarioId === "string" && SAFE_IDENTIFIER.test(metadata.scenarioId)
    ? metadata.scenarioId
    : redactIdentifier(scenarioName);
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
