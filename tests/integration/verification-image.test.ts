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

interface ImageAssetDto {
  imagePath?: string | null;
  imageAssetId?: string | null;
  imageUrl?: string | null;
}

test("runScenarioByName(\"image-log\") succeeds", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log");
  assert.equal(result.ok, true, result.consoleSummary);
});

test("image-log steps include all required step names", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log");
  const stepNames = result.steps.map((s) => s.name);
  const required = ["post_chat", "collect_stream", "verify_history", "verify_meals", "verify_asset_fetch", "cleanup_uploads"];
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
    messages?: Array<{ role: string } & ImageAssetDto>;
  } | undefined;
  const mealsArtifact = result.artifacts.meals as {
    d12_2_verified?: boolean;
    meals?: Array<{ foodName: string } & ImageAssetDto>;
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

test("image-log artifacts expose durable asset refs and block legacy raw upload paths", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log");
  const historyArtifact = result.artifacts.history as {
    messages?: Array<{ role: string } & ImageAssetDto>;
    persistedMessages?: Array<{ role: string; imagePath?: string | null }>;
  } | undefined;
  const mealsArtifact = result.artifacts.meals as {
    meals?: Array<{ foodName: string } & ImageAssetDto>;
    persistedMeals?: Array<{ foodName: string; imagePath?: string | null }>;
  } | undefined;
  const assetFetch = result.artifacts.asset_fetch as {
    assetUrl?: string;
    status?: number;
    contentType?: string | null;
  } | undefined;

  const dtoRows = [
    ...(historyArtifact?.messages ?? []),
    ...(mealsArtifact?.meals ?? []),
  ].filter((row) => typeof row.imagePath === "string");
  const persistedRows = [
    ...(historyArtifact?.persistedMessages ?? []),
    ...(mealsArtifact?.persistedMeals ?? []),
  ].filter((row) => typeof row.imagePath === "string");

  const rawPaths = persistedRows
    .map((row) => row.imagePath ?? "")
    .filter((imagePath) => /\/uploads\//.test(imagePath));
  assert.equal(
    rawPaths.length,
    0,
    `Legacy raw upload paths remain; backfill or clear them before beta sign-off. Found: ${JSON.stringify(rawPaths)}`,
  );

  for (const row of dtoRows) {
    assert.match(row.imagePath ?? "", /^asset:/, `expected durable asset ref for ${JSON.stringify(row)}`);
    assert.ok(row.imageAssetId, `expected imageAssetId for ${JSON.stringify(row)}`);
    assert.equal(
      row.imageUrl,
      `/api/assets/${row.imageAssetId}`,
      `expected imageUrl to derive from asset id for ${JSON.stringify(row)}`,
    );
  }

  for (const row of persistedRows) {
    assert.match(row.imagePath ?? "", /^asset:/, `expected persisted durable asset ref for ${JSON.stringify(row)}`);
  }

  assert.ok(assetFetch, "expected asset_fetch artifact");
  assert.equal(assetFetch.status, 200, "expected verify_asset_fetch to return 200");
  assert.equal(assetFetch.contentType, "image/jpeg", "expected fetched asset to preserve its mime type");
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

test("runScenarioByName(\"image-log-failure\") succeeds with all three sub-scenarios", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log-failure");
  assert.equal(result.ok, true, result.consoleSummary);
});

test("image-log-failure artifacts show sub_a_analysis_fail evidence", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log-failure");
  assert.ok(result.artifacts.sub_a_analysis_fail, "expected sub_a_analysis_fail artifact");
});

test("image-log-failure artifacts show sub_c_reply_fail with mealKept true", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log-failure");
  const subC = result.artifacts.sub_c_reply_fail as {
    donePayload?: { didLogMeal?: boolean; dailySummary?: unknown };
    fallbackContent?: string;
    mealKept?: boolean;
  } | undefined;
  assert.ok(subC, "expected sub_c_reply_fail artifact");
  assert.equal(subC.donePayload?.didLogMeal, true, "D-09: done.didLogMeal must remain true");
  assert.ok(subC.donePayload?.dailySummary, "D-09: dailySummary must be preserved");
  assert.match(subC.fallbackContent ?? "", /已記錄測試餐點C/);
  assert.match(subC.fallbackContent ?? "", /蛋白質 0 g/);
  assert.equal(subC.mealKept, true, "D-09: meal must be kept when log_food succeeded before reply failed");
});
