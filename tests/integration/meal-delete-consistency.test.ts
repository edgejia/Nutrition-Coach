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
