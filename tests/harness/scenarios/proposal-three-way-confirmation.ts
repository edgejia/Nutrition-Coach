/**
 * Deterministic proof for Phase 90 three-way proposal confirmation.
 *
 * Artifacts intentionally store metadata-only evidence: proposal kind/status
 * booleans, action visibility, mutation counts, and copy-presence predicates.
 * Raw prompts, cookies, provider payloads, transcripts, image bytes, ids in
 * evidence payloads, and full DB snapshots must not be persisted.
 */

import { createScenarioApp } from "../app-fixture.js";
import type {
  VerificationScenario,
  ScenarioContext,
  ScenarioResult,
  ScenarioStepResult,
} from "../scenario-types.js";

const SCENARIO_NAME = "proposal-three-way-confirmation";
const STEP_NAMES = [
  "goal_card_approve_action",
  "meal_estimate_card_edit_context",
  "delete_card_reject_and_approve",
  "history_reload_recovers_actionability",
  "meal_lane_supersede_lapse_copy",
  "expiry_lapse_on_refresh",
  "stale_action_misses_without_mutation",
  "cross_session_action_rejected",
  "duplicate_action_noops",
  "metadata_only_artifact_guard",
] as const;

function pass(name: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: true, actual };
}

function fail(name: string, error: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: false, error, actual };
}

function failResult(
  steps: ScenarioStepResult[],
  failedStepName: string,
  artifacts: Record<string, unknown>,
): ScenarioResult {
  return {
    ok: false,
    failedStep: failedStepName,
    steps,
    artifacts,
    consoleSummary: `FAIL ${SCENARIO_NAME} ${failedStepName}`,
  };
}

const scenario: VerificationScenario = {
  name: SCENARIO_NAME,

  async run(_ctx: ScenarioContext): Promise<ScenarioResult> {
    const steps: ScenarioStepResult[] = [];
    const artifacts = { evidence: [] as unknown[] };
    const fixture = await createScenarioApp({});

    try {
      const step = STEP_NAMES[0];
      steps.push(fail(step, "RED: proposal confirmation harness not implemented yet"));
      return failResult(steps, step, artifacts);
    } finally {
      await fixture.close();
    }
  },
};

export default scenario;
