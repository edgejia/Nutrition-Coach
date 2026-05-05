/**
 * Unit tests for harness artifact writing and failure serialization.
 * Covers VERI-03: redaction, failure evidence, and directory behavior.
 *
 * Uses Node.js built-in node:test only.
 */

import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeScenarioArtifacts } from "../harness/artifacts.js";
import type { ScenarioResult } from "../harness/scenario-types.js";

// ------------------------------------------------------------------ helpers

function makeTmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "veri-test-"));
}

function makePassResult(scenarioName: string): ScenarioResult {
  return {
    ok: true,
    steps: [
      { name: "send-message", ok: true, actual: { status: 200 } },
      { name: "verify-reply", ok: true, actual: { reply: "hello" } },
    ],
    artifacts: {
      requestHeaders: { "x-device-id": "device-abc-123", "content-type": "multipart/form-data" },
      sseTranscript: "event: chunk\ndata: hello\n\nevent: done\ndata: {}\n\n",
    },
    consoleSummary: `PASS ${scenarioName} 2/2`,
  };
}

function makeFailResult(scenarioName: string): ScenarioResult {
  return {
    ok: false,
    failedStep: "verify-meal-persisted",
    steps: [
      { name: "send-message", ok: true, actual: { status: 200 } },
      {
        name: "verify-meal-persisted",
        ok: false,
        actual: { mealCount: 0 },
        expected: { mealCount: 1 },
        error: "AssertionError: Expected 1, got 0",
      },
    ],
    artifacts: {
      requestHeaders: {
        "x-device-id": "secret-device-id-xyz",
        "content-type": "multipart/form-data",
      },
      uploadPath: "/absolute/path/to/server/uploads/image.jpg",
      mealsSnapshot: [{ id: 1, deviceId: "secret-device-id-xyz", food_name: "apple" }],
      queryUrl: "http://127.0.0.1:54321/api/meals?deviceId=secret-device-id-xyz&limit=10",
    },
    consoleSummary: `FAIL ${scenarioName} verify-meal-persisted`,
  };
}

// ------------------------------------------------------------------ tests

