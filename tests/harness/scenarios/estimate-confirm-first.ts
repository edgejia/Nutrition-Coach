import type {
  VerificationScenario,
  ScenarioContext,
  ScenarioResult,
  ScenarioStepResult,
} from "../scenario-types.js";

const SCENARIO_NAME = "estimate-confirm-first";
const STEP_NAMES = [
  "estimate_proposal_created_without_mutation",
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
    const steps = [
      fail(STEP_NAMES[0], "RED: estimate confirm-first scenario is not implemented yet"),
    ];
    return failResult(steps, STEP_NAMES[0], {});
  },
};

export default scenario;
