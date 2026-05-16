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
    replyText?: string;
    donePayload?: {
      didLogMeal?: boolean;
      loggedMeal?: {
        mealId?: string;
        foodName?: string;
        itemCount?: number;
        calories?: number;
        protein?: number;
        carbs?: number;
        fat?: number;
        items?: Array<{ name?: string; position?: number }>;
      };
    };
    loggedMealReceiptVerified?: boolean;
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
  assert.ok((streamArtifact.replyText ?? "").trim().length > 0, "expected non-empty assembled chunk text");
  assert.equal(streamArtifact.loggedMealReceiptVerified, true, "expected stream artifact to verify loggedMeal receipt shape");
  assert.match(streamArtifact.donePayload?.loggedMeal?.mealId ?? "", /^[0-9a-f-]{36}$/);
  assert.equal(streamArtifact.donePayload?.loggedMeal?.foodName, "豬肉燒烤飯盒");
  assert.ok((streamArtifact.donePayload?.loggedMeal?.itemCount ?? 0) > 0);
  for (const field of ["calories", "protein", "carbs", "fat"] as const) {
    assert.equal(Number.isFinite(streamArtifact.donePayload?.loggedMeal?.[field]), true, `expected finite ${field}`);
  }
  for (const item of streamArtifact.donePayload?.loggedMeal?.items ?? []) {
    assert.ok((item.name ?? "").trim().length > 0, `expected non-empty item name for ${JSON.stringify(item)}`);
    assert.equal(Number.isFinite(item.position), true, `expected finite item position for ${JSON.stringify(item)}`);
  }
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
  const subA = result.artifacts.sub_a_analysis_fail as {
    liveChunkEvidence?: {
      nonEmptyChunkBeforeDone?: boolean;
      nonEmptyChunkCount?: number;
    };
    falseLogChunkClaim?: boolean;
    liveChunkTextLength?: number;
  } | undefined;
  assert.ok(subA, "expected sub_a_analysis_fail artifact");
  assert.equal("liveChunkText" in subA, false, "raw live chunk text must not be persisted");
  assert.equal(subA.liveChunkEvidence?.nonEmptyChunkBeforeDone, true, "expected structured live chunk evidence");
  assert.ok((subA.liveChunkEvidence?.nonEmptyChunkCount ?? 0) > 0, "expected non-empty chunk count evidence");
  assert.ok((subA.liveChunkTextLength ?? 0) > 0, "expected chunk length evidence");
  assert.equal(subA.falseLogChunkClaim, false, "failed/no-mutation chunks must not claim logging");
});

test("image-log-failure artifacts show sub_b_tool_fail chunk evidence", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log-failure");
  const subB = result.artifacts.sub_b_tool_fail as {
    liveChunkEvidence?: {
      nonEmptyChunkBeforeDone?: boolean;
      nonEmptyChunkCount?: number;
    };
    falseLogChunkClaim?: boolean;
    liveChunkTextLength?: number;
  } | undefined;
  assert.ok(subB, "expected sub_b_tool_fail artifact");
  assert.equal("liveChunkText" in subB, false, "raw live chunk text must not be persisted");
  assert.equal(subB.liveChunkEvidence?.nonEmptyChunkBeforeDone, true, "expected structured live chunk evidence");
  assert.ok((subB.liveChunkEvidence?.nonEmptyChunkCount ?? 0) > 0, "expected non-empty chunk count evidence");
  assert.ok((subB.liveChunkTextLength ?? 0) > 0, "expected chunk length evidence");
  assert.equal(subB.falseLogChunkClaim, false, "failed/no-mutation chunks must not claim logging");
});

test("image-log-failure artifacts show sub_c_reply_fail with mealKept true", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log-failure");
  const subC = result.artifacts.sub_c_reply_fail as {
    donePayload?: { didLogMeal?: boolean; dailySummary?: unknown };
    fallbackContent?: string;
    projectedReplyMatched?: boolean;
    projectedReplyTextLength?: number;
    mealKept?: boolean;
  } | undefined;
  assert.ok(subC, "expected sub_c_reply_fail artifact");
  assert.equal(subC.donePayload?.didLogMeal, true, "D-09: done.didLogMeal must remain true");
  assert.ok(subC.donePayload?.dailySummary, "D-09: dailySummary must be preserved");
  assert.equal("fallbackContent" in subC, false, "raw fallback content must not be persisted");
  assert.equal(subC.projectedReplyMatched, true, "expected projected reply evidence");
  assert.ok((subC.projectedReplyTextLength ?? 0) > 0, "expected projected reply length evidence");
  assert.equal(subC.mealKept, true, "D-09: meal must be kept when log_food succeeded before reply failed");
});
