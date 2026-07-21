import {
  assertGroundedNumbers,
  assertNoInternalLeakage,
  assertNoInventedMeals,
  assertQuantityUncertaintyCaveat,
  assertTraditionalChinese,
  evaluateExpectedFailures,
  type BehaviorAssertionResult,
  type BehaviorCaseOutcome,
  type NumberSource,
} from "../behavior-assertions.js";
import type { ScenarioAppFactory } from "../app-fixture.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { createLlmTraceRecorder } from "../../../server/orchestrator/llm-trace.js";
import type { LogFoodArgs } from "../../../server/orchestrator/tools.js";

interface LoggedMealEvidence {
  foodName: string;
  dateKey: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  quantityUncertaintyReason?: string;
}

interface DonePayload {
  didLogMeal?: boolean;
  loggedMeal?: LoggedMealEvidence;
  dailySummary?: {
    totalCalories?: number;
    totalProtein?: number;
    totalCarbs?: number;
    totalFat?: number;
  };
}

function parseChunkText(events: Array<{ event: string; data: string }>): string {
  return events
    .filter((event) => event.event === "chunk")
    .map((event) => {
      try {
        return (JSON.parse(event.data) as { token?: string }).token ?? "";
      } catch {
        return "";
      }
    })
    .join("");
}

function parseDonePayload(events: Array<{ event: string; data: string }>): DonePayload {
  const done = events.find((event) => event.event === "done");
  if (!done) return {};
  try {
    return JSON.parse(done.data) as DonePayload;
  } catch {
    return {};
  }
}

async function readDoneEventText(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readStreamUntilEvent(reader, "done", 60),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("Timed out collecting CASE-02 SSE done event")), 5000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function mealNumbers(meal: LoggedMealEvidence | undefined): number[] {
  return meal ? [meal.calories, meal.protein, meal.carbs, meal.fat] : [];
}

function estimateRangeNumbers(meal: LoggedMealEvidence | undefined): number[] {
  return meal
    ? [
        Math.floor(meal.calories * 0.85),
        Math.ceil(meal.calories * 1.15),
        -Math.ceil(meal.calories * 1.15),
      ]
    : [];
}

function summaryNumbers(summary: DonePayload["dailySummary"]): number[] {
  if (!summary) return [];
  return [
    summary.totalCalories,
    summary.totalProtein,
    summary.totalCarbs,
    summary.totalFat,
  ].filter((value): value is number => typeof value === "number");
}

function buildNumberSources(input: {
  toolArgs: number[];
  donePayload: DonePayload;
  persistedMeal: LoggedMealEvidence | undefined;
}): NumberSource[] {
  return [
    { source: "tool_args", numbers: input.toolArgs },
    { source: "done.loggedMeal", numbers: mealNumbers(input.donePayload.loggedMeal) },
    { source: "receipt_payload", numbers: mealNumbers(input.donePayload.loggedMeal) },
    { source: "persisted_meal", numbers: mealNumbers(input.persistedMeal) },
    { source: "daily_summary", numbers: summaryNumbers(input.donePayload.dailySummary) },
    { source: "derived_uncertainty_range", numbers: estimateRangeNumbers(input.donePayload.loggedMeal) },
  ];
}

function traceSummary(trace: ReturnType<ReturnType<typeof createLlmTraceRecorder>["build"]>) {
  return {
    finalReplySource: trace.summary.finalReply.source,
    finalReplyShape: trace.summary.finalReply.shape,
    roundCount: trace.summary.roundCount,
    toolCount: trace.summary.toolCount,
  };
}

function observedTools(trace: ReturnType<ReturnType<typeof createLlmTraceRecorder>["build"]>): string[] {
  return trace.timeline
    .filter((event) => event.type === "tool_received")
    .map((event) => event.tool);
}

function assertion(
  name: string,
  ok: boolean,
  message: string,
  evidence?: Record<string, unknown>,
): BehaviorAssertionResult {
  return ok ? { name, ok, evidence } : { name, ok, message, evidence };
}

function buildOutcome(
  assertions: BehaviorAssertionResult[],
  evidence: Record<string, unknown>,
): BehaviorCaseOutcome {
  const evaluation = evaluateExpectedFailures({ assertions });
  return {
    caseId: "CASE-02",
    status: evaluation.status,
    ok: evaluation.ok,
    assertions: evaluation.assertions,
    evidence: {
      ...evidence,
      expectedFailureEvaluation: evaluation.evidence,
    },
  };
}

