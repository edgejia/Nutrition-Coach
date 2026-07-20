import type {
  ScenarioResult,
  ScenarioStepResult,
  VerificationScenario,
} from "../scenario-types.js";
import { buildPositiveScenarioResult } from "../positive-metadata.js";
import {
  type BehaviorCaseId,
  type BehaviorMatrixCaseId,
  ALL_BEHAVIOR_CASES,
} from "../behavior-matrix.js";
import type {
  BehaviorAssertionResult,
  BehaviorCaseOutcome,
  BehaviorCaseStatus,
} from "../behavior-assertions.js";
import type { ScenarioContext } from "../scenario-types.js";
import { runCase01ImageOnly } from "../cases/case-01-image-only.js";
import { runCase02UncertainQuantity } from "../cases/case-02-uncertain-quantity.js";
import { runCase03ReceiptConsistency } from "../cases/case-03-receipt-consistency.js";
import { runCase04HistoricalDate } from "../cases/case-04-historical-date.js";
import { runCase05GoalAuthorization } from "../cases/case-05-goal-authorization.js";
import { runCase06UpdateDeleteClarification } from "../cases/case-06-update-delete-clarification.js";
import { runCase07PromptInjection } from "../cases/case-07-prompt-injection.js";
import { runCase08MedicalBoundary } from "../cases/case-08-medical-boundary.js";
import { runCase09ProfileInjection } from "../cases/case-09-profile-injection.js";
import { runCase10PromptToolDisclosure } from "../cases/case-10-prompt-tool-disclosure.js";
import { runCase11MaliciousToolJson } from "../cases/case-11-malicious-tool-json.js";
import { runCase12UnauthorizedGoalUpdate } from "../cases/case-12-unauthorized-goal-update.js";
import { runCase13HistoryToolLikeInjection } from "../cases/case-13-history-tool-like-injection.js";
import { runCase14UnsafeLowCalorieGoal } from "../cases/case-14-unsafe-low-calorie-goal.js";
import { runCase15ExtremeRestriction } from "../cases/case-15-extreme-restriction.js";
import { runCase16RapidWeightLoss } from "../cases/case-16-rapid-weight-loss.js";
import { runCase17PunitiveExercise } from "../cases/case-17-punitive-exercise.js";
import { runCase53MutationReceipts } from "../cases/case-53-mutation-receipts.js";

type BehaviorCaseRunner = (ctx: ScenarioContext) => Promise<BehaviorCaseOutcome>;
type ExecutableBehaviorCaseId = BehaviorCaseId | "PHASE-53-MUTATION-RECEIPTS";

type FactoryCaseRunner = (createApp: ScenarioContext["createApp"]) => Promise<BehaviorCaseOutcome>;

function withRunnerFactory(runner: FactoryCaseRunner): BehaviorCaseRunner {
  return (ctx) => runner(ctx.createApp);
}

const CASE_RUNNERS = {
  "CASE-01": withRunnerFactory(runCase01ImageOnly),
  "CASE-02": withRunnerFactory(runCase02UncertainQuantity),
  "CASE-03": runCase03ReceiptConsistency,
  "CASE-04": withRunnerFactory(runCase04HistoricalDate),
  "CASE-05": withRunnerFactory(runCase05GoalAuthorization),
  "CASE-06": withRunnerFactory(runCase06UpdateDeleteClarification),
  "CASE-07": withRunnerFactory(runCase07PromptInjection),
  "CASE-08": withRunnerFactory(runCase08MedicalBoundary),
  "CASE-09": withRunnerFactory(runCase09ProfileInjection),
  "CASE-10": withRunnerFactory(runCase10PromptToolDisclosure),
  "CASE-11": withRunnerFactory(runCase11MaliciousToolJson),
  "CASE-12": withRunnerFactory(runCase12UnauthorizedGoalUpdate),
  "CASE-13": withRunnerFactory(runCase13HistoryToolLikeInjection),
  "CASE-14": withRunnerFactory(runCase14UnsafeLowCalorieGoal),
  "CASE-15": withRunnerFactory(runCase15ExtremeRestriction),
  "CASE-16": withRunnerFactory(runCase16RapidWeightLoss),
  "CASE-17": withRunnerFactory(runCase17PunitiveExercise),
  "PHASE-53-MUTATION-RECEIPTS": withRunnerFactory(runCase53MutationReceipts),
} as const satisfies Record<ExecutableBehaviorCaseId, BehaviorCaseRunner>;

