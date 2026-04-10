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

test("text-log scenario artifacts include dailySummary with mealCount 1", async () => {
  const result = await runScenarioByName("text-log");
  assert.equal(result.ok, true, `Scenario failed at step: ${result.failedStep ?? "unknown"}`);

  const dailySummary = result.artifacts.dailySummary as {
    mealCount: number;
    totalCalories: number;
  } | undefined;

  assert.ok(dailySummary, "Expected artifacts.dailySummary to be present");
  assert.equal(
    dailySummary.mealCount,
    1,
    `Expected dailySummary.mealCount === 1, got ${dailySummary.mealCount}`,
  );
});