export async function runCase02UncertainQuantity(createApp: ScenarioAppFactory): Promise<BehaviorCaseOutcome> {
  const llm = new StreamingLLMProvider();
  const recorder = createLlmTraceRecorder();
  const foodName = "雞肉沙拉";
  const toolArgsItem = {
    food_name: foodName,
    calories: 420,
    protein: 32,
    carbs: 28,
    fat: 18,
  };
  const toolArgs: LogFoodArgs = {
    items: [toolArgsItem],
    protein_sources: [
      { name: "雞肉", protein: 32, is_primary: true, certainty: "clear" },
    ],
  };

  llm.queueRoundResponse({
    toolCalls: [
      {
        id: "call_case_02_log_food",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify(toolArgs),
        },
      },
    ],
  });
  const userText = `我吃了${foodName}`;
  process.env.TZ = "Asia/Taipei";
  const { normalizeLogFoodArgs } = await import("../../../server/orchestrator/tools.js");
  const normalizedToolArgs = normalizeLogFoodArgs(toolArgs, userText);

  const fixture = await createApp({
    llmProvider: llm,
    llmTraceRecorderFactory: () => recorder,
  });

  try {
    const form = new FormData();
    form.append("message", userText);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let res: Response | undefined;
    let sseText = "";
    try {
      res = await fetch(`${fixture.address}/api/chat`, {
        method: "POST",
        headers: {
          cookie: fixture.cookieHeader,
          Accept: "text/event-stream",
        },
        signal: controller.signal,
        body: form,
      });

      const reader = res.body?.getReader();
      try {
        sseText = reader ? await readDoneEventText(reader) : "";
      } finally {
        await reader?.cancel().catch(() => {});
      }
    } finally {
      clearTimeout(timeout);
    }
    if (!res) {
      throw new Error("CASE-02 request did not return a response");
    }
    const response = res;
    const events = parseSSEEvents(sseText);
    const replyText = parseChunkText(events);
    const donePayload = parseDonePayload(events);
    const persistedRows = await fixture.services.foodLoggingService.getMealsByDate(
      fixture.deviceId,
      new Date(),
    );
    const persistedMeal = persistedRows.find((meal) => meal.foodName === foodName);
    const persistedEvidence = persistedMeal
      ? {
          foodName: persistedMeal.foodName,
          dateKey: persistedMeal.loggedAt.slice(0, 10),
          calories: persistedMeal.calories,
          protein: persistedMeal.protein,
          carbs: persistedMeal.carbs,
          fat: persistedMeal.fat,
          quantityUncertaintyReason: normalizedToolArgs.quantityUncertaintyReason,
        }
      : undefined;
    const trace = recorder.build({ scenario: "CASE-02", status: "pass" });
    const sources = buildNumberSources({
      toolArgs: [toolArgsItem.calories, toolArgsItem.protein, toolArgsItem.carbs, toolArgsItem.fat],
      donePayload,
      persistedMeal: persistedEvidence,
    });

    const assertions = [
      assertion("http_ok", response.ok, `Expected HTTP 200, got ${response.status}`, { status: response.status }),
      assertion("did_log_meal", donePayload.didLogMeal === true, "Expected done.didLogMeal true", {
        didLogMeal: donePayload.didLogMeal,
      }),
      assertion(
        "missing_quantity_reason",
        normalizedToolArgs.quantityUncertaintyReason === "missing_quantity",
        "Expected missing_quantity uncertainty reason",
        { quantityUncertaintyReason: normalizedToolArgs.quantityUncertaintyReason },
      ),
      assertTraditionalChinese(replyText),
      assertNoInternalLeakage(replyText),
      assertGroundedNumbers(replyText, { sources }),
      assertNoInventedMeals(replyText, {
        allowedMealNames: [foodName],
        assistantMealNames: [donePayload.loggedMeal?.foodName ?? ""].filter(Boolean),
      }),
      assertQuantityUncertaintyCaveat(replyText),
      assertion("persisted_meal_facts", persistedEvidence?.foodName === foodName, "Expected persisted meal", {
        persistedMeal: persistedEvidence,
      }),
    ];

    const caveat = assertions.find((result) => result.name === "quantity_uncertainty_caveat");
    const numbers = assertions.find((result) => result.name === "grounded_numbers");

    return buildOutcome(assertions, {
      quantityUncertaintyReason: normalizedToolArgs.quantityUncertaintyReason,
      matchedCaveatPatterns: caveat?.evidence?.matchedPatterns,
      extractedNumbers: numbers?.evidence?.extractedNumbers,
      allowedNumberSourceLabels: sources.map((source) => source.source),
      unsupportedNumbers: numbers?.evidence?.unsupportedNumbers,
      persistedMeal: persistedEvidence,
      receiptLoggedMeal: donePayload.loggedMeal,
      observedTools: observedTools(trace),
      trace: traceSummary(trace),
      sseEventNames: events.map((event) => event.event),
    });
  } finally {
    await fixture.close();
  }
}
