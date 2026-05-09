import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import { ALL_BEHAVIOR_CASES } from "../harness/behavior-matrix.js";
import type {
  BehaviorAssertionName,
  BehaviorCaseId,
  BehaviorRisk,
} from "../harness/behavior-matrix.js";

const EXPECTED_CASE_IDS = [
  "CASE-01",
  "CASE-02",
  "CASE-03",
  "CASE-04",
  "CASE-05",
  "CASE-06",
  "CASE-07",
  "CASE-08",
] as const satisfies readonly BehaviorCaseId[];

const REQUIRED_RISKS = [
  "traditional_chinese",
  "internal_api_leakage",
  "grounded_numbers",
  "no_fabricated_meals",
  "uncertainty_caveat",
  "receipt_consistency",
  "historical_date",
  "goal_authorization",
  "clarification_no_mutation",
  "prompt_injection_resistance",
  "medical_boundary",
  "no_unauthorized_mutation",
  "expected_fail_integrity",
] as const satisfies readonly BehaviorRisk[];

async function exportedBehaviorAssertionNames() {
  const source = await readFile("tests/harness/behavior-assertions.ts", "utf8");
  const names = new Set<string>();
  for (const match of source.matchAll(/^export (?:function|const) ([A-Za-z0-9_]+)/gm)) {
    names.add(match[1]);
  }
  return names;
}

function assertNonEmptyString(value: unknown, label: string) {
  assert.equal(typeof value, "string", `${label} must be a string`);
  assert.ok((value as string).trim().length > 0, `${label} must be non-empty`);
}

describe("behavior matrix contract", () => {
  it("locks exact behavior cases, requirement IDs, and non-empty coverage", () => {
    assert.deepEqual(
      ALL_BEHAVIOR_CASES.map((behaviorCase) => behaviorCase.caseId),
      EXPECTED_CASE_IDS,
      "missing behavior case or case order drift",
    );

    const seen = new Set<BehaviorCaseId>();
    for (const behaviorCase of ALL_BEHAVIOR_CASES) {
      assert.ok(!seen.has(behaviorCase.caseId), `duplicate behavior case ${behaviorCase.caseId}`);
      seen.add(behaviorCase.caseId);

      assertNonEmptyString(behaviorCase.title, `${behaviorCase.caseId} title`);
      assert.ok(
        behaviorCase.requirements.includes(behaviorCase.caseId),
        `${behaviorCase.caseId} must reference its matching requirement ID`,
      );
      assert.ok(behaviorCase.risks.length > 0, `${behaviorCase.caseId} risks must be non-empty`);
      assert.ok(behaviorCase.coverage.length > 0, `${behaviorCase.caseId} coverage must be non-empty`);

      const coverageRisks = behaviorCase.coverage.map((entry) => entry.risk);
      assert.deepEqual(
        coverageRisks,
        behaviorCase.risks,
        `${behaviorCase.caseId} risks must match coverage risk order`,
      );

      for (const entry of behaviorCase.coverage) {
        assert.ok(entry.assertions.length > 0, `${behaviorCase.caseId} ${entry.risk} assertions must be non-empty`);
      }
    }
  });

  it("covers every Phase 52 risk at least once", () => {
    const coveredRisks = new Set(ALL_BEHAVIOR_CASES.flatMap((behaviorCase) => behaviorCase.risks));
    for (const risk of REQUIRED_RISKS) {
      assert.ok(coveredRisks.has(risk), `missing behavior risk ${risk}`);
    }
  });

  it("references only exported behavior assertion functions or constants", async () => {
    const exportedNames = await exportedBehaviorAssertionNames();

    for (const behaviorCase of ALL_BEHAVIOR_CASES) {
      for (const entry of behaviorCase.coverage) {
        for (const assertionName of entry.assertions) {
          assert.ok(
            exportedNames.has(assertionName),
            `${behaviorCase.caseId} ${entry.risk} references missing behavior assertion export ${assertionName}`,
          );
        }
      }
    }
  });

  it("keeps CASE-03 renderer expected-fail metadata complete and non-stale", async () => {
    const case03 = ALL_BEHAVIOR_CASES.find((behaviorCase) => behaviorCase.caseId === "CASE-03");
    assert.ok(case03, "missing behavior case CASE-03");

    const expectedFailures = case03.expectedFailures ?? [];
    assert.equal(expectedFailures.length, 1, "CASE-03 must have exactly one expected-fail entry");
    assert.equal(expectedFailures[0].expectedResolutionPhase, 53);
    assert.match(expectedFailures[0].assertionName, /\S/);
    assert.match(expectedFailures[0].reason, /\S/);
    assert.match(
      expectedFailures[0].expiresWhen,
      /assertTraceFinalReplySource supports renderer/,
    );

    const llmTraceSource = await readFile("server/orchestrator/llm-trace.ts", "utf8");
    const rendererSourceSignal =
      /type LlmTraceFinalReplySource[\s\S]*\| "renderer"/.test(llmTraceSource) ||
      /source:\s*"renderer"/.test(llmTraceSource);
    assert.equal(
      rendererSourceSignal,
      false,
      "CASE-03 renderer expected-fail metadata is stale because server/orchestrator/llm-trace.ts supports renderer",
    );
  });

  it("uses locked assertion names in coverage entries", () => {
    const assertionNames = new Set<BehaviorAssertionName>();
    for (const behaviorCase of ALL_BEHAVIOR_CASES) {
      for (const entry of behaviorCase.coverage) {
        for (const assertionName of entry.assertions) {
          assertionNames.add(assertionName);
        }
      }
    }

    for (const requiredAssertion of [
      "assertTraditionalChinese",
      "assertNoInternalLeakage",
      "assertGroundedNumbers",
      "assertNoInventedMeals",
      "assertQuantityUncertaintyCaveat",
      "assertPromptInjectionResistance",
      "assertMedicalBoundary",
      "assertNoUnauthorizedMutation",
      "evaluateExpectedFailures",
    ] as const satisfies readonly BehaviorAssertionName[]) {
      assert.ok(assertionNames.has(requiredAssertion), `missing assertion coverage ${requiredAssertion}`);
    }
  });
});
