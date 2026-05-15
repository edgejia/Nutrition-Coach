import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createDb } from "../../server/db/client.js";
import { mealRevisionItems, mealRevisions, mealTransactions } from "../../server/db/schema.js";
import { createDeviceService } from "../../server/services/device.js";
import { createMealCorrectionService } from "../../server/services/meal-correction.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createSummaryService } from "../../server/services/summary.js";
import {
  executeTool,
  getToolDefinitions,
  toolRegistry,
  type ToolDeps,
} from "../../server/orchestrator/tools.js";
import { runContract } from "../../server/orchestrator/tool-contract.js";
import { formatLocalDate } from "../../server/lib/time.js";
import type { ToolCall } from "../../server/llm/types.js";

// Plan 10-02 Task 2: parity guarantees for log_food and get_daily_summary
// after migration to the ToolContract registry. Failure-path tests assert at
// the runContract layer so controlled `failureReason` values remain observable
// where invalid input should not persist.

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

  it("normalizes single-shape log_food calls through the canonical grouped path while preserving top-level protein_sources", async () => {
    const calls: Array<{ method: "logFood" | "logGroupedMeal"; input: unknown }> = [];
    const toolDefs = Object.fromEntries(
      getToolDefinitions().map((definition) => [definition.function.name, definition.function.parameters]),
    ) as Record<string, any>;

    const result = await executeTool(logFoodCall, deviceId, {
      foodLoggingService: {
        async logFood(_deviceId: string, input: unknown) {
          calls.push({ method: "logFood", input });
          return {
            id: "meal-single",
            mealRevisionId: "rev-single",
            foodName: "蘋果",
            calories: 100,
            protein: 0,
            carbs: 20,
            fat: 0.5,
            imagePath: null,
            loggedAt: new Date().toISOString(),
          };
        },
        async logGroupedMeal(_deviceId: string, input: unknown) {
          calls.push({ method: "logGroupedMeal", input });
          return {
            id: "meal-single",
            mealRevisionId: "rev-single",
            foodName: "蘋果",
            calories: 100,
            protein: 0,
            carbs: 20,
            fat: 0.5,
            imagePath: null,
            loggedAt: new Date().toISOString(),
          };
        },
      } as any,
      summaryService: {
        async getDailySummary() {
          return {
            date: formatLocalDate(new Date()),
            totalCalories: 100,
            totalProtein: 0,
            totalCarbs: 20,
            totalFat: 0.5,
            mealCount: 1,
          };
        },
      } as any,
    });

    assert.equal(result.summary, "成功");
    assert.deepEqual(calls.map((call) => call.method), ["logGroupedMeal"]);
    assert.deepEqual(calls[0]?.input, {
      imagePath: undefined,
      loggedAt: undefined,
      items: [{
        foodName: "蘋果",
        calories: 100,
        protein: 0,
        carbs: 20,
        fat: 0.5,
      }],
    });
    assert.ok(toolDefs.log_food.properties.protein_sources, "protein_sources must stay top-level");
    assert.ok(toolDefs.log_food.properties.items, "items[] must remain accepted");
    assert.equal(toolDefs.log_food.properties.items.items.properties.protein_sources, undefined);
    for (const quantityField of ["quantity", "quantity_g", "quantity_ml", "amount", "unit", "serving_size"]) {
      assert.ok(toolDefs.log_food.properties[quantityField], `${quantityField} must be exposed for single-shape log_food`);
      assert.ok(
        toolDefs.log_food.properties.items.items.properties[quantityField],
        `${quantityField} must be exposed for items[] log_food entries`,
      );
    }
  });

  it("normalizes items[] log_food calls through the same canonical grouped path and ignores top-level aggregates", async () => {
    const calls: Array<{ method: "logFood" | "logGroupedMeal"; input: any }> = [];
    const groupedCall: ToolCall = {
      id: "call_items_authoritative",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "should be ignored",
          calories: 999,
          protein: 999,
          carbs: 999,
          fat: 999,
          items: [
            {
              food_name: "蛋餅",
              calories: 320,
              protein: 12,
              carbs: 30,
              fat: 16,
            },
            {
              food_name: "豆漿",
              calories: 180,
              protein: 12,
              carbs: 14,
              fat: 8,
            },
          ],
          protein_sources: [
            { name: "蛋餅", protein: 12, is_primary: true, certainty: "clear" },
            { name: "豆漿", protein: 12, is_primary: true, certainty: "clear" },
          ],
        }),
      },
    };

    await executeTool(groupedCall, deviceId, {
      foodLoggingService: {
        async logFood(_deviceId: string, input: unknown) {
          calls.push({ method: "logFood", input });
          throw new Error("single-shape shim must not be used for items[]");
        },
        async logGroupedMeal(_deviceId: string, input: any) {
          calls.push({ method: "logGroupedMeal", input });
          return {
            id: "meal-grouped",
            mealRevisionId: "rev-grouped",
            foodName: "蛋餅、豆漿",
            calories: 500,
            protein: 24,
            carbs: 44,
            fat: 24,
            imagePath: null,
            loggedAt: new Date().toISOString(),
          };
        },
      } as any,
      summaryService: {
        async getDailySummary() {
          return {
            date: formatLocalDate(new Date()),
            totalCalories: 500,
            totalProtein: 24,
            totalCarbs: 44,
            totalFat: 24,
            mealCount: 1,
          };
        },
      } as any,
    });

    assert.deepEqual(calls.map((call) => call.method), ["logGroupedMeal"]);
    assert.deepEqual(calls[0]?.input.items.map((item: { foodName: string }) => item.foodName), ["蛋餅", "豆漿"]);
    assert.equal(calls[0]?.input.items.reduce((sum: number, item: { calories: number }) => sum + item.calories, 0), 500);
  });

  it("accepts grouped log_food incident args with top-level serving metadata while keeping items authoritative", async () => {
    const incidentCall: ToolCall = {
      id: "call_breakfast_chicken_rice",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "雞胸肉、白飯",
          quantity: 1,
          amount: "雞胸肉150g和一碗白飯",
          unit: "餐",
          serving_size: "早餐",
          calories: 455,
          protein: 49,
          carbs: 58,
          fat: 5,
          items: [
            {
              food_name: "雞胸肉",
              calories: 248,
              protein: 46.5,
              carbs: 0,
              fat: 5.4,
            },
            {
              food_name: "白飯",
              calories: 207,
              protein: 4.3,
              carbs: 46,
              fat: 0.4,
            },
          ],
          protein_sources: [
            { name: "雞胸肉", protein: 46.5, is_primary: true, certainty: "clear" },
            { name: "白飯", protein: 4.3, is_primary: false, certainty: "clear" },
          ],
        }),
      },
    };

    const result = await executeTool(incidentCall, deviceId, {
      foodLoggingService,
      summaryService,
    }, {
      currentUserMessage: "早餐吃雞胸肉150g和一碗白飯",
    });

    assert.ok(result.loggedMeal);
    assert.equal(result.loggedMeal.itemCount, 2);
    assert.equal(result.loggedMeal.foodName, "雞胸肉、白飯");
    assert.equal(result.loggedMeal.quantityUncertaintyReason, undefined);
    assert.deepEqual(result.loggedMeal.countedSources.map((source) => source.name), ["雞胸肉"]);
    assert.deepEqual(result.loggedMeal.excludedSources.map((source) => source.name), ["白飯"]);
    assert.deepEqual(result.loggedMeal.items, [
      { name: "雞胸肉", position: 1, calories: 248, protein: 46.5, carbs: 0, fat: 5.4 },
      { name: "白飯", position: 2, calories: 207, protein: 0, carbs: 46, fat: 0.4 },
    ]);

    const transactions = await db.select().from(mealTransactions);
    const revisionItems = await db.select().from(mealRevisionItems);
    assert.equal(transactions.length, 1);
    assert.equal(revisionItems.length, 2);
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
    assert.ok(result.loggedMeal.mealId, "loggedMeal mealId must be returned");
    assert.ok(result.loggedMeal.mealRevisionId, "loggedMeal mealRevisionId must be returned");
    assert.equal(result.loggedMeal.itemCount, 1);
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
    assert.equal(result.loggedMeal.mealId, meals[0].id);
    assert.equal(meals[0].foodName, "蘋果");
    assert.equal(meals[0].protein, 0);

    const transaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, result.loggedMeal.mealId))
    )[0];
    assert.ok(transaction);
    assert.equal(result.loggedMeal.mealRevisionId, transaction!.currentRevisionId);
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
    assert.equal(result.loggedMeal.itemCount, 2);
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
    assert.equal(result.loggedMeal.mealId, transactions[0]!.id);
    assert.equal(result.loggedMeal.mealRevisionId, revisions[0]!.id);
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
    assert.equal(result.loggedMeal.itemCount, 4);
    assert.equal(result.loggedMeal.foodName, "高蛋白粉、肌酸、燕麥片、低糖豆漿");
    assert.equal(result.loggedMeal.calories, 390);
    assert.equal(result.loggedMeal.protein, 38);
    assert.equal(result.loggedMeal.carbs, 34);
    assert.equal(result.loggedMeal.fat, 9);
    assert.deepEqual(
      result.loggedMeal.countedSources.map((source) => source.name),
      ["高蛋白粉", "低糖豆漿"],
    );
  });

  it("adds transient missing_quantity metadata for text logs without quantity-bearing numbers", async () => {
    const noQuantityCall: ToolCall = {
      id: "call_no_quantity",
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
            { name: "雞腿", protein: 24, is_primary: true, certainty: "uncertain" },
          ],
        }),
      },
    };

    const result = await executeTool(noQuantityCall, deviceId, {
      foodLoggingService,
      summaryService,
    });

    assert.ok(result.loggedMeal);
    assert.equal(result.loggedMeal.itemCount, 1);
    assert.equal(result.loggedMeal.quantityUncertaintyReason, "missing_quantity");
  });

  it("repairs explicit ingredient-style protein sources from anchor food labels", async () => {
    const soyMilkCall: ToolCall = {
      id: "call_soy_milk_repaired_source",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "豆漿",
          quantity_ml: 300,
          calories: 120,
          protein: 8,
          carbs: 10,
          fat: 4,
          protein_sources: [
            { name: "黃豆", protein: 8, is_primary: true, certainty: "clear" },
          ],
        }),
      },
    };

    const result = await executeTool(soyMilkCall, deviceId, {
      foodLoggingService,
      summaryService,
    });

    assert.equal(result.summary, "成功");
    assert.ok(result.loggedMeal);
    assert.equal(result.loggedMeal.foodName, "豆漿");
    assert.equal(result.loggedMeal.protein, 8);
    assert.deepEqual(result.loggedMeal.countedSources.map((source) => source.name), ["豆漿"]);
    assert.deepEqual(result.loggedMeal.excludedSources.map((source) => source.name), ["黃豆"]);
  });

  it("uses anchor item-label inference with explicit untrusted sources but still fails unsupported protein", async () => {
    const repairedAnchorCall: ToolCall = {
      id: "call_anchor_with_untrusted_source",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "低糖豆漿",
          quantity_ml: 400,
          calories: 190,
          protein: 14,
          carbs: 15,
          fat: 6,
          protein_sources: [
            { name: "大豆", protein: 14, is_primary: true, certainty: "clear" },
          ],
        }),
      },
    };
    const unsupportedProteinCall: ToolCall = {
      id: "call_unsupported_positive_protein",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "珍珠奶茶",
          quantity_ml: 500,
          calories: 420,
          protein: 9,
          carbs: 76,
          fat: 10,
          protein_sources: [
            { name: "珍珠", protein: 9, is_primary: true, certainty: "clear" },
          ],
        }),
      },
    };

    const repairedResult = await executeTool(repairedAnchorCall, deviceId, {
      foodLoggingService,
      summaryService,
    });

    assert.ok(repairedResult.loggedMeal);
    assert.equal(repairedResult.loggedMeal.protein, 14);
    assert.deepEqual(repairedResult.loggedMeal.countedSources.map((source) => source.name), ["低糖豆漿"]);

    await assert.rejects(
      executeTool(unsupportedProteinCall, deviceId, {
        foodLoggingService,
        summaryService,
      }),
      /trusted protein basis required for this meal/,
    );
  });

  it("repairs generic drink labels from explicit soy-milk source text only", async () => {
    const soyTextAnchoredCall: ToolCall = {
      id: "call_generic_drink_soy_text",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "飲品",
          quantity_ml: 300,
          calories: 120,
          protein: 8,
          carbs: 10,
          fat: 4,
          protein_sources: [
            { name: "植物性飲料", protein: 8, is_primary: true, certainty: "clear" },
          ],
        }),
      },
    };
    const genericDrinkCall: ToolCall = {
      id: "call_generic_drink_no_anchor",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "飲品",
          quantity_ml: 300,
          calories: 120,
          protein: 8,
          carbs: 10,
          fat: 4,
          protein_sources: [
            { name: "植物性飲料", protein: 8, is_primary: true, certainty: "clear" },
          ],
        }),
      },
    };
    const nonGenericSoyTextCall: ToolCall = {
      id: "call_non_generic_soy_text",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "珍珠奶茶",
          quantity_ml: 500,
          calories: 420,
          protein: 9,
          carbs: 76,
          fat: 10,
        }),
      },
    };

    const repairedResult = await executeTool(soyTextAnchoredCall, deviceId, {
      foodLoggingService,
      summaryService,
    }, {
      currentUserMessage: "一杯豆漿",
    });

    assert.ok(repairedResult.loggedMeal);
    assert.equal(repairedResult.loggedMeal.foodName, "豆漿");
    assert.equal(repairedResult.loggedMeal.protein, 8);
    assert.deepEqual(repairedResult.loggedMeal.countedSources.map((source) => source.name), ["豆漿"]);
    assert.doesNotMatch(repairedResult.result, /飲品|植物性飲料|無糖飲料/);

    await assert.rejects(
      executeTool(genericDrinkCall, deviceId, {
        foodLoggingService,
        summaryService,
      }, {
        currentUserMessage: "一杯飲料",
      }),
      /trusted protein basis required for this meal/,
    );
    await assert.rejects(
      executeTool(nonGenericSoyTextCall, deviceId, {
        foodLoggingService,
        summaryService,
      }, {
        currentUserMessage: "一杯豆漿珍珠奶茶",
      }),
      /trusted protein basis required for this meal/,
    );
  });

  it("returns missing-quantity loggedMeal protein that matches persisted item protein", async () => {
    const ambiguousNoodleCall: ToolCall = {
      id: "call_missing_quantity_noodle",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "麵",
          calories: 450,
          protein: 12,
          carbs: 70,
          fat: 10,
          protein_sources: [
            { name: "麵", protein: 12, is_primary: true, certainty: "clear" },
          ],
        }),
      },
    };

    const result = await executeTool(ambiguousNoodleCall, deviceId, {
      foodLoggingService,
      summaryService,
    }, {
      currentUserMessage: "我剛吃麵",
    });

    assert.ok(result.loggedMeal);
    assert.equal(result.loggedMeal.quantityUncertaintyReason, "missing_quantity");
    assert.equal(result.loggedMeal.protein, 0);

    const items = await db
      .select()
      .from(mealRevisionItems)
      .where(eq(mealRevisionItems.revisionId, result.loggedMeal.mealRevisionId));
    assert.equal(items.length, 1);
    assert.equal(items[0]?.protein, result.loggedMeal.protein);
  });

  it("returns normalized loggedMeal item details for downstream edit receipts", async () => {
    const groupedCall: ToolCall = {
      id: "call_logged_meal_items",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          items: [
            { food_name: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 15, quantity: 1 },
            { food_name: "白飯", calories: 280, protein: 5, carbs: 62, fat: 1, quantity: 1 },
            { food_name: "青菜", calories: 40, protein: 2, carbs: 8, fat: 0.5, quantity: 1 },
          ],
          protein_sources: [
            { name: "雞腿", protein: 24, is_primary: true, certainty: "clear" },
            { name: "白飯", protein: 5, is_primary: false, certainty: "clear" },
            { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
          ],
        }),
      },
    };

    const result = await executeTool(groupedCall, deviceId, {
      foodLoggingService,
      summaryService,
    });

    assert.ok(result.loggedMeal);
    assert.deepEqual(result.loggedMeal.items, [
      { name: "雞腿", position: 1, calories: 260, protein: 24, carbs: 0, fat: 15 },
      { name: "白飯", position: 2, calories: 280, protein: 0, carbs: 62, fat: 1 },
      { name: "青菜", position: 3, calories: 40, protein: 0, carbs: 8, fat: 0.5 },
    ]);
  });

  it("omits transient missing_quantity metadata when quantity fields or item text include numbers", async () => {
    const quantityFieldCall: ToolCall = {
      id: "call_quantity_field",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "豆漿",
          quantity_ml: 400,
          calories: 180,
          protein: 12,
          carbs: 14,
          fat: 8,
          protein_sources: [
            { name: "豆漿", protein: 12, is_primary: true, certainty: "clear" },
          ],
        }),
      },
    };
    const quantityInTextCall: ToolCall = {
      id: "call_quantity_text",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          items: [
            {
              food_name: "飯糰 2 顆",
              calories: 420,
              protein: 10,
              carbs: 72,
              fat: 8,
            },
          ],
          protein_sources: [
            { name: "飯糰", protein: 10, is_primary: true, certainty: "clear" },
          ],
        }),
      },
    };

    const quantityFieldResult = await executeTool(quantityFieldCall, deviceId, {
      foodLoggingService,
      summaryService,
    });
    const quantityTextResult = await executeTool(quantityInTextCall, deviceId, {
      foodLoggingService,
      summaryService,
    });

    assert.ok(quantityFieldResult.loggedMeal);
    assert.equal(quantityFieldResult.loggedMeal.quantityUncertaintyReason, undefined);
    assert.ok(quantityTextResult.loggedMeal);
    assert.equal(quantityTextResult.loggedMeal.quantityUncertaintyReason, undefined);
  });

  it("omits transient missing_quantity metadata when the source user text carries the quantity", async () => {
    const normalizedNameCall: ToolCall = {
      id: "call_user_text_quantity",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "白飯",
          calories: 280,
          protein: 5,
          carbs: 62,
          fat: 1,
          protein_sources: [
            { name: "白飯", protein: 5, is_primary: false, certainty: "clear" },
          ],
        }),
      },
    };

    const result = await executeTool(normalizedNameCall, deviceId, {
      foodLoggingService,
      summaryService,
    }, {
      currentUserMessage: "我吃了一碗飯",
    });

    assert.ok(result.loggedMeal);
    assert.equal(result.loggedMeal.quantityUncertaintyReason, undefined);
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

  it("Test 2: log_food summary recomputation failure still returns a committed meal receipt payload", async () => {
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

    assert.equal(outcome.success, true);
    assert.equal(outcome.executed, true);
    assert.equal(outcome.result, "食物已成功記錄");
    const contractResult = outcome.contractResult as {
      status: string;
      dailySummary: {
        totalCalories: number;
        totalProtein: number;
        totalCarbs: number;
        totalFat: number;
        mealCount: number;
        date: string;
      };
      loggedMeal: { foodName: string; protein: number };
    };
    assert.equal(contractResult.status, "logged");
    assert.deepEqual(contractResult.dailySummary, {
      totalCalories: 100,
      totalProtein: 0,
      totalCarbs: 20,
      totalFat: 0.5,
      mealCount: 1,
      date: formatLocalDate(new Date()),
    });
    assert.equal(contractResult.loggedMeal.foodName, "蘋果");
    assert.equal(contractResult.loggedMeal.protein, 0);

    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals.length, 1);
    assert.equal(meals[0].foodName, "蘋果");
    assert.equal(meals[0].protein, 0);

    const result = await executeTool(logFoodCall, deviceId, {
      foodLoggingService,
      summaryService: throwingSummary,
    });
    assert.equal(result.summary, "成功");
    assert.equal(result.dailySummary?.mealCount, 2);
    assert.equal(result.dailySummary?.totalCalories, 200);
    assert.equal(result.loggedMeal?.foodName, "蘋果");
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
    assert.equal(parsed.reason, "schema_validation");
    assert.ok(Array.isArray(parsed.fields), "validation fields list must be present");
    assert.deepEqual(outcome.logSummary, "<log_food args>");

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

  it("returns the updated current revision identity from update_meal loggedMeal", async () => {
    const created = await foodLoggingService.logFood(deviceId, {
      foodName: "蘋果",
      calories: 95,
      protein: 0.5,
      carbs: 25,
      fat: 0.3,
      loggedAt: "2026-03-25T04:30:00.000Z",
    });
    const mealCorrectionService = createMealCorrectionService(db);

    const call: ToolCall = {
      id: "call_update",
      type: "function",
      function: {
        name: "update_meal",
        arguments: JSON.stringify({
          meal_id: created.id,
          calories: 48,
        }),
      },
    };

    const result = await executeTool(call, deviceId, {
      foodLoggingService,
      summaryService,
      mealCorrectionService,
      toolSessionState: {
        resolvedMealIds: [created.id],
      },
    });

    const transaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, created.id))
    )[0];

    assert.ok(result.loggedMeal);
    assert.ok(transaction);
    assert.equal(result.mealMutationKind, "update");
    assert.equal(result.loggedMeal.mealId, created.id);
    assert.equal(result.loggedMeal.mealRevisionId, transaction!.currentRevisionId);
    assert.equal(result.loggedMeal.itemCount, 1);
    assert.notEqual(result.loggedMeal.mealRevisionId, created.mealRevisionId);
    assert.equal(result.loggedMeal.dateKey, "2026-03-25");
    assert.equal(result.loggedMeal.loggedAt, "2026-03-25T04:30:00.000Z");
    assert.equal(result.loggedMeal.imageAssetId, null);
    assert.equal(result.loggedMeal.imageUrl, null);
  });

  it("returns committed deleted meal facts from delete_meal", async () => {
    const created = await foodLoggingService.logFood(deviceId, {
      foodName: "牛肉麵",
      calories: 520,
      protein: 24,
      carbs: 68,
      fat: 16,
      loggedAt: "2026-03-25T10:30:00.000Z",
    });
    const mealCorrectionService = createMealCorrectionService(db);

    const call: ToolCall = {
      id: "call_delete",
      type: "function",
      function: {
        name: "delete_meal",
        arguments: JSON.stringify({
          meal_id: created.id,
        }),
      },
    };

    const result = await executeTool(call, deviceId, {
      foodLoggingService,
      summaryService,
      mealCorrectionService,
      toolSessionState: {
        resolvedMealIds: [created.id],
      },
    });

    assert.equal(result.mealMutationKind, "delete");
    assert.equal(result.affectedDate, "2026-03-25");
    assert.equal(result.dailySummary?.date, "2026-03-25");
    assert.equal(result.dailySummary?.mealCount, 0);
    assert.equal(result.summary, "成功");
    assert.ok(result.deletedMeal);
    const deletedMeal = result.deletedMeal;
    assert.equal(deletedMeal.foodName, "牛肉麵");
    assert.equal(deletedMeal.dateKey, "2026-03-25");
    assert.equal(deletedMeal.mealId, created.id);
    assert.doesNotMatch(JSON.stringify(deletedMeal), /deviceId|revision|delete_meal/);
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
