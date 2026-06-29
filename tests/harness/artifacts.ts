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
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ScenarioResult, ScenarioStepResult } from "./scenario-types.js";

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

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const REDACTED = "[REDACTED]";
const REDACTED_PATH = "[REDACTED_PATH]";

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
  return s;
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
  return OMITTED_KEYS.has(normalized);
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
  return /^[a-z0-9][a-z0-9._:-]*$/i.test(value) ? value : REDACTED;
}

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
): Promise<void> {
  const dir = latestDir(scenarioName);

  // Replace latest/ atomically: remove then recreate.
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  // summary.json
  const summary = redact(buildSummary(scenarioName, result));
  fs.writeFileSync(
    path.join(dir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf-8",
  );

  // steps.json — redact all step evidence, including assertion strings that may
  // embed model/user transcript excerpts.
  const steps = result.steps.map((s: ScenarioStepResult) => ({
    name: redactIdentifier(s.name),
    ok: s.ok,
    ...(s.actual !== undefined ? { actual: redact(s.actual) } : {}),
    ...(s.expected !== undefined ? { expected: redact(s.expected) } : {}),
    ...(s.error !== undefined ? { error: REDACTED } : {}),
  }));
  fs.writeFileSync(path.join(dir, "steps.json"), JSON.stringify(steps, null, 2), "utf-8");

  // snapshots.json — redact all artifact blobs
  const snapshots = redact(result.artifacts);
  fs.writeFileSync(
    path.join(dir, "snapshots.json"),
    JSON.stringify(snapshots, null, 2),
    "utf-8",
  );

  if (result.llmTrace !== undefined) {
    fs.writeFileSync(
      path.join(dir, "llm-trace.json"),
      JSON.stringify(redact(result.llmTrace), null, 2),
      "utf-8",
    );
  }

  const scenarioResult = redact(result);
  fs.writeFileSync(
    path.join(dir, "scenario-result.json"),
    JSON.stringify(scenarioResult, null, 2),
    "utf-8",
  );
}
