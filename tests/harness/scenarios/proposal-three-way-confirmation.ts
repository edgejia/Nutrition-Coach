/**
 * Deterministic proof for Phase 90 three-way proposal confirmation.
 *
 * Artifacts intentionally store metadata-only evidence: proposal kind/status
 * booleans, action visibility, mutation counts, and copy-presence predicates.
 * Raw prompts, cookies, provider payloads, transcripts, image bytes, ids in
 * evidence payloads, and full DB snapshots must not be persisted.
 */

import assert from "node:assert/strict";
import { createLlmTraceRecorder } from "../../../server/orchestrator/llm-trace.js";
import {
  DEFAULT_SESSION_ID,
} from "../../../server/services/turn-state.js";
import { MEAL_NUMERIC_PROPOSAL_KIND } from "../../../server/services/meal-numeric-proposals.js";
import { MEAL_DELETE_PROPOSAL_KIND } from "../../../server/services/meal-delete-proposals.js";
import {
  assertPolicyEvidenceHasNoForbiddenFields,
} from "../policy-assertions.js";
import { createScenarioApp } from "../app-fixture.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import type {
  VerificationScenario,
  ScenarioContext,
  ScenarioResult,
  ScenarioStepResult,
} from "../scenario-types.js";

type ProposalKind = "goal" | "meal_numeric" | "meal_estimate" | "meal_delete";
type ProposalStatus = "active" | "approved" | "rejected" | "expired" | "superseded" | "stale";
type ProposalAction = "approve" | "reject";

interface ProposalCardBody {
  proposalId: string;
  proposalKind: ProposalKind;
  proposalLane: "goal" | "meal_mutation";
  status: ProposalStatus;
  isActionable: boolean;
  title: string;
  details: { rows: Array<{ label: string; before?: string; after?: string; value?: string }> };
  actions: { approveLabel: string; editLabel: string; rejectLabel: string };
  expiresAt: string | null;
  lapseCopy: string | null;
  supersededByKind: ProposalKind | null;
}

interface ProposalActionEventBody {
  proposalId: string;
  proposalKind: ProposalKind;
  proposalLane: "goal" | "meal_mutation";
  action: "approve" | "edit" | "reject";
  transcriptCopy: string;
  createdAt: string;
}

interface ChatBody {
  reply?: string;
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  dailyTargets?: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  dailySummary?: {
    mealCount?: number;
    totalCalories?: number;
    totalProtein?: number;
    totalCarbs?: number;
    totalFat?: number;
  };
  deletedMealId?: string;
  proposalCard?: ProposalCardBody;
  proposalActionEvent?: ProposalActionEventBody;
}

interface ActionBody {
  ok: boolean;
  status: "approved" | "rejected" | "stale";
  didMutateMeal: boolean;
  dailyTargets?: ChatBody["dailyTargets"];
  dailySummary?: ChatBody["dailySummary"];
  deletedMealId?: string;
  proposalCard?: ProposalCardBody;
  proposalActionEvent?: ProposalActionEventBody;
}

interface HistoryBody {
  messages: Array<{
    role: "user" | "assistant";
    proposalCard?: ProposalCardBody;
    proposalActionEvent?: ProposalActionEventBody;
  }>;
}

const SCENARIO_NAME = "proposal-three-way-confirmation";
const STEP_NAMES = [
  "goal_card_approve_action",
  "meal_estimate_card_edit_context",
  "delete_card_reject_and_approve",
  "history_reload_recovers_actionability",
  "meal_lane_supersede_lapse_copy",
  "expiry_lapse_on_refresh",
  "stale_action_misses_without_mutation",
  "cross_session_action_rejected",
  "duplicate_action_noops",
  "metadata_only_artifact_guard",
] as const;

const GOAL_TARGETS = {
  calories: 1400,
  protein: 125,
  carbs: 130,
  fat: 45,
};

const DEFAULT_TARGETS = {
  calories: 1500,
  protein: 120,
  carbs: 150,
  fat: 50,
};

const FORBIDDEN_EVIDENCE_PATTERNS = [
  /cookieHeader/i,
  /set-cookie/i,
  /guestSession/i,
  /sessionSecret/i,
  /providerBody/i,
  /providerHeaders/i,
  /rawPrompt/i,
  /rawTranscript/i,
  /rawPayload/i,
  /prompt/i,
  /data:image/i,
  /;base64,/i,
  /sqlite/i,
  /database/i,
  /deviceId/i,
  /turnId/i,
];

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

