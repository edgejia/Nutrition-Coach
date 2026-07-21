/**
 * Integration coverage for the text-log scenario contract.
 *
 * Proves VERI-01: the text logging flow is deterministically replayable through
 * the real /api/chat and /api/sse route boundary with step-local failure evidence.
 *
 * Run via:
 *   node --import tsx --test tests/integration/verification-text.test.ts
 *   yarn test:integration  (included automatically by the existing glob)
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { runScenarioByName } from "../harness/run.js";

test("text-log scenario passes end to end", async () => {
  const result = await runScenarioByName("text-log");
  assert.equal(result.ok, true, `Scenario failed at step: ${result.failedStep ?? "unknown"}`);
});

test("text-log scenario step sequence includes all required route assertions", async () => {
  const result = await runScenarioByName("text-log");
  const stepNames = result.steps.map((s) => s.name);

  assert.ok(
    stepNames.includes("post_chat"),
    `Expected step "post_chat" in [${stepNames.join(", ")}]`,
  );
  assert.ok(
    stepNames.includes("collect_stream"),
    `Expected step "collect_stream" in [${stepNames.join(", ")}]`,
  );
  assert.ok(
    stepNames.includes("verify_history"),
    `Expected step "verify_history" in [${stepNames.join(", ")}]`,
  );
  assert.ok(
    stepNames.includes("verify_meals"),
    `Expected step "verify_meals" in [${stepNames.join(", ")}]`,
  );
  assert.ok(
    stepNames.includes("verify_summary"),
    `Expected step "verify_summary" in [${stepNames.join(", ")}]`,
  );
});

test("text-log scenario metadata preserves the daily summary proof", async () => {
  const result = await runScenarioByName("text-log");
  assert.equal(result.ok, true, `Scenario failed at step: ${result.failedStep ?? "unknown"}`);

  assert.deepEqual(result.artifacts, {}, "migrated result must not expose arbitrary artifacts");
  assert.equal(result.llmTrace, undefined, "migrated result must not expose llmTrace");
  assert.ok(result.metadata, "Expected positive scenario metadata");
  assert.equal(
    result.metadata.assertions?.dailySummaryMealCountIsOne,
    true,
    "Expected metadata to preserve dailySummary.mealCount === 1",
  );
  assert.equal(result.metadata.counts?.dailySummaryMealCount, 1);
  assert.equal(result.metadata.assertions?.historyReceiptVerified, true);
  assert.equal(result.metadata.assertions?.mealCaloriesVerified, true);
  assert.equal(result.metadata.trace?.counts.llmToolCount, 1);
});
