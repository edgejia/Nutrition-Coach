import {
  assertGroundedNumbers,
  assertNoForbiddenReceiptCopy,
  assertNoUnauthorizedMutation,
  assertSuccessfulMutationRendererSource,
  type BehaviorAssertionResult,
  type BehaviorCaseOutcome,
} from "../behavior-assertions.js";
import { createScenarioApp, type ScenarioAppContext } from "../app-fixture.js";
import { parseSSEEvents } from "../sse.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { createLlmTraceRecorder } from "../../../server/orchestrator/llm-trace.js";
import { formatLocalDate } from "../../../server/lib/time.js";

type MutationKind = "log" | "update" | "delete" | "goals";

interface ChatResponse {
  status: number;
  reply: string;
  loggedMeal?: {
    mealId?: string;
    dateKey?: string;
    foodName?: string;
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  };
  proposalCard?: {
    proposalId?: string;
    proposalKind?: string;
  };
}

interface DailyTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface MealSnapshot {
  id: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  loggedAt: string;
}

interface SubflowResult {
  assertions: BehaviorAssertionResult[];
  evidence: Record<string, unknown>;
}

const CASE_ID = "PHASE-53-MUTATION-RECEIPTS";

export async function runCase53MutationReceipts(): Promise<BehaviorCaseOutcome> {
  const subflows = [
    await runLogSubflow(),
    await runUpdateSubflow(),
    await runDeleteSubflow(),
    await runGoalsSubflow(),
    await runNonMutationModelSubflow(),
  ];
  const assertions = subflows.flatMap((subflow) => subflow.assertions);
  const ok = assertions.every((assertion) => assertion.ok);

  return {
    caseId: CASE_ID,
    status: ok ? "passed" : "failed",
    ok,
    assertions,
    evidence: {
      subflows: subflows.map((subflow) => subflow.evidence),
    },
  };
}

async function runLogSubflow(): Promise<SubflowResult> {
  const llmProvider = new StreamingLLMProvider();
  const recorder = createLlmTraceRecorder();
  llmProvider.queueRoundResponse({
    toolCalls: [{
      id: "phase_53_log_food",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          items: [
            {
              food_name: "雞胸便當",
              calories: 520,
              protein: 38,
              carbs: 58,
              fat: 14,
              amount: "1 份",
            },
          ],
          protein_sources: [{ name: "雞胸", protein: 38, is_primary: true, certainty: "clear" }],
        }),
      },
    }],
  });

  const fixture = await createScenarioApp({
    llmProvider,
    llmTraceRecorderFactory: () => recorder,
  });

  try {
    const response = await postChat(fixture, "我吃了一份雞胸便當");
    const trace = recorder.build({ scenario: "behavior-matrix:phase-53-log", status: "pass" });
    const persistedMeal = (await readMeals(fixture)).find((meal) => meal.foodName === "雞胸便當");
    const committedFacts = {
      foodName: persistedMeal?.foodName,
      calories: persistedMeal?.calories,
      protein: persistedMeal?.protein,
      carbs: persistedMeal?.carbs,
      fat: persistedMeal?.fat,
    };
    const evidence = {
      name: "log",
      observedTools: collectTraceTools(trace),
      traceFinalReplySource: trace.summary.finalReply.source,
      finalReplyLength: response.reply.length,
      committedFacts,
      persistedMeal,
      responseLoggedMeal: response.loggedMeal,
    };

    return {
      assertions: [
        namedAssertion("phase_53_log_http_ok", response.status === 200, evidence),
        assertSuccessfulMutationRendererSource({ source: trace.summary.finalReply.source, mutationKind: "log" }),
        assertNoUnauthorizedMutation({ allowedTools: ["log_food"], observedTools: collectTraceTools(trace) }),
        assertNoForbiddenReceiptCopy(response.reply),
        assertGroundedNumbers(response.reply, {
          sources: [{ source: "committed_log_facts", numbers: [520, 38] }],
        }),
        namedAssertion(
          "phase_53_log_committed_text",
          response.reply.includes("雞胸便當") && response.reply.includes("520") && response.reply.includes("38"),
          evidence,
        ),
      ],
      evidence,
    };
  } finally {
    await fixture.close();
  }
}

