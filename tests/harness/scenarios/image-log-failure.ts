/**
 * Failure scenario scaffold for image logging - IMG-03.
 *
 * Sub-scenarios covered (implemented in Phase 5 Plan 03):
 *   A: Image analysis (chatRound) throws -> fallback in history, didLogMeal false, no meal
 *   B: log_food tool throws FatalToolError -> fallback in history, no meal
 *   C: log_food succeeds, final reply generation throws -> meal kept, partial-success fallback in history
 *
 * This file is a scaffold: run() returns ok: true with no steps so the scenario
 * can be discovered by runScenarioByName() before Plan 03 adds assertions.
 */
import type { VerificationScenario, ScenarioContext, ScenarioResult } from "../scenario-types.js";

const scenario: VerificationScenario = {
  name: "image-log-failure",

  async run(_ctx: ScenarioContext): Promise<ScenarioResult> {
    // Placeholder - full implementation added in Plan 03
    return {
      ok: true,
      failedStep: undefined,
      steps: [],
      artifacts: { note: "scaffold - assertions pending Plan 03" },
      consoleSummary: "SKIP image-log-failure (scaffold)",
    };
  },
};

export default scenario;