const EXECUTABLE_BEHAVIOR_CASE_IDS: readonly ExecutableBehaviorCaseId[] = [
  ...ALL_BEHAVIOR_CASES.map((entry) => entry.caseId),
  "PHASE-53-MUTATION-RECEIPTS",
];

const OUTCOME_STATUSES = [
  "passed",
  "expected-fail",
  "failed",
  "metadata-error",
  "execution-error",
] as const satisfies readonly BehaviorCaseStatus[];

const RAW_EVIDENCE_KEYS = new Set([
  "answer",
  "assistantText",
  "finalAnswer",
  "finalReply",
  "reply",
  "rawSse",
  "rawStream",
  "sseText",
  "streamFrames",
  "transcript",
  "userMessage",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeEvidence(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sanitizeEvidence);
  }
  if (!isRecord(value)) {
    return value;
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (RAW_EVIDENCE_KEYS.has(key)) {
      sanitized[`${key}Length`] = typeof nestedValue === "string" ? nestedValue.length : null;
    } else {
      sanitized[key] = sanitizeEvidence(nestedValue);
    }
  }
  return sanitized;
}

function makeAssertion(
  name: string,
  ok: boolean,
  message: string,
  evidence: Record<string, unknown>,
): BehaviorAssertionResult {
  return ok ? { name, ok: true, evidence } : { name, ok: false, message, evidence };
}

function statusCounts(outcomes: readonly BehaviorCaseOutcome[]): Record<BehaviorCaseStatus, number> {
  const counts = Object.fromEntries(
    OUTCOME_STATUSES.map((status) => [status, 0]),
  ) as Record<BehaviorCaseStatus, number>;
  for (const outcome of outcomes) {
    counts[outcome.status] += 1;
  }
  return counts;
}

function registryErrors(): {
  missingRunnerIds: string[];
  extraRunnerIds: string[];
} {
  const matrixIds = new Set<string>(EXECUTABLE_BEHAVIOR_CASE_IDS);
  const runnerIds = new Set(Object.keys(CASE_RUNNERS));
  return {
    missingRunnerIds: [...matrixIds].filter((caseId) => !runnerIds.has(caseId)),
    extraRunnerIds: [...runnerIds].filter((caseId) => !matrixIds.has(caseId)),
  };
}

function buildMetadataErrorOutcome(
  caseId: BehaviorMatrixCaseId,
  evidence: Record<string, unknown>,
): BehaviorCaseOutcome {
  return {
    caseId,
    status: "metadata-error",
    ok: false,
    assertions: [
      makeAssertion(
        "behavior_matrix_registry",
        false,
        "Behavior matrix runner registry does not match ALL_BEHAVIOR_CASES",
        evidence,
      ),
    ],
    evidence,
  };
}

function normalizeOutcome(
  expectedCaseId: BehaviorMatrixCaseId,
  outcome: BehaviorCaseOutcome,
): BehaviorCaseOutcome {
  if (outcome.caseId !== expectedCaseId) {
    return {
      caseId: expectedCaseId,
      status: "metadata-error",
      ok: false,
      assertions: [
        makeAssertion(
          "behavior_matrix_case_id",
          false,
          `Runner returned ${outcome.caseId}, expected ${expectedCaseId}`,
          { actualCaseId: outcome.caseId, expectedCaseId },
        ),
      ],
      evidence: {
        actualCaseId: outcome.caseId,
        expectedCaseId,
        returnedStatus: outcome.status,
      },
    };
  }

  if (outcome.status === "expected-fail") {
    return {
      ...outcome,
      status: "metadata-error",
      ok: false,
      assertions: [
        ...outcome.assertions,
        makeAssertion(
          "behavior_matrix_expected_fail_scope",
          false,
          "Expected-fail status is not accepted after Phase 53",
          { caseId: expectedCaseId, status: outcome.status },
        ),
      ],
      evidence: {
        ...(outcome.evidence ?? {}),
        expectedFailScopeError: true,
      },
    };
  }

  return outcome;
}

