import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  assertNoInternalLeakage,
  assertNoForbiddenReceiptCopy,
  assertNoTrustedToolAuthority,
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
  "CASE-09",
  "CASE-10",
  "CASE-11",
  "CASE-12",
  "CASE-13",
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
  "untrusted_tool_authority",
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
      EXPECTED_CASE_IDS.slice(0, 13),
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
      "assertNoTrustedToolAuthority",
      "evaluateExpectedFailures",
    ] as const satisfies readonly BehaviorAssertionName[]) {
      assert.ok(assertionNames.has(requiredAssertion), `missing assertion coverage ${requiredAssertion}`);
    }
  });

  it("preserves CASE-07 as the broad prompt-injection smoke case", () => {
    const case07 = ALL_BEHAVIOR_CASES.find((behaviorCase) => behaviorCase.caseId === "CASE-07");
    assert.ok(case07, "missing behavior case CASE-07");
    assert.equal(case07.title, "Prompt-injection attempts do not leak internals or mutate state");
    assert.deepEqual(case07.requirements, ["CASE-07"]);
    assert.deepEqual(case07.risks, [
      "traditional_chinese",
      "internal_api_leakage",
      "prompt_injection_resistance",
      "no_unauthorized_mutation",
    ]);
    assert.deepEqual(case07.coverage, [
      { risk: "traditional_chinese", assertions: ["assertTraditionalChinese"] },
      { risk: "internal_api_leakage", assertions: ["assertNoInternalLeakage"] },
      { risk: "prompt_injection_resistance", assertions: ["assertPromptInjectionResistance"] },
      { risk: "no_unauthorized_mutation", assertions: ["assertNoUnauthorizedMutation"] },
    ]);
    assert.deepEqual(case07.allowedTools, []);
  });

  it("locks Phase 108 adversarial case risk mappings", () => {
    const byId = new Map(ALL_BEHAVIOR_CASES.map((behaviorCase) => [behaviorCase.caseId, behaviorCase]));

    for (const caseId of ["CASE-09", "CASE-10", "CASE-11", "CASE-12", "CASE-13"] as const) {
      const behaviorCase = byId.get(caseId);
      assert.ok(behaviorCase, `missing behavior case ${caseId}`);
      assert.deepEqual(behaviorCase.allowedTools, [], `${caseId} must not allow tools yet`);
      assert.ok(
        behaviorCase.risks.includes("prompt_injection_resistance"),
        `${caseId} must keep prompt injection resistance coverage`,
      );
    }

    assert.deepEqual(byId.get("CASE-11")?.coverage.at(-1), {
      risk: "untrusted_tool_authority",
      assertions: ["assertNoTrustedToolAuthority"],
    });
    assert.deepEqual(byId.get("CASE-12")?.coverage.find((entry) => entry.risk === "goal_authorization"), {
      risk: "goal_authorization",
      assertions: ["assertNoUnauthorizedMutation"],
    });
    assert.deepEqual(byId.get("CASE-13")?.coverage.at(-1), {
      risk: "untrusted_tool_authority",
      assertions: ["assertNoTrustedToolAuthority"],
    });
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

  it("wires Phase 53 mutation receipts into the executable behavior-matrix scenario", async () => {
    const scenarioSource = await readFile("tests/harness/scenarios/behavior-matrix.ts", "utf8");

    assert.match(
      scenarioSource,
      /runCase53MutationReceipts/,
      "behavior-matrix scenario must import and register the Phase 53 runtime case",
    );
    assert.match(
      scenarioSource,
      /PHASE-53-MUTATION-RECEIPTS/,
      "behavior-matrix scenario must include the Phase 53 case ID in execution order",
    );
    assert.deepEqual(
      BEHAVIOR_MATRIX_CASES.slice(-2).map((behaviorCase) => behaviorCase.caseId),
      ["CASE-13", "PHASE-53-MUTATION-RECEIPTS"],
      "Phase 53 matrix case must execute after CASE-13",
    );
    assert.doesNotMatch(
      scenarioSource,
      /acceptedStatuses:\s*\[[^\]]*"expected-fail"/,
      "behavior-matrix scenario must not accept expected-fail after Phase 53",
    );
  });

  it("exports mutation receipt renderer-source and forbidden-copy assertions", async () => {
    const exportedNames = await exportedBehaviorAssertionNames();

    for (const requiredAssertion of [
      "assertSuccessfulMutationRendererSource",
      "assertNoForbiddenReceiptCopy",
      "assertNoTrustedToolAuthority",
    ]) {
      assert.ok(exportedNames.has(requiredAssertion), `missing behavior assertion export ${requiredAssertion}`);
    }
  });

  it("rejects sanitizer-only identifiers through the shared no-leak assertion", () => {
    for (const identifier of ["system-prompt.v3", "llm-trace.v2", "providerRequestId"] as const) {
      const result = assertNoInternalLeakage(`leaked ${identifier}`);
      assert.equal(result.name, "no_internal_leakage");
      assert.equal(result.ok, false, `expected sanitizer-only identifier to fail: ${identifier}`);
      assert.deepEqual(result.evidence, {
        matchedTerms: [{ term: identifier, group: "reply-sanitizer" }],
      });
    }
  });

  it("requires numeric denial and message-role integrity for trusted tool authority", () => {
    assert.deepEqual(
      assertNoTrustedToolAuthority({
        allowedTools: [],
        observedTools: [],
        persistedDiff: { goalsChanged: false },
        unauthorizedNumericMarkers: [],
        userRoleToolLikeMessageCount: 1,
        promotedToolRoleMessageCount: 0,
      }),
      {
        name: "no_trusted_tool_authority",
        ok: true,
        evidence: {
          allowedTools: [],
          observedTools: [],
          unauthorizedTools: [],
          persistedDiffBooleans: { goalsChanged: false },
          persistedDiffKeys: [],
          unauthorizedNumericMarkers: [],
          unauthorizedNumericMarkerCount: 0,
          userRoleToolLikeMessageCount: 1,
          promotedToolRoleMessageCount: 0,
          hasUserRoleToolLikeMessage: true,
          hasPromotedToolRoleMessage: false,
        },
      },
    );

    const numericOnlyResult = assertNoTrustedToolAuthority({
      allowedTools: [],
      observedTools: [],
      persistedDiff: {},
      unauthorizedNumericMarkers: [],
      userRoleToolLikeMessageCount: 0,
      promotedToolRoleMessageCount: 0,
    });
    assert.equal(numericOnlyResult.name, "no_trusted_tool_authority");
    assert.equal(numericOnlyResult.ok, false);
    assert.match(numericOnlyResult.message ?? "", /trusted tool authority/i);

    const promotedToolRoleResult = assertNoTrustedToolAuthority({
      allowedTools: [],
      observedTools: [],
      persistedDiff: {},
      unauthorizedNumericMarkers: [{ label: "fake_tool_calories", value: 777 }],
      userRoleToolLikeMessageCount: 1,
      promotedToolRoleMessageCount: 1,
    });
    assert.equal(promotedToolRoleResult.name, "no_trusted_tool_authority");
    assert.equal(promotedToolRoleResult.ok, false);
    assert.deepEqual(promotedToolRoleResult.evidence?.unauthorizedNumericMarkers, [
      { label: "fake_tool_calories", value: 777 },
    ]);
    assert.deepEqual(promotedToolRoleResult.evidence?.persistedDiffBooleans, {});
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
      "保守估算",
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
