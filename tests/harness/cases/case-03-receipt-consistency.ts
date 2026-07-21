import { and, asc, eq, isNull } from "drizzle-orm";
import {
  type BehaviorAssertionResult,
  type BehaviorCaseOutcome,
  assertGroundedNumbers,
  assertNoInventedMeals,
  assertSuccessfulMutationRendererSource,
} from "../behavior-assertions.js";
import { parseSSEEvents } from "../sse.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import {
  mealRevisionItems,
  mealRevisions,
  mealTransactions,
} from "../../../server/db/schema.js";
import type { AppDatabase } from "../../../server/db/client.js";
import { formatLocalDate } from "../../../server/lib/time.js";
import { createLlmTraceRecorder } from "../../../server/orchestrator/llm-trace.js";
import type { ScenarioAppFactory } from "../app-fixture.js";

type TraceFinalReplySource =
  | "renderer"
  | "model"
  | "fallback"
  | "tool_receipt"
  | "mixed";

type TraceFinalReplyShape =
  | "plain_text"
  | "streamed_text"
  | "fallback_text"
  | "empty_or_missing";

interface NormalizedReceiptFacts {
  foodName: string | null;
  itemCount: number | null;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  dateKey: string | null;
  mealId: string | null;
  mealRevisionId: string | null;
  traceFinalReplySource: TraceFinalReplySource | null;
  traceFinalReplyShape: TraceFinalReplyShape | null;
}

interface DonePayload {
  didLogMeal?: unknown;
  loggedMeal?: unknown;
}

interface HistoryPayload {
  messages?: unknown;
}