async function runUpdateSubflow(): Promise<SubflowResult> {
  const llmProvider = new StreamingLLMProvider();
  const recorder = createLlmTraceRecorder();
  const fixture = await createScenarioApp({
    llmProvider,
    llmTraceRecorderFactory: () => recorder,
  });

  try {
    const seededMeal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
      items: [
        { foodName: "鮪魚飯", calories: 620, protein: 31, carbs: 76, fat: 18 },
      ],
    });
    const message = "把今天鮪魚飯改成 500 kcal，蛋白質 40 g";
    llmProvider.queueRoundResponse({
      toolCalls: [
        {
          id: "phase_53_update_find_meals",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({ action: "update", query: message }),
          },
        },
        {
          id: "phase_53_update_meal",
          type: "function",
          function: {
            name: "update_meal",
            arguments: JSON.stringify({ meal_id: seededMeal.id, calories: 500, protein: 40 }),
          },
        },
      ],
    });

    const response = await postChat(fixture, message);
    const trace = recorder.build({ scenario: "behavior-matrix:phase-53-update", status: "pass" });
    const updatedMeal = (await readMeals(fixture)).find((meal) => meal.id === seededMeal.id);
    const evidence = {
      name: "update",
      observedTools: collectTraceTools(trace),
      traceFinalReplySource: trace.summary.finalReply.source,
      finalReplyLength: response.reply.length,
      seededMeal,
      updatedMeal,
      committedFacts: {
        foodName: updatedMeal?.foodName,
        calories: updatedMeal?.calories,
        protein: updatedMeal?.protein,
      },
    };

    return {
      assertions: [
        namedAssertion("phase_53_update_http_ok", response.status === 200, evidence),
        assertSuccessfulMutationRendererSource({ source: trace.summary.finalReply.source, mutationKind: "update" }),
        assertNoUnauthorizedMutation({
          allowedTools: ["find_meals", "update_meal"],
          observedTools: collectTraceTools(trace),
        }),
        assertNoForbiddenReceiptCopy(response.reply),
        assertGroundedNumbers(response.reply, {
          sources: [{ source: "committed_update_facts", numbers: [500, 40] }],
        }),
        namedAssertion(
          "phase_53_update_committed_text",
          response.reply.includes("鮪魚飯") && response.reply.includes("500") && response.reply.includes("40"),
          evidence,
        ),
        namedAssertion(
          "phase_53_update_persisted",
          updatedMeal?.calories === 500 && updatedMeal.protein === 40,
          evidence,
        ),
      ],
      evidence,
    };
  } finally {
    await fixture.close();
  }
}