describe("verification-artifacts", () => {
  let tmpDir: string;
  const originalEnv = process.env.HARNESS_ARTIFACTS_DIR;

  before(() => {
    tmpDir = makeTmpDir();
    process.env.HARNESS_ARTIFACTS_DIR = tmpDir;
  });

  after(() => {
    if (originalEnv === undefined) {
      delete process.env.HARNESS_ARTIFACTS_DIR;
    } else {
      process.env.HARNESS_ARTIFACTS_DIR = originalEnv;
    }
    // Clean up tmp dir
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("writeScenarioArtifacts creates summary.json, steps.json, snapshots.json, and scenario-result.json for a passing run", async () => {
    const result = makePassResult("text-log");
    await writeScenarioArtifacts("text-log", result);

    const latestDir = path.join(tmpDir, "text-log", "latest");
    assert.ok(fs.existsSync(latestDir), `expected directory: ${latestDir}`);
    assert.ok(fs.existsSync(path.join(latestDir, "summary.json")), "summary.json missing");
    assert.ok(fs.existsSync(path.join(latestDir, "steps.json")), "steps.json missing");
    assert.ok(fs.existsSync(path.join(latestDir, "snapshots.json")), "snapshots.json missing");
    assert.ok(fs.existsSync(path.join(latestDir, "scenario-result.json")), "scenario-result.json missing");
  });

  test("summary.json contains ok, failedStep, consoleSummary, and step count", async () => {
    const result = makePassResult("text-log-summary");
    await writeScenarioArtifacts("text-log-summary", result);

    const latestDir = path.join(tmpDir, "text-log-summary", "latest");
    const summary = JSON.parse(fs.readFileSync(path.join(latestDir, "summary.json"), "utf-8")) as {
      ok: boolean;
      failedStep?: string;
      consoleSummary: string;
      totalSteps: number;
      passedSteps: number;
    };

    assert.equal(summary.ok, true);
    assert.equal(summary.consoleSummary, "PASS text-log-summary 2/2");
    assert.equal(summary.totalSteps, 2);
    assert.equal(summary.passedSteps, 2);
    assert.equal(summary.failedStep, undefined);
  });

  test("steps.json contains ordered steps with name, ok, and evidence", async () => {
    const result = makeFailResult("image-log-steps");
    await writeScenarioArtifacts("image-log-steps", result);

    const latestDir = path.join(tmpDir, "image-log-steps", "latest");
    const steps = JSON.parse(
      fs.readFileSync(path.join(latestDir, "steps.json"), "utf-8"),
    ) as Array<{ name: string; ok: boolean }>;

    assert.equal(steps.length, 2);
    assert.equal(steps[0].name, "send-message");
    assert.equal(steps[0].ok, true);
    assert.equal(steps[1].name, "verify-meal-persisted");
    assert.equal(steps[1].ok, false);
  });

  test("x-device-id header value is redacted in saved JSON", async () => {
    const result = makeFailResult("redact-device-header");
    await writeScenarioArtifacts("redact-device-header", result);

    const latestDir = path.join(tmpDir, "redact-device-header", "latest");
    const raw = fs.readFileSync(path.join(latestDir, "snapshots.json"), "utf-8");

    assert.doesNotMatch(
      raw,
      /secret-device-id-xyz/,
      "x-device-id value must be redacted in snapshots.json",
    );
    assert.match(raw, /\[REDACTED\]/, "expected [REDACTED] placeholder in snapshots.json");
  });

  test("deviceId= URL query parameter is redacted in saved JSON", async () => {
    const result = makeFailResult("redact-device-query");
    await writeScenarioArtifacts("redact-device-query", result);

    const latestDir = path.join(tmpDir, "redact-device-query", "latest");
    const raw = fs.readFileSync(path.join(latestDir, "snapshots.json"), "utf-8");

    // The queryUrl contains "deviceId=secret-device-id-xyz" — value must be redacted
    assert.doesNotMatch(
      raw,
      /deviceId=secret-device-id-xyz/,
      "deviceId= query param value must be redacted",
    );
  });

  test("absolute upload paths are redacted in saved JSON", async () => {
    const result = makeFailResult("redact-upload-path");
    await writeScenarioArtifacts("redact-upload-path", result);

    const latestDir = path.join(tmpDir, "redact-upload-path", "latest");
    const raw = fs.readFileSync(path.join(latestDir, "snapshots.json"), "utf-8");

    // The artifact contains "/absolute/path/to/server/uploads/image.jpg"
    assert.doesNotMatch(
      raw,
      /\/absolute\/path\/to\/server\/uploads/,
      "absolute upload path must be redacted",
    );
  });

  test("deviceId values in nested objects are redacted across the artifact graph", async () => {
    const result = makeFailResult("redact-nested-device");
    await writeScenarioArtifacts("redact-nested-device", result);

    const latestDir = path.join(tmpDir, "redact-nested-device", "latest");
    const raw = fs.readFileSync(path.join(latestDir, "snapshots.json"), "utf-8");

    // mealsSnapshot contains a deviceId field with the secret value
    assert.doesNotMatch(raw, /secret-device-id-xyz/, "all occurrences of deviceId value must be redacted");
  });

  test("failed scenario produces ok=false and populated failedStep in summary.json", async () => {
    const result = makeFailResult("image-log-fail");
    await writeScenarioArtifacts("image-log-fail", result);

    const latestDir = path.join(tmpDir, "image-log-fail", "latest");
    const summary = JSON.parse(
      fs.readFileSync(path.join(latestDir, "summary.json"), "utf-8"),
    ) as { ok: boolean; failedStep?: string };

    assert.equal(summary.ok, false);
    assert.equal(summary.failedStep, "verify-meal-persisted");
  });

  test("writeScenarioArtifacts overwrites latest/ on repeated runs for the same scenario", async () => {
    const first = makePassResult("repeated-run");
    first.consoleSummary = "PASS repeated-run 2/2 (run-1)";
    await writeScenarioArtifacts("repeated-run", first);

    const second = makeFailResult("repeated-run");
    second.consoleSummary = "FAIL repeated-run verify-meal-persisted (run-2)";
    await writeScenarioArtifacts("repeated-run", second);

    const latestDir = path.join(tmpDir, "repeated-run", "latest");
    const summary = JSON.parse(
      fs.readFileSync(path.join(latestDir, "summary.json"), "utf-8"),
    ) as { consoleSummary: string };

    // latest/ must reflect the most recent run
    assert.match(summary.consoleSummary, /run-2/);
  });
});
