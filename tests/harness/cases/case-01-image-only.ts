import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
import { createScenarioApp } from "../app-fixture.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { createLlmTraceRecorder } from "../../../server/orchestrator/llm-trace.js";
import { validJpegBytes } from "../../fixtures/image-bytes.js";

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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TEMP_ROOT = path.resolve(__dirname, "..", "tmp", "case-01-image-only");

function makeJpegBytes(): ArrayBuffer {
  return validJpegBytes();
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
        timeout = setTimeout(() => reject(new Error("Timed out collecting CASE-01 SSE done event")), 5000);
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
    caseId: "CASE-01",
    status: evaluation.status,
    ok: evaluation.ok,
    assertions: evaluation.assertions,
    evidence: {
      ...evidence,
      expectedFailureEvaluation: evaluation.evidence,
    },
  };
}

export async function runCase01ImageOnly(): Promise<BehaviorCaseOutcome> {
  await rm(TEMP_ROOT, { recursive: true, force: true });
  await mkdir(path.join(TEMP_ROOT, "uploads"), { recursive: true });
  await mkdir(path.join(TEMP_ROOT, "assets"), { recursive: true });

  const llm = new StreamingLLMProvider();
  const recorder = createLlmTraceRecorder();
  const foodName = "豬肉燒烤飯盒";
  const toolArgs = {
    food_name: foodName,
    calories: 680,
    protein: 35,
    carbs: 86,
    fat: 22,
    protein_sources: [
      { name: "豬肉", protein: 35, is_primary: true, certainty: "clear" },
    ],
  };

  llm.queueRoundResponse({
    toolCalls: [
      {
        id: "call_case_01_log_food",
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
    uploadsDir: path.join(TEMP_ROOT, "uploads"),
    assetsDir: path.join(TEMP_ROOT, "assets"),
  });

  try {
    const form = new FormData();
    form.append("message", "");
    form.append(
      "image",
      new Blob([makeJpegBytes()], { type: "image/jpeg" }),
      "case-01.jpg",
    );

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
      throw new Error("CASE-01 request did not return a response");
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
        }
      : undefined;
    const trace = recorder.build({ scenario: "CASE-01", status: "pass" });
    const sources = buildNumberSources({
      toolArgs: [toolArgs.calories, toolArgs.protein, toolArgs.carbs, toolArgs.fat],
      donePayload,
      persistedMeal: persistedEvidence,
    });

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
      assertQuantityUncertaintyCaveat(replyText),
      assertion("persisted_meal_facts", persistedEvidence?.foodName === foodName, "Expected persisted meal", {
        persistedMeal: persistedEvidence,
      }),
    ];

    const caveat = assertions.find((result) => result.name === "quantity_uncertainty_caveat");
    const numbers = assertions.find((result) => result.name === "grounded_numbers");

    return buildOutcome(assertions, {
      extractedNumbers: numbers?.evidence?.extractedNumbers,
      allowedNumberSourceLabels: sources.map((source) => source.source),
      persistedMeal: persistedEvidence,
      receiptLoggedMeal: donePayload.loggedMeal,
      observedTools: observedTools(trace),
      matchedCaveatPatterns: caveat?.evidence?.matchedPatterns,
      trace: traceSummary(trace),
      sseEventNames: events.map((event) => event.event),
    });
  } finally {
    await fixture.close();
    await rm(TEMP_ROOT, { recursive: true, force: true });
  }
}
