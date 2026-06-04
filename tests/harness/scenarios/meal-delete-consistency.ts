/**
 * Deterministic delete consistency verification scenario.
 *
 * Proves that an image-backed meal can be deleted through
 * `DELETE /api/meals/:id` without breaking the original chat-side image
 * evidence, that the affected-day summary drops the deleted meal, and that
 * follow-up summary context does not resurrect deleted meal facts.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm } from "node:fs/promises";
import { createScenarioApp } from "../app-fixture.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { collectEventSequence, parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import type {
  VerificationScenario,
  ScenarioContext,
  ScenarioResult,
  ScenarioStepResult,
} from "../scenario-types.js";

interface DailySummary {
  date: string;
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  mealCount: number;
}

interface DailySummaryEnvelope {
  summary?: DailySummary;
  affectedDate?: string;
  source?: "initial" | "meal_mutation";
}

interface MealDto {
  id: string;
  mealRevisionId: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  loggedAt: string;
  imageAssetId?: string | null;
  imageUrl?: string | null;
}

interface ChatHistoryMessage {
  role: string;
  content: string;
  imageAssetId?: string | null;
  imageUrl?: string | null;
  loggedMeal?: {
    receiptStatus?: string;
    mealId?: string;
    mealRevisionId?: string;
    dateKey?: string;
    foodName?: string;
    itemCount?: number;
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
    imageAssetId?: string | null;
    imageUrl?: string | null;
  };
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_ROOT = path.resolve(__dirname, "..", "tmp", "meal-delete-consistency");
const SCENARIO_UPLOADS_DIR = path.join(SCENARIO_ROOT, "uploads");
const SCENARIO_ASSETS_DIR = path.join(SCENARIO_ROOT, "assets");
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STEP_NAMES = [
  "bootstrap",
  "subscribe_summary",
  "post_chat",
  "collect_stream",
  "verify_pre_delete_meal",
  "verify_summary_after_log",
  "delete_meal",
  "verify_summary_after_delete",
  "verify_meals_after_delete",
  "verify_deleted_receipt_reload",
  "verify_history_image",
  "verify_asset_fetch",
  "verify_post_delete_followup",
] as const;

function pass(name: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: true, actual };
}

function fail(name: string, error: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: false, error, actual };
}

function failResult(
  scenarioName: string,
  steps: ScenarioStepResult[],
  failedStepName: string,
  artifacts: Record<string, unknown>,
): ScenarioResult {
  return {
    ok: false,
    failedStep: failedStepName,
    steps,
    artifacts,
    consoleSummary: `FAIL ${scenarioName} ${failedStepName}`,
  };
}

function makeJpegBytes(): ArrayBuffer {
  const bytes = new Uint8Array([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    ...new Array(50).fill(0x00),
    0xFF, 0xD9,
  ]);
  return bytes.buffer as ArrayBuffer;
}

function parseDailySummaryFrame(data: string): DailySummary {
  const parsed = JSON.parse(data) as DailySummary | DailySummaryEnvelope;
  if ("summary" in parsed && parsed.summary) {
    return parsed.summary;
  }
  return parsed as DailySummary;
}

function summarizeSummary(summary: DailySummary | undefined) {
  if (!summary) return undefined;
  return {
    dateShapeValid: DATE_KEY_PATTERN.test(summary.date),
    mealCount: summary.mealCount,
    totalCalories: summary.totalCalories,
    totalProtein: summary.totalProtein,
    totalCarbs: summary.totalCarbs,
    totalFat: summary.totalFat,
  };
}

function summarizeMeal(meal: MealDto) {
  return {
    hasId: typeof meal.id === "string" && meal.id.length > 0,
    hasMealRevisionId: typeof meal.mealRevisionId === "string" && meal.mealRevisionId.length > 0,
    foodName: meal.foodName,
    calories: meal.calories,
    protein: meal.protein,
    carbs: meal.carbs,
    fat: meal.fat,
    hasImageAssetId: typeof meal.imageAssetId === "string" && meal.imageAssetId.length > 0,
    hasImageUrl: typeof meal.imageUrl === "string" && meal.imageUrl.length > 0,
  };
}

function summarizeDeletedReceipt(receipt: NonNullable<ChatHistoryMessage["loggedMeal"]> | undefined) {
  if (!receipt) return undefined;
  return {
    receiptStatus: receipt.receiptStatus,
    hasMealId: typeof receipt.mealId === "string",
    hasMealRevisionId: typeof receipt.mealRevisionId === "string",
    hasDateKey: typeof receipt.dateKey === "string",
    foodName: receipt.foodName,
    itemCount: receipt.itemCount,
    calories: receipt.calories,
    protein: receipt.protein,
    carbs: receipt.carbs,
    fat: receipt.fat,
    imageAssetIdMatched: receipt.imageAssetId,
    imageUrlMatched: receipt.imageUrl,
  };
}

function chunkTextFromEvents(events: Array<{ event: string; data: string }>): string {
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

async function waitForDailySummaryCount(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  currentText: string,
  targetCount: number,
) {
  let collectedText = currentText;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const events = parseSSEEvents(collectedText);
    const dailySummaryEvents = events.filter((event) => event.event === "daily_summary");
    if (dailySummaryEvents.length >= targetCount) {
      const summary = parseDailySummaryFrame(dailySummaryEvents[targetCount - 1]!.data);
      return { collectedText, events, summary, dailySummaryEvents };
    }

    const moreText = await readStreamUntilEvent(reader, "daily_summary", 20);
    if (!moreText) {
      break;
    }
    collectedText += moreText;
  }

  const events = parseSSEEvents(collectedText);
  return {
    collectedText,
    events,
    dailySummaryEvents: events.filter((event) => event.event === "daily_summary"),
    summary: undefined,
  };
}

const scenario: VerificationScenario = {
  name: "meal-delete-consistency",

  async run(_ctx: ScenarioContext): Promise<ScenarioResult> {
    const scenarioName = "meal-delete-consistency";
    const steps: ScenarioStepResult[] = [];
    const artifacts: Record<string, unknown> = {};

    await rm(SCENARIO_ROOT, { recursive: true, force: true });
    await mkdir(SCENARIO_UPLOADS_DIR, { recursive: true });
    await mkdir(SCENARIO_ASSETS_DIR, { recursive: true });

    const provider = new StreamingLLMProvider();
    provider.queueRoundResponse({
      toolCalls: [
        {
          id: "call_meal_delete_consistency_1",
          type: "function",
          function: {
            name: "log_food",
            arguments: JSON.stringify({
              food_name: "雞腿便當",
              calories: 640,
              protein: 34,
              carbs: 72,
              fat: 22,
            }),
          },
        },
      ],
    });
    provider.queueChatStream([
      "已先完成記錄，",
      "如果之後要修正這筆午餐也可以直接告訴我。",
    ]);

    const fixture = await createScenarioApp({
      llmProvider: provider,
      uploadsDir: SCENARIO_UPLOADS_DIR,
      assetsDir: SCENARIO_ASSETS_DIR,
    });

    let sseController: AbortController | undefined;
    let sseTimeout: ReturnType<typeof setTimeout> | undefined;
    let sseReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let sseCollectedText = "";

    try {
      const bootstrapRes = await fetch(`${fixture.address}/api/meals`, {
        headers: { cookie: fixture.cookieHeader },
      });
      if (bootstrapRes.status !== 200) {
        steps.push(fail("bootstrap", `Expected 200 from /api/meals, got ${bootstrapRes.status}`));
        return failResult(scenarioName, steps, "bootstrap", artifacts);
      }
      steps.push(pass("bootstrap", { status: bootstrapRes.status }));

      sseController = new AbortController();
      sseTimeout = setTimeout(() => sseController?.abort(), 10000);

      const sseRes = await fetch(`${fixture.address}/api/sse`, {
        headers: { cookie: fixture.cookieHeader, Accept: "text/event-stream" },
        signal: sseController.signal,
      });
      if (sseRes.status !== 200 || !sseRes.body) {
        steps.push(fail("subscribe_summary", `Expected 200 with SSE body, got ${sseRes.status}`));
        return failResult(scenarioName, steps, "subscribe_summary", artifacts);
      }

      sseReader = sseRes.body.getReader();
      const initialSummaryState = await waitForDailySummaryCount(sseReader, sseCollectedText, 1);
      sseCollectedText = initialSummaryState.collectedText;
      artifacts.summaryEvents = {
        eventSequence: initialSummaryState.events.map((event) => event.event),
        dailySummaryEventCount: initialSummaryState.dailySummaryEvents.length,
      };
      if (!initialSummaryState.summary) {
        steps.push(fail("subscribe_summary", "Did not receive initial daily_summary event", initialSummaryState.events));
        return failResult(scenarioName, steps, "subscribe_summary", artifacts);
      }
      if (initialSummaryState.summary.mealCount !== 0) {
        steps.push(fail(
          "subscribe_summary",
          `Expected initial mealCount === 0, got ${initialSummaryState.summary.mealCount}`,
          initialSummaryState.summary,
        ));
        return failResult(scenarioName, steps, "subscribe_summary", artifacts);
      }
      steps.push(pass("subscribe_summary", summarizeSummary(initialSummaryState.summary)));

      const form = new FormData();
      form.append("message", "這是我剛剛吃的午餐");
      form.append(
        "image",
        new Blob([makeJpegBytes()], { type: "image/jpeg" }),
        "meal-delete-consistency.jpg",
      );

      const chatRes = await fetch(`${fixture.address}/api/chat`, {
        method: "POST",
        headers: {
          cookie: fixture.cookieHeader,
          Accept: "text/event-stream",
        },
        body: form,
      });
      if (chatRes.status !== 200 || !chatRes.body) {
        steps.push(fail("post_chat", `Expected 200 with body, got ${chatRes.status}`, { status: chatRes.status }));
        return failResult(scenarioName, steps, "post_chat", artifacts);
      }
      steps.push(pass("post_chat", { status: chatRes.status }));

      const streamText = await readStreamUntilEvent(chatRes.body.getReader(), "done", 60);
      const streamEvents = parseSSEEvents(streamText);
      const doneEvent = streamEvents.find((event) => event.event === "done");
      const statusLabels = streamEvents
        .filter((event) => event.event === "status")
        .map((event) => {
          try {
            return (JSON.parse(event.data) as { label: string }).label;
          } catch {
            return event.data;
          }
        });

      artifacts.stream = {
        eventSequence: collectEventSequence(streamText),
        statusLabels,
        doneEventCount: doneEvent ? 1 : 0,
      };
      if (!doneEvent) {
        steps.push(fail("collect_stream", "Stream ended without event: done", streamEvents));
        return failResult(scenarioName, steps, "collect_stream", artifacts);
      }

      const donePayload = JSON.parse(doneEvent.data) as {
        didLogMeal?: boolean;
        dailySummary?: DailySummary;
      };
      if (donePayload.didLogMeal !== true) {
        steps.push(fail("collect_stream", "Expected done.didLogMeal === true", donePayload));
        return failResult(scenarioName, steps, "collect_stream", artifacts);
      }
      if (!donePayload.dailySummary || donePayload.dailySummary.mealCount !== 1) {
        steps.push(fail("collect_stream", "Expected done.dailySummary.mealCount === 1", donePayload));
        return failResult(scenarioName, steps, "collect_stream", artifacts);
      }
      if (!DATE_KEY_PATTERN.test(donePayload.dailySummary.date)) {
        steps.push(fail(
          "collect_stream",
          `Expected done.dailySummary.date to match YYYY-MM-DD, got ${String(donePayload.dailySummary.date)}`,
          donePayload,
        ));
        return failResult(scenarioName, steps, "collect_stream", artifacts);
      }
      steps.push(pass("collect_stream", {
        statusLabels,
        donePayload: {
          didLogMeal: donePayload.didLogMeal,
          summary: summarizeSummary(donePayload.dailySummary),
        },
      }));

      const preDeleteMealsRes = await fetch(`${fixture.address}/api/meals`, {
        headers: { cookie: fixture.cookieHeader },
      });
      if (preDeleteMealsRes.status !== 200) {
        steps.push(fail("verify_pre_delete_meal", `Expected 200 from /api/meals, got ${preDeleteMealsRes.status}`));
        return failResult(scenarioName, steps, "verify_pre_delete_meal", artifacts);
      }
      const preDeleteMeals = (await preDeleteMealsRes.json() as { meals: MealDto[] }).meals;
      artifacts.preDeleteMeals = {
        mealCount: preDeleteMeals.length,
        meals: preDeleteMeals.map(summarizeMeal),
      };
      if (preDeleteMeals.length !== 1) {
        steps.push(fail("verify_pre_delete_meal", `Expected 1 meal before delete, got ${preDeleteMeals.length}`, preDeleteMeals));
        return failResult(scenarioName, steps, "verify_pre_delete_meal", artifacts);
      }
      const deletedMeal = preDeleteMeals[0]!;
      if (!deletedMeal.imageAssetId || !deletedMeal.imageUrl) {
        steps.push(fail("verify_pre_delete_meal", "Expected image metadata on the pre-delete meal", deletedMeal));
        return failResult(scenarioName, steps, "verify_pre_delete_meal", artifacts);
      }
      steps.push(pass("verify_pre_delete_meal", summarizeMeal(deletedMeal)));

      const postLogSummaryState = await waitForDailySummaryCount(sseReader, sseCollectedText, 2);
      sseCollectedText = postLogSummaryState.collectedText;
      artifacts.summaryEvents = {
        eventSequence: postLogSummaryState.events.map((event) => event.event),
        dailySummaryEventCount: postLogSummaryState.dailySummaryEvents.length,
      };
      if (!postLogSummaryState.summary) {
        steps.push(fail("verify_summary_after_log", "Did not receive the post-log daily_summary event", postLogSummaryState.events));
        return failResult(scenarioName, steps, "verify_summary_after_log", artifacts);
      }
      if (postLogSummaryState.summary.mealCount !== 1) {
        steps.push(fail(
          "verify_summary_after_log",
          `Expected post-log mealCount === 1, got ${postLogSummaryState.summary.mealCount}`,
          postLogSummaryState.summary,
        ));
        return failResult(scenarioName, steps, "verify_summary_after_log", artifacts);
      }
      if (postLogSummaryState.summary.date !== donePayload.dailySummary.date) {
        steps.push(fail(
          "verify_summary_after_log",
          `Expected post-log summary date ${donePayload.dailySummary.date}, got ${postLogSummaryState.summary.date}`,
          postLogSummaryState.summary,
        ));
        return failResult(scenarioName, steps, "verify_summary_after_log", artifacts);
      }
      steps.push(pass("verify_summary_after_log", summarizeSummary(postLogSummaryState.summary)));

      // DELETE /api/meals/:id is the transaction-level soft delete contract under test.
      const deleteRes = await fetch(`${fixture.address}/api/meals/${deletedMeal.id}`, {
        method: "DELETE",
        headers: { cookie: fixture.cookieHeader, "content-type": "application/json" },
        body: JSON.stringify({ expectedMealRevisionId: deletedMeal.mealRevisionId }),
      });
      const deleteBody = await deleteRes.json() as {
        affectedDate?: string;
        dailySummary?: { date?: string; mealCount?: number };
      };
      artifacts.deleteResponse = {
        status: deleteRes.status,
        mealIdMatched: typeof deletedMeal.id === "string" && deleteBody.affectedDate === postLogSummaryState.summary.date,
        affectedDateShapeValid: typeof deleteBody.affectedDate === "string" && DATE_KEY_PATTERN.test(deleteBody.affectedDate),
        summary: deleteBody.dailySummary
          ? {
              dateMatchesAffectedDate: deleteBody.dailySummary.date === deleteBody.affectedDate,
              mealCount: deleteBody.dailySummary.mealCount,
            }
          : undefined,
      };
      if (deleteRes.status !== 200) {
        steps.push(fail("delete_meal", `Expected 200 from DELETE /api/meals/:id, got ${deleteRes.status}`));
        return failResult(scenarioName, steps, "delete_meal", artifacts);
      }
      if (deleteBody.affectedDate !== postLogSummaryState.summary.date) {
        steps.push(fail(
          "delete_meal",
          `Expected delete affectedDate ${postLogSummaryState.summary.date}, got ${deleteBody.affectedDate ?? "<missing>"}`,
          deleteBody,
        ));
        return failResult(scenarioName, steps, "delete_meal", artifacts);
      }
      if (deleteBody.dailySummary?.date !== deleteBody.affectedDate) {
        steps.push(fail(
          "delete_meal",
          `Expected delete response dailySummary.date ${deleteBody.affectedDate}, got ${deleteBody.dailySummary?.date ?? "<missing>"}`,
          deleteBody,
        ));
        return failResult(scenarioName, steps, "delete_meal", artifacts);
      }
      steps.push(pass("delete_meal", artifacts.deleteResponse));

      const postDeleteSummaryState = await waitForDailySummaryCount(sseReader, sseCollectedText, 3);
      sseCollectedText = postDeleteSummaryState.collectedText;
      artifacts.summaryEvents = {
        eventSequence: postDeleteSummaryState.events.map((event) => event.event),
        dailySummaryEventCount: postDeleteSummaryState.dailySummaryEvents.length,
      };
      artifacts.summaryAfterDelete = summarizeSummary(postDeleteSummaryState.summary);
      if (!postDeleteSummaryState.summary) {
        steps.push(fail("verify_summary_after_delete", "Did not receive the post-delete daily_summary event", postDeleteSummaryState.events));
        return failResult(scenarioName, steps, "verify_summary_after_delete", artifacts);
      }
      if (postDeleteSummaryState.summary.mealCount !== 0) {
        steps.push(fail(
          "verify_summary_after_delete",
          `Expected post-delete mealCount === 0, got ${postDeleteSummaryState.summary.mealCount}`,
          postDeleteSummaryState.summary,
        ));
        return failResult(scenarioName, steps, "verify_summary_after_delete", artifacts);
      }
      if (postDeleteSummaryState.summary.date !== postLogSummaryState.summary.date) {
        steps.push(fail(
          "verify_summary_after_delete",
          `Expected post-delete summary date ${postLogSummaryState.summary.date}, got ${postDeleteSummaryState.summary.date}`,
          postDeleteSummaryState.summary,
        ));
        return failResult(scenarioName, steps, "verify_summary_after_delete", artifacts);
      }
      steps.push(pass("verify_summary_after_delete", summarizeSummary(postDeleteSummaryState.summary)));

      const postDeleteMealsRes = await fetch(`${fixture.address}/api/meals`, {
        headers: { cookie: fixture.cookieHeader },
      });
      if (postDeleteMealsRes.status !== 200) {
        steps.push(fail("verify_meals_after_delete", `Expected 200 from /api/meals, got ${postDeleteMealsRes.status}`));
        return failResult(scenarioName, steps, "verify_meals_after_delete", artifacts);
      }
      const postDeleteMeals = (await postDeleteMealsRes.json() as { meals: MealDto[] }).meals;
      artifacts.postDeleteMeals = {
        mealCount: postDeleteMeals.length,
        containsDeletedMeal: postDeleteMeals.some((meal) => meal.id === deletedMeal.id),
      };
      if (postDeleteMeals.some((meal) => meal.id === deletedMeal.id)) {
        steps.push(fail("verify_meals_after_delete", "Deleted meal still appears in /api/meals", postDeleteMeals));
        return failResult(scenarioName, steps, "verify_meals_after_delete", artifacts);
      }
      steps.push(pass("verify_meals_after_delete", artifacts.postDeleteMeals));

      const historyRes = await fetch(`${fixture.address}/api/chat/history?limit=10`, {
        headers: { cookie: fixture.cookieHeader },
      });
      if (historyRes.status !== 200) {
        steps.push(fail("verify_history_image", `Expected 200 from /api/chat/history, got ${historyRes.status}`));
        return failResult(scenarioName, steps, "verify_history_image", artifacts);
      }
      const historyMessages = (await historyRes.json() as { messages: ChatHistoryMessage[] }).messages;
      const userImageMessage = historyMessages.find(
        (message) => message.role === "user" && message.imageAssetId,
      );
      const deletedReceiptMessage = historyMessages.find((message) =>
        message.role === "assistant" && message.loggedMeal?.foodName === deletedMeal.foodName
      );
      const deletedReceipt = deletedReceiptMessage?.loggedMeal;
      artifacts.historyAfterDelete = {
        messageCount: historyMessages.length,
        userImageMessageFound: Boolean(userImageMessage),
        deletedReceipt: summarizeDeletedReceipt(deletedReceipt),
      };
      if (!deletedReceipt) {
        steps.push(fail("verify_deleted_receipt_reload", "Expected deleted assistant receipt after history reload", artifacts.historyAfterDelete));
        return failResult(scenarioName, steps, "verify_deleted_receipt_reload", artifacts);
      }
      if (deletedReceipt.receiptStatus !== "deleted") {
        steps.push(fail("verify_deleted_receipt_reload", `Expected receiptStatus deleted, got ${String(deletedReceipt.receiptStatus)}`, artifacts.historyAfterDelete));
        return failResult(scenarioName, steps, "verify_deleted_receipt_reload", artifacts);
      }
      if (deletedReceipt.mealId !== undefined || deletedReceipt.mealRevisionId !== undefined || deletedReceipt.dateKey !== undefined) {
        steps.push(fail("verify_deleted_receipt_reload", "Expected deleted receipt to omit edit identity", artifacts.historyAfterDelete));
        return failResult(scenarioName, steps, "verify_deleted_receipt_reload", artifacts);
      }
      if (
        deletedReceipt.foodName !== deletedMeal.foodName ||
        deletedReceipt.calories !== deletedMeal.calories ||
        deletedReceipt.protein !== deletedMeal.protein ||
        deletedReceipt.carbs !== deletedMeal.carbs ||
        deletedReceipt.fat !== deletedMeal.fat ||
        deletedReceipt.itemCount !== 1
      ) {
        steps.push(fail("verify_deleted_receipt_reload", "Expected deleted receipt to preserve historical nutrition evidence", artifacts.historyAfterDelete));
        return failResult(scenarioName, steps, "verify_deleted_receipt_reload", artifacts);
      }
      if (deletedReceipt.imageAssetId !== deletedMeal.imageAssetId || deletedReceipt.imageUrl !== deletedMeal.imageUrl) {
        steps.push(fail("verify_deleted_receipt_reload", "Expected deleted receipt to preserve image evidence", artifacts.historyAfterDelete));
        return failResult(scenarioName, steps, "verify_deleted_receipt_reload", artifacts);
      }
      steps.push(pass("verify_deleted_receipt_reload", artifacts.historyAfterDelete));
      if (!userImageMessage) {
        steps.push(fail("verify_history_image", "Expected a user chat message with image evidence after delete", historyMessages));
        return failResult(scenarioName, steps, "verify_history_image", artifacts);
      }
      if (userImageMessage.imageAssetId !== deletedMeal.imageAssetId) {
        steps.push(fail(
          "verify_history_image",
          `Expected chat imageAssetId ${deletedMeal.imageAssetId}, got ${String(userImageMessage.imageAssetId)}`,
          userImageMessage,
        ));
        return failResult(scenarioName, steps, "verify_history_image", artifacts);
      }
      if (userImageMessage.imageUrl !== deletedMeal.imageUrl) {
        steps.push(fail(
          "verify_history_image",
          `Expected chat imageUrl ${deletedMeal.imageUrl}, got ${String(userImageMessage.imageUrl)}`,
          userImageMessage,
        ));
        return failResult(scenarioName, steps, "verify_history_image", artifacts);
      }
      steps.push(pass("verify_history_image", {
        imageAssetIdMatched: userImageMessage.imageAssetId === deletedMeal.imageAssetId,
        imageUrlMatched: userImageMessage.imageUrl === deletedMeal.imageUrl,
      }));

      if (!userImageMessage.imageUrl?.startsWith("/api/assets/")) {
        steps.push(fail(
          "verify_asset_fetch",
          `Expected imageUrl to start with /api/assets/, got ${String(userImageMessage.imageUrl)}`,
          userImageMessage,
        ));
        return failResult(scenarioName, steps, "verify_asset_fetch", artifacts);
      }
      const assetRes = await fetch(`${fixture.address}${userImageMessage.imageUrl}`, {
        headers: { cookie: fixture.cookieHeader },
      });
      artifacts.assetFetch = {
        imageUrl: userImageMessage.imageUrl,
        status: assetRes.status,
        contentType: assetRes.headers.get("content-type"),
      };
      if (assetRes.status !== 200) {
        steps.push(fail("verify_asset_fetch", `Expected 200 from ${userImageMessage.imageUrl}, got ${assetRes.status}`));
        return failResult(scenarioName, steps, "verify_asset_fetch", artifacts);
      }
      steps.push(pass("verify_asset_fetch", artifacts.assetFetch));

      provider.queueRoundResponse({
        toolCalls: [{
          id: "call_summary_after_delete",
          type: "function",
          function: {
            name: "get_daily_summary",
            arguments: "{}",
          },
        }],
      });
      provider.queueChatStream(["目前今天沒有已記錄餐點。"]);

      const followupForm = new FormData();
      followupForm.append("message", "今天吃了什麼？");
      const followupRes = await fetch(`${fixture.address}/api/chat`, {
        method: "POST",
        headers: {
          cookie: fixture.cookieHeader,
          Accept: "text/event-stream",
        },
        body: followupForm,
      });
      if (followupRes.status !== 200 || !followupRes.body) {
        steps.push(fail("verify_post_delete_followup", `Expected 200 with body, got ${followupRes.status}`, { status: followupRes.status }));
        return failResult(scenarioName, steps, "verify_post_delete_followup", artifacts);
      }
      const followupText = await readStreamUntilEvent(followupRes.body.getReader(), "done", 60);
      const followupEvents = parseSSEEvents(followupText);
      const followupChunkText = chunkTextFromEvents(followupEvents);
      const followupDoneEvent = followupEvents.find((event) => event.event === "done");
      const followupDonePayload = followupDoneEvent
        ? JSON.parse(followupDoneEvent.data) as {
            didLogMeal?: boolean;
            didMutateMeal?: boolean;
            dailySummary?: DailySummary;
            loggedMeal?: unknown;
          }
        : undefined;
      const currentSummary = await fixture.services.summaryService.getDailySummary(fixture.deviceId, new Date());
      const deletedFactPattern = new RegExp(`${deletedMeal.foodName}|${deletedMeal.calories}\\s*kcal|${deletedMeal.calories}|${deletedMeal.protein}\\s*g|${deletedMeal.carbs}\\s*g|${deletedMeal.fat}\\s*g`);
      const latestProviderCall = provider.chatCalls.at(-1);
      const nonSystemContextMessages = latestProviderCall?.messages.filter((message) => message.role !== "system") ?? [];
      const compressedContextText = JSON.stringify(nonSystemContextMessages);
      artifacts.postDeleteFollowup = {
        eventSequence: collectEventSequence(followupText),
        chunkTextLength: followupChunkText.length,
        chunkMentionsDeletedFacts: deletedFactPattern.test(followupChunkText),
        compressedContextMentionsDeletedFacts: deletedFactPattern.test(compressedContextText),
        donePayload: {
          didLogMeal: followupDonePayload?.didLogMeal,
          didMutateMeal: followupDonePayload?.didMutateMeal,
          hasLoggedMeal: followupDonePayload
            ? Object.prototype.hasOwnProperty.call(followupDonePayload, "loggedMeal")
            : false,
          summary: summarizeSummary(followupDonePayload?.dailySummary),
        },
        currentSummary: summarizeSummary(currentSummary),
      };
      if (!followupDonePayload) {
        steps.push(fail("verify_post_delete_followup", "Expected follow-up done payload", artifacts.postDeleteFollowup));
        return failResult(scenarioName, steps, "verify_post_delete_followup", artifacts);
      }
      if (deletedFactPattern.test(followupChunkText)) {
        steps.push(fail("verify_post_delete_followup", "Follow-up assistant response mentioned deleted meal facts", artifacts.postDeleteFollowup));
        return failResult(scenarioName, steps, "verify_post_delete_followup", artifacts);
      }
      if (deletedFactPattern.test(compressedContextText)) {
        steps.push(fail("verify_post_delete_followup", "Compressed provider context mentioned deleted meal facts", artifacts.postDeleteFollowup));
        return failResult(scenarioName, steps, "verify_post_delete_followup", artifacts);
      }
      if (followupDonePayload.didLogMeal !== false || followupDonePayload.didMutateMeal !== false) {
        steps.push(fail("verify_post_delete_followup", "Expected non-mutating follow-up done payload", artifacts.postDeleteFollowup));
        return failResult(scenarioName, steps, "verify_post_delete_followup", artifacts);
      }
      if (
        followupDonePayload.dailySummary !== undefined &&
        (
          followupDonePayload.dailySummary.mealCount !== 0 ||
          followupDonePayload.dailySummary.totalCalories !== 0 ||
          followupDonePayload.dailySummary.totalProtein !== 0 ||
          followupDonePayload.dailySummary.totalCarbs !== 0 ||
          followupDonePayload.dailySummary.totalFat !== 0
        )
      ) {
        steps.push(fail("verify_post_delete_followup", "Expected follow-up done summary, when present, to exclude deleted meal nutrition", artifacts.postDeleteFollowup));
        return failResult(scenarioName, steps, "verify_post_delete_followup", artifacts);
      }
      if (
        currentSummary.mealCount !== 0 ||
        currentSummary.totalCalories !== 0 ||
        currentSummary.totalProtein !== 0 ||
        currentSummary.totalCarbs !== 0 ||
        currentSummary.totalFat !== 0
      ) {
        steps.push(fail("verify_post_delete_followup", "Expected current summary totals to exclude deleted meal nutrition", artifacts.postDeleteFollowup));
        return failResult(scenarioName, steps, "verify_post_delete_followup", artifacts);
      }
      steps.push(pass("verify_post_delete_followup", artifacts.postDeleteFollowup));

      const missingStepNames = STEP_NAMES.filter((name) => !steps.some((step) => step.name === name));
      artifacts.artifactContract = {
        stepNames: [...STEP_NAMES],
        missingStepNames,
        metadataOnly: true,
      };
      if (missingStepNames.length > 0) {
        steps.push(fail("verify_artifact_contract", `Missing step names: ${missingStepNames.join(", ")}`, artifacts.artifactContract));
        return failResult(scenarioName, steps, "verify_artifact_contract", artifacts);
      }
      steps.push(pass("verify_artifact_contract", artifacts.artifactContract));

      return {
        ok: true,
        steps,
        artifacts,
        consoleSummary: `PASS ${scenarioName} ${steps.length}/${steps.length}`,
      };
    } finally {
      if (sseTimeout) {
        clearTimeout(sseTimeout);
      }
      if (sseController && !sseController.signal.aborted) {
        sseController.abort();
      }
      if (fixture) {
        await fixture.close();
      }
      await rm(SCENARIO_ROOT, { recursive: true, force: true });
    }
  },
};

export default scenario;
