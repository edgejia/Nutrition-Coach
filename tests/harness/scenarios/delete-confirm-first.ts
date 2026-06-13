/**
 * Deterministic proof for the delete confirm-first lifecycle.
 *
 * Artifacts intentionally store metadata-only evidence: policy fact summaries,
 * narrow DB/publish invariants, proposal booleans, and visible outcome
 * predicates. Raw prompts, tool arguments, cookies, ids, transcripts, and DB
 * snapshots must not be persisted.
 */

import assert from "node:assert/strict";
import { createLlmTraceRecorder } from "../../../server/orchestrator/llm-trace.js";
import type { ToolPolicyDecisionFact } from "../../../server/orchestrator/tool-contract.js";
import { MEAL_DELETE_PROPOSAL_KIND } from "../../../server/services/meal-delete-proposals.js";
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

interface ChatBody {
  reply?: string;
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  deletedMealId?: string;
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
  success: boolean;
  executed: boolean;
  turnId?: string;
};

const SCENARIO_NAME = "delete-confirm-first";
const STEP_NAMES = [
  "delete_proposal_created_without_mutation",
  "delete_confirmation_deletes_previewed_meal_once",
  "delete_cancel_clears_without_mutation",
  "delete_ignore_preserves_without_mutation",
  "delete_supersede_replaces_old_proposal",
  "delete_expiry_rejects_without_mutation",
  "delete_stale_revision_rejects_without_mutation",
  "delete_cross_session_rejects_without_mutation",
  "delete_duplicate_confirmation_noops",
  "direct_delete_without_confirm_blocked_without_mutation",
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
  assert.equal(typeof fact.success, "boolean", "policy fact success must be explicit");
  assert.equal(typeof fact.executed, "boolean", "policy fact executed must be explicit");
  const success = fact.success as boolean;
  const executed = fact.executed as boolean;
  return {
    tool: String(fact.tool),
    success,
    executed,
    policyClass: fact.policyClass as PolicyEvidence["policyClass"],
    decision: fact.decision as PolicyEvidence["decision"],
    ruleId: String(fact.ruleId),
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

function summarizeVisibleOutcome(input: {
  keyLabels?: Record<string, boolean>;
  meaning?: Record<string, boolean>;
}) {
  return { ...input };
}

function summarizeProposal(input: {
  persisted: boolean;
  consumed?: boolean;
  replacedPrevious?: boolean;
  oldProposalRejected?: boolean;
  numericProposalCleared?: boolean;
  expectedRevisionMatched?: boolean;
  snapshotHasDescription?: boolean;
  snapshotHasCalories?: boolean;
  snapshotHasMacros?: boolean;
  snapshotHasDate?: boolean;
  snapshotHasMealPeriod?: boolean;
  groupedItemCount?: number;
}) {
  return { ...input };
}

function summarizeMealState(input: {
  previewedMealPresent?: boolean;
  otherMealPresent?: boolean;
  previewedRevisionUnchanged?: boolean;
  previewedMealDeleted?: boolean;
  otherMealPreserved?: boolean;
  deletedReceiptRedacted?: boolean;
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
    const readMeals = () => fixture.services.foodLoggingService.getMealsByDate(
      fixture.deviceId,
      new Date(),
    );
    const createDeleteProposalViaChat = async (label: string, items?: Array<{
      foodName: string;
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    }>) => {
      provider.reset();
      resetPublishCounts();
      const meal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
        loggedAt: new Date().toISOString(),
        items: items ?? [{ foodName: label, calories: 650, protein: 30, carbs: 80, fat: 20 }],
      });
      provider.queueRoundResponse({
        toolCalls: [{
          id: `${label}_find`,
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({
              action: "delete",
              query: label,
            }),
          },
        }],
      });
      provider.queueRoundResponse({
        toolCalls: [{
          id: `${label}_delete`,
          type: "function",
          function: {
            name: "delete_meal",
            arguments: JSON.stringify({
              meal_id: meal.id,
            }),
          },
        }],
      });
      const chat = await postChat(fixture.address, fixture.cookieHeader, `刪除${label}`);
      assert.equal(chat.status, 200);
      assert.equal(chat.body.didMutateMeal, false);
      const proposal = await fixture.services.mealDeleteProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      assert.ok(proposal);
      assert.equal(proposal.mealId, meal.id);
      return { meal, proposal, chat };
    };

    try {
      const proposalStep = STEP_NAMES[0];
      provider.reset();
      resetPublishCounts();
      const previewedMeal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
        loggedAt: new Date().toISOString(),
        items: [
          { foodName: "刪除預覽牛肉麵", calories: 520, protein: 24, carbs: 68, fat: 16 },
          { foodName: "刪除預覽滷蛋", calories: 80, protein: 7, carbs: 1, fat: 5 },
        ],
      });
      const preservedMeal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
        loggedAt: new Date().toISOString(),
        items: [{ foodName: "保留鮭魚飯", calories: 520, protein: 32, carbs: 58, fat: 14 }],
      });
      const mealsBeforeProposal = await readMeals();
      provider.queueRoundResponse({
        toolCalls: [{
          id: "delete_find_target",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({
              action: "delete",
              query: "刪除預覽牛肉麵和滷蛋",
            }),
          },
        }],
      });
      provider.queueRoundResponse({
        toolCalls: [{
          id: "delete_create_proposal",
          type: "function",
          function: {
            name: "delete_meal",
            arguments: JSON.stringify({
              meal_id: previewedMeal.id,
            }),
          },
        }],
      });

      const proposed = await postChat(
        fixture.address,
        fixture.cookieHeader,
        "刪除預覽牛肉麵和滷蛋",
      );
      const proposalTrace = traceRecorders.at(-1)?.build({ scenario: proposalStep, status: "pass" });
      assert.ok(proposalTrace);
      const targetLookupPolicyFact = findPolicyFact(proposalTrace, "find_meals");
      const deleteSetupPolicyFact = findPolicyFact(proposalTrace, "delete_meal");
      const proposal = await fixture.services.mealDeleteProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const mealsAfterProposal = await readMeals();
      const previewedAfterProposal = mealsAfterProposal.find((meal) => meal.id === previewedMeal.id);
      const preservedAfterProposal = mealsAfterProposal.find((meal) => meal.id === preservedMeal.id);
      const proposalDbInvariant = summarizeDbInvariant({
        mealCountBefore: mealsBeforeProposal.length,
        mealCountAfter: mealsAfterProposal.length,
        pendingPreserved: proposal?.mealId === previewedMeal.id,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const proposalSummary = summarizeProposal({
        persisted: proposal !== undefined,
        expectedRevisionMatched: proposal?.expectedMealRevisionId === previewedMeal.mealRevisionId,
        snapshotHasDescription: proposal?.snapshot.mealLabel === "刪除預覽牛肉麵、刪除預覽滷蛋",
        snapshotHasCalories: proposal?.snapshot.calories === 600,
        snapshotHasMacros: proposal?.snapshot.protein === 31
          && proposal.snapshot.carbs === 69
          && proposal.snapshot.fat === 21,
        snapshotHasDate: typeof proposal?.snapshot.dateKey === "string" && proposal.snapshot.dateKey.length > 0,
        snapshotHasMealPeriod: proposal?.snapshot.mealPeriod !== undefined,
        groupedItemCount: proposal?.snapshot.items?.length,
      });
      const proposalMealState = summarizeMealState({
        previewedMealPresent: previewedAfterProposal !== undefined,
        otherMealPresent: preservedAfterProposal !== undefined,
        previewedRevisionUnchanged: previewedAfterProposal?.mealRevisionId === previewedMeal.mealRevisionId,
      });
      const proposalVisibleOutcome = summarizeVisibleOutcome({
        keyLabels: {
          hasDeletePreviewHeading: /即將刪除/.test(proposed.body.reply ?? ""),
          hasDescription: /刪除預覽牛肉麵、刪除預覽滷蛋/.test(proposed.body.reply ?? ""),
          hasCalories: /600 kcal/.test(proposed.body.reply ?? ""),
          hasMacros: /P31g \/ C69g \/ F21g/.test(proposed.body.reply ?? ""),
          hasDateAndMealPeriod: /日期：\d{4}-\d{2}-\d{2} (早餐|午餐|晚餐|宵夜|餐點)/.test(
            proposed.body.reply ?? "",
          ),
          hasGroupedItems: /刪除預覽牛肉麵 520 kcal/.test(proposed.body.reply ?? "")
            && /刪除預覽滷蛋 80 kcal/.test(proposed.body.reply ?? ""),
          asksForConfirmation: /如果確認要刪除，請回覆「好」或「確認」/.test(proposed.body.reply ?? ""),
        },
        meaning: {
          returnedHttpSuccess: proposed.status === 200,
          didNotLogMeal: proposed.body.didLogMeal === false,
          didNotMutateMeal: proposed.body.didMutateMeal === false,
          proposalIsVisible: /餐點紀錄不會變更/.test(proposed.body.reply ?? ""),
        },
      });

      assert.ok(proposal);
      assert.equal(proposed.status, 200);
      assert.equal(proposed.body.didMutateMeal, false);
      assert.equal(previewedAfterProposal?.mealRevisionId, previewedMeal.mealRevisionId);
      assert.equal(preservedAfterProposal?.mealRevisionId, preservedMeal.mealRevisionId);
      assertPolicyFact(targetLookupPolicyFact, {
        tool: "find_meals",
        policyClass: "clarify-first",
        decision: "allowed",
        ruleId: "base_policy_allowed",
        requireTurnId: false,
      });
      assertPolicyFact(deleteSetupPolicyFact, {
        tool: "delete_meal",
        policyClass: "confirm-first",
        decision: "allowed",
        ruleId: "delete_meal_setup_only",
        requireTurnId: false,
      });
      assert.equal(deleteSetupPolicyFact.success, true);
      assert.equal(deleteSetupPolicyFact.executed, false);
      assertPolicyDbInvariant(proposalDbInvariant, {
        mealCountBefore: mealsBeforeProposal.length,
        mealCountAfter: mealsBeforeProposal.length,
        pendingPreserved: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(proposalVisibleOutcome, {
        keyLabels: {
          hasDeletePreviewHeading: true,
          hasDescription: true,
          hasCalories: true,
          hasMacros: true,
          hasDateAndMealPeriod: true,
          hasGroupedItems: true,
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
        policyFacts: [targetLookupPolicyFact, deleteSetupPolicyFact],
        dbInvariant: proposalDbInvariant,
        proposal: proposalSummary,
        mealState: proposalMealState,
        visibleOutcome: proposalVisibleOutcome,
      });
      steps.push(pass(proposalStep, {
        policyFacts: [targetLookupPolicyFact, deleteSetupPolicyFact],
        dbInvariant: proposalDbInvariant,
        proposal: proposalSummary,
        mealState: proposalMealState,
        visibleOutcome: proposalVisibleOutcome,
      }));

      const confirmStep = STEP_NAMES[1];
      provider.reset();
      resetPublishCounts();
      const mealsBeforeConfirm = await readMeals();
      const confirmed = await postChat(fixture.address, fixture.cookieHeader, "好");
      const confirmTrace = traceRecorders.at(-1)?.build({ scenario: confirmStep, status: "pass" });
      assert.ok(confirmTrace);
      const approvalPolicyFact = findPolicyFact(confirmTrace, "delete_meal");
      const mealsAfterConfirm = await readMeals();
      const pendingAfterConfirm = await fixture.services.mealDeleteProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const previewedAfterConfirm = mealsAfterConfirm.find((meal) => meal.id === previewedMeal.id);
      const preservedAfterConfirm = mealsAfterConfirm.find((meal) => meal.id === preservedMeal.id);
      const confirmDbInvariant = summarizeDbInvariant({
        mealCountBefore: mealsBeforeConfirm.length,
        mealCountAfter: mealsAfterConfirm.length,
        pendingConsumed: pendingAfterConfirm === undefined,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const confirmProposalSummary = summarizeProposal({
        persisted: true,
        consumed: pendingAfterConfirm === undefined,
        expectedRevisionMatched: proposal.expectedMealRevisionId === previewedMeal.mealRevisionId,
        groupedItemCount: proposal.snapshot.items?.length,
      });
      const confirmMealState = summarizeMealState({
        previewedMealDeleted: previewedAfterConfirm === undefined,
        otherMealPreserved: preservedAfterConfirm?.mealRevisionId === preservedMeal.mealRevisionId,
        deletedReceiptRedacted: confirmed.body.deletedMealId === previewedMeal.id,
      });
      const confirmVisibleOutcome = summarizeVisibleOutcome({
        keyLabels: {
          hasDeletedReceipt: /已刪除/.test(confirmed.body.reply ?? ""),
          hasRemovedCopy: /已從當日紀錄移除/.test(confirmed.body.reply ?? ""),
        },
        meaning: {
          returnedHttpSuccess: confirmed.status === 200,
          didMutateMeal: confirmed.body.didMutateMeal === true,
          returnedSummary: Boolean(confirmed.body.dailySummary),
          deletedExactlyPreviewedMeal: confirmed.body.deletedMealId === previewedMeal.id,
        },
      });

      assert.equal(confirmed.status, 200);
      assert.equal(confirmed.body.didMutateMeal, true);
      assert.equal(confirmed.body.deletedMealId, previewedMeal.id);
      assert.equal(previewedAfterConfirm, undefined);
      assert.equal(preservedAfterConfirm?.mealRevisionId, preservedMeal.mealRevisionId);
      assertPolicyFact(approvalPolicyFact, {
        tool: "delete_meal",
        policyClass: "confirm-first",
        decision: "allowed",
        ruleId: "delete_meal_approval_consume",
        requireTurnId: false,
      });
      assert.equal(approvalPolicyFact.success, true);
      assert.equal(approvalPolicyFact.executed, true);
      assertPolicyDbInvariant(confirmDbInvariant, {
        mealCountBefore: mealsBeforeConfirm.length,
        mealCountAfter: mealsBeforeConfirm.length - 1,
        pendingConsumed: true,
        dailySummaryPublishCount: 1,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(confirmVisibleOutcome, {
        keyLabels: {
          hasDeletedReceipt: true,
          hasRemovedCopy: true,
        },
        meaning: {
          returnedHttpSuccess: true,
          didMutateMeal: true,
          returnedSummary: true,
          deletedExactlyPreviewedMeal: true,
        },
      });
      addEvidence(artifacts, {
        step: confirmStep,
        policyFact: approvalPolicyFact,
        dbInvariant: confirmDbInvariant,
        proposal: confirmProposalSummary,
        mealState: confirmMealState,
        visibleOutcome: confirmVisibleOutcome,
      });
      steps.push(pass(confirmStep, {
        policyFact: approvalPolicyFact,
        dbInvariant: confirmDbInvariant,
        proposal: confirmProposalSummary,
        mealState: confirmMealState,
        visibleOutcome: confirmVisibleOutcome,
      }));

      const cancelStep = STEP_NAMES[2];
      const cancelSetup = await createDeleteProposalViaChat("刪除取消雞腿飯");
      resetPublishCounts();
      const cancelMealsBefore = await readMeals();
      const cancelled = await postChat(fixture.address, fixture.cookieHeader, "先不要");
      const cancelMealsAfter = await readMeals();
      const cancelPending = await fixture.services.mealDeleteProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const cancelMeal = cancelMealsAfter.find((meal) => meal.id === cancelSetup.meal.id);
      const cancelDbInvariant = summarizeDbInvariant({
        mealCountBefore: cancelMealsBefore.length,
        mealCountAfter: cancelMealsAfter.length,
        pendingConsumed: cancelPending === undefined,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const cancelVisibleOutcome = summarizeVisibleOutcome({
        keyLabels: { cancelledLabel: /已取消刪除/.test(cancelled.body.reply ?? "") },
        meaning: {
          returnedHttpSuccess: cancelled.status === 200,
          didNotMutateMeal: cancelled.body.didMutateMeal === false,
          clearedProposal: cancelPending === undefined,
        },
      });
      assert.equal(cancelMeal?.mealRevisionId, cancelSetup.meal.mealRevisionId);
      assertPolicyDbInvariant(cancelDbInvariant, {
        mealCountBefore: cancelMealsBefore.length,
        mealCountAfter: cancelMealsBefore.length,
        pendingConsumed: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(cancelVisibleOutcome, {
        keyLabels: { cancelledLabel: true },
        meaning: {
          returnedHttpSuccess: true,
          didNotMutateMeal: true,
          clearedProposal: true,
        },
      });
      addEvidence(artifacts, {
        step: cancelStep,
        dbInvariant: cancelDbInvariant,
        proposal: summarizeProposal({ persisted: true, consumed: true }),
        mealState: summarizeMealState({ previewedMealPresent: cancelMeal !== undefined }),
        visibleOutcome: cancelVisibleOutcome,
      });
      steps.push(pass(cancelStep, {
        dbInvariant: cancelDbInvariant,
        visibleOutcome: cancelVisibleOutcome,
      }));

      const ignoreStep = STEP_NAMES[3];
      const ignoreSetup = await createDeleteProposalViaChat("刪除忽略雞腿飯");
      provider.reset();
      provider.queueRoundResponse({ content: "先保留目前的刪除提案。" });
      resetPublishCounts();
      const ignoreMealsBefore = await readMeals();
      const ignored = await postChat(fixture.address, fixture.cookieHeader, "今天水喝夠嗎");
      const ignoreMealsAfter = await readMeals();
      const ignorePending = await fixture.services.mealDeleteProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const ignoreMeal = ignoreMealsAfter.find((meal) => meal.id === ignoreSetup.meal.id);
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
        mealState: summarizeMealState({ previewedMealPresent: ignoreMeal !== undefined }),
        visibleOutcome: ignoreVisibleOutcome,
      });
      steps.push(pass(ignoreStep, {
        dbInvariant: ignoreDbInvariant,
        visibleOutcome: ignoreVisibleOutcome,
      }));
      await fixture.services.mealDeleteProposalService.clear({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });

      const supersedeStep = STEP_NAMES[4];
      const supersedeOld = await createDeleteProposalViaChat("刪除被取代雞腿飯");
      const supersedeNewMeal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
        loggedAt: new Date().toISOString(),
        items: [{ foodName: "刪除替代鮭魚飯", calories: 520, protein: 32, carbs: 58, fat: 14 }],
      });
      const supersedeNewProposal = await fixture.services.mealDeleteProposalService.putLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
        input: {
          mealId: supersedeNewMeal.id,
          expectedMealRevisionId: supersedeNewMeal.mealRevisionId,
          snapshot: {
            mealId: supersedeNewMeal.id,
            expectedMealRevisionId: supersedeNewMeal.mealRevisionId,
            mealLabel: "刪除替代鮭魚飯",
            calories: 520,
            protein: 32,
            carbs: 58,
            fat: 14,
            dateKey: new Date().toISOString().slice(0, 10),
            loggedAt: supersedeNewMeal.loggedAt,
            mealPeriod: "lunch",
          },
        },
      });
      resetPublishCounts();
      const supersedeMealsBefore = await readMeals();
      const oldDeleteConsume = await fixture.services.mealDeleteProposalService.consumeLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
        proposalId: supersedeOld.proposal.proposalId,
        expectedMealRevisionId: supersedeOld.meal.mealRevisionId,
      });
      const activeReplacement = await fixture.services.mealDeleteProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const supersedeMealsAfter = await readMeals();
      const supersedeOldMeal = supersedeMealsAfter.find((meal) => meal.id === supersedeOld.meal.id);
      const supersedeReplacementMeal = supersedeMealsAfter.find((meal) => meal.id === supersedeNewMeal.id);
      const supersedeDbInvariant = summarizeDbInvariant({
        mealCountBefore: supersedeMealsBefore.length,
        mealCountAfter: supersedeMealsAfter.length,
        pendingPreserved: activeReplacement?.proposalId === supersedeNewProposal.proposalId,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const supersedeVisibleOutcome = summarizeVisibleOutcome({
        meaning: {
          oldProposalRejected: oldDeleteConsume === undefined,
          replacementProposalActive: activeReplacement?.proposalId === supersedeNewProposal.proposalId,
          didNotMutateMeal: supersedeOldMeal !== undefined && supersedeReplacementMeal !== undefined,
        },
      });
      assert.equal(oldDeleteConsume, undefined);
      assert.equal(supersedeOldMeal?.mealRevisionId, supersedeOld.meal.mealRevisionId);
      assert.equal(supersedeReplacementMeal?.mealRevisionId, supersedeNewMeal.mealRevisionId);
      assertPolicyDbInvariant(supersedeDbInvariant, {
        mealCountBefore: supersedeMealsBefore.length,
        mealCountAfter: supersedeMealsBefore.length,
        pendingPreserved: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(supersedeVisibleOutcome, {
        meaning: {
          oldProposalRejected: true,
          replacementProposalActive: true,
          didNotMutateMeal: true,
        },
      });
      addEvidence(artifacts, {
        step: supersedeStep,
        dbInvariant: supersedeDbInvariant,
        proposal: summarizeProposal({
          persisted: true,
          replacedPrevious: true,
          oldProposalRejected: true,
        }),
        mealState: summarizeMealState({
          previewedMealPresent: supersedeReplacementMeal !== undefined,
          otherMealPresent: supersedeOldMeal !== undefined,
        }),
        visibleOutcome: supersedeVisibleOutcome,
      });
      steps.push(pass(supersedeStep, {
        dbInvariant: supersedeDbInvariant,
        visibleOutcome: supersedeVisibleOutcome,
      }));
      await fixture.services.mealDeleteProposalService.clear({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });

      const expiryStep = STEP_NAMES[5];
      const expirySetup = await createDeleteProposalViaChat("刪除過期雞腿飯");
      fixture.services.db.$client
        .prepare(
          "UPDATE turn_states SET expires_at = ? WHERE device_id = ? AND session_id = ? AND kind = ?",
        )
        .run(
          "2026-05-16T00:00:00.000Z",
          fixture.deviceId,
          DEFAULT_SESSION_ID,
          MEAL_DELETE_PROPOSAL_KIND,
        );
      provider.reset();
      provider.queueRoundResponse({ content: "目前沒有待確認的刪除提案。" });
      resetPublishCounts();
      const expiryMealsBefore = await readMeals();
      const expired = await postChat(fixture.address, fixture.cookieHeader, "好");
      const expiryMealsAfter = await readMeals();
      const expiryMeal = expiryMealsAfter.find((meal) => meal.id === expirySetup.meal.id);
      const expiryPending = await fixture.services.mealDeleteProposalService.getLatest({
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
        mealState: summarizeMealState({ previewedMealPresent: expiryMeal !== undefined }),
        visibleOutcome: expiryVisibleOutcome,
      });
      steps.push(pass(expiryStep, {
        dbInvariant: expiryDbInvariant,
        visibleOutcome: expiryVisibleOutcome,
      }));

      const staleStep = STEP_NAMES[6];
      const staleSetup = await createDeleteProposalViaChat("刪除過時雞腿飯");
      const externalUpdate = await fixture.services.foodLoggingService.updateMeal(
        fixture.deviceId,
        staleSetup.meal.id,
        {
          expectedMealRevisionId: staleSetup.meal.mealRevisionId,
          items: [{ foodName: "新版刪除過時雞腿飯", calories: 651, protein: 31, carbs: 80, fat: 20 }],
        },
      );
      resetPublishCounts();
      const staleMealsBefore = await readMeals();
      const stale = await postChat(fixture.address, fixture.cookieHeader, "好");
      const staleTrace = traceRecorders.at(-1)?.build({ scenario: staleStep, status: "pass" });
      assert.ok(staleTrace);
      const stalePolicyFact = findPolicyFact(staleTrace, "delete_meal");
      const staleMealsAfter = await readMeals();
      const staleMeal = staleMealsAfter.find((meal) => meal.id === staleSetup.meal.id);
      const stalePending = await fixture.services.mealDeleteProposalService.getLatest({
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
        keyLabels: { staleCopy: /餐點內容已經變更/.test(stale.body.reply ?? "") },
        meaning: {
          returnedHttpSuccess: stale.status === 200,
          didNotMutateMeal: stale.body.didMutateMeal === false,
          staleRevisionRejected: staleMeal?.mealRevisionId === externalUpdate.mealRevisionId,
        },
      });
      assert.equal(staleMeal?.mealRevisionId, externalUpdate.mealRevisionId);
      assertPolicyFact(stalePolicyFact, {
        tool: "delete_meal",
        policyClass: "confirm-first",
        decision: "blocked",
        ruleId: "delete_meal_approval_stale",
        requireTurnId: false,
      });
      assert.equal(stalePolicyFact.success, false);
      assert.equal(stalePolicyFact.executed, false);
      assertPolicyDbInvariant(staleDbInvariant, {
        mealCountBefore: staleMealsBefore.length,
        mealCountAfter: staleMealsBefore.length,
        pendingConsumed: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(staleVisibleOutcome, {
        keyLabels: { staleCopy: true },
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
        mealState: summarizeMealState({ previewedMealPresent: staleMeal !== undefined }),
        visibleOutcome: staleVisibleOutcome,
      });
      steps.push(pass(staleStep, {
        policyFact: stalePolicyFact,
        dbInvariant: staleDbInvariant,
        visibleOutcome: staleVisibleOutcome,
      }));

      const crossSessionStep = STEP_NAMES[7];
      const crossSetup = await createDeleteProposalViaChat("刪除跨工作階段雞腿飯");
      const otherDeviceRes = await fixture.app.inject({
        method: "POST",
        url: "/api/device",
        payload: { goal: "fat_loss" },
      });
      assert.ok(otherDeviceRes.statusCode === 200 || otherDeviceRes.statusCode === 201);
      const otherCookieHeader = [otherDeviceRes.headers["set-cookie"]]
        .flat()
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.split(";", 1)[0])
        .join("; ");
      provider.reset();
      provider.queueRoundResponse({ content: "目前沒有待確認的刪除提案。" });
      resetPublishCounts();
      const crossMealsBefore = await readMeals();
      const cross = await postChat(fixture.address, otherCookieHeader, "好");
      const crossMealsAfter = await readMeals();
      const crossMeal = crossMealsAfter.find((meal) => meal.id === crossSetup.meal.id);
      const crossPending = await fixture.services.mealDeleteProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const crossDbInvariant = summarizeDbInvariant({
        mealCountBefore: crossMealsBefore.length,
        mealCountAfter: crossMealsAfter.length,
        pendingPreserved: crossPending?.proposalId === crossSetup.proposal.proposalId,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const crossVisibleOutcome = summarizeVisibleOutcome({
        meaning: {
          returnedHttpSuccess: cross.status === 200,
          didNotMutateMeal: cross.body.didMutateMeal === false,
          originalProposalStillPending: crossPending?.proposalId === crossSetup.proposal.proposalId,
        },
      });
      assert.equal(crossMeal?.mealRevisionId, crossSetup.meal.mealRevisionId);
      assertPolicyDbInvariant(crossDbInvariant, {
        mealCountBefore: crossMealsBefore.length,
        mealCountAfter: crossMealsBefore.length,
        pendingPreserved: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(crossVisibleOutcome, {
        meaning: {
          returnedHttpSuccess: true,
          didNotMutateMeal: true,
          originalProposalStillPending: true,
        },
      });
      addEvidence(artifacts, {
        step: crossSessionStep,
        dbInvariant: crossDbInvariant,
        proposal: summarizeProposal({ persisted: true, consumed: false }),
        mealState: summarizeMealState({ previewedMealPresent: crossMeal !== undefined }),
        visibleOutcome: crossVisibleOutcome,
      });
      steps.push(pass(crossSessionStep, {
        dbInvariant: crossDbInvariant,
        visibleOutcome: crossVisibleOutcome,
      }));
      await fixture.services.mealDeleteProposalService.clear({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });

      const duplicateStep = STEP_NAMES[8];
      const duplicateSetup = await createDeleteProposalViaChat("刪除重複確認雞腿飯");
      const firstDuplicate = await postChat(fixture.address, fixture.cookieHeader, "好");
      assert.equal(firstDuplicate.body.didMutateMeal, true);
      resetPublishCounts();
      provider.reset();
      provider.queueRoundResponse({ content: "目前沒有待確認的刪除提案。" });
      const duplicateMealsBefore = await readMeals();
      const duplicate = await postChat(fixture.address, fixture.cookieHeader, "好");
      const duplicateMealsAfter = await readMeals();
      const duplicatePending = await fixture.services.mealDeleteProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const duplicateDbInvariant = summarizeDbInvariant({
        mealCountBefore: duplicateMealsBefore.length,
        mealCountAfter: duplicateMealsAfter.length,
        pendingConsumed: duplicatePending === undefined,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const duplicateVisibleOutcome = summarizeVisibleOutcome({
        meaning: {
          returnedHttpSuccess: duplicate.status === 200,
          didNotMutateMealAgain: duplicate.body.didMutateMeal !== true,
          deletedMealStillAbsent: !duplicateMealsAfter.some((meal) => meal.id === duplicateSetup.meal.id),
        },
      });
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
          deletedMealStillAbsent: true,
        },
      });
      addEvidence(artifacts, {
        step: duplicateStep,
        dbInvariant: duplicateDbInvariant,
        proposal: summarizeProposal({ persisted: true, consumed: true }),
        mealState: summarizeMealState({ previewedMealDeleted: true }),
        visibleOutcome: duplicateVisibleOutcome,
      });
      steps.push(pass(duplicateStep, {
        dbInvariant: duplicateDbInvariant,
        visibleOutcome: duplicateVisibleOutcome,
      }));

      const directStep = STEP_NAMES[9];
      provider.reset();
      resetPublishCounts();
      const directMealForSetup = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
        loggedAt: new Date().toISOString(),
        items: [{ foodName: "刪除直接工具雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 }],
      });
      await fixture.services.mealNumericProposalService.putLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
        input: {
          mealId: directMealForSetup.id,
          expectedMealRevisionId: directMealForSetup.mealRevisionId,
          updateInput: { protein: 14 },
          affectedFields: [{ field: "protein", before: 30, after: 14 }],
          sourceOperator: "half",
        },
      });
      provider.queueRoundResponse({
        toolCalls: [{
          id: "direct_delete_find",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({
              action: "delete",
              query: "刪除直接工具雞腿飯",
            }),
          },
        }],
      });
      provider.queueRoundResponse({
        toolCalls: [{
          id: "direct_delete_setup",
          type: "function",
          function: {
            name: "delete_meal",
            arguments: JSON.stringify({
              meal_id: directMealForSetup.id,
            }),
          },
        }],
      });
      const directSetup = await postChat(
        fixture.address,
        fixture.cookieHeader,
        "刪除直接工具雞腿飯",
      );
      const directTrace = traceRecorders.at(-1)?.build({ scenario: directStep, status: "pass" });
      assert.ok(directTrace);
      const directDeletePolicyFact = findPolicyFact(directTrace, "delete_meal");
      const directMealsAfter = await readMeals();
      const directPending = await fixture.services.mealDeleteProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const directNumericPending = await fixture.services.mealNumericProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      const directMeal = directMealsAfter.find((meal) => meal.id === directMealForSetup.id);
      const directDbInvariant = summarizeDbInvariant({
        mealCountBefore: directMealsAfter.length,
        mealCountAfter: directMealsAfter.length,
        pendingPreserved: directPending?.mealId === directMealForSetup.id,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const directVisibleOutcome = summarizeVisibleOutcome({
        keyLabels: {
          hasPreviewOnlyCopy: /即將刪除/.test(directSetup.body.reply ?? "")
            && /如果確認要刪除/.test(directSetup.body.reply ?? ""),
          hasNoDeletedReceipt: !/已刪除/.test(directSetup.body.reply ?? ""),
        },
        meaning: {
          returnedHttpSuccess: directSetup.status === 200,
          didNotMutateMeal: directSetup.body.didMutateMeal === false,
          proposalStillPending: directPending?.mealId === directMealForSetup.id,
          numericProposalCleared: directNumericPending === undefined,
        },
      });
      assert.equal(directSetup.status, 200);
      assert.equal(directSetup.body.didMutateMeal, false);
      assert.equal(directMeal?.mealRevisionId, directMealForSetup.mealRevisionId);
      assert.equal(directNumericPending, undefined);
      assertPolicyFact(directDeletePolicyFact, {
        tool: "delete_meal",
        policyClass: "confirm-first",
        decision: "allowed",
        ruleId: "delete_meal_setup_only",
        requireTurnId: false,
      });
      assert.equal(directDeletePolicyFact.success, true);
      assert.equal(directDeletePolicyFact.executed, false);
      assertPolicyDbInvariant(directDbInvariant, {
        mealCountBefore: directMealsAfter.length,
        mealCountAfter: directMealsAfter.length,
        pendingPreserved: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(directVisibleOutcome, {
        keyLabels: {
          hasPreviewOnlyCopy: true,
          hasNoDeletedReceipt: true,
        },
        meaning: {
          returnedHttpSuccess: true,
          didNotMutateMeal: true,
          proposalStillPending: true,
          numericProposalCleared: true,
        },
      });
      addEvidence(artifacts, {
        step: directStep,
        policyFact: directDeletePolicyFact,
        dbInvariant: directDbInvariant,
        proposal: summarizeProposal({ persisted: true, consumed: false, numericProposalCleared: true }),
        mealState: summarizeMealState({ previewedMealPresent: directMeal !== undefined }),
        visibleOutcome: directVisibleOutcome,
      });
      steps.push(pass(directStep, {
        policyFact: directDeletePolicyFact,
        dbInvariant: directDbInvariant,
        visibleOutcome: directVisibleOutcome,
      }));

      assert.equal(steps.length, STEP_NAMES.length, "negative delete controls not implemented");
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
