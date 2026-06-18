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
import {
  MEAL_NUMERIC_PROPOSAL_KIND,
  type MealNumericAffectedField,
  type MealNumericUpdateInput,
} from "../../../server/services/meal-numeric-proposals.js";

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
  "estimate_decline_clears_without_mutation",
  "estimate_ignore_preserves_without_mutation",
  "estimate_supersede_replaces_old_proposal",
  "estimate_expiry_rejects_without_mutation",
  "estimate_stale_revision_rejects_without_mutation",
  "estimate_duplicate_confirmation_noops",
  "direct_estimated_update_blocked_without_mutation",
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
    const findMeal = async (mealId: string) => {
      const meals = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      return meals.find((meal) => meal.id === mealId);
    };
    const createEstimateProposalViaChat = async (
      label: string,
      estimated: Required<MealNumericUpdateInput>,
    ) => {
      provider.reset();
      resetPublishCounts();
      const meal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
        loggedAt: new Date().toISOString(),
        items: [{ foodName: label, calories: 650, protein: 30, carbs: 80, fat: 20 }],
      });
      provider.queueRoundResponse({
        toolCalls: [{
          id: `${label}_find`,
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({
              action: "update",
              query: `${label} 幫我估合理一點然後更新`,
            }),
          },
        }],
      });
      provider.queueRoundResponse({
        toolCalls: [{
          id: `${label}_estimate`,
          type: "function",
          function: {
            name: "propose_meal_estimate",
            arguments: JSON.stringify({
              meal_id: meal.id,
              fields: ["calories", "protein", "carbs", "fat"],
              estimated,
            }),
          },
        }],
      });
      const chat = await postChat(
        fixture.address,
        fixture.cookieHeader,
        "幫我估合理一點然後更新",
      );
      assert.equal(chat.status, 200);
      assert.equal(chat.body.didMutateMeal, false);
      const proposal = await fixture.services.mealNumericProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      assert.ok(proposal);
      assert.equal(proposal.mealId, meal.id);
      assert.equal(proposal.provenance, "model_estimate");
      return { meal, proposal };
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

      const declineStep = STEP_NAMES[2];
      const declineSetup = await createEstimateProposalViaChat("估值取消飯", {
        calories: 600,
        protein: 33,
        carbs: 64,
        fat: 19,
      });
      resetPublishCounts();
      const declineMealsBefore = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const declined = await postChat(fixture.address, fixture.cookieHeader, "先不用套用餐點修改");
      const declineMealsAfter = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const declineMeal = declineMealsAfter.find((meal) => meal.id === declineSetup.meal.id);
      const declinePending = await fixture.services.mealNumericProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const declineDbInvariant = summarizeDbInvariant({
        mealCountBefore: declineMealsBefore.length,
        mealCountAfter: declineMealsAfter.length,
        pendingConsumed: declinePending === undefined,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const declineVisibleOutcome = summarizeVisibleOutcome({
        keyLabels: {
          cancelledLabel: /取消|不用/.test(declined.body.reply ?? ""),
        },
        meaning: {
          returnedHttpSuccess: declined.status === 200,
          didNotMutateMeal: declined.body.didMutateMeal === false,
          clearedProposal: declinePending === undefined,
        },
      });
      assert.equal(declineMeal?.mealRevisionId, declineSetup.meal.mealRevisionId);
      assert.equal(declineMeal?.calories, 650);
      assertPolicyDbInvariant(declineDbInvariant, {
        mealCountBefore: declineMealsBefore.length,
        mealCountAfter: declineMealsBefore.length,
        pendingConsumed: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(declineVisibleOutcome, {
        keyLabels: { cancelledLabel: true },
        meaning: {
          returnedHttpSuccess: true,
          didNotMutateMeal: true,
          clearedProposal: true,
        },
      });
      addEvidence(artifacts, {
        step: declineStep,
        dbInvariant: declineDbInvariant,
        proposal: summarizeProposal({ persisted: true, consumed: true }),
        visibleOutcome: declineVisibleOutcome,
      });
      steps.push(pass(declineStep, {
        dbInvariant: declineDbInvariant,
        visibleOutcome: declineVisibleOutcome,
      }));

      const ignoreStep = STEP_NAMES[3];
      const ignoreSetup = await createEstimateProposalViaChat("估值忽略飯", {
        calories: 610,
        protein: 35,
        carbs: 66,
        fat: 17,
      });
      resetPublishCounts();
      provider.reset();
      provider.queueRoundResponse({ content: "先保留目前的餐點修正提案。" });
      const ignoreMealsBefore = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const ignored = await postChat(fixture.address, fixture.cookieHeader, "今天水喝夠嗎");
      const ignoreMealsAfter = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const ignoreMeal = ignoreMealsAfter.find((meal) => meal.id === ignoreSetup.meal.id);
      const ignorePending = await fixture.services.mealNumericProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const ignoreDbInvariant = summarizeDbInvariant({
        mealCountBefore: ignoreMealsBefore.length,
        mealCountAfter: ignoreMealsAfter.length,
        pendingPreserved: ignorePending?.proposalId === ignoreSetup.proposal.proposalId,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const ignoreVisibleOutcome = summarizeVisibleOutcome({
        meaning: {
          returnedHttpSuccess: ignored.status === 200,
          didNotMutateMeal: ignored.body.didMutateMeal === false,
          preservedProposal: ignorePending?.proposalId === ignoreSetup.proposal.proposalId,
        },
      });
      assert.equal(ignoreMeal?.mealRevisionId, ignoreSetup.meal.mealRevisionId);
      assert.equal(ignoreMeal?.protein, 30);
      assertPolicyDbInvariant(ignoreDbInvariant, {
        mealCountBefore: ignoreMealsBefore.length,
        mealCountAfter: ignoreMealsBefore.length,
        pendingPreserved: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(ignoreVisibleOutcome, {
        meaning: {
          returnedHttpSuccess: true,
          didNotMutateMeal: true,
          preservedProposal: true,
        },
      });
      addEvidence(artifacts, {
        step: ignoreStep,
        dbInvariant: ignoreDbInvariant,
        proposal: summarizeProposal({ persisted: true, consumed: false }),
        visibleOutcome: ignoreVisibleOutcome,
      });
      steps.push(pass(ignoreStep, {
        dbInvariant: ignoreDbInvariant,
        visibleOutcome: ignoreVisibleOutcome,
      }));
      await fixture.services.mealNumericProposalService.clear({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });

      const supersedeStep = STEP_NAMES[4];
      const supersedeSetup = await createEstimateProposalViaChat("估值替換飯", {
        calories: 620,
        protein: 36,
        carbs: 68,
        fat: 16,
      });
      resetPublishCounts();
      provider.reset();
      provider.queueRoundResponse({
        toolCalls: [{
          id: "supersede_find",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({
              action: "update",
              query: "估值替換飯 蛋白質改成 38g",
            }),
          },
        }],
      });
      provider.queueRoundResponse({
        toolCalls: [{
          id: "supersede_numeric",
          type: "function",
          function: {
            name: "propose_meal_numeric_correction",
            arguments: JSON.stringify({
              meal_id: supersedeSetup.meal.id,
              fields: ["protein"],
              operator: "set",
              value: 38,
            }),
          },
        }],
      });
      const supersedeMealsBefore = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const superseded = await postChat(fixture.address, fixture.cookieHeader, "蛋白質改成 38g");
      const supersedeMealsAfter = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const replacementProposal = await fixture.services.mealNumericProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      assert.ok(replacementProposal);
      const oldEstimateConsume = await fixture.services.mealNumericProposalService.consumeLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
        proposalId: supersedeSetup.proposal.proposalId,
        expectedMealRevisionId: supersedeSetup.meal.mealRevisionId,
      });
      const supersedeMeal = supersedeMealsAfter.find((meal) => meal.id === supersedeSetup.meal.id);
      const supersedeTrace = traceRecorders.at(-1)?.build({ scenario: supersedeStep, status: "pass" });
      assert.ok(supersedeTrace);
      const supersedePolicyFact = findPolicyFact(supersedeTrace, "propose_meal_numeric_correction");
      const supersedeDbInvariant = summarizeDbInvariant({
        mealCountBefore: supersedeMealsBefore.length,
        mealCountAfter: supersedeMealsAfter.length,
        pendingPreserved: replacementProposal.proposalId !== supersedeSetup.proposal.proposalId,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const supersedeVisibleOutcome = summarizeVisibleOutcome({
        keyLabels: {
          hasReplacementProposal: /蛋白質：30 g 改為 38 g/.test(superseded.body.reply ?? ""),
        },
        meaning: {
          returnedHttpSuccess: superseded.status === 200,
          didNotMutateMeal: superseded.body.didMutateMeal === false,
          oldProposalRejected: oldEstimateConsume === undefined,
        },
      });
      assert.equal(replacementProposal.provenance, undefined);
      assert.notEqual(replacementProposal.proposalId, supersedeSetup.proposal.proposalId);
      assert.equal(replacementProposal.updateInput?.protein, 38);
      assert.equal(supersedeMeal?.mealRevisionId, supersedeSetup.meal.mealRevisionId);
      assertPolicyFact(supersedePolicyFact, {
        tool: "propose_meal_numeric_correction",
        policyClass: "confirm-first",
        decision: "allowed",
        ruleId: "base_policy_allowed",
      });
      assertPolicyDbInvariant(supersedeDbInvariant, {
        mealCountBefore: supersedeMealsBefore.length,
        mealCountAfter: supersedeMealsBefore.length,
        pendingPreserved: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(supersedeVisibleOutcome, {
        keyLabels: { hasReplacementProposal: true },
        meaning: {
          returnedHttpSuccess: true,
          didNotMutateMeal: true,
          oldProposalRejected: true,
        },
      });
      addEvidence(artifacts, {
        step: supersedeStep,
        policyFact: supersedePolicyFact,
        dbInvariant: supersedeDbInvariant,
        proposal: summarizeProposal({
          persisted: true,
          replacedPrevious: true,
          affectedFieldCount: replacementProposal.affectedFields.length,
          affectedFieldNames: replacementProposal.affectedFields.map((field) => field.field),
        }),
        visibleOutcome: supersedeVisibleOutcome,
      });
      steps.push(pass(supersedeStep, {
        policyFact: supersedePolicyFact,
        dbInvariant: supersedeDbInvariant,
        visibleOutcome: supersedeVisibleOutcome,
      }));
      await fixture.services.mealNumericProposalService.clear({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });

      const expiryStep = STEP_NAMES[5];
      const expirySetup = await createEstimateProposalViaChat("估值過期飯", {
        calories: 580,
        protein: 32,
        carbs: 60,
        fat: 15,
      });
      fixture.services.db.$client
        .prepare(
          "UPDATE turn_states SET expires_at = ? WHERE device_id = ? AND session_id = ? AND kind = ?",
        )
        .run(
          "2026-05-16T00:00:00.000Z",
          fixture.deviceId,
          DEFAULT_SESSION_ID,
          MEAL_NUMERIC_PROPOSAL_KIND,
        );
      resetPublishCounts();
      provider.reset();
      provider.queueRoundResponse({ content: "目前沒有待套用的餐點修改。" });
      const expiryMealsBefore = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const expired = await postChat(fixture.address, fixture.cookieHeader, "套用餐點修改");
      const expiryMealsAfter = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const expiryMeal = expiryMealsAfter.find((meal) => meal.id === expirySetup.meal.id);
      const expiryPending = await fixture.services.mealNumericProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const expiryDbInvariant = summarizeDbInvariant({
        mealCountBefore: expiryMealsBefore.length,
        mealCountAfter: expiryMealsAfter.length,
        pendingConsumed: expiryPending === undefined,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const expiryVisibleOutcome = summarizeVisibleOutcome({
        meaning: {
          returnedHttpSuccess: expired.status === 200,
          didNotMutateMeal: expired.body.didMutateMeal === false,
          expiredProposalRejected: expiryPending === undefined,
        },
      });
      assert.equal(expiryMeal?.mealRevisionId, expirySetup.meal.mealRevisionId);
      assert.equal(expiryMeal?.carbs, 80);
      assertPolicyDbInvariant(expiryDbInvariant, {
        mealCountBefore: expiryMealsBefore.length,
        mealCountAfter: expiryMealsBefore.length,
        pendingConsumed: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(expiryVisibleOutcome, {
        meaning: {
          returnedHttpSuccess: true,
          didNotMutateMeal: true,
          expiredProposalRejected: true,
        },
      });
      addEvidence(artifacts, {
        step: expiryStep,
        dbInvariant: expiryDbInvariant,
        proposal: summarizeProposal({ persisted: true, consumed: true }),
        visibleOutcome: expiryVisibleOutcome,
      });
      steps.push(pass(expiryStep, {
        dbInvariant: expiryDbInvariant,
        visibleOutcome: expiryVisibleOutcome,
      }));

      const staleStep = STEP_NAMES[6];
      const staleSetup = await createEstimateProposalViaChat("估值過時飯", {
        calories: 570,
        protein: 31,
        carbs: 58,
        fat: 14,
      });
      const externalUpdate = await fixture.services.foodLoggingService.updateMeal(
        fixture.deviceId,
        staleSetup.meal.id,
        {
          expectedMealRevisionId: staleSetup.meal.mealRevisionId,
          items: [{ foodName: "新版估值過時飯", calories: 651, protein: 31, carbs: 80, fat: 20 }],
        },
      );
      resetPublishCounts();
      const staleMealsBefore = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const stale = await postChat(fixture.address, fixture.cookieHeader, "套用餐點修改");
      const staleTrace = traceRecorders.at(-1)?.build({ scenario: staleStep, status: "pass" });
      assert.ok(staleTrace);
      const stalePolicyFact = findPolicyFact(staleTrace, "propose_meal_numeric_correction");
      const staleMealsAfter = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const staleMeal = staleMealsAfter.find((meal) => meal.id === staleSetup.meal.id);
      const stalePending = await fixture.services.mealNumericProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const staleDbInvariant = summarizeDbInvariant({
        mealCountBefore: staleMealsBefore.length,
        mealCountAfter: staleMealsAfter.length,
        pendingConsumed: stalePending === undefined,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const staleVisibleOutcome = summarizeVisibleOutcome({
        meaning: {
          returnedHttpSuccess: stale.status === 200,
          didNotMutateMeal: stale.body.didMutateMeal === false,
          staleRevisionRejected: staleMeal?.mealRevisionId === externalUpdate.mealRevisionId,
        },
      });
      assert.equal(staleMeal?.calories, 651);
      assert.equal(staleMeal?.mealRevisionId, externalUpdate.mealRevisionId);
      assertPolicyFact(stalePolicyFact, {
        tool: "propose_meal_numeric_correction",
        policyClass: "confirm-first",
        decision: "allowed",
        ruleId: "meal_numeric_proposal_approval_consume",
        proposalId: staleSetup.proposal.proposalId,
      });
      assertPolicyDbInvariant(staleDbInvariant, {
        mealCountBefore: staleMealsBefore.length,
        mealCountAfter: staleMealsBefore.length,
        pendingConsumed: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(staleVisibleOutcome, {
        meaning: {
          returnedHttpSuccess: true,
          didNotMutateMeal: true,
          staleRevisionRejected: true,
        },
      });
      addEvidence(artifacts, {
        step: staleStep,
        policyFact: stalePolicyFact,
        dbInvariant: staleDbInvariant,
        proposal: summarizeProposal({ persisted: true, consumed: true }),
        visibleOutcome: staleVisibleOutcome,
      });
      steps.push(pass(staleStep, {
        policyFact: stalePolicyFact,
        dbInvariant: staleDbInvariant,
        visibleOutcome: staleVisibleOutcome,
      }));

      const duplicateStep = STEP_NAMES[7];
      const duplicateSetup = await createEstimateProposalViaChat("估值重複飯", {
        calories: 560,
        protein: 33,
        carbs: 61,
        fat: 13,
      });
      const firstDuplicate = await postChat(fixture.address, fixture.cookieHeader, "套用餐點修改");
      assert.equal(firstDuplicate.body.didMutateMeal, true);
      const afterFirstDuplicate = await findMeal(duplicateSetup.meal.id);
      resetPublishCounts();
      provider.reset();
      provider.queueRoundResponse({ content: "目前沒有待套用的餐點修改。" });
      const duplicateMealsBefore = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const duplicate = await postChat(fixture.address, fixture.cookieHeader, "套用餐點修改");
      const duplicateMealsAfter = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const duplicateMeal = duplicateMealsAfter.find((meal) => meal.id === duplicateSetup.meal.id);
      const duplicateDbInvariant = summarizeDbInvariant({
        mealCountBefore: duplicateMealsBefore.length,
        mealCountAfter: duplicateMealsAfter.length,
        pendingConsumed: await fixture.services.mealNumericProposalService.getLatest({
          deviceId: fixture.deviceId,
          sessionId: DEFAULT_SESSION_ID,
        }) === undefined,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const duplicateVisibleOutcome = summarizeVisibleOutcome({
        meaning: {
          returnedHttpSuccess: duplicate.status === 200,
          didNotMutateMealAgain: duplicate.body.didMutateMeal !== true,
          revisionUnchangedAfterSecondConfirm: duplicateMeal?.mealRevisionId === afterFirstDuplicate?.mealRevisionId,
        },
      });
      assert.equal(duplicateMeal?.calories, duplicateSetup.proposal.updateInput?.calories);
      assert.equal(duplicateMeal?.mealRevisionId, afterFirstDuplicate?.mealRevisionId);
      assertPolicyDbInvariant(duplicateDbInvariant, {
        mealCountBefore: duplicateMealsBefore.length,
        mealCountAfter: duplicateMealsBefore.length,
        pendingConsumed: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(duplicateVisibleOutcome, {
        meaning: {
          returnedHttpSuccess: true,
          didNotMutateMealAgain: true,
          revisionUnchangedAfterSecondConfirm: true,
        },
      });
      addEvidence(artifacts, {
        step: duplicateStep,
        dbInvariant: duplicateDbInvariant,
        proposal: summarizeProposal({ persisted: true, consumed: true }),
        visibleOutcome: duplicateVisibleOutcome,
      });
      steps.push(pass(duplicateStep, {
        dbInvariant: duplicateDbInvariant,
        visibleOutcome: duplicateVisibleOutcome,
      }));

      const directStep = STEP_NAMES[8];
      provider.reset();
      resetPublishCounts();
      const directMeal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
        loggedAt: new Date().toISOString(),
        items: [{ foodName: "估值直改飯", calories: 650, protein: 30, carbs: 80, fat: 20 }],
      });
      provider.queueRoundResponse({
        toolCalls: [{
          id: "direct_find",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({
              action: "update",
              query: "估值直改飯 幫我估合理一點然後更新",
            }),
          },
        }],
      });
      provider.queueRoundResponse({
        toolCalls: [{
          id: "direct_update",
          type: "function",
          function: {
            name: "update_meal",
            arguments: JSON.stringify({
              meal_id: directMeal.id,
              calories: 590,
              protein: 34,
              carbs: 62,
              fat: 18,
            }),
          },
        }],
      });
      const directMealsBefore = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const direct = await postChat(
        fixture.address,
        fixture.cookieHeader,
        "幫我估合理一點然後更新",
      );
      const directTrace = traceRecorders.at(-1)?.build({ scenario: directStep, status: "pass" });
      assert.ok(directTrace);
      const directPolicyFact = findPolicyFact(directTrace, "update_meal");
      const directMealsAfter = await fixture.services.foodLoggingService.getMealsByDate(
        fixture.deviceId,
        new Date(),
      );
      const directMealAfter = directMealsAfter.find((meal) => meal.id === directMeal.id);
      const directPending = await fixture.services.mealNumericProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const directDbInvariant = summarizeDbInvariant({
        mealCountBefore: directMealsBefore.length,
        mealCountAfter: directMealsAfter.length,
        pendingConsumed: directPending === undefined,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const directVisibleOutcome = summarizeVisibleOutcome({
        keyLabels: {
          authorityFailureCopy: /這次沒有更新餐點紀錄/.test(direct.body.reply ?? ""),
        },
        meaning: {
          returnedHttpSuccess: direct.status === 200,
          didNotMutateMeal: direct.body.didMutateMeal === false,
          createdNoProposal: directPending === undefined,
        },
      });
      assert.equal(directMealAfter?.mealRevisionId, directMeal.mealRevisionId);
      assert.equal(directMealAfter?.calories, 650);
      assert.equal(directMealAfter?.protein, 30);
      assertPolicyFact(directPolicyFact, {
        tool: "update_meal",
        policyClass: "direct-execute",
        decision: "allowed",
        ruleId: "base_policy_allowed",
      });
      assertPolicyDbInvariant(directDbInvariant, {
        mealCountBefore: directMealsBefore.length,
        mealCountAfter: directMealsBefore.length,
        pendingConsumed: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(directVisibleOutcome, {
        keyLabels: { authorityFailureCopy: true },
        meaning: {
          returnedHttpSuccess: true,
          didNotMutateMeal: true,
          createdNoProposal: true,
        },
      });
      addEvidence(artifacts, {
        step: directStep,
        policyFact: directPolicyFact,
        dbInvariant: directDbInvariant,
        proposal: summarizeProposal({ persisted: false, consumed: true }),
        visibleOutcome: directVisibleOutcome,
      });
      steps.push(pass(directStep, {
        policyFact: directPolicyFact,
        dbInvariant: directDbInvariant,
        visibleOutcome: directVisibleOutcome,
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
