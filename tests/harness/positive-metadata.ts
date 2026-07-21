import type {
  ScenarioErrorCategory,
  ScenarioMetadata,
  ScenarioResult,
  ScenarioStepResult,
} from "./scenario-types.js";

interface PositiveScenarioOptions {
  counts?: Record<string, number>;
  assertions?: Record<string, boolean | number>;
  trace?: NonNullable<ScenarioMetadata["trace"]>;
  errorCategory?: ScenarioErrorCategory;
}

export function buildPositiveScenarioMetadata(
  scenarioName: string,
  status: "pass" | "fail",
  steps: ScenarioStepResult[],
  options: PositiveScenarioOptions = {},
): ScenarioMetadata {
  return {
    scenarioId: scenarioName,
    scenarioName,
    status,
    counts: {
      stepCount: steps.length,
      passedStepCount: steps.filter((step) => step.ok).length,
      ...options.counts,
    },
    assertions: {
      metadataOnly: true,
      rawEvidenceExcluded: true,
      ...options.assertions,
    },
    ...(options.trace === undefined ? {} : { trace: options.trace }),
    ...(status === "fail"
      ? { errorCategory: options.errorCategory ?? "assertion_failed" }
      : {}),
  };
}

export function buildPositiveScenarioResult(
  scenarioName: string,
  ok: boolean,
  steps: ScenarioStepResult[],
  failedStep: string | undefined,
  options: PositiveScenarioOptions = {},
): ScenarioResult {
  const safeSteps = steps.map((step) => ({
    name: step.name,
    ok: step.ok,
    ...(step.errorCategory === undefined ? {} : { errorCategory: step.errorCategory }),
  }));
  return {
    ok,
    ...(failedStep === undefined ? {} : { failedStep }),
    steps: safeSteps,
    artifacts: {},
    metadata: buildPositiveScenarioMetadata(scenarioName, ok ? "pass" : "fail", safeSteps, options),
    consoleSummary: ok
      ? `PASS ${scenarioName} ${safeSteps.filter((step) => step.ok).length}/${safeSteps.length}`
      : `FAIL ${scenarioName} ${failedStep ?? "unknown"}`,
  };
}
