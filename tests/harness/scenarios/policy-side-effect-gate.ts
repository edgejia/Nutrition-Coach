/**
 * Umbrella deterministic proof for the side-effect policy classes.
 *
 * Artifacts intentionally store metadata-only evidence: policy fact summaries,
 * narrow DB/publish invariants, and visible outcome booleans.
 */

import assert from "node:assert/strict";
import { createLlmTraceRecorder } from "../../../server/orchestrator/llm-trace.js";
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

function summarizePolicyDbInvariant(input: {
  mealCountBefore?: number;
  mealCountAfter?: number;
  targetsChanged?: boolean;
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