async function runDeleteSubflow(): Promise<SubflowResult> {
  const llmProvider = new StreamingLLMProvider();
  const recorder = createLlmTraceRecorder();
  const fixture = await createScenarioApp({
    llmProvider,
    llmTraceRecorderFactory: () => recorder,
  });

  try {
    const seededMeal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
      items: [
        { foodName: "拿鐵", calories: 180, protein: 9, carbs: 14, fat: 8 },
      ],
    });
    const message = "刪掉今天的拿鐵";
    llmProvider.queueRoundResponse({
      toolCalls: [
        {
          id: "phase_53_delete_find_meals",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({ action: "delete", query: message }),
          },
        },
        {
          id: "phase_53_delete_meal",
          type: "function",
          function: {
            name: "delete_meal",
            arguments: JSON.stringify({ meal_id: seededMeal.id }),
          },
        },
      ],
    });

    const response = await postChat(fixture, message);
    const approvalResponse = await postChat(fixture, "確認刪除這筆餐點");
    const trace = recorder.build({ scenario: "behavior-matrix:phase-53-delete", status: "pass" });
    const afterMeals = await readMeals(fixture);
    const deletedMeal = {
      mealId: seededMeal.id,
      dateKey: formatLocalDate(new Date(seededMeal.loggedAt)),
      foodName: seededMeal.foodName,
    };
    const evidence = {
      name: "delete",
      observedTools: collectTraceTools(trace),
      traceFinalReplySource: trace.summary.finalReply.source,
      proposalReplyLength: response.reply.length,
      finalReplyLength: approvalResponse.reply.length,
      proposalKind: response.proposalCard?.proposalKind,
      deletedMeal,
      afterMeals,
    };

    return {
      assertions: [
        namedAssertion("phase_53_delete_http_ok", response.status === 200, evidence),
        assertSuccessfulMutationRendererSource({ source: trace.summary.finalReply.source, mutationKind: "delete" }),
        assertNoUnauthorizedMutation({
          allowedTools: ["find_meals", "delete_meal"],
          observedTools: collectTraceTools(trace),
        }),
        assertNoForbiddenReceiptCopy(response.reply),
        namedAssertion(
          "phase_53_delete_committed_snapshot",
          approvalResponse.reply.includes(deletedMeal.foodName) &&
            deletedMeal.mealId === seededMeal.id &&
            deletedMeal.dateKey.length > 0 &&
            deletedMeal.foodName === "拿鐵",
          evidence,
        ),
        namedAssertion(
          "phase_53_delete_persisted",
          !afterMeals.some((meal) => meal.id === seededMeal.id),
          evidence,
        ),
      ],
      evidence,
    };
  } finally {
    await fixture.close();
  }
}

async function runGoalsSubflow(): Promise<SubflowResult> {
  const llmProvider = new StreamingLLMProvider();
  const recorder = createLlmTraceRecorder();
  llmProvider.queueRoundResponse({
    toolCalls: [{
      id: "phase_53_update_goals",
      type: "function",
      function: {
        name: "update_goals",
        arguments: JSON.stringify({
          mode: "current_turn_values",
          calories: 1800,
          protein: 130,
          carbs: 150,
          fat: 50,
        }),
      },
    }],
  });
  const fixture = await createScenarioApp({
    llmProvider,
    llmTraceRecorderFactory: () => recorder,
  });

  try {
    const response = await postChat(fixture, "目標改成 1800 kcal、蛋白質 130、碳水 150、脂肪 50");
    const targets = await readTargets(fixture);
    const trace = recorder.build({ scenario: "behavior-matrix:phase-53-goals", status: "pass" });
    const evidence = {
      name: "goals",
      observedTools: collectTraceTools(trace),
      traceFinalReplySource: trace.summary.finalReply.source,
      finalReplyLength: response.reply.length,
      committedTargets: targets,
    };

    return {
      assertions: [
        namedAssertion("phase_53_goals_http_ok", response.status === 200, evidence),
        assertSuccessfulMutationRendererSource({ source: trace.summary.finalReply.source, mutationKind: "goals" }),
        assertNoUnauthorizedMutation({ allowedTools: ["update_goals"], observedTools: collectTraceTools(trace) }),
        assertNoForbiddenReceiptCopy(response.reply),
        assertGroundedNumbers(response.reply, {
          sources: [{ source: "committed_goal_targets", numbers: [1800, 130, 150, 50] }],
        }),
        namedAssertion(
          "phase_53_goals_committed_text",
          response.reply.includes("1800") &&
            response.reply.includes("130") &&
            response.reply.includes("150") &&
            response.reply.includes("50"),
          evidence,
        ),
      ],
      evidence,
    };
  } finally {
    await fixture.close();
  }
}

