/**
 * Deterministic proof for the estimate confirm-first lifecycle.
 *
 * Artifacts intentionally store metadata-only evidence: policy fact summaries,
 * narrow DB/publish invariants, proposal booleans, numeric deltas, and visible
 * outcome booleans. Raw prompts, tool arguments, cookies, ids, and DB snapshots
 * must not be persisted.
 */

import assert from "node:assert/strict";
import { createLlmTraceRecorder } from "../../../server/orchestrator/llm-trace.js";
import { DEFAULT_SESSION_ID } from "../../../server/services/turn-state.js";
import {
  assertPolicyDbInvariant,
  assertPolicyEvidenceHasNoForbiddenFields,
  assertPolicyFact,
  assertVisibleOutcomeSummary,
} from "../policy-assertions.js";
import { createScenarioApp } from "../app-fixture.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import type {
  VerificationScenario,
  ScenarioContext,
  ScenarioResult,
  ScenarioStepResult,
} from "../scenario-types.js";
import type { ToolPolicyDecisionFact } from "../../../server/orchestrator/tool-contract.js";
import type { MealNumericAffectedField } from "../../../server/services/meal-numeric-proposals.js";

interface ChatBody {
  reply?: string;
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  dailySummary?: {
    mealCount?: number;
    totalCalories?: number;
    totalProtein?: number;
    totalCarbs?: number;
    totalFat?: number;
  };
}

type LlmTraceArtifact = ReturnType<ReturnType<typeof createLlmTraceRecorder>["build"]>;
type PolicyEvidence = ToolPolicyDecisionFact & {
  turnId?: string;
};

