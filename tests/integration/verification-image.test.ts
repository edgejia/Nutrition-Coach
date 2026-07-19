/**
 * Integration test: deterministic image logging replay and upload cleanup.
 *
 * Covers VERI-02 with positive metadata-only scenario results. Runtime
 * assertions remain inside the harness scenario; this file checks the safe
 * counts, assertions, and trace fields exposed by the migrated result.
 */

process.env.TZ = "Asia/Taipei";

import { test } from "node:test";
import assert from "node:assert/strict";
import { runScenarioByName } from "../harness/run.js";
import type { ScenarioResult } from "../harness/scenario-types.js";

function assertPositiveResult(result: ScenarioResult): void {
  assert.ok(result.metadata, "expected positive scenario metadata");
  assert.deepEqual(result.artifacts, {}, "migrated result must not expose arbitrary artifacts");
  assert.equal(result.llmTrace, undefined, "migrated result must not expose llmTrace");
}

test("runScenarioByName(\"image-log\") succeeds", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log");
  assert.equal(result.ok, true, result.consoleSummary);
  assertPositiveResult(result);
});

test("image-log steps include all required step names", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log");
  const stepNames = result.steps.map((s) => s.name);
  const required = ["post_chat", "collect_stream", "verify_history", "verify_meals", "verify_asset_fetch", "cleanup_uploads"];
  for (const name of required) {
    assert.ok(stepNames.includes(name), `expected step "${name}" in ${JSON.stringify(stepNames)}`);
  }
});

test("image-log metadata preserves both status-label assertions", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log");
  assertPositiveResult(result);
  assert.equal(result.metadata?.assertions?.analysisStatusSeen, true);
  assert.equal(result.metadata?.assertions?.loggingStatusSeen, true);
  assert.equal(result.metadata?.assertions?.analysisBeforeLogging, true);
});

test("image-log metadata proves D-12 status and persistence invariants", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log");
  assert.equal(result.ok, true, `Scenario failed at step: ${result.failedStep ?? "unknown"}`);
  assertPositiveResult(result);
  assert.equal(result.metadata?.assertions?.streamDidLogMeal, true, "D-12.2: done.didLogMeal must be true");
  assert.equal(result.metadata?.assertions?.replyTextNonEmpty, true, "expected non-empty assembled chunk text");
  assert.equal(result.metadata?.assertions?.loggedMealReceiptVerified, true);
  assert.equal(result.metadata?.assertions?.mealPersistenceVerified, true, "D-12.2: matching meal must be present");
  assert.equal(result.metadata?.assertions?.historyPersistenceVerified, true, "D-12.3: assistant history must exist after done");
  assert.ok((result.metadata?.counts?.loggedMealItemCount ?? 0) > 0);
  assert.ok((result.metadata?.counts?.analysisStatusIndex ?? 0) < (result.metadata?.counts?.loggingStatusIndex ?? 0));
  assert.ok((result.metadata?.counts?.loggingStatusIndex ?? 0) > 0);
});

test("image-log metadata exposes durable asset refs and blocks legacy raw upload paths", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log");
  assertPositiveResult(result);
  assert.equal(result.metadata?.assertions?.durableAssetRefsVerified, true);
  assert.equal(result.metadata?.assertions?.assetFetchSucceeded, true);
});

test("image-log cleanup metadata reports zero residual files", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log");
  assertPositiveResult(result);
  assert.equal(result.metadata?.assertions?.cleanupResidualFilesZero, true);
  assert.equal(result.metadata?.assertions?.cleanupDirectoryRemoved, true);
  assert.equal(result.metadata?.counts?.residualFiles, 0);
});

test("runScenarioByName(\"image-log-failure\") succeeds with all three sub-scenarios", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log-failure");
  assert.equal(result.ok, true, result.consoleSummary);
  assertPositiveResult(result);
});

test("image-log-failure metadata shows sub_a_analysis_fail evidence", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log-failure");
  assertPositiveResult(result);
  assert.equal(result.metadata?.assertions?.subAChunkBeforeDone, true);
  assert.equal(result.metadata?.assertions?.subAFalseLogChunkClaim, true);
  assert.equal(result.metadata?.assertions?.subAFallbackFriendly, true);
  assert.equal(result.metadata?.assertions?.subANoMeal, true);
  assert.ok((result.metadata?.counts?.subAChunkCount ?? 0) > 0);
});

test("image-log-failure metadata shows sub_b_tool_fail chunk evidence", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log-failure");
  assertPositiveResult(result);
  assert.equal(result.metadata?.assertions?.subBChunkBeforeDone, true);
  assert.equal(result.metadata?.assertions?.subBFalseLogChunkClaim, true);
  assert.equal(result.metadata?.assertions?.subBFallbackUnified, true);
  assert.equal(result.metadata?.assertions?.subBNoMeal, true);
  assert.ok((result.metadata?.counts?.subBChunkCount ?? 0) > 0);
});

test("image-log-failure metadata shows sub_c_reply_fail with mealKept true", async () => {
  const result: ScenarioResult = await runScenarioByName("image-log-failure");
  assertPositiveResult(result);
  assert.equal(result.metadata?.assertions?.subCDidLogMeal, true, "D-09: done.didLogMeal must remain true");
  assert.equal(result.metadata?.assertions?.subCDailySummaryPreserved, true, "D-09: dailySummary must be preserved");
  assert.equal(result.metadata?.assertions?.subCProjectedReplyMatched, true);
  assert.ok((result.metadata?.counts?.subCReplyTextLength ?? 0) > 0);
  assert.equal(result.metadata?.assertions?.subCMealKept, true, "D-09: meal must be kept when log_food succeeded before reply failed");
});
