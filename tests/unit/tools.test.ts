import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { mealRevisionItems, mealRevisions, mealTransactions } from "../../server/db/schema.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createSummaryService } from "../../server/services/summary.js";
import {
  executeTool,
  toolRegistry,
  type ToolDeps,
} from "../../server/orchestrator/tools.js";
import { runContract } from "../../server/orchestrator/tool-contract.js";
import { formatLocalDate } from "../../server/lib/time.js";
import type { ToolCall } from "../../server/llm/types.js";

// Plan 10-02 Task 2: parity guarantees for log_food and get_daily_summary
// after migration to the ToolContract registry. Tests 2 and 3 assert at the
// runContract layer so the controlled `failureReason` (D-07) is observable;
// the executeTool wrapper still throws FatalToolError to preserve Phase 8
// orchestrator hook behavior, which Tests 1 and 4 also pin.

describe("Phase 10-02: log_food / get_daily_summary contract parity", () => {
  let db: ReturnType<typeof createDb>;
  let deviceId: string;
  let foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  let summaryService: ReturnType<typeof createSummaryService>;

  const logFoodCall: ToolCall = {
    id: "call_1",
    type: "function",
    function: {
      name: "log_food",
      arguments: JSON.stringify({
        food_name: "蘋果",
        calories: 100,
        protein: 1,
        carbs: 20,
        fat: 0.5,
      }),
    },
  };

  beforeEach(async () => {
    db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    foodLoggingService = createFoodLoggingService(db);
    summaryService = createSummaryService(db);
    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
  });

  it("Test 1: log_food persists meal and returns result/summary/dailySummary.date/loggedMeal", async () => {
    const result = await executeTool(logFoodCall, deviceId, {
      foodLoggingService,
      summaryService,
    });

    assert.equal(result.result, "食物已成功記錄");
    assert.equal(result.summary, "成功");
    assert.ok(result.dailySummary, "dailySummary must be returned");
    assert.equal(result.dailySummary.mealCount, 1);
    assert.equal(result.dailySummary.date, formatLocalDate(new Date()));

    assert.ok(result.loggedMeal, "loggedMeal must be returned");
    assert.equal(result.loggedMeal.foodName, "蘋果");
    assert.equal(result.loggedMeal.calories, 100);
    assert.equal(result.loggedMeal.protein, 0);
    assert.equal(result.loggedMeal.carbs, 20);
    assert.equal(result.loggedMeal.fat, 0.5);
    assert.deepEqual(result.loggedMeal.countedSources, []);
    assert.deepEqual(result.loggedMeal.excludedSources, [{
      name: "蘋果",
      protein: 1,
      reason: "trace",
    }]);
    assert.equal(result.loggedMeal.usedConservativeAssumption, false);

    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals.length, 1);
    assert.equal(meals[0].foodName, "蘋果");
    assert.equal(meals[0].protein, 0);
  });

  it("Test 1b: log_food items[] writes one transaction with multiple revision items and returns dailySummary/loggedMeal", async () => {
    const groupedCall: ToolCall = {
      id: "call_grouped",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          items: [
            {
              food_name: "蘋果",
              calories: 95,
              protein: 0.5,
              carbs: 25,
              fat: 0.3,
            },
            {
              food_name: "優格",
              calories: 120,
              protein: 8,
              carbs: 12,
              fat: 4,
            },
          ],
        }),
      },
    };

    const result = await executeTool(groupedCall, deviceId, {
      foodLoggingService,
      summaryService,
    });

    assert.ok(result.dailySummary, "dailySummary must be returned for grouped writes");
    assert.equal(result.dailySummary.mealCount, 1);
    assert.equal(result.dailySummary.totalProtein, 8);
    assert.ok(result.loggedMeal);
    assert.equal(result.loggedMeal.foodName, "蘋果、優格");
    assert.equal(result.loggedMeal.calories, 215);
    assert.equal(result.loggedMeal.protein, 8);
    assert.equal(result.loggedMeal.carbs, 37);
    assert.equal(result.loggedMeal.fat, 4.3);
    assert.deepEqual(result.loggedMeal.countedSources.map((source) => source.name), ["優格"]);
    assert.deepEqual(result.loggedMeal.excludedSources.map((source) => source.name), ["蘋果"]);

    const transactions = await db.select().from(mealTransactions);
    const revisions = await db.select().from(mealRevisions);
    const revisionItems = await db.select().from(mealRevisionItems);

    assert.equal(transactions.length, 1, "one transaction should be created for one grouped turn");
    assert.equal(revisions.length, 1, "the grouped turn should create one current revision");
    assert.equal(
      revisionItems.length,
      2,
      "the grouped turn should persist one transaction with two revision items",
    );

    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals.length, 1);
    assert.equal(meals[0].id, transactions[0]!.id);
    assert.equal(meals[0].foodName, "蘋果、優格");
    assert.equal(meals[0].protein, 8);
    assert.deepEqual(
      revisionItems.map((item) => item.protein),
      [0, 8],
      "trace-only grouped items should store protein = 0",
    );
  });

  it("accepts grouped log_food calls that include aggregate totals and serving metadata", async () => {
    const groupedCall: ToolCall = {
      id: "call_grouped_with_totals",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "高蛋白粉、肌酸、燕麥片、低糖豆漿",
          calories: 390,
          protein: 34,
          carbs: 34,
          fat: 9,
          items: [
            {
              food_name: "高蛋白粉",
              quantity_g: 30,
              calories: 120,
              protein: 24,
              carbs: 3,
              fat: 2,
            },
            {
              food_name: "肌酸",
              quantity_g: 5,
              calories: 0,
              protein: 0,
              carbs: 0,
              fat: 0,
            },
            {
              food_name: "燕麥片",
              amount: "20g",
              calories: 76,
              protein: 2.5,
              carbs: 13,
              fat: 1.5,
            },
            {
              food_name: "低糖豆漿",
              quantity_ml: 400,
              calories: 194,
              protein: 14,
              carbs: 18,
              fat: 5.5,
            },
          ],
          protein_sources: [
            { name: "高蛋白粉", protein: 24, is_primary: true, certainty: "clear" },
            { name: "低糖豆漿", protein: 14, is_primary: true, certainty: "clear" },
            { name: "燕麥片", protein: 2.5, is_primary: false, certainty: "clear" },
            { name: "肌酸", protein: 0, is_primary: false, certainty: "clear" },
          ],
        }),
      },
    };

    const result = await executeTool(groupedCall, deviceId, {
      foodLoggingService,
      summaryService,
    });

    assert.ok(result.loggedMeal);
    assert.equal(result.loggedMeal.foodName, "高蛋白粉、肌酸 等4項");
    assert.equal(result.loggedMeal.calories, 390);
    assert.equal(result.loggedMeal.protein, 38);
    assert.equal(result.loggedMeal.carbs, 34);
    assert.equal(result.loggedMeal.fat, 9);
    assert.deepEqual(
      result.loggedMeal.countedSources.map((source) => source.name),
      ["高蛋白粉", "低糖豆漿"],
    );
  });

  it("Test 1c: mixed lunchbox persists trusted protein from protein_sources instead of raw proposal", async () => {
    const lunchboxCall: ToolCall = {
      id: "call_lunchbox",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "雞腿便當",
          calories: 640,
          protein: 30,
          carbs: 78,
          fat: 20,
          protein_sources: [
            { name: "雞腿", protein: 18, is_primary: true, certainty: "clear" },
            { name: "滷蛋", protein: 6, is_primary: true, certainty: "clear" },
            { name: "白飯", protein: 4, is_primary: false, certainty: "clear" },
            { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
          ],
        }),
      },
    };

    const result = await executeTool(lunchboxCall, deviceId, {
      foodLoggingService,
      summaryService,
    });

    assert.ok(result.dailySummary);
    assert.equal(result.dailySummary.totalProtein, 24);
    assert.ok(result.loggedMeal);
    assert.equal(result.loggedMeal.foodName, "雞腿便當");
    assert.equal(result.loggedMeal.protein, 24);
    assert.deepEqual(result.loggedMeal.countedSources.map((source) => source.name), ["雞腿", "滷蛋"]);
    assert.deepEqual(result.loggedMeal.excludedSources.map((source) => source.name), ["白飯", "青菜"]);

    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals.length, 1);
    assert.equal(meals[0].protein, 24);
  });

  it("lets image log_food protein-basis failures return to the model for retry", async () => {
    const imageRetryCall: ToolCall = {
      id: "call_image_retry",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "照片餐點",
          calories: 760,
          protein: 12,
          carbs: 92,
          fat: 38,
        }),
      },
    };

    const result = await executeTool(imageRetryCall, deviceId, {
      foodLoggingService,
      summaryService,
      imagePath: "asset:image-retry",
    });

    assert.equal(result.success, false);
    assert.equal(result.executed, false);
    assert.equal(result.failureReason, "execute");
    assert.equal(result.summary, "failureReason: execute");
    assert.match(result.result, /trusted protein basis required/);

    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals.length, 0);
  });

  it("Test 2: log_food summary recomputation failure persists meal and returns controlled failureReason:execute", async () => {
    const throwingSummary = {
      getDailySummary: async () => {
        throw new Error("summary computation failed");
      },
    } as unknown as typeof summaryService;

    const contract = toolRegistry.get("log_food");
    assert.ok(contract, "log_food contract must be registered");

    const toolDeps: ToolDeps = {
      foodLoggingService,
      summaryService: throwingSummary,
    };

    const outcome = await runContract(contract!, logFoodCall, {
      currentUserMessage: "",
      previousAssistantMessage: undefined,
      deps: { toolDeps, deviceId },
    });

    assert.equal(outcome.success, false);
    assert.equal(outcome.executed, false);
    assert.equal(outcome.failureReason, "execute");
    const parsed = JSON.parse(outcome.result);
    assert.equal(parsed.failureReason, "execute");
    assert.match(parsed.message, /summary computation failed/);

    // Plan-mandated parity: meal must still be persisted before the recompute
    // failure returns a controlled tool result (Phase 8/9 invariant).
    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals.length, 1);
    assert.equal(meals[0].foodName, "蘋果");
    assert.equal(meals[0].protein, 0);

    // The orchestrator-facing wrapper continues to surface this as
    // FatalToolError so the existing executed:false hook path stays intact.
    await assert.rejects(
      executeTool(logFoodCall, deviceId, {
        foodLoggingService,
        summaryService: throwingSummary,
      }),
      /summary computation failed/,
    );
  });

  it("Test 3: invalid log_food args do not persist a meal and return executed:false", async () => {
    const contract = toolRegistry.get("log_food");
    assert.ok(contract);

    const invalidCall: ToolCall = {
      id: "call_invalid",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "", // empty name fails strict zod schema
          calories: "not-a-number",
          protein: 1,
          carbs: 20,
          fat: 0.5,
        }),
      },
    };

    const outcome = await runContract(contract!, invalidCall, {
      currentUserMessage: "",
      previousAssistantMessage: undefined,
      deps: { toolDeps: { foodLoggingService, summaryService }, deviceId },
    });

    assert.equal(outcome.success, false);
    assert.equal(outcome.executed, false);
    assert.equal(outcome.failureReason, "validation");
    const parsed = JSON.parse(outcome.result);
    assert.equal(parsed.failureReason, "validation");
    assert.ok(Array.isArray(parsed.fields), "validation fields list must be present");

    // No meal should have been persisted because execute was never reached.
    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals.length, 0);
  });

  it("Test 4: get_daily_summary returns JSON.stringify(summary) plus the macro summary text", async () => {
    // Seed one meal so totals are non-zero, easier to assert formatting.
    await foodLoggingService.logFood(deviceId, {
      foodName: "蛋白餐",
      calories: 450,
      protein: 35,
      carbs: 40,
      fat: 12,
    });

    const call: ToolCall = {
      id: "call_summary",
      type: "function",
      function: {
        name: "get_daily_summary",
        arguments: JSON.stringify({}),
      },
    };

    const result = await executeTool(call, deviceId, {
      foodLoggingService,
      summaryService,
    });

    const summary = await summaryService.getDailySummary(deviceId, new Date());
    assert.equal(result.result, JSON.stringify(summary));
    assert.equal(
      result.summary,
      `熱量 ${summary.totalCalories}kcal, P${summary.totalProtein}g, C${summary.totalCarbs}g, F${summary.totalFat}g`,
    );
  });

  it("returns affectedDate when log_food targets an explicit historical day", async () => {
    const historicalCall: ToolCall = {
      id: "call_historical",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "牛肉麵",
          calories: 520,
          protein: 24,
          carbs: 68,
          fat: 16,
          date_text: "2026-03-25",
          meal_period: "dinner",
        }),
      },
    };

    const result = await executeTool(
      historicalCall,
      deviceId,
      { foodLoggingService, summaryService },
      { currentUserMessage: "幫我補記 2026-03-25 晚餐吃牛肉麵" },
    );

    assert.equal(result.summary, "成功");
    assert.equal(result.affectedDate, "2026-03-25");
    assert.equal(result.dailySummary?.date, "2026-03-25");
  });

  it("returns a controlled multiple_targets outcome for multi-date summary requests", async () => {
    const call: ToolCall = {
      id: "call_multi_summary",
      type: "function",
      function: {
        name: "get_daily_summary",
        arguments: JSON.stringify({}),
      },
    };

    const result = await executeTool(
      call,
      deviceId,
      { foodLoggingService, summaryService },
      { currentUserMessage: "昨天和前天各吃多少蛋白質？" },
    );

    assert.equal(result.success, false);
    assert.equal(result.executed, false);
    assert.equal(result.failureReason, "guard");
    assert.equal(result.summary, "status: multiple_targets");
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dayBeforeYesterday = new Date();
    dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);
    assert.deepEqual(JSON.parse(result.result), {
      status: "multiple_targets",
      dateKeys: [formatLocalDate(yesterday), formatLocalDate(dayBeforeYesterday)],
    });
  });
});