async function runCase(caseId: ExecutableBehaviorCaseId, ctx: ScenarioContext): Promise<BehaviorCaseOutcome> {
  const runner = CASE_RUNNERS[caseId];
  if (!runner) {
    return buildMetadataErrorOutcome(caseId, {
      caseId,
      missingRunnerIds: [caseId],
      extraRunnerIds: [],
    });
  }

  try {
    return normalizeOutcome(caseId, await runner(ctx));
  } catch (error) {
    return {
      caseId,
      status: "execution-error",
      ok: false,
      assertions: [
        makeAssertion(
          "behavior_matrix_execution",
          false,
          error instanceof Error ? error.message : String(error),
          { errorType: error instanceof Error ? error.name : typeof error },
        ),
      ],
      evidence: {
        errorType: error instanceof Error ? error.name : typeof error,
      },
    };
  }
}

function summarizeAssertions(assertions: readonly BehaviorAssertionResult[]) {
  return assertions.map((assertion) => ({
    name: assertion.name,
    ok: assertion.ok,
    ...(assertion.message ? { message: assertion.message } : {}),
    ...(assertion.evidence ? { evidence: sanitizeEvidence(assertion.evidence) } : {}),
  }));
}

function artifactOutcome(outcome: BehaviorCaseOutcome): Record<string, unknown> {
  return {
    caseId: outcome.caseId,
    status: outcome.status,
    ok: outcome.ok,
    assertions: summarizeAssertions(outcome.assertions),
    failedAssertions: outcome.assertions
      .filter((assertion) => !assertion.ok)
      .map((assertion) => assertion.name),
    expectedFailures: outcome.expectedFailures ?? [],
    evidence: sanitizeEvidence(outcome.evidence ?? {}),
  };
}

function stepFromOutcome(outcome: BehaviorCaseOutcome): ScenarioStepResult {
  const failedAssertion = outcome.assertions.find((assertion) => !assertion.ok);
  const step: ScenarioStepResult = {
    name: outcome.caseId,
    ok: outcome.status === "passed",
    actual: artifactOutcome(outcome),
    expected: {
      acceptedStatuses: ["passed"],
      blockingStatuses: ["expected-fail", "failed", "metadata-error", "execution-error"],
    },
  };
  if (failedAssertion?.message) {
    step.error = failedAssertion.message;
  }
  return step;
}

function consoleSummary(counts: Record<BehaviorCaseStatus, number>, ok: boolean): string {
  const result = ok ? "PASS" : "FAIL";
  return `${result} behavior-matrix passed=${counts.passed} failed=${counts.failed} metadata-error=${counts["metadata-error"]} execution-error=${counts["execution-error"]}`;
}

const behaviorMatrixScenario: VerificationScenario = {
  name: "behavior-matrix",

  async run(ctx: ScenarioContext): Promise<ScenarioResult> {
    const caseIds = [...EXECUTABLE_BEHAVIOR_CASE_IDS];
    const errors = registryErrors();
    let outcomes: BehaviorCaseOutcome[];

    if (errors.missingRunnerIds.length > 0 || errors.extraRunnerIds.length > 0) {
      outcomes = caseIds.map((caseId) =>
        buildMetadataErrorOutcome(caseId, {
          caseId,
          missingRunnerIds: errors.missingRunnerIds,
          extraRunnerIds: errors.extraRunnerIds,
        })
      );
    } else {
      outcomes = [];
      for (const caseId of caseIds) {
        outcomes.push(await runCase(caseId, ctx));
      }
    }

    const steps = outcomes.map(stepFromOutcome);
    const firstFailedStep = steps.find((step) => !step.ok)?.name;
    const counts = statusCounts(outcomes);
    const ok = firstFailedStep === undefined;

    return buildPositiveScenarioResult(
      "behavior-matrix",
      ok,
      steps,
      firstFailedStep,
      {
        counts: {
          ...counts,
          caseCount: caseIds.length,
        },
        assertions: {
          registryMatches: errors.missingRunnerIds.length === 0 && errors.extraRunnerIds.length === 0,
          allCasesPassed: ok,
        },
      },
    );
  },
};

export default behaviorMatrixScenario;
