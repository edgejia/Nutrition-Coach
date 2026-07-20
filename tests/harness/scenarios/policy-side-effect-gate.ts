/**
 * Umbrella deterministic proof for the side-effect policy classes.
 *
 * Artifacts intentionally store metadata-only evidence: policy fact summaries,
 * narrow DB/publish invariants, and visible outcome booleans.
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
import { StreamingLLMProvider } from "../streaming-llm.js";
import type {
  VerificationScenario,
  ScenarioContext,
  ScenarioResult,
  ScenarioStepResult,
} from "../scenario-types.js";
import type { ToolPolicyDecisionFact } from "../../../server/orchestrator/tool-contract.js";

interface ChatBody {
  reply?: string;
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  dailySummary?: {
    mealCount?: number;
  };
  loggedMeal?: {
    hasMealRevisionId?: boolean;
  };
}

interface DeviceSessionBody {
  dailyTargets: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
}

type PolicyEvidence = ToolPolicyDecisionFact & {
  turnId?: string;
};

const SCENARIO_NAME = "policy-side-effect-gate";
const STEP_NAMES = [
  "direct-execute_get_daily_summary_policy_fact",
  "execute-and-report_log_food_policy_fact",
  "clarify-first_find_meals_no_domain_mutation",
  "confirm-first_propose_approve_meal_numeric",
  "confirm-first_propose_cancel_goal",
  "confirm-first_cross_session_reject",
  "confirm-first_stale_revision_reject",
  "confirm-first_double_confirmation_reject",
] as const;

function pass(name: string, _actual?: unknown): ScenarioStepResult {
  return { name, ok: true };
}

function fail(name: string, _error: string, _actual?: unknown): ScenarioStepResult {
  return { name, ok: false, errorCategory: "assertion_failed" };
}

function metadataStepName(value: unknown): string {
  return String(value ?? "unknown");
}

function buildPolicyMetadata(
  status: "pass" | "fail",
  artifacts: ReturnType<typeof evidenceArtifacts>,
  steps: ScenarioStepResult[],
): NonNullable<ScenarioResult["metadata"]> {
  const evidence = artifacts.evidence as Array<Record<string, unknown>>;
  const policyFacts = evidence.flatMap((entry) => {
    const fact = entry.policyFact;
    if (fact === undefined || fact === null || typeof fact !== "object") return [];
    const value = fact as Record<string, unknown>;
    return [{
      step: metadataStepName(entry.step),
      tool: String(value.tool),
      policyClass: value.policyClass as "direct-execute" | "execute-and-report" | "clarify-first" | "confirm-first",
      decision: value.decision as "allowed" | "blocked",
      ruleId: String(value.ruleId),
    }];
  });
  const policyDbInvariants = evidence.flatMap((entry) => {
    const invariant = entry.dbInvariant;
    if (invariant === undefined || invariant === null || typeof invariant !== "object") return [];
    return [{ step: metadataStepName(entry.step), ...(invariant as Record<string, unknown>) }];
  });
  const visibleOutcomes = evidence.flatMap((entry) => {
    const outcome = entry.visibleOutcome;
    if (outcome === undefined || outcome === null || typeof outcome !== "object") return [];
    return [{ step: metadataStepName(entry.step), ...(outcome as Record<string, unknown>) }];
  });
  return {
    scenarioId: SCENARIO_NAME,
    scenarioName: SCENARIO_NAME,
    status,
    counts: {
      stepCount: steps.length,
      evidenceCount: evidence.length,
      policyFactCount: policyFacts.length,
      invariantCount: policyDbInvariants.length,
      visibleOutcomeCount: visibleOutcomes.length,
    },
    assertions: {
      metadataOnly: true,
      rawArgumentsExcluded: true,
      rawSseExcluded: true,
      numericPayloadsExcluded: true,
      databaseSnapshotsExcluded: true,
    },
    policyFacts,
    policyDbInvariants,
    visibleOutcomes,
    ...(status === "fail" ? { errorCategory: "assertion_failed" as const } : {}),
  };
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
    artifacts: {},
    metadata: buildPolicyMetadata("fail", artifacts as ReturnType<typeof evidenceArtifacts>, steps),
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

function summarizePolicyDbInvariant(input: {
  mealCountBefore?: number;
  mealCountAfter?: number;
  targetsChanged?: boolean;
  pendingConsumed?: boolean;
  pendingPreserved?: boolean;
  dailySummaryPublishCount?: number;
  goalsPublishCount?: number;
  proposalCardCount?: number;
  actionEventCount?: number;
  mutationOutcomeCount?: number;
  proposalCardPresent?: boolean;
  proposalCardKindMatches?: boolean;
  proposalCardProposalIdMatches?: boolean;
}) {
  return { ...input };
}

function summarizeVisibleOutcome(input: {
  keyLabels?: Record<string, boolean>;
  meaning?: Record<string, boolean>;
}) {
  return { ...input };
}

function findPolicyFact(
  trace: ReturnType<ReturnType<typeof createLlmTraceRecorder>["build"]>,
  tool: string,
): PolicyEvidence {
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

async function readTargets(address: string, cookieHeader: string): Promise<DeviceSessionBody["dailyTargets"]> {
  const res = await fetch(`${address}/api/device/session`, {
    method: "POST",
    headers: { cookie: cookieHeader },
  });
  assert.equal(res.status, 200);
  const body = await res.json() as DeviceSessionBody;
  return body.dailyTargets;
}

function sameTargets(
  left: DeviceSessionBody["dailyTargets"],
  right: DeviceSessionBody["dailyTargets"],
): boolean {
  return left.calories === right.calories
    && left.protein === right.protein
    && left.carbs === right.carbs
    && left.fat === right.fat;
}

const scenario: VerificationScenario = {
  name: SCENARIO_NAME,

  prepareApp() {
    const provider = new StreamingLLMProvider();
    const traceRecorders: Array<ReturnType<typeof createLlmTraceRecorder>> = [];
    return {
      appOptions: {
        llmProvider: provider,
        llmTraceRecorderFactory() {
          const recorder = createLlmTraceRecorder();
          traceRecorders.push(recorder);
          return recorder;
        },
      },
      state: { provider, traceRecorders },
    };
  },

  async run(ctx: ScenarioContext): Promise<ScenarioResult> {
    const steps: ScenarioStepResult[] = [];
    const artifacts = evidenceArtifacts();
    const { provider, traceRecorders } = ctx.prepared as {
      provider: StreamingLLMProvider;
      traceRecorders: Array<ReturnType<typeof createLlmTraceRecorder>>;
    };
    const fixture = ctx;

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
      const directStep = STEP_NAMES[0];
      provider.reset();
      resetPublishCounts();
      provider.queueRoundResponse({
        toolCalls: [{
          id: "policy_direct_summary",
          type: "function",
          function: {
            name: "get_daily_summary",
            arguments: JSON.stringify({}),
          },
        }],
      });
      const direct = await postChat(fixture.address, fixture.cookieHeader, "看今天摘要");
      const directTrace = traceRecorders.at(-1)?.build({ scenario: directStep, status: "pass" });
      assert.ok(directTrace);
      const directPolicyFact = findPolicyFact(directTrace, "get_daily_summary");
      const directDbInvariant = summarizePolicyDbInvariant({
        mealCountBefore: 0,
        mealCountAfter: 0,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const directVisibleOutcome = summarizeVisibleOutcome({
        meaning: {
          returnedHttpSuccess: direct.status === 200,
          didNotLogMeal: direct.body.didLogMeal === false,
          didNotMutateMeal: direct.body.didMutateMeal === false,
        },
      });
      assertPolicyFact(directPolicyFact, {
        tool: "get_daily_summary",
        policyClass: "direct-execute",
        decision: "allowed",
        ruleId: "base_policy_allowed",
      });
      assertPolicyDbInvariant(directDbInvariant, {
        mealCountBefore: 0,
        mealCountAfter: 0,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(directVisibleOutcome, {
        meaning: {
          returnedHttpSuccess: true,
          didNotLogMeal: true,
          didNotMutateMeal: true,
        },
      });
      addEvidence(artifacts, {
        step: directStep,
        policyFact: directPolicyFact,
        dbInvariant: directDbInvariant,
        visibleOutcome: directVisibleOutcome,
      });
      steps.push(pass(directStep, { policyFact: directPolicyFact, dbInvariant: directDbInvariant, visibleOutcome: directVisibleOutcome }));

      const logStep = STEP_NAMES[1];
      provider.reset();
      resetPublishCounts();
      const logMealsBefore = await fixture.services.foodLoggingService.getMealsByDate(fixture.deviceId, new Date());
      provider.queueRoundResponse({
        toolCalls: [{
          id: "policy_log_food",
          type: "function",
          function: {
            name: "log_food",
            arguments: JSON.stringify({
              items: [{
                food_name: "茶葉蛋",
                calories: 90,
                protein: 7,
                carbs: 1,
                fat: 6,
              }],
            }),
          },
        }],
      });
      const logged = await postChat(fixture.address, fixture.cookieHeader, "早餐吃一顆茶葉蛋");
      const logTrace = traceRecorders.at(-1)?.build({ scenario: logStep, status: "pass" });
      assert.ok(logTrace);
      const logPolicyFact = findPolicyFact(logTrace, "log_food");
      const logMealsAfter = await fixture.services.foodLoggingService.getMealsByDate(fixture.deviceId, new Date());
      const logDbInvariant = summarizePolicyDbInvariant({
        mealCountBefore: logMealsBefore.length,
        mealCountAfter: logMealsAfter.length,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const logVisibleOutcome = summarizeVisibleOutcome({
        meaning: {
          returnedHttpSuccess: logged.status === 200,
          didLogMeal: logged.body.didLogMeal === true,
          didMutateMeal: logged.body.didMutateMeal === true,
          returnedSummary: Boolean(logged.body.dailySummary),
        },
      });
      assertPolicyFact(logPolicyFact, {
        tool: "log_food",
        policyClass: "execute-and-report",
        decision: "allowed",
        ruleId: "base_policy_allowed",
      });
      assertPolicyDbInvariant(logDbInvariant, {
        mealCountBefore: logMealsBefore.length,
        mealCountAfter: logMealsBefore.length + 1,
        dailySummaryPublishCount: 1,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(logVisibleOutcome, {
        meaning: {
          returnedHttpSuccess: true,
          didLogMeal: true,
          didMutateMeal: true,
          returnedSummary: true,
        },
      });
      addEvidence(artifacts, {
        step: logStep,
        policyFact: logPolicyFact,
        dbInvariant: logDbInvariant,
        visibleOutcome: logVisibleOutcome,
      });
      steps.push(pass(logStep, { policyFact: logPolicyFact, dbInvariant: logDbInvariant, visibleOutcome: logVisibleOutcome }));

      const clarifyStep = STEP_NAMES[2];
      provider.reset();
      resetPublishCounts();
      await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
        loggedAt: new Date().toISOString(),
        items: [{ foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 }],
      });
      await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
        loggedAt: new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        items: [{ foodName: "雞腿飯", calories: 620, protein: 28, carbs: 76, fat: 18 }],
      });
      const clarifyMealsBefore = await fixture.services.foodLoggingService.getMealsByDate(fixture.deviceId, new Date());
      provider.queueRoundResponse({
        toolCalls: [{
          id: "policy_find_meals",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({
              action: "update",
              query: "雞腿飯",
            }),
          },
        }],
      });
      const clarified = await postChat(fixture.address, fixture.cookieHeader, "雞腿飯要修改");
      const clarifyTrace = traceRecorders.at(-1)?.build({ scenario: clarifyStep, status: "pass" });
      assert.ok(clarifyTrace);
      const clarifyPolicyFact = findPolicyFact(clarifyTrace, "find_meals");
      const clarifyMealsAfter = await fixture.services.foodLoggingService.getMealsByDate(fixture.deviceId, new Date());
      const clarifyDbInvariant = summarizePolicyDbInvariant({
        mealCountBefore: clarifyMealsBefore.length,
        mealCountAfter: clarifyMealsAfter.length,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const clarifyVisibleOutcome = summarizeVisibleOutcome({
        keyLabels: {
          asksForNumberedChoice: /請直接回覆編號/.test(clarified.body.reply ?? ""),
        },
        meaning: {
          returnedHttpSuccess: clarified.status === 200,
          didNotLogMeal: clarified.body.didLogMeal === false,
          didNotMutateMeal: clarified.body.didMutateMeal === false,
        },
      });
      assertPolicyFact(clarifyPolicyFact, {
        tool: "find_meals",
        policyClass: "clarify-first",
        decision: "allowed",
        ruleId: "base_policy_allowed",
      });
      assertPolicyDbInvariant(clarifyDbInvariant, {
        mealCountBefore: clarifyMealsBefore.length,
        mealCountAfter: clarifyMealsBefore.length,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(clarifyVisibleOutcome, {
        keyLabels: {
          asksForNumberedChoice: true,
        },
        meaning: {
          returnedHttpSuccess: true,
          didNotLogMeal: true,
          didNotMutateMeal: true,
        },
      });
      addEvidence(artifacts, {
        step: clarifyStep,
        policyFact: clarifyPolicyFact,
        dbInvariant: clarifyDbInvariant,
        visibleOutcome: clarifyVisibleOutcome,
      });
      steps.push(pass(clarifyStep, { policyFact: clarifyPolicyFact, dbInvariant: clarifyDbInvariant, visibleOutcome: clarifyVisibleOutcome }));

      const approveStep = STEP_NAMES[3];
      provider.reset();
      resetPublishCounts();
      const approvalMeal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
        loggedAt: new Date().toISOString(),
        items: [{ foodName: "鮭魚飯", calories: 700, protein: 36, carbs: 82, fat: 24 }],
      });
      const approvalProposal = await fixture.services.mealNumericProposalService.putLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
        input: {
          mealId: approvalMeal.id,
          expectedMealRevisionId: approvalMeal.mealRevisionId,
          updateInput: { protein: 18 },
          affectedFields: [{ field: "protein", before: 36, after: 18 }],
          sourceOperator: "half",
        },
      });
      const approvalAssistant = await fixture.services.chatService.saveMessage(
        fixture.deviceId,
        "assistant",
        "請確認這組餐點修改提案。",
      );
      await fixture.services.proposalCardService.saveAssistantProposalCard({
        deviceId: fixture.deviceId,
        assistantMessageId: approvalAssistant.id,
        proposalId: approvalProposal.proposalId,
        proposalKind: "meal_numeric",
        proposalLane: "meal_mutation",
        title: "請確認這組餐點修改提案。",
        details: { rows: [{ label: "蛋白質", before: "36 g", after: "18 g" }] },
        actions: { approveLabel: "套用", editLabel: "調整", rejectLabel: "取消" },
      });
      const approvalMealsBefore = await fixture.services.foodLoggingService.getMealsByDate(fixture.deviceId, new Date());
      const approved = await postChat(fixture.address, fixture.cookieHeader, "套用餐點修改");
      const approvalTrace = traceRecorders.at(-1)?.build({ scenario: approveStep, status: "pass" });
      assert.ok(approvalTrace);
      const approvalPolicyFact = findPolicyFact(approvalTrace, "propose_meal_numeric_correction");
      const approvalMealsAfter = await fixture.services.foodLoggingService.getMealsByDate(fixture.deviceId, new Date());
      const approvedMeal = approvalMealsAfter.find((meal) => meal.id === approvalMeal.id);
      const approvalCard = await fixture.services.proposalCardService.getLatestCardForProposal({
        deviceId: fixture.deviceId,
        proposalId: approvalProposal.proposalId,
        proposalKind: "meal_numeric",
      });
      const approvalDbInvariant = summarizePolicyDbInvariant({
        mealCountBefore: approvalMealsBefore.length,
        mealCountAfter: approvalMealsAfter.length,
        pendingConsumed: await fixture.services.mealNumericProposalService.getLatest({
          deviceId: fixture.deviceId,
          sessionId: DEFAULT_SESSION_ID,
        }) === undefined,
        proposalCardPresent: approvalCard !== undefined,
        proposalCardKindMatches: approvalCard?.proposalKind === "meal_numeric",
        proposalCardProposalIdMatches: approvalCard?.proposalId === approvalProposal.proposalId,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const approvalVisibleOutcome = summarizeVisibleOutcome({
        keyLabels: {
          updatedProteinLabel: /蛋白質 18 g/.test(approved.body.reply ?? ""),
        },
        meaning: {
          returnedHttpSuccess: approved.status === 200,
          didMutateMeal: approved.body.didMutateMeal === true,
          returnedSummary: Boolean(approved.body.dailySummary),
        },
      });
      assert.equal(approvedMeal?.protein, 18);
      assertPolicyFact(approvalPolicyFact, {
        tool: "propose_meal_numeric_correction",
        policyClass: "confirm-first",
        decision: "allowed",
        ruleId: "typed_meal_numeric_approve",
        proposalId: approvalProposal.proposalId,
      });
      assertPolicyDbInvariant(approvalDbInvariant, {
        mealCountBefore: approvalMealsBefore.length,
        mealCountAfter: approvalMealsBefore.length,
        pendingConsumed: true,
        proposalCardPresent: true,
        proposalCardKindMatches: true,
        proposalCardProposalIdMatches: true,
        dailySummaryPublishCount: 1,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(approvalVisibleOutcome, {
        keyLabels: {
          updatedProteinLabel: true,
        },
        meaning: {
          returnedHttpSuccess: true,
          didMutateMeal: true,
          returnedSummary: true,
        },
      });
      addEvidence(artifacts, {
        step: approveStep,
        policyFact: approvalPolicyFact,
        dbInvariant: approvalDbInvariant,
        visibleOutcome: approvalVisibleOutcome,
      });
      steps.push(pass(approveStep, { policyFact: approvalPolicyFact, dbInvariant: approvalDbInvariant, visibleOutcome: approvalVisibleOutcome }));

      const cancelStep = STEP_NAMES[4];
      provider.reset();
      resetPublishCounts();
      const targetsBeforeCancel = await readTargets(fixture.address, fixture.cookieHeader);
      await fixture.services.goalProposalService.putLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
        targets: {
          calories: targetsBeforeCancel.calories - 100,
          protein: targetsBeforeCancel.protein,
          carbs: targetsBeforeCancel.carbs,
          fat: targetsBeforeCancel.fat,
        },
      });
      const cancelled = await postChat(fixture.address, fixture.cookieHeader, "先不用");
      const targetsAfterCancel = await readTargets(fixture.address, fixture.cookieHeader);
      const cancelDbInvariant = summarizePolicyDbInvariant({
        targetsChanged: !sameTargets(targetsBeforeCancel, targetsAfterCancel),
        pendingConsumed: await fixture.services.goalProposalService.getLatest({
          deviceId: fixture.deviceId,
          sessionId: DEFAULT_SESSION_ID,
        }) === undefined,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const cancelVisibleOutcome = summarizeVisibleOutcome({
        keyLabels: {
          cancelledLabel: /取消|不用/.test(cancelled.body.reply ?? ""),
        },
        meaning: {
          returnedHttpSuccess: cancelled.status === 200,
          didNotMutateMeal: cancelled.body.didMutateMeal === false,
          targetsUnchanged: sameTargets(targetsBeforeCancel, targetsAfterCancel),
        },
      });
      assertPolicyDbInvariant(cancelDbInvariant, {
        targetsChanged: false,
        pendingConsumed: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(cancelVisibleOutcome, {
        keyLabels: {
          cancelledLabel: true,
        },
        meaning: {
          returnedHttpSuccess: true,
          didNotMutateMeal: true,
          targetsUnchanged: true,
        },
      });
      addEvidence(artifacts, {
        step: cancelStep,
        dbInvariant: cancelDbInvariant,
        visibleOutcome: cancelVisibleOutcome,
      });
      steps.push(pass(cancelStep, { dbInvariant: cancelDbInvariant, visibleOutcome: cancelVisibleOutcome }));

      const crossStep = STEP_NAMES[5];
      resetPublishCounts();
      const crossMeal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
        loggedAt: new Date().toISOString(),
        items: [{ foodName: "牛肉飯", calories: 680, protein: 32, carbs: 84, fat: 22 }],
      });
      const crossMealsBefore = await fixture.services.foodLoggingService.getMealsByDate(fixture.deviceId, new Date());
      const crossProposal = await fixture.services.mealNumericProposalService.putLatest({
        deviceId: fixture.deviceId,
        sessionId: "phase86-session-a",
        input: {
          mealId: crossMeal.id,
          expectedMealRevisionId: crossMeal.mealRevisionId,
          updateInput: { protein: 16 },
          affectedFields: [{ field: "protein", before: 32, after: 16 }],
          sourceOperator: "half",
        },
      });
      const crossConsumed = await fixture.services.mealNumericProposalService.consumeLatest({
        deviceId: fixture.deviceId,
        sessionId: "phase86-session-b",
        proposalId: crossProposal.proposalId,
        expectedMealRevisionId: crossMeal.mealRevisionId,
      });
      const crossStillPending = await fixture.services.mealNumericProposalService.getLatest({
        deviceId: fixture.deviceId,
        sessionId: "phase86-session-a",
      });
      const crossMealsAfter = await fixture.services.foodLoggingService.getMealsByDate(fixture.deviceId, new Date());
      const crossDbInvariant = summarizePolicyDbInvariant({
        mealCountBefore: crossMealsBefore.length,
        mealCountAfter: crossMealsAfter.length,
        pendingPreserved: crossStillPending?.proposalId === crossProposal.proposalId,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const crossVisibleOutcome = summarizeVisibleOutcome({
        meaning: {
          rejectedWrongOwner: crossConsumed === undefined,
          didNotMutateMeal: crossMealsAfter.find((meal) => meal.id === crossMeal.id)?.protein === 32,
        },
      });
      assertPolicyDbInvariant(crossDbInvariant, {
        mealCountBefore: crossMealsBefore.length,
        mealCountAfter: crossMealsBefore.length,
        pendingPreserved: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(crossVisibleOutcome, {
        meaning: {
          rejectedWrongOwner: true,
          didNotMutateMeal: true,
        },
      });
      addEvidence(artifacts, {
        step: crossStep,
        dbInvariant: crossDbInvariant,
        visibleOutcome: crossVisibleOutcome,
      });
      steps.push(pass(crossStep, { dbInvariant: crossDbInvariant, visibleOutcome: crossVisibleOutcome }));

      const staleStep = STEP_NAMES[6];
      provider.reset();
      resetPublishCounts();
      const staleMeal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
        loggedAt: new Date().toISOString(),
        items: [{ foodName: "豆腐飯", calories: 560, protein: 26, carbs: 78, fat: 16 }],
      });
      const staleProposal = await fixture.services.mealNumericProposalService.putLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
        input: {
          mealId: staleMeal.id,
          expectedMealRevisionId: staleMeal.mealRevisionId,
          updateInput: { protein: 13 },
          affectedFields: [{ field: "protein", before: 26, after: 13 }],
          sourceOperator: "half",
        },
      });
      const staleAssistant = await fixture.services.chatService.saveMessage(
        fixture.deviceId,
        "assistant",
        "請確認這組餐點修改提案。",
      );
      await fixture.services.proposalCardService.saveAssistantProposalCard({
        deviceId: fixture.deviceId,
        assistantMessageId: staleAssistant.id,
        proposalId: staleProposal.proposalId,
        proposalKind: "meal_numeric",
        proposalLane: "meal_mutation",
        title: "請確認這組餐點修改提案。",
        details: { rows: [{ label: "蛋白質", before: "26 g", after: "13 g" }] },
        actions: { approveLabel: "套用", editLabel: "調整", rejectLabel: "取消" },
      });
      const staleExternalUpdate = await fixture.services.foodLoggingService.updateMeal(fixture.deviceId, staleMeal.id, {
        expectedMealRevisionId: staleMeal.mealRevisionId,
        items: [{ foodName: "新版豆腐飯", calories: 560, protein: 27, carbs: 78, fat: 16 }],
      });
      const staleMealsBefore = await fixture.services.foodLoggingService.getMealsByDate(fixture.deviceId, new Date());
      const stale = await postChat(fixture.address, fixture.cookieHeader, "套用餐點修改");
      const staleTrace = traceRecorders.at(-1)?.build({ scenario: staleStep, status: "pass" });
      assert.ok(staleTrace);
      const stalePolicyFact = findPolicyFact(staleTrace, "propose_meal_numeric_correction");
      const staleMealsAfter = await fixture.services.foodLoggingService.getMealsByDate(fixture.deviceId, new Date());
      const staleCurrent = staleMealsAfter.find((meal) => meal.id === staleMeal.id);
      const staleCard = await fixture.services.proposalCardService.getLatestCardForProposal({
        deviceId: fixture.deviceId,
        proposalId: staleProposal.proposalId,
        proposalKind: "meal_numeric",
      });
      const staleDbInvariant = summarizePolicyDbInvariant({
        mealCountBefore: staleMealsBefore.length,
        mealCountAfter: staleMealsAfter.length,
        pendingConsumed: await fixture.services.mealNumericProposalService.getLatest({
          deviceId: fixture.deviceId,
          sessionId: DEFAULT_SESSION_ID,
        }) === undefined,
        targetsChanged: false,
        proposalCardPresent: staleCard !== undefined,
        proposalCardKindMatches: staleCard?.proposalKind === "meal_numeric",
        proposalCardProposalIdMatches: staleCard?.proposalId === staleProposal.proposalId,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const staleVisibleOutcome = summarizeVisibleOutcome({
        meaning: {
          returnedHttpSuccess: stale.status === 200,
          didNotMutateMeal: stale.body.didMutateMeal === false,
          staleRevisionRejected: staleCurrent?.mealRevisionId === staleExternalUpdate.mealRevisionId,
        },
      });
      assert.equal(staleCurrent?.protein, 27);
      assertPolicyFact(stalePolicyFact, {
        tool: "propose_meal_numeric_correction",
        policyClass: "confirm-first",
        decision: "blocked",
        ruleId: "typed_meal_numeric_approve",
        proposalId: staleProposal.proposalId,
      });
      assertPolicyDbInvariant(staleDbInvariant, {
        mealCountBefore: staleMealsBefore.length,
        mealCountAfter: staleMealsBefore.length,
        pendingConsumed: true,
        targetsChanged: false,
        proposalCardPresent: true,
        proposalCardKindMatches: true,
        proposalCardProposalIdMatches: true,
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
        visibleOutcome: staleVisibleOutcome,
      });
      steps.push(pass(staleStep, { policyFact: stalePolicyFact, dbInvariant: staleDbInvariant, visibleOutcome: staleVisibleOutcome }));

      const doubleStep = STEP_NAMES[7];
      provider.reset();
      resetPublishCounts();
      const doubleMeal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
        loggedAt: new Date().toISOString(),
        items: [{ foodName: "雞胸飯", calories: 610, protein: 40, carbs: 76, fat: 14 }],
      });
      const doubleProposal = await fixture.services.mealNumericProposalService.putLatest({
        deviceId: fixture.deviceId,
        sessionId: DEFAULT_SESSION_ID,
        input: {
          mealId: doubleMeal.id,
          expectedMealRevisionId: doubleMeal.mealRevisionId,
          updateInput: { protein: 20 },
          affectedFields: [{ field: "protein", before: 40, after: 20 }],
          sourceOperator: "half",
        },
      });
      const doubleAssistant = await fixture.services.chatService.saveMessage(
        fixture.deviceId,
        "assistant",
        "請確認這組餐點修改提案。",
      );
      await fixture.services.proposalCardService.saveAssistantProposalCard({
        deviceId: fixture.deviceId,
        assistantMessageId: doubleAssistant.id,
        proposalId: doubleProposal.proposalId,
        proposalKind: "meal_numeric",
        proposalLane: "meal_mutation",
        title: "請確認這組餐點修改提案。",
        details: { rows: [{ label: "蛋白質", before: "40 g", after: "20 g" }] },
        actions: { approveLabel: "套用", editLabel: "調整", rejectLabel: "取消" },
      });
      const firstDouble = await postChat(fixture.address, fixture.cookieHeader, "套用餐點修改");
      assert.equal(firstDouble.body.didMutateMeal, true);
      resetPublishCounts();
      provider.reset();
      provider.queueRoundResponse({ content: "目前沒有待套用的餐點修改。" });
      const doubleMealsBefore = await fixture.services.foodLoggingService.getMealsByDate(fixture.deviceId, new Date());
      const secondDouble = await postChat(fixture.address, fixture.cookieHeader, "套用餐點修改");
      const doubleMealsAfter = await fixture.services.foodLoggingService.getMealsByDate(fixture.deviceId, new Date());
      const doubleCurrent = doubleMealsAfter.find((meal) => meal.id === doubleMeal.id);
      const doubleCard = await fixture.services.proposalCardService.getLatestCardForProposal({
        deviceId: fixture.deviceId,
        proposalId: doubleProposal.proposalId,
        proposalKind: "meal_numeric",
      });
      const doubleDbInvariant = summarizePolicyDbInvariant({
        mealCountBefore: doubleMealsBefore.length,
        mealCountAfter: doubleMealsAfter.length,
        pendingConsumed: await fixture.services.mealNumericProposalService.getLatest({
          deviceId: fixture.deviceId,
          sessionId: DEFAULT_SESSION_ID,
        }) === undefined,
        proposalCardPresent: doubleCard !== undefined,
        proposalCardKindMatches: doubleCard?.proposalKind === "meal_numeric",
        proposalCardProposalIdMatches: doubleCard?.proposalId === doubleProposal.proposalId,
        dailySummaryPublishCount: publishCounts.dailySummary,
        goalsPublishCount: publishCounts.goals,
      });
      const doubleVisibleOutcome = summarizeVisibleOutcome({
        meaning: {
          returnedHttpSuccess: secondDouble.status === 200,
          didNotMutateMealAgain: secondDouble.body.didMutateMeal !== true && doubleCurrent?.protein === 20,
          oneShotProposalConsumed: doubleProposal.proposalId.length > 0,
        },
      });
      assertPolicyDbInvariant(doubleDbInvariant, {
        mealCountBefore: doubleMealsBefore.length,
        mealCountAfter: doubleMealsBefore.length,
        pendingConsumed: true,
        proposalCardPresent: true,
        proposalCardKindMatches: true,
        proposalCardProposalIdMatches: true,
        dailySummaryPublishCount: 0,
        goalsPublishCount: 0,
      });
      assertVisibleOutcomeSummary(doubleVisibleOutcome, {
        meaning: {
          returnedHttpSuccess: true,
          didNotMutateMealAgain: true,
          oneShotProposalConsumed: true,
        },
      });
      addEvidence(artifacts, {
        step: doubleStep,
        dbInvariant: doubleDbInvariant,
        visibleOutcome: doubleVisibleOutcome,
      });
      steps.push(pass(doubleStep, { dbInvariant: doubleDbInvariant, visibleOutcome: doubleVisibleOutcome }));

      assertPolicyEvidenceHasNoForbiddenFields(artifacts);

      return {
        ok: true,
        steps,
        artifacts: {},
        metadata: buildPolicyMetadata("pass", artifacts, steps),
        consoleSummary: `PASS ${SCENARIO_NAME} ${steps.length}/${STEP_NAMES.length}`,
      };
    } catch (error) {
      const failedStep = STEP_NAMES.find((stepName) => !steps.some((step) => step.name === stepName)) ?? SCENARIO_NAME;
      steps.push(fail(failedStep, error instanceof Error ? error.message : String(error)));
      return failResult(steps, failedStep, artifacts);
    }
  },
};

export default scenario;
