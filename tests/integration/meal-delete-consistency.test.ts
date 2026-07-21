process.env.TZ = "Asia/Taipei";

import { test } from "node:test";
import assert from "node:assert/strict";
import { runScenarioByName } from "../harness/run.js";
import type { ScenarioResult } from "../harness/scenario-types.js";

const REQUIRED_STEPS = [
  "post_chat",
  "collect_stream",
  "delete_meal",
  "verify_summary_after_delete",
  "verify_meals_after_delete",
  "verify_history_image",
  "verify_asset_fetch",
] as const;

test("runScenarioByName(\"meal-delete-consistency\") succeeds", async () => {
  const result: ScenarioResult = await runScenarioByName("meal-delete-consistency");
  assert.equal(result.ok, true, result.consoleSummary);
  assert.deepEqual(result.artifacts, {});
  assert.equal(result.llmTrace, undefined);
  assert.ok(result.metadata);
});

test("meal-delete-consistency includes the required verification steps", async () => {
  const result: ScenarioResult = await runScenarioByName("meal-delete-consistency");
  const stepNames = result.steps.map((step) => step.name);

  for (const name of REQUIRED_STEPS) {
    assert.ok(
      stepNames.includes(name),
      `expected step \"${name}\" in ${JSON.stringify(stepNames)}`,
    );
  }
});

test("meal-delete-consistency metadata preserves delete and follow-up proofs", async () => {
  const result: ScenarioResult = await runScenarioByName("meal-delete-consistency");
  assert.equal(result.ok, true, result.consoleSummary);
  assert.ok(result.metadata);
  assert.equal(result.metadata.assertions?.mealPersistedBeforeDelete, true);
  assert.equal(result.metadata.assertions?.deleteRouteSucceeded, true);
  assert.equal(result.metadata.assertions?.deleteSummaryEmpty, true);
  assert.equal(result.metadata.assertions?.deletedMealAbsent, true);
  assert.equal(result.metadata.assertions?.deletedReceiptPreserved, true);
  assert.equal(result.metadata.assertions?.deletedReceiptImagePreserved, true);
  assert.equal(result.metadata.assertions?.historyImagePreserved, true);
  assert.equal(result.metadata.assertions?.assetFetchSucceeded, true);
  assert.equal(result.metadata.assertions?.followupExcludesDeletedFacts, true);
  assert.equal(result.metadata.assertions?.followupNonMutating, true);
  assert.equal(result.metadata.assertions?.followupSummaryEmpty, true);
  assert.equal(result.metadata.assertions?.artifactContractComplete, true);
  assert.equal(result.metadata.counts?.preDeleteMealCount, 1);
  assert.equal(result.metadata.counts?.postDeleteMealCount, 0);
  assert.ok((result.metadata.counts?.dailySummaryEventCount ?? 0) >= 3);
});