async function runNonMutationModelSubflow(): Promise<SubflowResult> {
  const llmProvider = new StreamingLLMProvider();
  const recorder = createLlmTraceRecorder();
  llmProvider.queueRoundResponse({
    content: "可以，今天先維持原本節奏，下一餐補足蛋白質即可。",
  });
  const fixture = await createScenarioApp({
    llmProvider,
    llmTraceRecorderFactory: () => recorder,
  });

  try {
    const beforeMeals = await readMeals(fixture);
    const beforeTargets = await readTargets(fixture);
    const response = await postChat(fixture, "今天晚餐要怎麼安排？");
    const trace = recorder.build({ scenario: "behavior-matrix:phase-53-non-mutation", status: "pass" });
    const afterMeals = await readMeals(fixture);
    const afterTargets = await readTargets(fixture);
    const persistedDiff = buildPersistedDiff(beforeMeals, afterMeals, beforeTargets, afterTargets);
    const evidence = {
      name: "non_mutation_model",
      observedTools: collectTraceTools(trace),
      traceFinalReplySource: trace.summary.finalReply.source,
      finalReplyLength: response.reply.length,
      persistedDiff,
    };

    return {
      assertions: [
        namedAssertion("phase_53_non_mutation_http_ok", response.status === 200, evidence),
        namedAssertion(
          "phase_53_non_mutation_model_source",
          trace.summary.finalReply.source === "model",
          evidence,
        ),
        assertNoUnauthorizedMutation({
          allowedTools: [],
          observedTools: collectTraceTools(trace),
          persistedDiff,
        }),
        namedAssertion(
          "phase_53_non_mutation_no_tools",
          collectTraceTools(trace).length === 0,
          evidence,
        ),
      ],
      evidence,
    };
  } finally {
    await fixture.close();
  }
}

async function postChat(fixture: ScenarioAppContext, message: string): Promise<ChatResponse> {
  const form = new FormData();
  form.append("message", message);

  const res = await fetch(`${fixture.address}/api/chat`, {
    method: "POST",
    headers: {
      cookie: fixture.cookieHeader,
      Accept: "text/event-stream",
    },
    body: form,
  });
  const rawSse = await res.text();
  const events = parseSSEEvents(rawSse);
  const reply = events
    .filter((event) => event.event === "chunk")
    .map((event) => {
      try {
        return (JSON.parse(event.data) as { token?: string }).token ?? "";
      } catch {
        return "";
      }
    })
    .join("");
  const doneEvent = events.find((event) => event.event === "done");
  const donePayload = doneEvent
    ? JSON.parse(doneEvent.data) as Omit<ChatResponse, "status" | "reply">
    : {};
  return { status: res.status, reply, ...donePayload };
}

async function readMeals(fixture: ScenarioAppContext): Promise<MealSnapshot[]> {
  return fixture.services.foodLoggingService.getMealsByDate(fixture.deviceId, new Date());
}

async function readTargets(fixture: ScenarioAppContext): Promise<DailyTargets> {
  const res = await fetch(`${fixture.address}/api/device/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: fixture.cookieHeader,
    },
    body: JSON.stringify({}),
  });
  const body = await res.json() as { dailyTargets: DailyTargets };
  return body.dailyTargets;
}

function collectTraceTools(trace: ReturnType<ReturnType<typeof createLlmTraceRecorder>["build"]>): string[] {
  return trace.timeline
    .filter((event) => event.type === "tool_received")
    .map((event) => event.tool);
}

function buildPersistedDiff(
  beforeMeals: MealSnapshot[],
  afterMeals: MealSnapshot[],
  beforeTargets: DailyTargets,
  afterTargets: DailyTargets,
): Record<string, unknown> {
  return {
    mealsChanged: JSON.stringify(beforeMeals) !== JSON.stringify(afterMeals),
    goalsChanged: JSON.stringify(beforeTargets) !== JSON.stringify(afterTargets),
  };
}

function namedAssertion(
  name: string,
  ok: boolean,
  evidence: Record<string, unknown>,
): BehaviorAssertionResult {
  return ok
    ? { name, ok: true, evidence }
    : { name, ok: false, message: `${name} failed`, evidence };
}
