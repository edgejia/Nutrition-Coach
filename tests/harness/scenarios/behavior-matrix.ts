import type {
  ScenarioResult,
  ScenarioStepResult,
  VerificationScenario,
} from "../scenario-types.js";
import {
  type BehaviorCaseId,
  ALL_BEHAVIOR_CASES,
} from "../behavior-matrix.js";
import type {
  BehaviorAssertionResult,
  BehaviorCaseOutcome,
  BehaviorCaseStatus,
} from "../behavior-assertions.js";
import { runCase01ImageOnly } from "../cases/case-01-image-only.js";
import { runCase02UncertainQuantity } from "../cases/case-02-uncertain-quantity.js";
import { runCase03ReceiptConsistency } from "../cases/case-03-receipt-consistency.js";
import { runCase04HistoricalDate } from "../cases/case-04-historical-date.js";
import { runCase05GoalAuthorization } from "../cases/case-05-goal-authorization.js";
import { runCase06UpdateDeleteClarification } from "../cases/case-06-update-delete-clarification.js";
import { runCase07PromptInjection } from "../cases/case-07-prompt-injection.js";
import { runCase08MedicalBoundary } from "../cases/case-08-medical-boundary.js";

type BehaviorCaseRunner = () => Promise<BehaviorCaseOutcome>;

const CASE_RUNNERS = {
  "CASE-01": runCase01ImageOnly,
  "CASE-02": runCase02UncertainQuantity,
  "CASE-03": runCase03ReceiptConsistency,
  "CASE-04": runCase04HistoricalDate,
  "CASE-05": runCase05GoalAuthorization,
  "CASE-06": runCase06UpdateDeleteClarification,
  "CASE-07": runCase07PromptInjection,
  "CASE-08": runCase08MedicalBoundary,
} as const satisfies Record<BehaviorCaseId, BehaviorCaseRunner>;

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
  const matrixIds = new Set<string>(ALL_BEHAVIOR_CASES.map((entry) => entry.caseId));
  const runnerIds = new Set(Object.keys(CASE_RUNNERS));
  return {
    missingRunnerIds: [...matrixIds].filter((caseId) => !runnerIds.has(caseId)),
    extraRunnerIds: [...runnerIds].filter((caseId) => !matrixIds.has(caseId)),
  };
}

function buildMetadataErrorOutcome(
  caseId: BehaviorCaseId,
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
  expectedCaseId: BehaviorCaseId,
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

  if (outcome.status === "expected-fail" && expectedCaseId !== "CASE-03") {
    return {
      ...outcome,
      status: "metadata-error",
      ok: false,
      assertions: [
        ...outcome.assertions,
        makeAssertion(
          "behavior_matrix_expected_fail_scope",
          false,
          "Expected-fail status is limited to CASE-03 renderer/source metadata",
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

async function runCase(caseId: BehaviorCaseId): Promise<BehaviorCaseOutcome> {
  const runner = CASE_RUNNERS[caseId];
  if (!runner) {
    return buildMetadataErrorOutcome(caseId, {
      caseId,
      missingRunnerIds: [caseId],
      extraRunnerIds: [],
    });
  }

  try {
    return normalizeOutcome(caseId, await runner());
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
    ok: outcome.status === "passed" || outcome.status === "expected-fail",
    actual: artifactOutcome(outcome),
    expected: {
      acceptedStatuses: ["passed", "expected-fail"],
      blockingStatuses: ["failed", "metadata-error", "execution-error"],
    },
  };
  if (failedAssertion?.message) {
    step.error = failedAssertion.message;
  }
  return step;
}

function consoleSummary(counts: Record<BehaviorCaseStatus, number>, ok: boolean): string {
  const result = ok ? "PASS" : "FAIL";
  return `${result} behavior-matrix passed=${counts.passed} expected-fail=${counts["expected-fail"]} failed=${counts.failed} metadata-error=${counts["metadata-error"]} execution-error=${counts["execution-error"]}`;
}

const behaviorMatrixScenario: VerificationScenario = {
  name: "behavior-matrix",

  async run(): Promise<ScenarioResult> {
    const caseIds = ALL_BEHAVIOR_CASES.map((entry) => entry.caseId);
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
        outcomes.push(await runCase(caseId));
      }
    }

    const steps = outcomes.map(stepFromOutcome);
    const firstFailedStep = steps.find((step) => !step.ok)?.name;
    const counts = statusCounts(outcomes);
    const ok = firstFailedStep === undefined;

    return {
      ok,
      ...(firstFailedStep ? { failedStep: firstFailedStep } : {}),
      steps,
      artifacts: {
        outcomes: outcomes.map(artifactOutcome),
        statusCounts: counts,
        expectedFailures: outcomes.flatMap((outcome) =>
          (outcome.expectedFailures ?? []).map((failure) => ({
            caseId: outcome.caseId,
            ...failure,
          }))
        ),
        caseIds,
      },
      consoleSummary: consoleSummary(counts, ok),
    };
  },
};

export default behaviorMatrixScenario;