interface PersistedRevisionRow {
  mealId: string;
  mealRevisionId: string;
  loggedAt: string;
  foodName: string;
  position: number;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

const CASE_ID = "CASE-03";
const SCENARIO_NAME = "behavior-matrix:case-03";
const DETERMINISTIC_MEAL = {
  foodName: "雞胸沙拉",
  itemCount: 1,
  calories: 520,
  protein: 38,
  carbs: 58,
  fat: 14,
};

function pass(name: string, evidence?: Record<string, unknown>): BehaviorAssertionResult {
  return evidence === undefined ? { name, ok: true } : { name, ok: true, evidence };
}

function fail(
  name: string,
  message: string,
  evidence?: Record<string, unknown>,
): BehaviorAssertionResult {
  return evidence === undefined
    ? { name, ok: false, message }
    : { name, ok: false, message, evidence };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function inferInitialMealRevisionId(mealId: string | null): string | null {
  return mealId ? `${mealId}:r1` : null;
}

function normalizePayloadFacts(
  value: unknown,
  traceFinalReplySource: TraceFinalReplySource,
  traceFinalReplyShape: TraceFinalReplyShape,
): NormalizedReceiptFacts {
  if (!isRecord(value)) {
    return emptyFacts(traceFinalReplySource, traceFinalReplyShape);
  }

  const mealId = readString(value, "mealId") ?? readString(value, "id");
  const loggedAt = readString(value, "loggedAt");
  return {
    foodName: readString(value, "foodName"),
    itemCount: readNumber(value, "itemCount"),
    calories: readNumber(value, "calories"),
    protein: readNumber(value, "protein"),
    carbs: readNumber(value, "carbs"),
    fat: readNumber(value, "fat"),
    dateKey: readString(value, "dateKey") ?? (loggedAt ? formatLocalDate(new Date(loggedAt)) : null),
    mealId,
    mealRevisionId: readString(value, "mealRevisionId") ?? inferInitialMealRevisionId(mealId),
    traceFinalReplySource,
    traceFinalReplyShape,
  };
}

function emptyFacts(
  traceFinalReplySource: TraceFinalReplySource,
  traceFinalReplyShape: TraceFinalReplyShape,
): NormalizedReceiptFacts {
  return {
    foodName: null,
    itemCount: null,
    calories: null,
    protein: null,
    carbs: null,
    fat: null,
    dateKey: null,
    mealId: null,
    mealRevisionId: null,
    traceFinalReplySource,
    traceFinalReplyShape,
  };
}

function normalizeAssistantClassifiedFacts(
  reply: string,
  traceFinalReplySource: TraceFinalReplySource,
  traceFinalReplyShape: TraceFinalReplyShape,
): NormalizedReceiptFacts {
  const calories = Number(reply.match(/(\d+(?:\.\d+)?)\s*kcal/)?.[1]);
  const protein = Number(reply.match(/蛋白質\s*(\d+(?:\.\d+)?)\s*g/)?.[1]);
  return {
    foodName: reply.includes(DETERMINISTIC_MEAL.foodName) ? DETERMINISTIC_MEAL.foodName : null,
    itemCount: reply.includes(DETERMINISTIC_MEAL.foodName) ? DETERMINISTIC_MEAL.itemCount : null,
    calories: Number.isFinite(calories) ? calories : null,
    protein: Number.isFinite(protein) ? protein : null,
    carbs: null,
    fat: null,
    dateKey: null,
    mealId: null,
    mealRevisionId: null,
    traceFinalReplySource,
    traceFinalReplyShape,
  };
}

function normalizePersistedRevisionFacts(
  rows: PersistedRevisionRow[],
  traceFinalReplySource: TraceFinalReplySource,
  traceFinalReplyShape: TraceFinalReplyShape,
): NormalizedReceiptFacts {
  const first = rows[0];
  if (!first) {
    return emptyFacts(traceFinalReplySource, traceFinalReplyShape);
  }

  return {
    foodName: rows.map((row) => row.foodName).join("、"),
    itemCount: rows.length,
    calories: rows.reduce((sum, row) => sum + row.calories, 0),
    protein: rows.reduce((sum, row) => sum + row.protein, 0),
    carbs: rows.reduce((sum, row) => sum + row.carbs, 0),
    fat: rows.reduce((sum, row) => sum + row.fat, 0),
    dateKey: formatLocalDate(new Date(first.loggedAt)),
    mealId: first.mealId,
    mealRevisionId: first.mealRevisionId,
    traceFinalReplySource,
    traceFinalReplyShape,
  };
}

function comparableFacts(facts: NormalizedReceiptFacts): Record<string, unknown> {
  return {
    foodName: facts.foodName,
    itemCount: facts.itemCount,
    calories: facts.calories,
    protein: facts.protein,
    carbs: facts.carbs,
    fat: facts.fat,
    dateKey: facts.dateKey,
    mealId: facts.mealId,
    mealRevisionId: facts.mealRevisionId,
  };
}

function assertPairwiseConsistency(
  surfaces: Record<string, NormalizedReceiptFacts>,
): BehaviorAssertionResult {
  const entries = Object.entries(surfaces);
  const mismatches: Array<{
    left: string;
    right: string;
    field: string;
    leftValue: unknown;
    rightValue: unknown;
  }> = [];

  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const [leftName, leftFacts] = entries[i];
      const [rightName, rightFacts] = entries[j];
      const leftComparable = comparableFacts(leftFacts);
      const rightComparable = comparableFacts(rightFacts);
      for (const field of Object.keys(leftComparable)) {
        if (leftComparable[field] !== rightComparable[field]) {
          mismatches.push({
            left: leftName,
            right: rightName,
            field,
            leftValue: leftComparable[field],
            rightValue: rightComparable[field],
          });
        }
      }
    }
  }

  const evidence = {
    comparedSurfaces: entries.map(([name]) => name),
    mismatches,
  };
  return mismatches.length === 0
    ? pass("receipt_consistency", evidence)
    : fail("receipt_consistency", "Receipt facts differ across committed surfaces", evidence);
}

function assertTraceFinalReplyShape(
  actual: TraceFinalReplyShape,
  expected: TraceFinalReplyShape,
): BehaviorAssertionResult {
  const evidence = { actual, expected };
  return actual === expected
    ? pass("trace_final_reply_shape", evidence)
    : fail("trace_final_reply_shape", `Expected trace final reply shape ${expected}, got ${actual}`, evidence);
}

