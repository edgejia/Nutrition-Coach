/**
 * Deterministic proof for the delete confirm-first lifecycle.
 *
 * Artifacts intentionally store metadata-only evidence: policy fact summaries,
 * narrow DB/publish invariants, proposal booleans, and visible outcome
 * predicates. Raw prompts, tool arguments, cookies, ids, transcripts, and DB
 * snapshots must not be persisted.
 */

import type {
  VerificationScenario,
  ScenarioContext,
  ScenarioResult,
  ScenarioStepResult,
} from "../scenario-types.js";

const SCENARIO_NAME = "delete-confirm-first";
const STEP_NAMES = [
  "delete_proposal_created_without_mutation",
  "delete_confirmation_deletes_previewed_meal_once",
] as const;

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
    const artifacts = { evidence: [] as unknown[] };
    const failedStep = STEP_NAMES[0];
    return failResult(
      [fail(failedStep, "delete confirm-first positive lifecycle proof not implemented")],
      failedStep,
      artifacts,
    );
  },
};

export default scenario;