const SCENARIO_NAME = "estimate-confirm-first";
const STEP_NAMES = [
  "estimate_proposal_created_without_mutation",
  "estimate_confirmation_commits_once",
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

function summarizePolicyFact(fact: Record<string, unknown>): PolicyEvidence {
  return {
    tool: String(fact.tool),
    policyClass: fact.policyClass as PolicyEvidence["policyClass"],
    decision: fact.decision as PolicyEvidence["decision"],
    ruleId: String(fact.ruleId),
    ...(typeof fact.proposalId === "string" ? { proposalId: fact.proposalId } : {}),
    ...(typeof fact.turnId === "string" ? { turnId: fact.turnId } : {}),
  };
}

function findPolicyFact(trace: LlmTraceArtifact, tool: string): PolicyEvidence {
  const event = trace.timeline.find((entry) => entry.type === "tool_result" && entry.tool === tool);
  assert.ok(event, `missing policy trace event for ${tool}`);
  return summarizePolicyFact(event as Record<string, unknown>);
}

function evidenceArtifacts() {
  return { evidence: [] as unknown[] };
}

function addEvidence(
  artifacts: ReturnType<typeof evidenceArtifacts>,
  entry: Record<string, unknown>,
): void {
  assertPolicyEvidenceHasNoForbiddenFields(entry);
  artifacts.evidence.push(entry);
}

async function postChat(
  address: string,
  cookieHeader: string,
  text: string,
): Promise<{ status: number; body: ChatBody }> {
  const form = new FormData();
  form.append("message", text);

  const res = await fetch(`${address}/api/chat`, {
    method: "POST",
    headers: { cookie: cookieHeader },
    body: form,
  });

  return { status: res.status, body: await res.json() as ChatBody };
}

function numericDelta(fields: MealNumericAffectedField[]) {
  return fields.map((field) => ({
    field: field.field,
    before: field.before,
    after: field.after,
    changed: field.before !== field.after,
  }));
}

function summarizeVisibleOutcome(input: {
  keyLabels?: Record<string, boolean>;
  meaning?: Record<string, boolean>;
}) {
  return { ...input };
}

function summarizeDbInvariant(input: {
  mealCountBefore?: number;
  mealCountAfter?: number;
  pendingConsumed?: boolean;
  pendingPreserved?: boolean;
  dailySummaryPublishCount?: number;
  goalsPublishCount?: number;
}) {
  return { ...input };
}

function summarizeProposal(input: {
  persisted: boolean;
  consumed?: boolean;
  replacedPrevious?: boolean;
  hasModelEstimateProvenance?: boolean;
  expectedRevisionMatched?: boolean;
  affectedFieldCount?: number;
  affectedFieldNames?: string[];
}) {
  return { ...input };
}

const scenario: VerificationScenario = {
  name: SCENARIO_NAME,

  async run(_ctx: ScenarioContext): Promise<ScenarioResult> {
    const steps: ScenarioStepResult[] = [];
    const artifacts = evidenceArtifacts();
    const provider = new StreamingLLMProvider();
    const traceRecorders: Array<ReturnType<typeof createLlmTraceRecorder>> = [];
    const fixture = await createScenarioApp({
      llmProvider: provider,
      llmTraceRecorderFactory() {
        const recorder = createLlmTraceRecorder();
        traceRecorders.push(recorder);
        return recorder;
      },
    });

    const publishCounts = {
      dailySummary: 0,
      goals: 0,
    };
    const originalPublishDailySummary = fixture.services.publisher.publishDailySummary.bind(
      fixture.services.publisher,
    );
    fixture.services.publisher.publishDailySummary = (...args) => {
      publishCounts.dailySummary += 1;
      return originalPublishDailySummary(...args);
    };
    const originalPublishGoalsUpdate = fixture.services.publisher.publishGoalsUpdate.bind(
      fixture.services.publisher,
    );
    fixture.services.publisher.publishGoalsUpdate = (...args) => {
      publishCounts.goals += 1;
      return originalPublishGoalsUpdate(...args);
    };
    const resetPublishCounts = () => {
      publishCounts.dailySummary = 0;
      publishCounts.goals = 0;
    };

    try {
      const proposalStep = STEP_NAMES[0];
      provider.reset();
      resetPublishCounts();
      const originalMeal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
        loggedAt: new Date().toISOString(),
        items: [{ foodName: "估值雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 }],
      });
      const mealsBeforeProposal = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      provider.queueRoundResponse({
        toolCalls: [{
          id: "estimate_find_target",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({
              action: "update",
              query: "估值雞腿飯 幫我估合理一點然後更新",
            }),
          },
        }],
      });
      provider.queueRoundResponse({
        toolCalls: [{
          id: "estimate_create_proposal",
          type: "function",
          function: {
            name: "propose_meal_estimate",
            arguments: JSON.stringify({
              meal_id: originalMeal.id,
              fields: ["calories", "protein", "carbs", "fat"],
              estimated: {
                calories: 590,
                protein: 34,
                carbs: 62,
                fat: 18,
              },
            }),
          },
        }],
      });

      const proposed = await postChat(
        fixture.address,
        fixture.cookieHeader,
        "幫我估合理一點然後更新",
      );
      const proposalTrace = traceRecorders.at(-1)?.build({ scenario: proposalStep, status: "pass" });
      assert.ok(proposalTrace);
      const targetLookupPolicyFact = findPolicyFact(proposalTrace, "find_meals");
      const estimatePolicyFact = findPolicyFact(proposalTrace, "propose_meal_estimate");
      const proposal = await fixture.services.mealNumericProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const mealsAfterProposal = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const unchangedMeal = mealsAfterProposal.find((meal) => meal.id === originalMeal.id);
      const proposalDbInvariant = summarizeDbInvariant({
        mealCountBefore: mealsBeforeProposal.length,
        mealCountAfter: mealsAfterProposal.length,
        pendingPreserved: proposal?.mealId === originalMeal.id,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const proposalSummary = summarizeProposal({
        persisted: proposal !== undefined,
        hasModelEstimateProvenance: proposal?.provenance === "model_estimate",
        expectedRevisionMatched: proposal?.expectedMealRevisionId === originalMeal.mealRevisionId,
        affectedFieldCount: proposal?.affectedFields.length,
        affectedFieldNames: proposal?.affectedFields.map((field) => field.field),
      });
      const proposalVisibleOutcome = summarizeVisibleOutcome({
        keyLabels: {
          hasCaloriesBeforeAfter: /卡路里：650 kcal 改為 590 kcal/.test(proposed.body.reply ?? ""),
          hasProteinBeforeAfter: /蛋白質：30 g 改為 34 g/.test(proposed.body.reply ?? ""),
          asksForConfirmation: /如果要套用，請回覆「好」/.test(proposed.body.reply ?? ""),
        },
        meaning: {
          returnedHttpSuccess: proposed.status === 200,
          didNotLogMeal: proposed.body.didLogMeal === false,
          didNotMutateMeal: proposed.body.didMutateMeal === false,
          proposalIsVisible: /我可以幫你把/.test(proposed.body.reply ?? ""),
        },
      });

      assert.ok(proposal);
      assert.deepEqual(proposal.updateInput, {
        calories: 590,
        protein: 34,
        carbs: 62,
        fat: 18,
      });
      assert.equal(unchangedMeal?.mealRevisionId, originalMeal.mealRevisionId);
      assert.equal(unchangedMeal?.calories, 650);
      assert.equal(unchangedMeal?.protein, 30);
      assert.equal(unchangedMeal?.carbs, 80);
      assert.equal(unchangedMeal?.fat, 20);
      assertPolicyFact(targetLookupPolicyFact, {
        tool: "find_meals",
        policyClass: "clarify-first",
        decision: "allowed",
        ruleId: "base_policy_allowed",
      });
      assertPolicyFact(estimatePolicyFact, {
        tool: "propose_meal_estimate",
        policyClass: "confirm-first",
        decision: "allowed",
        ruleId: "base_policy_allowed",
      });
      assertPolicyDbInvariant(proposalDbInvariant, {
        mealCountBefore: mealsBeforeProposal.length,
        mealCountAfter: mealsBeforeProposal.length,
        pendingPreserved: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(proposalVisibleOutcome, {
        keyLabels: {
          hasCaloriesBeforeAfter: true,
          hasProteinBeforeAfter: true,
          asksForConfirmation: true,
        },
        meaning: {
          returnedHttpSuccess: true,
          didNotLogMeal: true,
          didNotMutateMeal: true,
          proposalIsVisible: true,
        },
      });
      addEvidence(artifacts, {
        step: proposalStep,
        policyFacts: [targetLookupPolicyFact, estimatePolicyFact],
        dbInvariant: proposalDbInvariant,
        proposal: proposalSummary,
        numericDelta: numericDelta(proposal.affectedFields),
        visibleOutcome: proposalVisibleOutcome,
      });
      steps.push(pass(proposalStep, {
        policyFacts: [targetLookupPolicyFact, estimatePolicyFact],
        dbInvariant: proposalDbInvariant,
        proposal: proposalSummary,
        visibleOutcome: proposalVisibleOutcome,
      }));

      const confirmStep = STEP_NAMES[1];
      provider.reset();
      resetPublishCounts();
      const mealsBeforeConfirm = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const confirmed = await postChat(fixture.address, fixture.cookieHeader, "套用餐點修改");
      const confirmTrace = traceRecorders.at(-1)?.build({ scenario: confirmStep, status: "pass" });
      assert.ok(confirmTrace);
      const approvalPolicyFact = findPolicyFact(confirmTrace, "propose_meal_numeric_correction");
      const mealsAfterConfirm = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const confirmedMeal = mealsAfterConfirm.find((meal) => meal.id === originalMeal.id);
      const pendingAfterConfirm = await fixture.services.mealNumericProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const confirmDbInvariant = summarizeDbInvariant({
        mealCountBefore: mealsBeforeConfirm.length,
        mealCountAfter: mealsAfterConfirm.length,
        pendingConsumed: pendingAfterConfirm === undefined,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const confirmProposalSummary = summarizeProposal({
        persisted: proposal !== undefined,
        consumed: pendingAfterConfirm === undefined,
        affectedFieldCount: proposal.affectedFields.length,
        affectedFieldNames: proposal.affectedFields.map((field) => field.field),
      });
      const confirmVisibleOutcome = summarizeVisibleOutcome({
        keyLabels: {
          hasCommittedCalories: /590 kcal/.test(confirmed.body.reply ?? ""),
          hasCommittedProtein: /蛋白質 34 g/.test(confirmed.body.reply ?? ""),
        },
        meaning: {
          returnedHttpSuccess: confirmed.status === 200,
          didMutateMeal: confirmed.body.didMutateMeal === true,
          returnedSummary: Boolean(confirmed.body.dailySummary),
        },
      });

      assert.equal(confirmedMeal?.calories, proposal.updateInput?.calories);
      assert.equal(confirmedMeal?.protein, proposal.updateInput?.protein);
      assert.equal(confirmedMeal?.carbs, proposal.updateInput?.carbs);
      assert.equal(confirmedMeal?.fat, proposal.updateInput?.fat);
      assert.notEqual(confirmedMeal?.mealRevisionId, originalMeal.mealRevisionId);
      assertPolicyFact(approvalPolicyFact, {
        tool: "propose_meal_numeric_correction",
        policyClass: "confirm-first",
        decision: "allowed",
        ruleId: "meal_numeric_proposal_approval_consume",
        proposalId: proposal.proposalId,
      });
      assertPolicyDbInvariant(confirmDbInvariant, {
        mealCountBefore: mealsBeforeConfirm.length,
        mealCountAfter: mealsBeforeConfirm.length,
        pendingConsumed: true,
        dailySummaryPublishCount: 1,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(confirmVisibleOutcome, {
        keyLabels: {
          hasCommittedCalories: true,
          hasCommittedProtein: true,
        },
        meaning: {
          returnedHttpSuccess: true,
          didMutateMeal: true,
          returnedSummary: true,
        },
      });
      addEvidence(artifacts, {
        step: confirmStep,
        policyFact: approvalPolicyFact,
        dbInvariant: confirmDbInvariant,
        proposal: confirmProposalSummary,
        numericDelta: numericDelta(proposal.affectedFields),
        visibleOutcome: confirmVisibleOutcome,
      });
      steps.push(pass(confirmStep, {
        policyFact: approvalPolicyFact,
        dbInvariant: confirmDbInvariant,
        proposal: confirmProposalSummary,
        visibleOutcome: confirmVisibleOutcome,
      }));

      assertPolicyEvidenceHasNoForbiddenFields(artifacts);

      return {
        ok: true,
        steps,
        artifacts,
        consoleSummary: `PASS ${SCENARIO_NAME} ${steps.length}/${STEP_NAMES.length}`,
      };
    } catch (error) {
      const failedStep = STEP_NAMES.find((stepName) => !steps.some((step) => step.name === stepName)) ?? SCENARIO_NAME;
      steps.push(fail(failedStep, error instanceof Error ? error.message : String(error)));
      return failResult(steps, failedStep, artifacts);
    } finally {
      await fixture.close();
    }
  },
};

export default scenario;
