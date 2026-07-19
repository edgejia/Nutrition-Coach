/**
 * Unit tests for the positive-schema artifact writer and in-memory redaction.
 *
 * Legacy ScenarioResult evidence is intentionally rejected by the writer;
 * phase-128-artifact-negative-controls covers that persisted failure envelope.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  readPublishedArtifact,
  redact,
  writeScenarioArtifacts,
} from "../harness/artifacts.js";
import type { ScenarioMetadata, ScenarioResult } from "../harness/scenario-types.js";

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veri-test-"));
}

function makeMetadata(scenarioName: string, status: "pass" | "fail" = "pass"): ScenarioMetadata {
  return {
    scenarioId: scenarioName,
    scenarioName,
    status,
    startedAt: "2026-07-19T14:00:00.000Z",
    finishedAt: "2026-07-19T14:00:00.125Z",
    durationMs: 125,
    counts: { steps: 2, passed: status === "pass" ? 2 : 1 },
    assertions: { terminalProof: true, noRawEvidence: true },
    trace: {
      eventNames: ["status", "chunk", "done"],
      counts: { status: 1, chunk: 1, done: 1 },
    },
    ...(status === "fail" ? { errorCategory: "assertion_failed" as const } : {}),
  };
}

function makePositiveResult(scenarioName: string, status: "pass" | "fail" = "pass"): ScenarioResult {
  const metadata = makeMetadata(scenarioName, status);
  return {
    ok: status === "pass",
    failedStep: status === "fail" ? "verify_result" : undefined,
    steps: [
      { name: "bootstrap", ok: true },
      { name: "verify_result", ok: status === "pass", errorCategory: status === "fail" ? "assertion_failed" : undefined },
    ],
    artifacts: {},
    metadata,
    consoleSummary: `${status.toUpperCase()} ${scenarioName}`,
  };
}

describe("verification-artifacts", () => {
  let tmpDir: string;
  const originalEnv = process.env.HARNESS_ARTIFACTS_DIR;

  before(() => {
    tmpDir = makeTmpDir();
    process.env.HARNESS_ARTIFACTS_DIR = tmpDir;
  });

  after(() => {
    if (originalEnv === undefined) delete process.env.HARNESS_ARTIFACTS_DIR;
    else process.env.HARNESS_ARTIFACTS_DIR = originalEnv;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writes the positive metadata schema and a manifest-backed latest pointer", async () => {
    const scenarioName = "positive-schema-pass";
    await writeScenarioArtifacts(scenarioName, makePositiveResult(scenarioName));

    const latestDir = path.join(tmpDir, scenarioName, "latest");
    assert.deepEqual(fs.readdirSync(latestDir).sort(), [
      "index.json",
      "llm-trace.json",
      "scenario-result.json",
      "snapshots.json",
      "steps.json",
      "summary.json",
    ]);
    const summary = JSON.parse(readPublishedArtifact(scenarioName, "summary.json")) as Record<string, unknown>;
    assert.equal(summary.status, "pass");
    assert.equal(summary.scenarioId, scenarioName);
    assert.deepEqual(
      JSON.parse(readPublishedArtifact(scenarioName, "steps.json")),
      [
        { name: "bootstrap", status: "pass" },
        { name: "verify_result", status: "pass" },
      ],
    );
    assert.deepEqual(
      JSON.parse(readPublishedArtifact(scenarioName, "llm-trace.json")),
      {
        schemaVersion: 1,
        eventNames: ["status", "chunk", "done"],
        counts: { status: 1, chunk: 1, done: 1 },
      },
    );
  });

  test("writes the same bounded schema for an allowed failure", async () => {
    const scenarioName = "positive-schema-fail";
    await writeScenarioArtifacts(scenarioName, makePositiveResult(scenarioName, "fail"));

    const summary = JSON.parse(readPublishedArtifact(scenarioName, "summary.json")) as Record<string, unknown>;
    const scenarioResult = JSON.parse(readPublishedArtifact(scenarioName, "scenario-result.json")) as Record<string, unknown>;
    assert.equal(summary.status, "fail");
    assert.equal(summary.errorCategory, "assertion_failed");
    assert.equal(scenarioResult.status, "fail");
    assert.equal(scenarioResult.errorCategory, "assertion_failed");
    assert.equal(fs.existsSync(path.join(tmpDir, scenarioName, "latest", "failure.json")), false);
  });

  test("fails closed when positive metadata is accompanied by arbitrary evidence", async () => {
    const scenarioName = "positive-schema-no-bypass";
    const result = makePositiveResult(scenarioName);
    result.artifacts = { rawSentinel: "must-not-be-persisted" };

    await assert.rejects(
      writeScenarioArtifacts(scenarioName, result),
      (error: unknown) => {
        assert.equal((error as { category?: string }).category, "artifact_allowlist_violation");
        assert.equal((error as { fieldPath?: string }).fieldPath, "artifacts");
        return true;
      },
    );

    const latestDir = path.join(tmpDir, scenarioName, "latest");
    const raw = fs.readdirSync(latestDir)
      .map((fileName) => fs.readFileSync(path.join(latestDir, fileName), "utf8"))
      .join("\n");
    assert.doesNotMatch(raw, /must-not-be-persisted/);
    assert.match(raw, /artifact_allowlist_violation/);
  });

  test("fails closed when arbitrary step evidence is present", async () => {
    const scenarioName = "positive-schema-step-bypass";
    const result = makePositiveResult(scenarioName);
    result.steps[0]!.actual = { rawSentinel: "must-not-be-persisted" };

    await assert.rejects(
      writeScenarioArtifacts(scenarioName, result),
      (error: unknown) => {
        assert.equal((error as { category?: string }).category, "artifact_allowlist_violation");
        assert.equal((error as { fieldPath?: string }).fieldPath, "steps[0].actual");
        return true;
      },
    );

    const raw = fs.readdirSync(path.join(tmpDir, scenarioName, "latest"))
      .map((fileName) => fs.readFileSync(path.join(tmpDir, scenarioName, "latest", fileName), "utf8"))
      .join("\n");
    assert.doesNotMatch(raw, /must-not-be-persisted/);
  });

  test("redacts sensitive values recursively in memory without mutating the input", () => {
    const input = {
      headers: { "x-device-id": "device-secret" },
      queryUrl: "https://example.test/api?deviceId=device-secret&token=token-secret",
      uploadPath: "/absolute/uploads/photo.jpg",
      deviceId: "device-secret",
      nested: { rawPrompt: "prompt-secret", safe: "visible" },
    };

    const output = redact(input) as Record<string, unknown>;
    assert.equal("headers" in output, false);
    assert.equal(output.deviceId, "[REDACTED]");
    assert.equal(output.uploadPath, "[REDACTED_PATH]");
    assert.match(output.queryUrl as string, /deviceId=\[REDACTED\]/);
    assert.match(output.queryUrl as string, /token=\[REDACTED\]/);
    assert.deepEqual(output.nested, { safe: "visible" });
    assert.equal(input.deviceId, "device-secret");
  });

  test("redacts unsafe prompt metadata and internal tool identifiers", () => {
    const output = redact({
      prompt: { version: "system-prompt.test", sectionIds: ["role", "raw prompt"] },
      tool: "update_goals",
      nested: { tool: "log_food" },
    }) as Record<string, unknown>;

    assert.deepEqual(output.prompt, {
      version: "system-prompt.test",
      sectionIds: ["role", "[REDACTED]"],
    });
    assert.equal(output.tool, "[REDACTED_TOOL]");
    assert.deepEqual(output.nested, { tool: "[REDACTED_TOOL]" });
  });

  test("rejects scenario paths that escape the artifact root without touching outside files", async () => {
    const outsideDir = path.join(tmpDir, "outside");
    fs.mkdirSync(outsideDir, { recursive: true });
    const sentinel = path.join(outsideDir, "sentinel.txt");
    fs.writeFileSync(sentinel, "do not delete", "utf8");

    await assert.rejects(
      writeScenarioArtifacts("../outside", makePositiveResult("escape")),
      /Invalid scenario name/,
    );
    assert.equal(fs.readFileSync(sentinel, "utf8"), "do not delete");
  });
});
