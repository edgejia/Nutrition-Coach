import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  POLICY_EVIDENCE_FORBIDDEN_KEYS,
  assertPolicyDbInvariant,
  assertPolicyEvidenceHasNoForbiddenFields,
  assertPolicyFact,
  assertVisibleOutcomeSummary,
  type PolicyDbInvariantExpectation,
  type PolicyFactExpectation,
  type VisibleOutcomeExpectation,
} from "../harness/policy-assertions.js";
import type { ToolPolicyDecisionFact } from "../../server/orchestrator/tool-contract.js";

type PolicyFactEvidence = ToolPolicyDecisionFact & { turnId?: string };

const expectedPolicyFact: PolicyFactExpectation = {
  tool: "propose_meal_numeric_correction",
  policyClass: "confirm-first",
  decision: "allowed",
  ruleId: "meal_numeric_proposal_approval_consume",
  proposalId: "proposal-safe-123",
  requireTurnId: true,
};

const expectedDbInvariant: PolicyDbInvariantExpectation = {
  mealCountBefore: 1,
  mealCountAfter: 1,
  targetsChanged: false,
  pendingConsumed: true,
  pendingPreserved: false,
  dailySummaryPublishCount: 0,
  goalsPublishCount: 1,
};

const expectedVisibleOutcome: VisibleOutcomeExpectation = {
  keyLabels: {
    confirmationPrompt: true,
    noMutationNotice: true,
  },
  meaning: {
    asksForConfirmation: true,
    reportsNoDomainMutation: true,
  },
};

function makePolicyFact(overrides: Partial<PolicyFactEvidence> = {}): PolicyFactEvidence {
  return {
    tool: "propose_meal_numeric_correction",
    policyClass: "confirm-first",
    decision: "allowed",
    ruleId: "meal_numeric_proposal_approval_consume",
    proposalId: "proposal-safe-123",
    turnId: "turn-safe-456",
    ...overrides,
  };
}

describe("policy harness assertions", () => {
  it("policy harness assertions accept allowlisted policy facts", () => {
    assert.doesNotThrow(() => assertPolicyFact(makePolicyFact(), expectedPolicyFact));
  });

  it("policy harness assertions reject mismatched policy facts", () => {
    assert.throws(
      () => assertPolicyFact(makePolicyFact({ policyClass: "direct-execute" }), expectedPolicyFact),
      /policyClass/,
    );
    assert.throws(
      () => assertPolicyFact(makePolicyFact({ decision: "blocked" }), expectedPolicyFact),
      /decision/,
    );
    assert.throws(
      () => assertPolicyFact(makePolicyFact({ ruleId: "wrong_rule" }), expectedPolicyFact),
      /ruleId/,
    );
    assert.throws(
      () => {
        const fact = makePolicyFact();
        delete fact.proposalId;
        assertPolicyFact(fact, expectedPolicyFact);
      },
      /proposalId/,
    );
    assert.throws(
      () => {
        const fact = makePolicyFact();
        delete fact.turnId;
        assertPolicyFact(fact, expectedPolicyFact);
      },
      /turnId/,
    );
  });

  it("policy harness assertions reject forbidden evidence fields", () => {
    for (const key of [
      "args",
      "rawUserText",
      "payload",
      "sessionMaterial",
      "message",
      "reply",
      "toolArguments",
      "toolResult",
      "providerPayload",
      "rawProviderPayload",
      "rawSseTranscript",
      "mealsSnapshot",
      "databaseSnapshot",
    ]) {
      assert.equal(
        POLICY_EVIDENCE_FORBIDDEN_KEYS.has(key),
        true,
        `expected forbidden key set to include ${key}`,
      );
      assert.throws(
        () => assertPolicyEvidenceHasNoForbiddenFields({ nested: { [key]: "forbidden" } }),
        new RegExp(key),
      );
    }
  });

  it("policy harness assertions reject DB invariant drift", () => {
    assert.doesNotThrow(() => {
      assertPolicyDbInvariant({ ...expectedDbInvariant }, expectedDbInvariant);
    });

    for (const [field, value] of [
      ["mealCountAfter", 2],
      ["targetsChanged", true],
      ["pendingConsumed", false],
      ["dailySummaryPublishCount", 1],
    ] as const) {
      assert.throws(
        () => assertPolicyDbInvariant({ ...expectedDbInvariant, [field]: value }, expectedDbInvariant),
        new RegExp(field),
      );
    }

    assert.throws(
      () => assertPolicyDbInvariant({ ...expectedDbInvariant, databaseSnapshot: {} }, expectedDbInvariant),
      /databaseSnapshot/,
    );
  });

  it("policy harness assertions reject visible outcome drift", () => {
    assert.doesNotThrow(() => {
      assertVisibleOutcomeSummary({ ...expectedVisibleOutcome }, expectedVisibleOutcome);
    });

    assert.throws(
      () => assertVisibleOutcomeSummary({
        ...expectedVisibleOutcome,
        keyLabels: {
          ...expectedVisibleOutcome.keyLabels,
          confirmationPrompt: false,
        },
      }, expectedVisibleOutcome),
      /keyLabels\.confirmationPrompt/,
    );
    assert.throws(
      () => assertVisibleOutcomeSummary({
        ...expectedVisibleOutcome,
        meaning: {
          ...expectedVisibleOutcome.meaning,
          asksForConfirmation: false,
        },
      }, expectedVisibleOutcome),
      /meaning\.asksForConfirmation/,
    );
    assert.throws(
      () => assertVisibleOutcomeSummary({
        ...expectedVisibleOutcome,
        rawSseTranscript: [],
      }, expectedVisibleOutcome),
      /rawSseTranscript/,
    );
  });
});