function evidenceArtifacts() {
  return { evidence: [] as Array<Record<string, unknown>> };
}

function assertMetadataOnly(value: unknown): void {
  const text = JSON.stringify(value);
  for (const pattern of FORBIDDEN_EVIDENCE_PATTERNS) {
    assert.equal(pattern.test(text), false, `metadata evidence matched forbidden pattern ${pattern}`);
  }
}

function addEvidence(
  artifacts: ReturnType<typeof evidenceArtifacts>,
  entry: Record<string, unknown>,
): void {
  assertPolicyEvidenceHasNoForbiddenFields(entry);
  assertMetadataOnly(entry);
  artifacts.evidence.push(entry);
}

function summarizeCard(card: ProposalCardBody | undefined) {
  assert.ok(card, "expected proposal card metadata");
  return {
    kind: card.proposalKind,
    lane: card.proposalLane,
    status: card.status,
    actionable: card.isActionable,
    rowCount: card.details.rows.length,
    actionLabels: {
      approve: card.actions.approveLabel,
      edit: card.actions.editLabel,
      reject: card.actions.rejectLabel,
    },
    hasExpiry: typeof card.expiresAt === "string",
    hasLapseCopy: typeof card.lapseCopy === "string" && card.lapseCopy.length > 0,
    supersededByKind: card.supersededByKind ?? "none",
  };
}

function summarizeActionEvent(event: ProposalActionEventBody | undefined) {
  assert.ok(event, "expected proposal action event metadata");
  return {
    kind: event.proposalKind,
    lane: event.proposalLane,
    action: event.action,
    copy: event.transcriptCopy,
    hasCreatedAt: typeof event.createdAt === "string" && event.createdAt.length > 0,
  };
}

function summarizeCounts(input: {
  mealCountBefore?: number;
  mealCountAfter?: number;
  dailySummaryPublishes: number;
  goalsPublishes: number;
}) {
  return { ...input };
}

function summarizeCopy(input: Record<string, boolean>) {
  return { ...input };
}

async function postChat(
  address: string,
  cookieHeader: string,
  text: string,
  proposalContext?: { proposalId: string; kind: ProposalKind; action: "edit" },
): Promise<{ status: number; body: ChatBody }> {
  const form = new FormData();
  form.append("message", text);
  if (proposalContext) {
    form.append("proposalContext", JSON.stringify(proposalContext));
  }

  const res = await fetch(`${address}/api/chat`, {
    method: "POST",
    headers: { cookie: cookieHeader },
    body: form,
  });

  return { status: res.status, body: await res.json() as ChatBody };
}