async function readPersistedRevisionRows(
  db: AppDatabase,
  deviceId: string,
  mealId: string,
): Promise<PersistedRevisionRow[]> {
  return await db
    .select({
      mealId: mealTransactions.id,
      mealRevisionId: mealRevisions.id,
      loggedAt: mealTransactions.loggedAt,
      foodName: mealRevisionItems.foodName,
      position: mealRevisionItems.position,
      calories: mealRevisionItems.calories,
      protein: mealRevisionItems.protein,
      carbs: mealRevisionItems.carbs,
      fat: mealRevisionItems.fat,
    })
    .from(mealTransactions)
    .innerJoin(mealRevisions, eq(mealTransactions.currentRevisionId, mealRevisions.id))
    .innerJoin(mealRevisionItems, eq(mealRevisionItems.revisionId, mealRevisions.id))
    .where(and(
      eq(mealTransactions.deviceId, deviceId),
      eq(mealTransactions.id, mealId),
      isNull(mealTransactions.deletedAt),
    ))
    .orderBy(asc(mealRevisionItems.position));
}

function parseDonePayload(rawSse: string): DonePayload {
  const doneEvent = parseSSEEvents(rawSse).find((event) => event.event === "done");
  if (!doneEvent) {
    throw new Error("CASE-03 did not receive an SSE done event");
  }
  return JSON.parse(doneEvent.data) as DonePayload;
}

function collectReply(rawSse: string): string {
  return parseSSEEvents(rawSse)
    .filter((event) => event.event === "chunk")
    .map((event) => {
      const parsed = JSON.parse(event.data) as { token?: unknown };
      return typeof parsed.token === "string" ? parsed.token : "";
    })
    .join("");
}

function findHistoryReceipt(payload: HistoryPayload): unknown {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const assistant = [...messages].reverse().find((message) => (
    isRecord(message) &&
    message.role === "assistant" &&
    isRecord(message.loggedMeal)
  ));
  return isRecord(assistant) ? assistant.loggedMeal : undefined;
}

function buildExecutionErrorOutcome(error: unknown): BehaviorCaseOutcome {
  return {
    caseId: CASE_ID,
    status: "execution-error",
    ok: false,
    assertions: [
      fail("case_03_execution", error instanceof Error ? error.message : String(error)),
    ],
    evidence: {
      errorType: error instanceof Error ? error.name : typeof error,
    },
  };
}

