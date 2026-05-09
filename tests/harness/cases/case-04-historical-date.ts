import {
  assertGroundedNumbers,
  assertNoInternalLeakage,
  assertNoInventedMeals,
  assertTraditionalChinese,
  evaluateExpectedFailures,
  type BehaviorAssertionResult,
  type BehaviorCaseOutcome,
  type NumberSource,
} from "../behavior-assertions.js";
import { createScenarioApp } from "../app-fixture.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { createLlmTraceRecorder } from "../../../server/orchestrator/llm-trace.js";

interface LoggedMealEvidence {
  foodName: string;
  dateKey: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface DonePayload {
  didLogMeal?: boolean;
  affectedDate?: string;
  loggedMeal?: LoggedMealEvidence;
  dailySummary?: {
    date?: string;
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
        timeout = setTimeout(() => reject(new Error("Timed out collecting CASE-04 SSE done event")), 5000);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function mealNumbers(meal: LoggedMealEvidence | undefined): number[] {
  return meal ? [meal.calories, meal.protein, meal.carbs, meal.fat] : [];
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

function dateNumbers(dateKey: string): number[] {
  return dateKey.split("-").map((part) => Number(part)).filter(Number.isFinite);
}

function buildNumberSources(input: {
  toolArgs: number[];
  requestedDateKey: string;
  donePayload: DonePayload;
  persistedMeal: LoggedMealEvidence | undefined;
}): NumberSource[] {
  return [
    { source: "tool_args", numbers: input.toolArgs },
    { source: "requested_date_text", numbers: dateNumbers(input.requestedDateKey) },
    { source: "done.loggedMeal", numbers: mealNumbers(input.donePayload.loggedMeal) },
    { source: "receipt_payload", numbers: mealNumbers(input.donePayload.loggedMeal) },
    { source: "persisted_meal", numbers: mealNumbers(input.persistedMeal) },
    { source: "daily_summary", numbers: summaryNumbers(input.donePayload.dailySummary) },
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
    caseId: "CASE-04",
    status: evaluation.status,
    ok: evaluation.ok,
    assertions: evaluation.assertions,
    evidence: {
      ...evidence,
      expectedFailureEvaluation: evaluation.evidence,
    },
  };
}

export async function runCase04HistoricalDate(): Promise<BehaviorCaseOutcome> {
  const llm = new StreamingLLMProvider();
  const recorder = createLlmTraceRecorder();
  const foodName = "牛肉飯";
  const requestedDateKey = "2026-05-01";
  const requestedDateText = "2026-05-01";
  const toolArgs = {
    food_name: foodName,
    calories: 620,
    protein: 30,
    carbs: 82,
    fat: 18,
    date_text: requestedDateText,
    meal_period: "dinner",
    protein_sources: [
      { name: "牛肉", protein: 30, is_primary: true, certainty: "clear" },
    ],
  };

  llm.queueRoundResponse({
    toolCalls: [
      {
        id: "call_case_04_log_food",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify(toolArgs),
        },
      },
    ],
  });

  const fixture = await createScenarioApp({
    llmProvider: llm,
    llmTraceRecorderFactory: () => recorder,
  });

  try {
    const form = new FormData();
    form.append("message", `請幫我補記 ${requestedDateText} 晚餐${foodName}`);

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
      throw new Error("CASE-04 request did not return a response");
    }
    const response = res;
    const events = parseSSEEvents(sseText);
    const replyText = parseChunkText(events);
    const donePayload = parseDonePayload(events);
    const persistedRows = await fixture.services.foodLoggingService.getMealsByDate(
      fixture.deviceId,
      new Date(2026, 4, 1, 12, 0, 0),
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
        }
      : undefined;
    const trace = recorder.build({ scenario: "CASE-04", status: "pass" });
    const sources = buildNumberSources({
      toolArgs: [toolArgs.calories, toolArgs.protein, toolArgs.carbs, toolArgs.fat],
      requestedDateKey,
      donePayload,
      persistedMeal: persistedEvidence,
    });
    const dateEvidence = {
      requestedDateText,
      requestedDateClassification: "explicit_historical_date",
      affectedDate: donePayload.affectedDate,
      receiptDateKey: donePayload.loggedMeal?.dateKey,
      persistedDateKey: persistedEvidence?.dateKey,
      summaryDate: donePayload.dailySummary?.date,
    };

    const assertions = [
      assertion("http_ok", response.ok, `Expected HTTP 200, got ${response.status}`, { status: response.status }),
      assertion("did_log_meal", donePayload.didLogMeal === true, "Expected done.didLogMeal true", {
        didLogMeal: donePayload.didLogMeal,
      }),
      assertTraditionalChinese(replyText),
      assertNoInternalLeakage(replyText),
      assertGroundedNumbers(replyText, { sources }),
      assertNoInventedMeals(replyText, {
        allowedMealNames: [foodName],
        assistantMealNames: [donePayload.loggedMeal?.foodName ?? ""].filter(Boolean),
      }),
      assertion(
        "historical_date_consistency",
        donePayload.affectedDate === requestedDateKey
          && donePayload.loggedMeal?.dateKey === requestedDateKey
          && persistedEvidence?.dateKey === requestedDateKey,
        "Expected affectedDate, receipt dateKey, and persisted dateKey to match requested date",
        dateEvidence,
      ),
    ];

    const numbers = assertions.find((result) => result.name === "grounded_numbers");

    return buildOutcome(assertions, {
      ...dateEvidence,
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
