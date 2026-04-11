/**
 * Integration test: deterministic image logging replay and upload cleanup.
 *
 * Covers VERI-02: automated proof that the image-log scenario passes,
 * records precise status evidence (分析圖片中..., 記錄餐點中...), and leaves
 * no upload residue under the scenario temp directory.
 */

process.env.TZ = "Asia/Taipei";

import { test } from "node:test";
import assert from "node:assert/strict";
import { runScenarioByName } from "../harness/run.js";
import type { ScenarioResult } from "../harness/scenario-types.js";

test("runScenarioByName(\"image-log\") succeeds", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log");
  assert.equal(result.ok, true, result.consoleSummary);
});

test("image-log steps include all required step names", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log");
  const stepNames = result.steps.map((s) => s.name);
  const required = ["post_chat", "collect_stream", "verify_history", "verify_meals", "cleanup_uploads"];
  for (const name of required) {
    assert.ok(stepNames.includes(name), `expected step "${name}" in ${JSON.stringify(stepNames)}`);
  }
});

test("image-log artifacts show both 分析圖片中 and 記錄餐點中 status labels", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log");
  const streamArtifact = result.artifacts.stream as {
    statusLabels?: string[];
  } | undefined;
  assert.ok(streamArtifact, "expected stream artifact");
  const labels: string[] = streamArtifact.statusLabels ?? [];
  assert.ok(
    labels.some((l) => l.includes("分析圖片中")),
    `expected 分析圖片中 in statusLabels: ${JSON.stringify(labels)}`,
  );
  assert.ok(
    labels.some((l) => l.includes("記錄餐點中")),
    `expected 記錄餐點中 in statusLabels: ${JSON.stringify(labels)}`,
  );
});

test("image-log artifacts prove D-12 status and persistence invariants", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log");
  const streamArtifact = result.artifacts.stream as {
    analysisIdx?: number;
    loggingIdx?: number;
    donePayload?: { didLogMeal?: boolean };
  } | undefined;
  const historyArtifact = result.artifacts.history as {
    d12_3_verified?: boolean;
  } | undefined;
  const mealsArtifact = result.artifacts.meals as {
    d12_2_verified?: boolean;
  } | undefined;

  assert.ok(streamArtifact, "expected stream artifact");
  assert.equal(streamArtifact.donePayload?.didLogMeal, true, "D-12.2: done.didLogMeal must be true");
  assert.ok(
    typeof streamArtifact.analysisIdx === "number" && streamArtifact.analysisIdx >= 0,
    `D-12.1: expected analysisIdx >= 0, got ${streamArtifact.analysisIdx}`,
  );
  assert.ok(
    typeof streamArtifact.loggingIdx === "number" && streamArtifact.loggingIdx >= 0,
    `D-12.1: expected loggingIdx >= 0, got ${streamArtifact.loggingIdx}`,
  );
  assert.ok(
    streamArtifact.analysisIdx < streamArtifact.loggingIdx,
    `D-12.1: expected analysisIdx < loggingIdx, got ${streamArtifact.analysisIdx} >= ${streamArtifact.loggingIdx}`,
  );
  assert.equal(mealsArtifact?.d12_2_verified, true, "D-12.2: matching meal must be present");
  assert.equal(historyArtifact?.d12_3_verified, true, "D-12.3: assistant history must exist after done");
});

test("image-log cleanup snapshot reports zero residual files", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log");
  const cleanup = result.artifacts.cleanup_uploads as {
    filesBeforeCleanup?: number;
    residualFiles?: number;
    directoryRemoved?: boolean;
  } | undefined;
  assert.ok(cleanup, "expected cleanup_uploads artifact");
  assert.equal(
    cleanup.residualFiles,
    0,
    `expected 0 residual files, got ${cleanup.residualFiles}`,
  );
  assert.equal(
    cleanup.directoryRemoved,
    true,
    "expected directoryRemoved: true in cleanup evidence",
  );
});
