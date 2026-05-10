import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  assertNoForbiddenReceiptCopy,
  assertSuccessfulMutationRendererSource,
} from "../harness/behavior-assertions.js";
import { ALL_BEHAVIOR_CASES, BEHAVIOR_MATRIX_CASES } from "../harness/behavior-matrix.js";
import type {
  BehaviorAssertionName,
  BehaviorMatrixCaseId,
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
  "PHASE-53-MUTATION-RECEIPTS",
] as const satisfies readonly BehaviorMatrixCaseId[];

const PHASE_53_REQUIREMENTS = [
  "TRACE-03",
  "RENDER-01",
  "RENDER-03",
  "RENDER-04",
  "RENDER-05",
] as const;

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
  "trace_final_reply_source",
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
      EXPECTED_CASE_IDS.slice(0, 8),
      "missing executable behavior case or case order drift",
    );
    assert.deepEqual(
      BEHAVIOR_MATRIX_CASES.map((behaviorCase) => behaviorCase.caseId),
      EXPECTED_CASE_IDS,
      "missing behavior matrix case or case order drift",
    );

    const seen = new Set<BehaviorMatrixCaseId>();
    for (const behaviorCase of BEHAVIOR_MATRIX_CASES) {
      assert.ok(!seen.has(behaviorCase.caseId), `duplicate behavior case ${behaviorCase.caseId}`);
      seen.add(behaviorCase.caseId);

      assertNonEmptyString(behaviorCase.title, `${behaviorCase.caseId} title`);
      if (behaviorCase.caseId.startsWith("CASE-")) {
        assert.ok(
          behaviorCase.requirements.some((requirement) => requirement === behaviorCase.caseId),
          `${behaviorCase.caseId} must reference its matching requirement ID`,
        );
      }
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
    const coveredRisks = new Set(BEHAVIOR_MATRIX_CASES.flatMap((behaviorCase) => behaviorCase.risks));
    for (const risk of REQUIRED_RISKS) {
      assert.ok(coveredRisks.has(risk), `missing behavior risk ${risk}`);
    }
  });

  it("references only exported behavior assertion functions or constants", async () => {
    const exportedNames = await exportedBehaviorAssertionNames();

    for (const behaviorCase of BEHAVIOR_MATRIX_CASES) {
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

  it("keeps CASE-03 renderer source as a hard assertion once trace supports renderer", async () => {
    const case03 = ALL_BEHAVIOR_CASES.find((behaviorCase) => behaviorCase.caseId === "CASE-03");
    assert.ok(case03, "missing behavior case CASE-03");

    const expectedFailures = case03.expectedFailures ?? [];
    assert.equal(expectedFailures.length, 0, "CASE-03 must not keep stale renderer expected-fail metadata");
    assert.ok(
      case03.risks.includes("trace_final_reply_source"),
      "CASE-03 must keep trace source as an active risk",
    );

    const llmTraceSource = await readFile("server/orchestrator/llm-trace.ts", "utf8");
    const rendererSourceSignal =
      /type LlmTraceFinalReplySource[\s\S]*\| "renderer"/.test(llmTraceSource) ||
      /source:\s*"renderer"/.test(llmTraceSource);
    assert.equal(
      rendererSourceSignal,
      true,
      "server/orchestrator/llm-trace.ts must support renderer before CASE-03 becomes a hard assertion",
    );
  });

  it("uses the shared CASE-03 runtime renderer-source assertion without expected-fail plumbing", async () => {
    const case03Source = await readFile("tests/harness/cases/case-03-receipt-consistency.ts", "utf8");

    assert.match(
      case03Source,
      /assertSuccessfulMutationRendererSource/,
      "CASE-03 runtime must call the shared renderer-source assertion",
    );
    assert.match(
      case03Source,
      /mutationKind:\s*"log"/,
      "CASE-03 renderer-source assertion must identify the log mutation family",
    );
    assert.doesNotMatch(
      case03Source,
      /orchestrator_projected_reply|evaluateExpectedFailures|expectedFailures/,
      "CASE-03 runtime must not keep stale expected-fail or legacy source plumbing",
    );
  });

  it("uses locked assertion names in coverage entries", () => {
    const assertionNames = new Set<BehaviorAssertionName>();
    for (const behaviorCase of BEHAVIOR_MATRIX_CASES) {
      for (const entry of behaviorCase.coverage) {
        for (const assertionName of entry.assertions) {
          assertionNames.add(assertionName);
        }
      }
    }

    for (const requiredAssertion of [
      "assertTraditionalChinese",
      "assertNoInternalLeakage",
      "assertNoForbiddenReceiptCopy",
      "assertGroundedNumbers",
      "assertSuccessfulMutationRendererSource",
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

  it("declares broad Phase 53 mutation receipt coverage", () => {
    const phase53 = BEHAVIOR_MATRIX_CASES.find(
      (behaviorCase) => behaviorCase.caseId === "PHASE-53-MUTATION-RECEIPTS",
    );
    assert.ok(phase53, "missing PHASE-53-MUTATION-RECEIPTS behavior case");
    assert.equal(
      phase53.title,
      "Deterministic renderer-owned mutation receipts across log, update, delete, and goals",
    );
    assert.deepEqual(phase53.requirements, PHASE_53_REQUIREMENTS);
    assert.deepEqual(phase53.risks, [
      "receipt_consistency",
      "internal_api_leakage",
      "no_unauthorized_mutation",
      "trace_final_reply_source",
      "grounded_numbers",
    ]);

    const phase53Assertions = new Set(
      phase53.coverage.flatMap((entry) => entry.assertions),
    );
    for (const assertionName of [
      "assertSuccessfulMutationRendererSource",
      "assertNoForbiddenReceiptCopy",
      "assertGroundedNumbers",
    ] as const) {
      assert.ok(phase53Assertions.has(assertionName), `missing Phase 53 assertion ${assertionName}`);
    }
  });

  it("exports mutation receipt renderer-source and forbidden-copy assertions", async () => {
    const exportedNames = await exportedBehaviorAssertionNames();

    for (const requiredAssertion of [
      "assertSuccessfulMutationRendererSource",
      "assertNoForbiddenReceiptCopy",
    ]) {
      assert.ok(exportedNames.has(requiredAssertion), `missing behavior assertion export ${requiredAssertion}`);
    }
  });

  it("rejects successful mutation receipts from model or mixed sources", () => {
    assert.deepEqual(
      assertSuccessfulMutationRendererSource({ source: "renderer", mutationKind: "log" }),
      {
        name: "mutation_receipt_renderer_source",
        ok: true,
        evidence: { source: "renderer", mutationKind: "log" },
      },
    );

    for (const source of ["model", "mixed"] as const) {
      const result = assertSuccessfulMutationRendererSource({ source, mutationKind: "update" });
      assert.equal(result.name, "mutation_receipt_renderer_source");
      assert.equal(result.ok, false);
      assert.match(result.message ?? "", /renderer/);
      assert.deepEqual(result.evidence, { source, mutationKind: "update" });
    }
  });

  it("rejects forbidden mutation receipt copy including API-like wording", () => {
    const cleanResult = assertNoForbiddenReceiptCopy("已記錄雞胸肉，320 kcal，蛋白質 35 g。");
    assert.equal(cleanResult.name, "no_forbidden_receipt_copy");
    assert.equal(cleanResult.ok, true);

    for (const term of [
      "headline",
      "先抓低",
      "log_food",
      "update_meal",
      "delete_meal",
      "update_goals",
      "revision",
      "deviceId",
      "mealMutationKind",
      "dailySummary",
      "dailyTargets",
      "API",
      "endpoint",
      "route",
      "payload",
      "field",
      "request",
      "response",
      "JSON",
      "PATCH",
      "POST",
      "DELETE",
      "/api",
      "body",
      "status code",
    ]) {
      const result = assertNoForbiddenReceiptCopy(`receipt leaked ${term}`);
      assert.equal(result.name, "no_forbidden_receipt_copy");
      assert.equal(result.ok, false, `expected forbidden term to fail: ${term}`);
      assert.match(result.message ?? "", /forbidden/i);
      assert.deepEqual(result.evidence, { matchedTerms: [term] });
    }
  });
});