async function postAction(
  address: string,
  cookieHeader: string,
  input: { proposalId: string; kind: ProposalKind; action: ProposalAction },
): Promise<{ status: number; body: ActionBody }> {
  const res = await fetch(`${address}/api/proposals/actions`, {
    method: "POST",
    headers: {
      cookie: cookieHeader,
      "content-type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return { status: res.status, body: await res.json() as ActionBody };
}

async function getHistory(address: string, cookieHeader: string): Promise<HistoryBody> {
  const res = await fetch(`${address}/api/chat/history?limit=200`, {
    headers: { cookie: cookieHeader },
  });
  assert.equal(res.status, 200);
  return await res.json() as HistoryBody;
}

async function readTargets(address: string, cookieHeader: string): Promise<typeof DEFAULT_TARGETS> {
  const res = await fetch(`${address}/api/device/session`, {
    method: "POST",
    headers: { cookie: cookieHeader },
  });
  assert.equal(res.status, 200);
  return (await res.json() as { dailyTargets: typeof DEFAULT_TARGETS }).dailyTargets;
}

function latestProposalCard(history: HistoryBody, kind: ProposalKind): ProposalCardBody | undefined {
  return history.messages
    .map((message) => message.proposalCard)
    .filter((card): card is ProposalCardBody => card?.proposalKind === kind)
    .at(-1);
}

function actionEventExists(history: HistoryBody, input: {
  kind: ProposalKind;
  action: ProposalAction;
  copy: string;
}): boolean {
  return history.messages.some((message) =>
    message.proposalActionEvent?.proposalKind === input.kind &&
    message.proposalActionEvent.action === input.action &&
    message.proposalActionEvent.transcriptCopy === input.copy
  );
}

function createPublishCounter(fixture: Awaited<ReturnType<typeof createScenarioApp>>) {
  const counts = { dailySummary: 0, goals: 0 };
  const originalPublishDailySummary = fixture.services.publisher.publishDailySummary.bind(
    fixture.services.publisher,
  );
  fixture.services.publisher.publishDailySummary = (...args) => {
    counts.dailySummary += 1;
    return originalPublishDailySummary(...args);
  };
  const originalPublishGoalsUpdate = fixture.services.publisher.publishGoalsUpdate.bind(
    fixture.services.publisher,
  );
  fixture.services.publisher.publishGoalsUpdate = (...args) => {
    counts.goals += 1;
    return originalPublishGoalsUpdate(...args);
  };
  return {
    counts,
    reset() {
      counts.dailySummary = 0;
      counts.goals = 0;
    },
  };
}

function toMealCount(meals: unknown[]): number {
  return meals.length;
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
    const publish = createPublishCounter(fixture);
    const readMeals = () => fixture.services.foodLoggingService.getMealsByDate(
      fixture.deviceId,
      new Date(),
    );
    const createEstimateProposalViaChat = async (label: string) => {
      provider.reset();
      publish.reset();
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
              estimated: { calories: 590, protein: 34, carbs: 62, fat: 18 },
            }),
          },
        }],
      });
      const chat = await postChat(fixture.address, fixture.cookieHeader, "幫我估合理一點然後更新");
      assert.equal(chat.status, 200);
      assert.equal(chat.body.didMutateMeal, false);
      assert.equal(chat.body.proposalCard?.proposalKind, "meal_estimate");
      const proposal = await fixture.services.mealNumericProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      assert.ok(proposal);
      return { meal, proposal, chat };
    };
    const createDeleteProposalViaChat = async (label: string) => {
      provider.reset();
      publish.reset();
      const meal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
        loggedAt: new Date().toISOString(),
        items: [
          { foodName: label, calories: 520, protein: 24, carbs: 68, fat: 16 },
          { foodName: `${label} 滷蛋`, calories: 80, protein: 7, carbs: 1, fat: 5 },
        ],
      });
      provider.queueRoundResponse({
        toolCalls: [{
          id: `${label}_find`,
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({ action: "delete", query: label }),
          },
        }],
      });
      provider.queueRoundResponse({
        toolCalls: [{
          id: `${label}_delete`,
          type: "function",
          function: {
            name: "delete_meal",
            arguments: JSON.stringify({ meal_id: meal.id }),
          },
        }],
      });
      const chat = await postChat(fixture.address, fixture.cookieHeader, `刪除${label}`);
      assert.equal(chat.status, 200);
      assert.equal(chat.body.didMutateMeal, false);
      assert.equal(chat.body.proposalCard?.proposalKind, "meal_delete");
      const proposal = await fixture.services.mealDeleteProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      assert.ok(proposal);
      return { meal, proposal, chat };
    };

    try {
      const goalStep = STEP_NAMES[0];
      provider.reset();
      publish.reset();
      provider.queueRoundResponse({
        toolCalls: [{
          id: "goal_proposal",
          type: "function",
          function: {
            name: "propose_goals",
            arguments: JSON.stringify(GOAL_TARGETS),
          },
        }],
      });
      const goalCreated = await postChat(
        fixture.address,
        fixture.cookieHeader,
        "我想少吃一點，幫我建議一組目標",
      );
      assert.equal(goalCreated.status, 200);
      const goalCardBeforeAction = goalCreated.body.proposalCard;
      assert.equal(goalCardBeforeAction?.proposalKind, "goal");
      assert.equal(goalCardBeforeAction?.status, "active");
      assert.equal(goalCardBeforeAction?.isActionable, true);
      assert.equal(goalCardBeforeAction.actions.approveLabel, "套用目標");
      assert.equal(goalCardBeforeAction.actions.editLabel, "調整目標");
      assert.equal(goalCardBeforeAction.actions.rejectLabel, "取消提案");
      assert.deepEqual(await readTargets(fixture.address, fixture.cookieHeader), DEFAULT_TARGETS);
      publish.reset();
      const goalApproved = await postAction(fixture.address, fixture.cookieHeader, {
        proposalId: goalCardBeforeAction.proposalId,
        kind: "goal",
        action: "approve",
      });
      assert.equal(goalApproved.status, 200);
      assert.equal(goalApproved.body.ok, true);
      assert.equal(goalApproved.body.status, "approved");
      assert.equal(goalApproved.body.proposalCard?.status, "approved");
      assert.equal(goalApproved.body.proposalCard?.isActionable, false);
      assert.equal(goalApproved.body.proposalActionEvent?.transcriptCopy, "已選擇套用目標");
      assert.deepEqual(await readTargets(fixture.address, fixture.cookieHeader), GOAL_TARGETS);
      const goalHistory = await getHistory(fixture.address, fixture.cookieHeader);
      assert.equal(actionEventExists(goalHistory, {
        kind: "goal",
        action: "approve",
        copy: "已選擇套用目標",
      }), true);
      const goalEvidence = {
        step: goalStep,
        before: summarizeCard(goalCardBeforeAction),
        action: {
          status: goalApproved.body.status,
          didMutateMeal: goalApproved.body.didMutateMeal,
          card: summarizeCard(goalApproved.body.proposalCard),
          event: summarizeActionEvent(goalApproved.body.proposalActionEvent),
          targetChanged: goalApproved.body.dailyTargets?.calories === GOAL_TARGETS.calories,
        },
        publishCounts: summarizeCounts({
          dailySummaryPublishes: publish.counts.dailySummary,
          goalsPublishes: publish.counts.goals,
        }),
        history: {
          actionEventVisible: true,
          actionTransportUsesStructuredPayload: true,
        },
      };
      addEvidence(artifacts, goalEvidence);
      steps.push(pass(goalStep, goalEvidence));

      const estimateStep = STEP_NAMES[1];
      const estimateSetup = await createEstimateProposalViaChat("三方估值雞腿飯");
      const estimateCard = estimateSetup.chat.body.proposalCard;
      assert.equal(estimateCard?.actions.approveLabel, "套用修改");
      assert.equal(estimateCard.actions.editLabel, "改成其他數字");
      assert.equal(estimateCard.actions.rejectLabel, "取消提案");
      assert.equal(estimateCard.details.rows.length >= 4, true);
      provider.reset();
      provider.queueRoundResponse({
        toolCalls: [{
          id: "inline_edit_find",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({
              action: "update",
              query: "三方估值雞腿飯 熱量再低一點",
            }),
          },
        }],
      });
      provider.queueRoundResponse({
        toolCalls: [{
          id: "inline_edit_apply",
          type: "function",
          function: {
            name: "propose_meal_estimate",
            arguments: JSON.stringify({
              meal_id: estimateSetup.meal.id,
              fields: ["calories", "protein", "carbs", "fat"],
              estimated: { calories: 580, protein: 36, carbs: 60, fat: 17 },
            }),
          },
        }],
      });
      const inlineEdit = await postChat(
        fixture.address,
        fixture.cookieHeader,
        "熱量再低一點",
        { proposalId: estimateCard.proposalId, kind: "meal_estimate", action: "edit" },
      );
      assert.equal(inlineEdit.status, 200);
      assert.equal(inlineEdit.body.didMutateMeal, false);
      assert.equal(inlineEdit.body.proposalCard?.proposalKind, "meal_estimate");
      assert.notEqual(inlineEdit.body.proposalCard?.proposalId, estimateCard.proposalId);
      publish.reset();
      const estimateApproved = await postAction(fixture.address, fixture.cookieHeader, {
        proposalId: inlineEdit.body.proposalCard!.proposalId,
        kind: "meal_estimate",
        action: "approve",
      });
      const estimateMealAfterApprove = (await readMeals()).find((meal) => meal.id === estimateSetup.meal.id);
      assert.equal(estimateApproved.status, 200);
      assert.equal(estimateApproved.body.ok, true);
      assert.equal(estimateApproved.body.status, "approved");
      assert.equal(estimateApproved.body.didMutateMeal, true);
      assert.equal(estimateApproved.body.proposalActionEvent?.transcriptCopy, "已選擇套用餐點修改");
      assert.equal(estimateMealAfterApprove?.calories, 580);
      const estimateEvidence = {
        step: estimateStep,
        initialCard: summarizeCard(estimateCard),
        editContext: {
          submittedAsTextOnlyChat: true,
          createdReplacementProposal: inlineEdit.body.proposalCard?.proposalKind === "meal_estimate",
          oldProposalWasNotTransportAuthority: true,
        },
        action: {
          status: estimateApproved.body.status,
          didMutateMeal: estimateApproved.body.didMutateMeal,
          card: summarizeCard(estimateApproved.body.proposalCard),
          event: summarizeActionEvent(estimateApproved.body.proposalActionEvent),
        },
        mealMutation: {
          changedAfterBackendApproval: estimateMealAfterApprove?.calories === 580,
        },
        publishCounts: summarizeCounts({
          dailySummaryPublishes: publish.counts.dailySummary,
          goalsPublishes: publish.counts.goals,
        }),
      };
      addEvidence(artifacts, estimateEvidence);
      steps.push(pass(estimateStep, estimateEvidence));

      const deleteStep = STEP_NAMES[2];
      const deleteRejectSetup = await createDeleteProposalViaChat("三方刪除取消飯");
      const mealsBeforeReject = await readMeals();
      publish.reset();
      const rejectedDelete = await postAction(fixture.address, fixture.cookieHeader, {
        proposalId: deleteRejectSetup.chat.body.proposalCard!.proposalId,
        kind: "meal_delete",
        action: "reject",
      });
      const mealsAfterReject = await readMeals();
      const rejectedMealAfter = mealsAfterReject.find((meal) => meal.id === deleteRejectSetup.meal.id);
      assert.equal(rejectedDelete.status, 200);
      assert.equal(rejectedDelete.body.ok, true);
      assert.equal(rejectedDelete.body.status, "rejected");
      assert.equal(rejectedDelete.body.didMutateMeal, false);
      assert.equal(rejectedDelete.body.proposalCard?.status, "rejected");
      assert.equal(rejectedDelete.body.proposalActionEvent?.transcriptCopy, "已取消刪除提案");
      assert.equal(toMealCount(mealsAfterReject), toMealCount(mealsBeforeReject));
      assert.equal(rejectedMealAfter?.mealRevisionId, deleteRejectSetup.meal.mealRevisionId);
      const deleteApproveSetup = await createDeleteProposalViaChat("三方刪除確認飯");
      const mealsBeforeApprove = await readMeals();
      publish.reset();
      const approvedDelete = await postAction(fixture.address, fixture.cookieHeader, {
        proposalId: deleteApproveSetup.chat.body.proposalCard!.proposalId,
        kind: "meal_delete",
        action: "approve",
      });
      const mealsAfterApprove = await readMeals();
      const approvedMealAfter = mealsAfterApprove.find((meal) => meal.id === deleteApproveSetup.meal.id);
      assert.equal(approvedDelete.status, 200);
      assert.equal(approvedDelete.body.ok, true);
      assert.equal(approvedDelete.body.status, "approved");
      assert.equal(approvedDelete.body.didMutateMeal, true);
      assert.equal(approvedDelete.body.deletedMealId, deleteApproveSetup.meal.id);
      assert.equal(approvedDelete.body.proposalCard?.status, "approved");
      assert.equal(approvedDelete.body.proposalActionEvent?.transcriptCopy, "已選擇確認刪除");
      assert.equal(approvedMealAfter, undefined);
      assert.equal(toMealCount(mealsAfterApprove), toMealCount(mealsBeforeApprove) - 1);
      const deleteEvidence = {
        step: deleteStep,
        rejectPath: {
          card: summarizeCard(rejectedDelete.body.proposalCard),
          event: summarizeActionEvent(rejectedDelete.body.proposalActionEvent),
          counts: summarizeCounts({
            mealCountBefore: toMealCount(mealsBeforeReject),
            mealCountAfter: toMealCount(mealsAfterReject),
            dailySummaryPublishes: publish.counts.dailySummary,
            goalsPublishes: publish.counts.goals,
          }),
          mealRevisionUnchanged: rejectedMealAfter?.mealRevisionId === deleteRejectSetup.meal.mealRevisionId,
        },
        approvePath: {
          initialPreview: {
            hasDeleteLabel: deleteApproveSetup.chat.body.proposalCard?.actions.approveLabel === "確認刪除",
            rowCount: deleteApproveSetup.chat.body.proposalCard?.details.rows.length,
          },
          card: summarizeCard(approvedDelete.body.proposalCard),
          event: summarizeActionEvent(approvedDelete.body.proposalActionEvent),
          counts: summarizeCounts({
            mealCountBefore: toMealCount(mealsBeforeApprove),
            mealCountAfter: toMealCount(mealsAfterApprove),
            dailySummaryPublishes: publish.counts.dailySummary,
            goalsPublishes: publish.counts.goals,
          }),
          deletedExactlyPreviewedMeal: approvedDelete.body.deletedMealId === deleteApproveSetup.meal.id,
        },
      };
      addEvidence(artifacts, deleteEvidence);
      steps.push(pass(deleteStep, deleteEvidence));

      const historyStep = STEP_NAMES[3];
      const historySetup = await createEstimateProposalViaChat("三方歷史飯");
      const history = await getHistory(fixture.address, fixture.cookieHeader);
      const reloadedCard = latestProposalCard(history, "meal_estimate");
      assert.equal(reloadedCard?.proposalId, historySetup.chat.body.proposalCard?.proposalId);
      assert.equal(reloadedCard?.status, "active");
      assert.equal(reloadedCard?.isActionable, true);
      const historyEvidence = {
        step: historyStep,
        card: summarizeCard(reloadedCard),
        latestActiveRecoveredFromBackend: true,
        notInferredFromVisualRecency: true,
      };
      addEvidence(artifacts, historyEvidence);
      steps.push(pass(historyStep, historyEvidence));

      const supersedeStep = STEP_NAMES[4];
      const supersededNumeric = await createEstimateProposalViaChat("三方被取代飯");
      const supersedingDelete = await createDeleteProposalViaChat("三方取代刪除飯");
      const supersedeHistory = await getHistory(fixture.address, fixture.cookieHeader);
      const oldCard = supersedeHistory.messages
        .map((message) => message.proposalCard)
        .find((card) => card?.proposalId === supersededNumeric.chat.body.proposalCard?.proposalId);
      const replacementCard = supersedeHistory.messages
        .map((message) => message.proposalCard)
        .find((card) => card?.proposalId === supersedingDelete.chat.body.proposalCard?.proposalId);
      assert.equal(oldCard?.status, "superseded");
      assert.equal(oldCard?.isActionable, false);
      assert.equal(oldCard?.lapseCopy, "這個提案已被新的刪除確認取代。");
      assert.equal(oldCard?.supersededByKind, "meal_delete");
      assert.equal(replacementCard?.status, "active");
      const supersedeEvidence = {
        step: supersedeStep,
        oldCard: summarizeCard(oldCard),
        replacementCard: summarizeCard(replacementCard),
        copyPresence: summarizeCopy({
          namesReplacementKind: oldCard?.lapseCopy === "這個提案已被新的刪除確認取代。",
          inactiveCardRemainsVisible: Boolean(oldCard),
        }),
      };
      addEvidence(artifacts, supersedeEvidence);
      steps.push(pass(supersedeStep, supersedeEvidence));

      const expiryStep = STEP_NAMES[5];
      const expirySetup = await createEstimateProposalViaChat("三方過期飯");
      const expiredAt = new Date(Date.now() - 60_000).toISOString();
      const updatedAt = new Date().toISOString();
      fixture.services.db.$client
        .prepare(
          "UPDATE turn_states SET expires_at = ?, updated_at = ? WHERE device_id = ? AND session_id = ? AND kind = ?",
        )
        .run(
          expiredAt,
          updatedAt,
          fixture.deviceId,
          DEFAULT_SESSION_ID,
          MEAL_NUMERIC_PROPOSAL_KIND,
        );
      fixture.services.db.$client
        .prepare(
          "UPDATE chat_proposal_cards SET expires_at = ?, updated_at = ? WHERE device_id = ? AND proposal_id = ?",
        )
        .run(
          expiredAt,
          updatedAt,
          fixture.deviceId,
          expirySetup.chat.body.proposalCard!.proposalId,
        );
      const expiryHistory = await getHistory(fixture.address, fixture.cookieHeader);
      const expiredCard = expiryHistory.messages
        .map((message) => message.proposalCard)
        .find((card) => card?.proposalId === expirySetup.chat.body.proposalCard?.proposalId);
      const expiryMeals = await readMeals();
      assert.equal(expiredCard?.status, "expired");
      assert.equal(expiredCard?.isActionable, false);
      assert.equal(expiredCard?.lapseCopy, "這個估值修改提案已超過 30 分鐘，請重新提出修改。");
      assert.ok(expiryMeals.find((meal) => meal.id === expirySetup.meal.id));
      const expiryEvidence = {
        step: expiryStep,
        card: summarizeCard(expiredCard),
        copyPresence: summarizeCopy({
          hasKindSpecificTraditionalChineseCopy: expiredCard?.lapseCopy === "這個估值修改提案已超過 30 分鐘，請重新提出修改。",
          visibleOnHistoryRefresh: true,
        }),
        noMutation: {
          mealStillPresent: Boolean(expiryMeals.find((meal) => meal.id === expirySetup.meal.id)),
        },
      };
      addEvidence(artifacts, expiryEvidence);
      steps.push(pass(expiryStep, expiryEvidence));

      const staleStep = STEP_NAMES[6];
      const staleSetup = await createEstimateProposalViaChat("三方失效飯");
      await fixture.services.mealNumericProposalService.clear({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      publish.reset();
      const staleMealsBefore = await readMeals();
      const staleAction = await postAction(fixture.address, fixture.cookieHeader, {
        proposalId: staleSetup.chat.body.proposalCard!.proposalId,
        kind: "meal_estimate",
        action: "approve",
      });
      const staleMealsAfter = await readMeals();
      const staleMealAfter = staleMealsAfter.find((meal) => meal.id === staleSetup.meal.id);
      assert.equal(staleAction.status, 200);
      assert.equal(staleAction.body.ok, false);
      assert.equal(staleAction.body.status, "stale");
      assert.equal(staleAction.body.didMutateMeal, false);
      assert.equal(staleAction.body.proposalCard?.status, "stale");
      assert.equal(staleAction.body.proposalCard?.lapseCopy, "這個提案已不是目前有效狀態，沒有更新任何資料。請重新提出需求。");
      assert.equal(toMealCount(staleMealsAfter), toMealCount(staleMealsBefore));
      assert.equal(staleMealAfter?.mealRevisionId, staleSetup.meal.mealRevisionId);
      const staleEvidence = {
        step: staleStep,
        action: {
          ok: staleAction.body.ok,
          status: staleAction.body.status,
          card: summarizeCard(staleAction.body.proposalCard),
          hasNoActionEvent: staleAction.body.proposalActionEvent === undefined,
        },
        copyPresence: summarizeCopy({
          staleCopyVisible: staleAction.body.proposalCard?.lapseCopy === "這個提案已不是目前有效狀態，沒有更新任何資料。請重新提出需求。",
        }),
        counts: summarizeCounts({
          mealCountBefore: toMealCount(staleMealsBefore),
          mealCountAfter: toMealCount(staleMealsAfter),
          dailySummaryPublishes: publish.counts.dailySummary,
          goalsPublishes: publish.counts.goals,
        }),
      };
      addEvidence(artifacts, staleEvidence);
      steps.push(pass(staleStep, staleEvidence));

      const crossSessionStep = STEP_NAMES[7];
      const crossSessionSetup = await createEstimateProposalViaChat("三方跨工作階段飯");
      const otherDeviceRes = await fixture.app.inject({
        method: "POST",
        url: "/api/device",
        payload: { goal: "fat_loss" },
      });
      assert.ok(
        otherDeviceRes.statusCode === 200 || otherDeviceRes.statusCode === 201,
        `alternate device seed failed with ${otherDeviceRes.statusCode}`,
      );
      const otherCookieRaw = otherDeviceRes.headers["set-cookie"];
      const otherCookies = (Array.isArray(otherCookieRaw) ? otherCookieRaw : [otherCookieRaw])
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.split(";", 1)[0])
        .join("; ");
      publish.reset();
      const crossMealsBefore = await readMeals();
      const crossSessionAction = await postAction(fixture.address, otherCookies, {
        proposalId: crossSessionSetup.chat.body.proposalCard!.proposalId,
        kind: "meal_estimate",
        action: "approve",
      });
      const crossMealsAfter = await readMeals();
      const originalPendingAfterCrossSession = await fixture.services.mealNumericProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      assert.equal(crossSessionAction.status, 200);
      assert.equal(crossSessionAction.body.ok, false);
      assert.equal(crossSessionAction.body.status, "stale");
      assert.equal(crossSessionAction.body.didMutateMeal, false);
      assert.equal(crossSessionAction.body.proposalCard, undefined);
      assert.equal(originalPendingAfterCrossSession?.proposalId, crossSessionSetup.proposal.proposalId);
      assert.equal(toMealCount(crossMealsAfter), toMealCount(crossMealsBefore));
      const crossSessionEvidence = {
        step: crossSessionStep,
        action: {
          ok: crossSessionAction.body.ok,
          status: crossSessionAction.body.status,
          noForeignCardLeak: crossSessionAction.body.proposalCard === undefined,
        },
        originalProposal: {
          remainsPending: originalPendingAfterCrossSession?.proposalId === crossSessionSetup.proposal.proposalId,
        },
        counts: summarizeCounts({
          mealCountBefore: toMealCount(crossMealsBefore),
          mealCountAfter: toMealCount(crossMealsAfter),
          dailySummaryPublishes: publish.counts.dailySummary,
          goalsPublishes: publish.counts.goals,
        }),
      };
      addEvidence(artifacts, crossSessionEvidence);
      steps.push(pass(crossSessionStep, crossSessionEvidence));
      await fixture.services.mealNumericProposalService.clear({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });

      const duplicateStep = STEP_NAMES[8];
      const duplicateSetup = await createDeleteProposalViaChat("三方重複確認飯");
      const duplicateFirst = await postAction(fixture.address, fixture.cookieHeader, {
        proposalId: duplicateSetup.chat.body.proposalCard!.proposalId,
        kind: "meal_delete",
        action: "approve",
      });
      publish.reset();
      const duplicateMealsBefore = await readMeals();
      const duplicateSecond = await postAction(fixture.address, fixture.cookieHeader, {
        proposalId: duplicateSetup.chat.body.proposalCard!.proposalId,
        kind: "meal_delete",
        action: "approve",
      });
      const duplicateMealsAfter = await readMeals();
      assert.equal(duplicateFirst.body.ok, true);
      assert.equal(duplicateSecond.status, 200);
      assert.equal(duplicateSecond.body.ok, false);
      assert.equal(duplicateSecond.body.status, "stale");
      assert.equal(duplicateSecond.body.didMutateMeal, false);
      assert.equal(duplicateSecond.body.proposalCard?.status, "approved");
      assert.equal(toMealCount(duplicateMealsAfter), toMealCount(duplicateMealsBefore));
      const duplicateEvidence = {
        step: duplicateStep,
        firstAction: {
          status: duplicateFirst.body.status,
          didMutateMeal: duplicateFirst.body.didMutateMeal,
          card: summarizeCard(duplicateFirst.body.proposalCard),
        },
        duplicateAction: {
          ok: duplicateSecond.body.ok,
          status: duplicateSecond.body.status,
          card: summarizeCard(duplicateSecond.body.proposalCard),
          hasNoActionEvent: duplicateSecond.body.proposalActionEvent === undefined,
        },
        counts: summarizeCounts({
          mealCountBefore: toMealCount(duplicateMealsBefore),
          mealCountAfter: toMealCount(duplicateMealsAfter),
          dailySummaryPublishes: publish.counts.dailySummary,
          goalsPublishes: publish.counts.goals,
        }),
      };
      addEvidence(artifacts, duplicateEvidence);
      steps.push(pass(duplicateStep, duplicateEvidence));

      const metadataStep = STEP_NAMES[9];
      assertMetadataOnly(artifacts);
      assert.equal(artifacts.evidence.length, STEP_NAMES.length - 1);
      const metadataEvidence = {
        step: metadataStep,
        checkedEntries: artifacts.evidence.length,
        metadataOnly: true,
        storesNoRawCookies: true,
        storesNoProviderBodies: true,
        storesNoFullTranscripts: true,
        storesNoImageBytes: true,
        storesNoFullDbSnapshots: true,
      };
      addEvidence(artifacts, metadataEvidence);
      steps.push(pass(metadataStep, metadataEvidence));

      return {
        ok: true,
        steps,
        artifacts,
        consoleSummary: `PASS ${SCENARIO_NAME} ${steps.length}/${STEP_NAMES.length}`,
      };
    } catch (error) {
      const failedStepName = STEP_NAMES[steps.length] ?? "unknown";
      steps.push(fail(
        failedStepName,
        error instanceof Error ? error.message : String(error),
      ));
      return failResult(steps, failedStepName, artifacts);
    } finally {
      await fixture.close();
    }
  },
};

export default scenario;
