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
 *   - Paths containing `/uploads/`  → "[REDACTED_PATH]"
 *   - Object keys containing `deviceId` or named `x-device-id`  → "[REDACTED]"
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
  return path.join(getArtifactsRoot(), scenarioName, "latest");
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
  if (/\/uploads\//.test(s)) {
    return REDACTED_PATH;
  }
  // Redact deviceId= query parameter values in URLs
  s = s.replace(/(deviceId=)[^&\s"']+/gi, `$1${REDACTED}`);
  return s;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    const lowerKey = key.toLowerCase();
    if (lowerKey === "x-device-id" || lowerKey.includes("deviceid")) {
      result[key] = REDACTED;
    } else {
      result[key] = redact(val);
    }
  }
  return result;
}

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
    scenarioName,
    ok: result.ok,
    consoleSummary: result.consoleSummary,
    totalSteps: result.steps.length,
    passedSteps,
    stepNames: result.steps.map((step) => step.name),
    writtenAt: new Date().toISOString(),
  };
  if (result.failedStep !== undefined) {
    summary.failedStep = result.failedStep;
  }
  return summary;
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
  const summary = buildSummary(scenarioName, result);
  fs.writeFileSync(
    path.join(dir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf-8",
  );

  // steps.json — redact actual/expected values
  const steps = result.steps.map((s: ScenarioStepResult) => ({
    name: s.name,
    ok: s.ok,
    ...(s.actual !== undefined ? { actual: redact(s.actual) } : {}),
    ...(s.expected !== undefined ? { expected: redact(s.expected) } : {}),
    ...(s.error !== undefined ? { error: s.error } : {}),
  }));
  fs.writeFileSync(path.join(dir, "steps.json"), JSON.stringify(steps, null, 2), "utf-8");

  // snapshots.json — redact all artifact blobs
  const snapshots = redact(result.artifacts);
  fs.writeFileSync(
    path.join(dir, "snapshots.json"),
    JSON.stringify(snapshots, null, 2),
    "utf-8",
  );

  const scenarioResult = redact(result);
  fs.writeFileSync(
    path.join(dir, "scenario-result.json"),
    JSON.stringify(scenarioResult, null, 2),
    "utf-8",
  );
}