export async function runCase03ReceiptConsistency(createApp: ScenarioAppFactory): Promise<BehaviorCaseOutcome> {
  process.env.TZ = "Asia/Taipei";
  const provider = new StreamingLLMProvider();
  const recorder = createLlmTraceRecorder();

  provider.queueRoundResponse({
    toolCalls: [
      {
        id: "call_case_03_log_food",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: DETERMINISTIC_MEAL.foodName,
                calories: DETERMINISTIC_MEAL.calories,
                protein: DETERMINISTIC_MEAL.protein,
                carbs: DETERMINISTIC_MEAL.carbs,
                fat: DETERMINISTIC_MEAL.fat,
                amount: "1 份",
              },
            ],
            protein_sources: [
              {
                name: "雞胸",
                protein: DETERMINISTIC_MEAL.protein,
                is_primary: true,
                certainty: "clear",
              },
            ],
          }),
        },
      },
    ],
  });

  try {
    const fixture = await createApp({
      llmProvider: provider,
      llmTraceRecorderFactory: () => recorder,
    });
    const { address, cookieHeader, deviceId } = fixture;

      const form = new FormData();
      form.append("message", "我吃了一份雞胸沙拉");
      const chatRes = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: cookieHeader, Accept: "text/event-stream" },
        body: form,
      });
      if (chatRes.status !== 200 || !chatRes.body) {
        throw new Error(`CASE-03 chat request failed with ${chatRes.status}`);
      }

      const rawSse = await chatRes.text();
      const donePayload = parseDonePayload(rawSse);
      if (donePayload.didLogMeal !== true) {
        throw new Error("CASE-03 expected didLogMeal=true");
      }

      const replyText = collectReply(rawSse);
      const trace = recorder.build({ scenario: SCENARIO_NAME, status: "pass" });
      const traceFinalReplySource = trace.summary.finalReply.source;
      const traceFinalReplyShape = trace.summary.finalReply.shape;
      const doneLoggedMealFacts = normalizePayloadFacts(
        donePayload.loggedMeal,
        traceFinalReplySource,
        traceFinalReplyShape,
      );
      if (!doneLoggedMealFacts.mealId) {
        throw new Error("CASE-03 done.loggedMeal missing mealId");
      }

      const historyRes = await fetch(`${address}/api/chat/history?limit=5`, {
        headers: { cookie: cookieHeader },
      });
      if (historyRes.status !== 200) {
        throw new Error(`CASE-03 history request failed with ${historyRes.status}`);
      }
      const receiptPayloadFacts = normalizePayloadFacts(
        findHistoryReceipt(await historyRes.json() as HistoryPayload),
        traceFinalReplySource,
        traceFinalReplyShape,
      );

      const mealsRes = await fetch(`${address}/api/meals`, {
        headers: { cookie: cookieHeader },
      });
      if (mealsRes.status !== 200) {
        throw new Error(`CASE-03 meals request failed with ${mealsRes.status}`);
      }
      const mealsPayload = await mealsRes.json() as { meals?: unknown[] };
      const persistedMealFacts = normalizePayloadFacts(
        Array.isArray(mealsPayload.meals) ? mealsPayload.meals[0] : undefined,
        traceFinalReplySource,
        traceFinalReplyShape,
      );

      const persistedRevisionFacts = normalizePersistedRevisionFacts(
        await readPersistedRevisionRows(fixture.services.db, deviceId, doneLoggedMealFacts.mealId),
        traceFinalReplySource,
        traceFinalReplyShape,
      );
      const normalizedAssistantClassificationFacts = normalizeAssistantClassifiedFacts(
        replyText,
        traceFinalReplySource,
        traceFinalReplyShape,
      );
      const hardGateSurfaces = {
        loggedMeal: doneLoggedMealFacts,
        receiptPayload: receiptPayloadFacts,
        persistence: persistedMealFacts,
        persistedRevision: persistedRevisionFacts,
      };
      const assertions: BehaviorAssertionResult[] = [
        assertPairwiseConsistency(hardGateSurfaces),
        assertGroundedNumbers(replyText, {
          sources: [
            {
              source: "committed_receipt_facts",
              numbers: [
                DETERMINISTIC_MEAL.itemCount,
                DETERMINISTIC_MEAL.calories,
                DETERMINISTIC_MEAL.protein,
                DETERMINISTIC_MEAL.carbs,
                DETERMINISTIC_MEAL.fat,
              ],
            },
          ],
        }),
        assertNoInventedMeals(replyText, {
          allowedMealNames: [DETERMINISTIC_MEAL.foodName],
          assistantMealNames: normalizedAssistantClassificationFacts.foodName
            ? [normalizedAssistantClassificationFacts.foodName]
            : [],
        }),
        assertTraceFinalReplyShape(traceFinalReplyShape, "plain_text"),
        assertSuccessfulMutationRendererSource({
          source: traceFinalReplySource,
          mutationKind: "log",
        }),
      ];

      const ok = assertions.every((assertion) => assertion.ok);

      return {
        caseId: CASE_ID,
        status: ok ? "passed" : "failed",
        ok,
        assertions,
        evidence: {
          normalizedFacts: {
            classifiedAssistant: normalizedAssistantClassificationFacts,
            loggedMeal: doneLoggedMealFacts,
            receiptPayload: receiptPayloadFacts,
            persistence: persistedMealFacts,
            persistedRevision: persistedRevisionFacts,
          },
          traceSummary: {
            finalReply: trace.summary.finalReply,
            toolCount: trace.summary.toolCount,
            fallbackCount: trace.summary.fallbackCount,
          },
        },
      };
  } catch (error) {
    return buildExecutionErrorOutcome(error);
  }
}
