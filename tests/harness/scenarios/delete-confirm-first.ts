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
  turnId?: string;
};

const SCENARIO_NAME = "delete-confirm-first";
const STEP_NAMES = [
  "delete_proposal_created_without_mutation",
  "delete_confirmation_deletes_previewed_meal_once",
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
      });
      assertPolicyFact(deleteSetupPolicyFact, {
        tool: "delete_meal",
        policyClass: "confirm-first",
        decision: "allowed",
        ruleId: "delete_meal_setup_only",
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
        proposalId: proposal.proposalId,
      });
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
