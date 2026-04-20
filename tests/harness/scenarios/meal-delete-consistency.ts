/**
 * Deterministic delete consistency verification scenario.
 *
 * Proves that an image-backed meal can be deleted through
 * `DELETE /api/meals/:id` without breaking the original chat-side image
 * evidence, and that the affected-day summary drops the deleted meal.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm } from "node:fs/promises";
import { createScenarioApp } from "../app-fixture.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
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

interface MealDto {
  id: string;
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
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_ROOT = path.resolve(__dirname, "..", "tmp", "meal-delete-consistency");
const SCENARIO_UPLOADS_DIR = path.join(SCENARIO_ROOT, "uploads");
const SCENARIO_ASSETS_DIR = path.join(SCENARIO_ROOT, "assets");
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
      const summary = JSON.parse(dailySummaryEvents[targetCount - 1]!.data) as DailySummary;
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
        headers: { "x-device-id": fixture.deviceId },
      });
      if (bootstrapRes.status !== 200) {
        steps.push(fail("bootstrap", `Expected 200 from /api/meals, got ${bootstrapRes.status}`));
        return failResult(scenarioName, steps, "bootstrap", artifacts);
      }
      steps.push(pass("bootstrap", { status: bootstrapRes.status }));

      sseController = new AbortController();
      sseTimeout = setTimeout(() => sseController?.abort(), 10000);

      const sseRes = await fetch(`${fixture.address}/api/sse?deviceId=${fixture.deviceId}`, {
        headers: { Accept: "text/event-stream" },
        signal: sseController.signal,
      });
      if (sseRes.status !== 200 || !sseRes.body) {
        steps.push(fail("subscribe_summary", `Expected 200 with SSE body, got ${sseRes.status}`));
        return failResult(scenarioName, steps, "subscribe_summary", artifacts);
      }

      sseReader = sseRes.body.getReader();
      const initialSummaryState = await waitForDailySummaryCount(sseReader, sseCollectedText, 1);
      sseCollectedText = initialSummaryState.collectedText;
      artifacts.summaryEvents = initialSummaryState.events;
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
      steps.push(pass("subscribe_summary", initialSummaryState.summary));

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
          "x-device-id": fixture.deviceId,
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

      artifacts.stream = { streamEvents, statusLabels };
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
      steps.push(pass("collect_stream", { statusLabels, donePayload }));

      const preDeleteMealsRes = await fetch(`${fixture.address}/api/meals`, {
        headers: { "x-device-id": fixture.deviceId },
      });
      if (preDeleteMealsRes.status !== 200) {
        steps.push(fail("verify_pre_delete_meal", `Expected 200 from /api/meals, got ${preDeleteMealsRes.status}`));
        return failResult(scenarioName, steps, "verify_pre_delete_meal", artifacts);
      }
      const preDeleteMeals = (await preDeleteMealsRes.json() as { meals: MealDto[] }).meals;
      artifacts.preDeleteMeals = preDeleteMeals;
      if (preDeleteMeals.length !== 1) {
        steps.push(fail("verify_pre_delete_meal", `Expected 1 meal before delete, got ${preDeleteMeals.length}`, preDeleteMeals));
        return failResult(scenarioName, steps, "verify_pre_delete_meal", artifacts);
      }
      const deletedMeal = preDeleteMeals[0]!;
      if (!deletedMeal.imageAssetId || !deletedMeal.imageUrl) {
        steps.push(fail("verify_pre_delete_meal", "Expected image metadata on the pre-delete meal", deletedMeal));
        return failResult(scenarioName, steps, "verify_pre_delete_meal", artifacts);
      }
      steps.push(pass("verify_pre_delete_meal", deletedMeal));

      const postLogSummaryState = await waitForDailySummaryCount(sseReader, sseCollectedText, 2);
      sseCollectedText = postLogSummaryState.collectedText;
      artifacts.summaryEvents = postLogSummaryState.events;
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
      steps.push(pass("verify_summary_after_log", postLogSummaryState.summary));

      // DELETE /api/meals/:id is the transaction-level soft delete contract under test.
      const deleteRes = await fetch(`${fixture.address}/api/meals/${deletedMeal.id}`, {
        method: "DELETE",
        headers: { "x-device-id": fixture.deviceId },
      });
      const deleteBody = await deleteRes.json() as {
        affectedDate?: string;
        dailySummary?: { date?: string; mealCount?: number };
      };
      artifacts.deleteResponse = { status: deleteRes.status, mealId: deletedMeal.id, body: deleteBody };
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
      steps.push(pass("delete_meal", { mealId: deletedMeal.id, status: deleteRes.status, body: deleteBody }));

      const postDeleteSummaryState = await waitForDailySummaryCount(sseReader, sseCollectedText, 3);
      sseCollectedText = postDeleteSummaryState.collectedText;
      artifacts.summaryEvents = postDeleteSummaryState.events;
      artifacts.summaryAfterDelete = postDeleteSummaryState.summary;
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
      steps.push(pass("verify_summary_after_delete", postDeleteSummaryState.summary));

      const postDeleteMealsRes = await fetch(`${fixture.address}/api/meals`, {
        headers: { "x-device-id": fixture.deviceId },
      });
      if (postDeleteMealsRes.status !== 200) {
        steps.push(fail("verify_meals_after_delete", `Expected 200 from /api/meals, got ${postDeleteMealsRes.status}`));
        return failResult(scenarioName, steps, "verify_meals_after_delete", artifacts);
      }
      const postDeleteMeals = (await postDeleteMealsRes.json() as { meals: MealDto[] }).meals;
      artifacts.postDeleteMeals = postDeleteMeals;
      if (postDeleteMeals.some((meal) => meal.id === deletedMeal.id)) {
        steps.push(fail("verify_meals_after_delete", "Deleted meal still appears in /api/meals", postDeleteMeals));
        return failResult(scenarioName, steps, "verify_meals_after_delete", artifacts);
      }
      steps.push(pass("verify_meals_after_delete", { mealCount: postDeleteMeals.length, meals: postDeleteMeals }));

      const historyRes = await fetch(`${fixture.address}/api/chat/history?limit=10`, {
        headers: { "x-device-id": fixture.deviceId },
      });
      if (historyRes.status !== 200) {
        steps.push(fail("verify_history_image", `Expected 200 from /api/chat/history, got ${historyRes.status}`));
        return failResult(scenarioName, steps, "verify_history_image", artifacts);
      }
      const historyMessages = (await historyRes.json() as { messages: ChatHistoryMessage[] }).messages;
      const userImageMessage = historyMessages.find(
        (message) => message.role === "user" && message.imageAssetId,
      );
      artifacts.historyAfterDelete = historyMessages;
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
      steps.push(pass("verify_history_image", userImageMessage));

      if (!userImageMessage.imageUrl?.startsWith("/api/assets/")) {
        steps.push(fail(
          "verify_asset_fetch",
          `Expected imageUrl to start with /api/assets/, got ${String(userImageMessage.imageUrl)}`,
          userImageMessage,
        ));
        return failResult(scenarioName, steps, "verify_asset_fetch", artifacts);
      }
      const assetRes = await fetch(`${fixture.address}${userImageMessage.imageUrl}`, {
        headers: { "x-device-id": fixture.deviceId },
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
