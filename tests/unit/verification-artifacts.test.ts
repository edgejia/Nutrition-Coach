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
      assetBoundary: {
        ownerDeviceId: "owner-device-id-123",
        foreignDeviceId: "foreign-device-id-456",
      },
      queryUrl: "http://127.0.0.1:54321/api/meals?deviceId=secret-device-id-xyz&limit=10",
    },
    consoleSummary: `FAIL ${scenarioName} verify-meal-persisted`,
  };
}

function artifactFileNames(tmpDir: string, scenarioName: string): string[] {
  return fs.readdirSync(path.join(tmpDir, scenarioName, "latest")).sort();
}

function readArtifact(tmpDir: string, scenarioName: string, fileName: string): string {
  return fs.readFileSync(path.join(tmpDir, scenarioName, "latest", fileName), "utf-8");
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

  test("writeScenarioArtifacts does not write llm-trace.json when a scenario returns no trace", async () => {
    const result = makePassResult("text-log-without-trace");
    await writeScenarioArtifacts("text-log-without-trace", result);

    assert.deepEqual(artifactFileNames(tmpDir, "text-log-without-trace"), [
      "scenario-result.json",
      "snapshots.json",
      "steps.json",
      "summary.json",
    ]);
  });

  test("writeScenarioArtifacts writes fixed llm-trace.json when a scenario returns a trace", async () => {
    const result = makePassResult("text-log-with-trace") as ScenarioResult & {
      llmTrace?: Record<string, unknown>;
    };
    result.llmTrace = {
      summary: { roundCount: 1, toolCount: 1 },
      timeline: [{ type: "tool_result", tool: "log_food", success: true }],
    };

    await writeScenarioArtifacts("text-log-with-trace", result);

    assert.deepEqual(artifactFileNames(tmpDir, "text-log-with-trace"), [
      "llm-trace.json",
      "scenario-result.json",
      "snapshots.json",
      "steps.json",
      "summary.json",
    ]);
  });

  test("llm-trace.json contains only the redacted ScenarioResult llmTrace", async () => {
    const result = makePassResult("text-log-trace-source") as ScenarioResult & {
      llmTrace?: Record<string, unknown>;
    };
    result.steps[0]!.actual = { stepOnly: "must not appear in llm trace" };
    result.artifacts = {
      llmTrace: { artifactTrace: "must not become llm-trace.json" },
      trace: { rawTrace: "must not become llm-trace.json" },
      snapshotOnly: "must not appear in llm trace",
    };
    result.llmTrace = {
      summary: {
        source: "shape survives",
        deviceId: "secret-device-id-xyz",
      },
      timeline: [{ type: "tool_result", tool: "log_food", success: true }],
    };

    await writeScenarioArtifacts("text-log-trace-source", result);

    const latestDir = path.join(tmpDir, "text-log-trace-source", "latest");
    const traceRaw = fs.readFileSync(path.join(latestDir, "llm-trace.json"), "utf-8");
    const trace = JSON.parse(traceRaw) as {
      summary: { source: string; deviceId: string };
      timeline: Array<{ type: string; tool: string; success: boolean }>;
    };

    assert.equal(trace.summary.source, "shape survives");
    assert.equal(trace.summary.deviceId, "[REDACTED]");
    assert.deepEqual(trace.timeline, [{ type: "tool_result", tool: "log_food", success: true }]);
    assert.doesNotMatch(traceRaw, /must not appear in llm trace/);
    assert.doesNotMatch(traceRaw, /must not become llm-trace\.json/);
    assert.doesNotMatch(traceRaw, /secret-device-id-xyz/);
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

  test("summary.json redacts untrusted console, failed step, and step name text", async () => {
    const result = makeFailResult("summary-redaction");
    result.consoleSummary =
      "FAIL summary-redaction raw user meal text should not persist /absolute/path/to/server/uploads/photo.jpg";
    result.failedStep = "raw user meal text should not persist";
    result.steps[1]!.name = "raw prompt text should not persist";

    await writeScenarioArtifacts("summary-redaction", result);

    const raw = readArtifact(tmpDir, "summary-redaction", "summary.json");
    const summary = JSON.parse(raw) as {
      consoleSummary: string;
      failedStep: string;
      stepNames: string[];
    };

    assert.equal(summary.consoleSummary, "FAIL summary-redaction [REDACTED]");
    assert.equal(summary.failedStep, "[REDACTED]");
    assert.deepEqual(summary.stepNames, ["send-message", "[REDACTED]"]);
    assert.doesNotMatch(raw, /raw user meal text should not persist|raw prompt text should not persist|\/uploads\//);
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

  test("session query parameter values are redacted in saved JSON", async () => {
    const result = makeFailResult("redact-session-query");
    result.artifacts.requestUrl =
      "http://127.0.0.1:54321/api/sse?guest_session=session-secret&guest_session_resume=resume-secret&guestSession=camel-secret&guestSessionResume=camel-resume-secret&sessionToken=token-secret&resumeToken=resume-token-secret&token=plain-secret";

    await writeScenarioArtifacts("redact-session-query", result);

    for (const fileName of ["snapshots.json", "scenario-result.json"]) {
      const raw = readArtifact(tmpDir, "redact-session-query", fileName);
      assert.doesNotMatch(raw, /session-secret|resume-secret|camel-secret|camel-resume-secret|token-secret|resume-token-secret|plain-secret/);
      assert.match(raw, /guest_session=\[REDACTED\]/);
      assert.match(raw, /guest_session_resume=\[REDACTED\]/);
      assert.match(raw, /guestSession=\[REDACTED\]/);
      assert.match(raw, /guestSessionResume=\[REDACTED\]/);
      assert.match(raw, /sessionToken=\[REDACTED\]/);
      assert.match(raw, /resumeToken=\[REDACTED\]/);
      assert.match(raw, /token=\[REDACTED\]/);
    }
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

  test("database snapshot evidence keys are omitted from saved artifact files", async () => {
    const result = makeFailResult("omit-database-snapshots");
    result.artifacts.historySnapshot = [{ role: "user", content: "raw user meal text should not persist" }];
    result.steps[0]!.actual = {
      receiptLoggedMeal: {
        mealId: "123e4567-e89b-42d3-a456-426614174000",
        mealRevisionId: "123e4567-e89b-42d3-a456-426614174000:r1",
        imageAssetId: "223e4567-e89b-42d3-a456-426614174000",
        imageUrl: "/api/assets/223e4567-e89b-42d3-a456-426614174000",
        loggedAt: "2026-06-29T17:53:28.750Z",
        dateKey: "2026-06-30",
        foodName: "raw receipt food",
        items: [{ name: "raw item food", calories: 777 }],
      },
      normalizedFacts: {
        loggedMeal: { foodName: "raw logged meal", calories: 777 },
        receiptPayload: { foodName: "raw receipt payload", protein: 88 },
        persistence: { foodName: "raw persistence", carbs: 99 },
        persistedRevision: { foodName: "raw revision", fat: 11 },
      },
      checkedMealNames: ["raw checked meal"],
      allowedMealNames: ["raw allowed meal"],
      assistantMealNames: ["raw assistant meal"],
      inventedMeals: ["raw invented meal"],
      expectedPatterns: ["raw expected phrase"],
      matchedPatterns: ["raw matched phrase"],
      matchedInjectionSafetyPatterns: ["不能忽略"],
      matchedPromptInjectionUnsafePatterns: ["照做"],
      matchedTerms: ["system-prompt.v3"],
    };
    result.artifacts.behaviorMatrixSnapshots = {
      beforeMeals: [{ id: "meal-1", foodName: "raw food name", calories: 777 }],
      afterMeals: [{ id: "meal-1", foodName: "raw food name", calories: 888 }],
      beforeTargets: { calories: 2000, protein: 100, carbs: 220, fat: 70 },
      afterTargets: { calories: 1800, protein: 130, carbs: 150, fat: 50 },
      persistedMeal: { id: "meal-2", foodName: "raw persisted meal" },
      seededMeal: { id: "meal-3", foodName: "raw seeded meal" },
      updatedMeal: { id: "meal-3", foodName: "raw updated meal" },
      responseLoggedMeal: { mealId: "meal-4", foodName: "raw response meal" },
      committedTargets: { calories: 1800, protein: 130, carbs: 150, fat: 50 },
      committedFacts: { foodName: "raw committed food", calories: 520 },
      deletedMeal: { mealId: "meal-5", foodName: "raw deleted meal" },
      receiptLoggedMeal: { mealId: "323e4567-e89b-42d3-a456-426614174000", foodName: "raw artifact receipt" },
      normalizedFacts: { persistence: { mealId: "423e4567-e89b-42d3-a456-426614174000" } },
    };

    await writeScenarioArtifacts("omit-database-snapshots", result);

    const latestDir = path.join(tmpDir, "omit-database-snapshots", "latest");
    for (const fileName of ["steps.json", "snapshots.json", "scenario-result.json"]) {
      const raw = fs.readFileSync(path.join(latestDir, fileName), "utf-8");
      assert.doesNotMatch(
        raw,
        /mealsSnapshot|historySnapshot|beforeMeals|afterMeals|beforeTargets|afterTargets|persistedMeal|seededMeal|updatedMeal|responseLoggedMeal|receiptLoggedMeal|normalizedFacts|loggedMeal|receiptPayload|persistence|persistedRevision|committedTargets|committedFacts|deletedMeal|mealId|mealRevisionId|imageAssetId|imageUrl|loggedAt|dateKey|foodName|items|checkedMealNames|allowedMealNames|assistantMealNames|inventedMeals|expectedPatterns|matchedPatterns|matchedInjectionSafetyPatterns|matchedPromptInjectionUnsafePatterns|matchedTerms/,
        `${fileName} must omit database snapshot keys`,
      );
      assert.doesNotMatch(
        raw,
        /raw user meal text should not persist|secret-device-id-xyz|raw food name|raw persisted meal|raw seeded meal|raw updated meal|raw response meal|raw committed food|raw deleted meal|raw receipt food|raw item food|raw logged meal|raw receipt payload|raw persistence|raw revision|raw checked meal|raw allowed meal|raw assistant meal|raw invented meal|raw expected phrase|raw matched phrase|不能忽略|照做|system-prompt\.v3|raw artifact receipt|123e4567-e89b-42d3-a456-426614174000|\/api\/assets\/223e4567-e89b-42d3-a456-426614174000/,
        `${fileName} must not persist database snapshot values`,
      );
    }
  });

  test("raw prompt and message keys are omitted while safe prompt metadata survives", async () => {
    const result = makePassResult("omit-raw-text-keys") as ScenarioResult & {
      llmTrace?: Record<string, unknown>;
    };
    result.steps[0]!.actual = {
      prompt: "raw prompt text should not persist",
      userPrompt: "raw user meal text should not persist",
      message: "raw user meal text should not persist",
      reply: "assistant final answer should not persist",
      response: "raw provider body should not persist",
    };
    result.artifacts.rawTextKeys = {
      systemPrompt: "raw prompt text should not persist",
      prompt: "raw prompt text should not persist",
      message: "raw user meal text should not persist",
      reply: "assistant final answer should not persist",
    };
    result.llmTrace = {
      summary: {
        prompt: {
          version: "system-prompt.test",
          sectionIds: ["role"],
          text: "raw prompt text should not persist",
          rawText: "raw prompt text should not persist",
        },
        message: "raw user meal text should not persist",
      },
      timeline: [
        {
          prompt: "raw prompt text should not persist",
          response: "raw provider body should not persist",
          reply: "assistant final answer should not persist",
        },
      ],
    };

    await writeScenarioArtifacts("omit-raw-text-keys", result);

    const trace = JSON.parse(readArtifact(tmpDir, "omit-raw-text-keys", "llm-trace.json")) as {
      summary: { prompt: { version: string; sectionIds: string[] } };
    };
    assert.deepEqual(trace.summary.prompt, {
      version: "system-prompt.test",
      sectionIds: ["role"],
    });

    for (const fileName of ["steps.json", "snapshots.json", "scenario-result.json", "llm-trace.json"]) {
      const raw = readArtifact(tmpDir, "omit-raw-text-keys", fileName);
      assert.doesNotMatch(raw, /raw prompt text should not persist|raw user meal text should not persist|assistant final answer should not persist|raw provider body should not persist/);
      assert.doesNotMatch(raw, /"userPrompt"|"systemPrompt"|"message"|"reply"|"response"/);
    }
  });

  test("safe prompt metadata values reject raw text payloads", async () => {
    const result = makePassResult("redact-unsafe-prompt-metadata") as ScenarioResult & {
      llmTrace?: Record<string, unknown>;
    };
    result.llmTrace = {
      summary: {
        prompt: {
          version: "raw prompt text should not persist",
          sectionIds: ["role", "raw user meal text should not persist"],
        },
      },
    };

    await writeScenarioArtifacts("redact-unsafe-prompt-metadata", result);

    const raw = readArtifact(tmpDir, "redact-unsafe-prompt-metadata", "llm-trace.json");
    const trace = JSON.parse(raw) as {
      summary: { prompt: { version: string; sectionIds: string[] } };
    };
    assert.deepEqual(trace.summary.prompt, {
      version: "[REDACTED]",
      sectionIds: ["role", "[REDACTED]"],
    });
    assert.doesNotMatch(raw, /raw prompt text should not persist|raw user meal text should not persist/);
  });

  test("error-like artifact keys are redacted across persisted artifacts", async () => {
    const result = makeFailResult("redact-error-like-keys");
    result.artifacts.diagnostic = {
      errorMessage: "raw user meal text should not persist",
      errorStack: "Error: raw provider body should not persist\n    at internal",
      providerErrorMessage: "assistant final answer should not persist",
    };

    await writeScenarioArtifacts("redact-error-like-keys", result);

    for (const fileName of ["snapshots.json", "scenario-result.json"]) {
      const raw = readArtifact(tmpDir, "redact-error-like-keys", fileName);
      const parsed = JSON.parse(raw) as {
        diagnostic?: {
          errorMessage?: string;
          errorStack?: string;
          providerErrorMessage?: string;
        };
        artifacts?: {
          diagnostic?: {
            errorMessage?: string;
            errorStack?: string;
            providerErrorMessage?: string;
          };
        };
      };
      const diagnostic = parsed.diagnostic ?? parsed.artifacts?.diagnostic;
      assert.equal(diagnostic?.errorMessage, "[REDACTED]");
      assert.equal(diagnostic?.errorStack, "[REDACTED]");
      assert.equal(diagnostic?.providerErrorMessage, "[REDACTED]");
      assert.doesNotMatch(raw, /raw user meal text should not persist|raw provider body should not persist|assistant final answer should not persist/);
    }
  });

  test("camelCase device id evidence keys are redacted across all artifact files", async () => {
    const result = makeFailResult("redact-camel-device-ids");
    result.steps[0]!.actual = {
      ownerDeviceId: "owner-device-id-123",
      foreignDeviceId: "foreign-device-id-456",
    };
    await writeScenarioArtifacts("redact-camel-device-ids", result);

    const latestDir = path.join(tmpDir, "redact-camel-device-ids", "latest");
    for (const fileName of ["steps.json", "snapshots.json", "scenario-result.json"]) {
      const raw = fs.readFileSync(path.join(latestDir, fileName), "utf-8");
      assert.doesNotMatch(raw, /owner-device-id-123/, `${fileName} must redact ownerDeviceId`);
      assert.doesNotMatch(raw, /foreign-device-id-456/, `${fileName} must redact foreignDeviceId`);
      assert.match(raw, /\[REDACTED\]/, `${fileName} should include redaction placeholders`);
    }
  });

  test("snake case and kebab case device id evidence keys are redacted across all artifact files", async () => {
    const result = makeFailResult("redact-delimited-device-ids");
    result.steps[0]!.actual = {
      device_id: "snake-device-id-123",
      owner_device_id: "owner-snake-device-id-456",
      "foreign-device-id": "foreign-kebab-device-id-789",
    };
    result.artifacts.delimitedEvidence = {
      device_id: "snake-device-id-123",
      owner_device_id: "owner-snake-device-id-456",
      "foreign-device-id": "foreign-kebab-device-id-789",
    };
    await writeScenarioArtifacts("redact-delimited-device-ids", result);

    const latestDir = path.join(tmpDir, "redact-delimited-device-ids", "latest");
    for (const fileName of ["steps.json", "snapshots.json", "scenario-result.json"]) {
      const raw = fs.readFileSync(path.join(latestDir, fileName), "utf-8");
      assert.doesNotMatch(raw, /snake-device-id-123/, `${fileName} must redact device_id`);
      assert.doesNotMatch(raw, /owner-snake-device-id-456/, `${fileName} must redact owner_device_id`);
      assert.doesNotMatch(raw, /foreign-kebab-device-id-789/, `${fileName} must redact foreign-device-id`);
      assert.match(raw, /\[REDACTED\]/, `${fileName} should include redaction placeholders`);
    }
  });

  test("persisted artifacts redact TRACE-04 forbidden probe strings across trace and evidence files", async () => {
    const result = makeFailResult("trace-redaction-forbidden-strings") as ScenarioResult & {
      llmTrace?: Record<string, unknown>;
    };
    result.steps[0]!.actual = {
      rawUserMessage: "raw user meal text should not persist",
      uploadStagingPath: "/var/folders/tmp/upload-staging/photo.png",
      imageDataUri: "data:image/png;base64,abc123",
      authorization: "Bearer step-secret-token",
      cookie: "guestSession=step-session-secret",
      providerPayload: { rawPrompt: "raw prompt text should not persist" },
      toolArguments: { food: "raw tool args should not persist" },
      finalAssistantContent: "assistant final answer should not persist",
    };
    result.steps[1]!.error =
      "Assertion failed with raw user meal text should not persist and assistant final answer should not persist";
    result.artifacts.forbiddenEvidence = {
      deviceId: "secret-device-id-xyz",
      userMealText: "raw user meal text should not persist",
      uploadPath: "/absolute/path/to/server/uploads/photo.jpg",
      imageBase64: "abc123base64image",
      apiKey: "sk-test-secret",
      setCookie: "guestSession=artifact-session-secret",
      messages: [{ role: "user", content: "raw prompt text should not persist" }],
      rawToolResult: { reply: "raw tool result should not persist" },
      assistantContent: "assistant final answer should not persist",
      streamFrames: [{ event: "chunk", data: "raw user meal text should not persist" }],
      historySnapshot: [{ role: "assistant", content: "assistant final answer should not persist" }],
      fallbackContent: "assistant final answer should not persist",
    };
    result.llmTrace = {
      summary: {
        prompt: { version: "system-prompt.test", sectionIds: ["role", "log-food-receipt"] },
        finalReply: { source: "orchestrator_projected_reply", shape: "plain_text" },
        rawPrompt: "raw prompt text should not persist",
        OPENAI_API_KEY: "sk-test-secret",
      },
      timeline: [
        {
          tool: "log_food",
          success: true,
          executed: true,
          source: "hook",
          shape: "tool_result",
          arguments: { food: "raw tool args should not persist" },
          toolResult: { reply: "raw tool result should not persist" },
        },
      ],
      finalAnswer: "assistant final answer should not persist",
    };

    await writeScenarioArtifacts("trace-redaction-forbidden-strings", result);

    const forbiddenPatterns = [
      /secret-device-id-xyz/,
      /raw user meal text should not persist/,
      /\/absolute\/path\/to\/server\/uploads/,
      /\/upload-staging\/photo\.png/,
      /data:image\/png;base64/,
      /abc123base64image/,
      /Bearer step-secret-token/,
      /sk-test-secret/,
      /guestSession=step-session-secret/,
      /artifact-session-secret/,
      /raw prompt text should not persist/,
      /raw tool args should not persist/,
      /raw tool result should not persist/,
      /assistant final answer should not persist/,
    ];

    for (const fileName of ["llm-trace.json", "snapshots.json", "steps.json", "scenario-result.json"]) {
      const raw = readArtifact(tmpDir, "trace-redaction-forbidden-strings", fileName);
      for (const pattern of forbiddenPatterns) {
        assert.doesNotMatch(raw, pattern, `${fileName} must redact ${pattern}`);
      }
    }
  });

  test("persisted llm-trace.json removes forbidden raw payload keys but preserves allowed trace metadata", async () => {
    const result = makePassResult("trace-redaction-forbidden-keys") as ScenarioResult & {
      llmTrace?: Record<string, unknown>;
    };
    result.llmTrace = {
      summary: {
        prompt: { version: "system-prompt.test", sectionIds: ["role", "daily-targets"] },
        finalReply: { source: "stream", shape: "streamed_text" },
        promptText: "raw prompt text should not persist",
        providerPayload: { secret: true },
        api_key: "sk-test-secret",
      },
      timeline: [
        {
          tool: "log_food",
          success: true,
          executed: true,
          source: "orchestrator",
          shape: "tool_result",
          rawArguments: { food: "raw tool args should not persist" },
          rawToolResult: { reply: "raw tool result should not persist" },
          finalAssistantContent: "assistant final answer should not persist",
        },
      ],
      messages: [{ role: "user", content: "raw prompt text should not persist" }],
      assistantContent: "assistant final answer should not persist",
    };

    await writeScenarioArtifacts("trace-redaction-forbidden-keys", result);

    const raw = readArtifact(tmpDir, "trace-redaction-forbidden-keys", "llm-trace.json");
    const trace = JSON.parse(raw) as {
      summary: {
        prompt: { version: string; sectionIds: string[] };
        finalReply: { source: string; shape: string };
      };
      timeline: Array<{ tool: string; success: boolean; executed: boolean; source: string; shape: string }>;
    };

    assert.equal(trace.summary.prompt.version, "system-prompt.test");
    assert.deepEqual(trace.summary.prompt.sectionIds, ["role", "daily-targets"]);
    assert.equal(trace.summary.finalReply.source, "stream");
    assert.equal(trace.summary.finalReply.shape, "streamed_text");
    assert.deepEqual(trace.timeline[0], {
      tool: "log_food",
      success: true,
      executed: true,
      source: "orchestrator",
      shape: "tool_result",
    });
    assert.doesNotMatch(
      raw,
      /apiKey|api_key|OPENAI_API_KEY|cookie|set-cookie|guestSession|sessionToken|bearer|messages|rawMessages|rawPrompt|promptText|providerPayload|rawProviderPayload|arguments|rawArguments|toolArguments|toolResult|rawToolResult|finalAnswer|assistantContent|finalAssistantContent/,
    );
  });

  test("persisted llm-trace.json preserves provider metadata while removing raw provider payload material", async () => {
    const result = makePassResult("trace-provider-metadata-redaction") as ScenarioResult & {
      llmTrace?: Record<string, unknown>;
    };
    result.llmTrace = {
      schemaVersion: "llm-trace.v2",
      scenario: "trace-provider-metadata-redaction",
      status: "pass",
      summary: {
        roundCount: 1,
        toolCount: 0,
        fallbackCount: 1,
        providerErrorCount: 1,
        prompt: { version: "system-prompt.test", sectionIds: ["role"] },
        finalReply: { source: "fallback", shape: "fallback_text" },
      },
      timeline: [
        {
          type: "llm_error",
          round: 1,
          providerMetadata: {
            provider: "openai",
            operation: "chat_round_initial",
            model: "gpt-test",
            aborted: false,
            status: 429,
            providerRequestId: "req_safe_123",
            errorName: "RateLimitError",
            errorType: "rate_limit_error",
            errorCode: "rate_limit_exceeded",
            providerPayload: { raw: "raw provider body should not persist" },
            headers: { authorization: "Bearer provider-token" },
            body: "raw provider body should not persist",
            messages: [{ role: "user", content: "raw user text should not persist" }],
            tools: [{ function: { name: "log_food" } }],
            promptText: "raw prompt text should not persist",
            rawUserMessage: "raw user text should not persist",
            rawToolResult: { reply: "raw tool result should not persist" },
            finalAssistantContent: "assistant final answer should not persist",
          },
        },
      ],
    };

    await writeScenarioArtifacts("trace-provider-metadata-redaction", result);

    const raw = readArtifact(tmpDir, "trace-provider-metadata-redaction", "llm-trace.json");
    const trace = JSON.parse(raw) as {
      summary: {
        providerErrorCount: number;
      };
      timeline: Array<{
        providerMetadata?: Record<string, unknown>;
      }>;
    };

    assert.equal(trace.summary.providerErrorCount, 1);
    assert.deepEqual(trace.timeline[0]!.providerMetadata, {
      provider: "openai",
      operation: "chat_round_initial",
      model: "gpt-test",
      aborted: false,
      status: 429,
      providerRequestId: "req_safe_123",
      errorName: "RateLimitError",
      errorType: "rate_limit_error",
      errorCode: "rate_limit_exceeded",
    });
    assert.doesNotMatch(
      raw,
      /providerPayload|headers|body|messages|tools|promptText|rawUserMessage|rawToolResult|finalAssistantContent|raw provider body should not persist|Bearer provider-token|raw prompt text should not persist|raw user text should not persist|raw tool result should not persist|assistant final answer should not persist/,
    );
  });

  test("structured SSE terminal proof metadata persists while raw SSE transcript keys are omitted", async () => {
    const result = makePassResult("sse-terminal-proof-redaction") as ScenarioResult & {
      llmTrace?: Record<string, unknown>;
    };
    result.steps[0]!.actual = {
      terminalProof: {
        closed: true,
        firstDoneObserved: true,
        firstDoneIndex: 2,
        noPostDoneChunkOrStatus: true,
        terminalViolationEvents: [],
        rawLength: 123,
      },
      rawSSE: "event: chunk\ndata: {\"token\":\"secret step token\"}\n\n",
      rawSse: "event: status\ndata: secret status text\n\n",
      sseTranscript: "event: chunk\ndata: secret transcript text\n\n",
      streamFrames: [{ event: "chunk", data: "secret frame text" }],
      token: "secret token text",
    };
    result.artifacts = {
      terminalProof: {
        closed: true,
        firstDoneObserved: true,
        firstDoneIndex: 2,
        noPostDoneChunkOrStatus: true,
        postDoneEventNames: [],
        terminalViolationEvents: [],
        nonEmptyChunkBeforeDone: true,
        readCount: 4,
        rawLength: 456,
      },
      rawSSE: "event: chunk\ndata: {\"token\":\"secret artifact token\"}\n\n",
      rawSse: "event: status\ndata: secret artifact status\n\n",
      sseTranscript: "event: chunk\ndata: secret artifact transcript\n\n",
      streamFrames: [{ event: "chunk", data: "secret artifact frame" }],
      token: "secret artifact token text",
    };
    result.llmTrace = {
      summary: {
        terminalProof: {
          closed: true,
          firstDoneObserved: true,
          firstDoneIndex: 2,
          noPostDoneChunkOrStatus: true,
          terminalViolationEvents: [],
          rawLength: 789,
        },
        rawSSE: "event: chunk\ndata: {\"token\":\"secret trace token\"}\n\n",
      },
      timeline: [
        {
          type: "sse_terminal_proof",
          terminalProof: {
            closed: true,
            firstDoneObserved: true,
            firstDoneIndex: 2,
            noPostDoneChunkOrStatus: true,
            terminalViolationEvents: [],
            rawLength: 789,
          },
          rawSse: "event: status\ndata: secret trace status\n\n",
          streamFrames: [{ event: "chunk", data: "secret trace frame" }],
          token: "secret trace token text",
        },
      ],
    };

    await writeScenarioArtifacts("sse-terminal-proof-redaction", result);

    const snapshotsRaw = readArtifact(tmpDir, "sse-terminal-proof-redaction", "snapshots.json");
    const snapshots = JSON.parse(snapshotsRaw) as {
      terminalProof: {
        closed: boolean;
        firstDoneObserved: boolean;
        firstDoneIndex: number;
        noPostDoneChunkOrStatus: boolean;
        terminalViolationEvents: string[];
        rawLength: number;
      };
    };
    assert.deepEqual(snapshots.terminalProof, {
      closed: true,
      firstDoneObserved: true,
      firstDoneIndex: 2,
      noPostDoneChunkOrStatus: true,
      postDoneEventNames: [],
      terminalViolationEvents: [],
      nonEmptyChunkBeforeDone: true,
      readCount: 4,
      rawLength: 456,
    });

    for (const fileName of ["summary.json", "steps.json", "snapshots.json", "scenario-result.json", "llm-trace.json"]) {
      const raw = readArtifact(tmpDir, "sse-terminal-proof-redaction", fileName);
      assert.doesNotMatch(raw, /rawSSE|rawSse|sseTranscript|streamFrames|token/);
      assert.doesNotMatch(
        raw,
        /event: chunk|event: status|secret step token|secret status text|secret transcript text|secret frame text|secret token text|secret artifact token|secret artifact status|secret artifact transcript|secret artifact frame|secret artifact token text|secret trace token|secret trace status|secret trace frame|secret trace token text/,
      );
    }
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
    ) as { consoleSummary: string; ok: boolean; failedStep?: string };

    // latest/ must reflect the most recent run
    assert.equal(summary.ok, false);
    assert.equal(summary.failedStep, "verify-meal-persisted");
    assert.equal(summary.consoleSummary, "FAIL repeated-run verify-meal-persisted");
  });

  test("writeScenarioArtifacts rejects scenario paths that escape the artifact root", async () => {
    const outsideDir = path.join(tmpDir, "outside");
    fs.mkdirSync(outsideDir, { recursive: true });
    const sentinel = path.join(outsideDir, "sentinel.txt");
    fs.writeFileSync(sentinel, "do not delete", "utf-8");

    await assert.rejects(
      writeScenarioArtifacts("../outside", makePassResult("escape")),
      /Invalid scenario name/,
    );

    assert.equal(fs.readFileSync(sentinel, "utf-8"), "do not delete");
  });
});
