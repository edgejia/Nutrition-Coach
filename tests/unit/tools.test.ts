import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createDb } from "../../server/db/client.js";
import { mealRevisionItems, mealRevisions, mealTransactions } from "../../server/db/schema.js";
import { createDeviceService } from "../../server/services/device.js";
import { createMealCorrectionService } from "../../server/services/meal-correction.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createMealNumericProposalService } from "../../server/services/meal-numeric-proposals.js";
import { createSummaryService } from "../../server/services/summary.js";
import {
  renderMealNumericAuthorityFailureCopy,
  renderMealNumericProposalCopy,
} from "../../server/orchestrator/mutation-receipts.js";
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

function assertClarificationFact(result: unknown): Record<string, unknown> {
  const clarification = (result as { clarification?: unknown }).clarification;
  assert.ok(clarification && typeof clarification === "object", "ToolExecutionResult.clarification must be present");
  return clarification as Record<string, unknown>;
}

function assertNoRawCandidateFields(candidate: Record<string, unknown>) {
  for (const field of [
    "mealId",
    "mealRevisionId",
    "currentRevisionId",
    "calories",
    "protein",
    "carbs",
    "fat",
    "itemNames",
    "score",
  ]) {
    assert.equal(candidate[field], undefined, `clarification candidate must not expose raw ${field}`);
  }
}

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

  it("omits transient missing_quantity metadata for grouped top-level Chinese serving metadata", async () => {
    const cases: Array<{
      id: string;
      args: Record<string, unknown>;
      sourceText: string;
    }> = [
      {
        id: "call_grouped_amount_one_serving",
        args: { amount: "一份" },
        sourceText: "我剛吃雞腿和白飯",
      },
      {
        id: "call_grouped_serving_size_half_bowl",
        args: { serving_size: "半碗" },
        sourceText: "我剛吃白飯和青菜",
      },
      {
        id: "call_grouped_amount_two_unit_serving",
        args: { amount: "兩份", unit: "份" },
        sourceText: "我剛吃雞腿和豆腐",
      },
    ];

    for (const testCase of cases) {
      const groupedCall: ToolCall = {
        id: testCase.id,
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "雞腿",
                calories: 260,
                protein: 24,
                carbs: 0,
                fat: 15,
              },
              {
                food_name: "白飯",
                calories: 280,
                protein: 5,
                carbs: 62,
                fat: 1,
              },
            ],
            protein_sources: [
              { name: "雞腿", protein: 24, is_primary: true, certainty: "clear" },
            ],
            ...testCase.args,
          }),
        },
      };

      const result = await executeTool(groupedCall, deviceId, {
        foodLoggingService,
        summaryService,
      }, {
        currentUserMessage: testCase.sourceText,
      });

      assert.ok(result.loggedMeal);
      assert.equal(result.loggedMeal.quantityUncertaintyReason, undefined, testCase.id);
    }
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
    assert.equal(result.summaryOutcome?.status, "recovered");
    assert.equal(result.summaryOutcome?.reason, "recompute_failed");
    assert.equal(result.summaryOutcome?.dailySummary.mealCount, 2);
    assert.equal(result.dailySummary?.mealCount, 2);
    assert.equal(result.dailySummary?.totalCalories, 200);
    assert.equal(result.loggedMeal?.foodName, "蘋果");
  });

  it("log_food returns unavailable summaryOutcome without dailySummary when recompute and recovery fail", async () => {
    const throwingSummary = {
      getDailySummary: async () => {
        throw new Error("summary computation failed");
      },
    } as unknown as typeof summaryService;
    const recoveryFailingFoodLoggingService = {
      ...foodLoggingService,
      getMealsByDate: async () => {
        throw new Error("persisted meal recovery failed");
      },
    } as unknown as typeof foodLoggingService;

    const result = await executeTool(logFoodCall, deviceId, {
      foodLoggingService: recoveryFailingFoodLoggingService,
      summaryService: throwingSummary,
    });

    assert.equal(result.summary, "成功");
    assert.deepEqual(result.summaryOutcome, { status: "unavailable", reason: "recompute_failed" });
    assert.equal(result.dailySummary, undefined);
    assert.ok(result.loggedMeal);
    assert.equal(result.loggedMeal.foodName, "蘋果");
    assert.equal(result.loggedMeal.calories, 100);
    assert.equal(result.loggedMeal.protein, 0);

    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals.length, 1);
    assert.equal(meals[0].foodName, "蘋果");
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

  it("Test 4: get_daily_summary returns persisted meal facts plus the macro summary text", async () => {
    // Seed one meal so totals are non-zero, easier to assert formatting.
    await foodLoggingService.logFood(deviceId, {
      foodName: "蛋白餐",
      calories: 450,
      protein: 35,
      carbs: 40,
      fat: 12,
    });
    await foodLoggingService.logFood(deviceId, {
      foodName: "豆腐飯",
      calories: 520,
      protein: 24,
      carbs: 70,
      fat: 14,
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
    assert.deepEqual(JSON.parse(result.result), {
      dailySummary: summary,
      meals: [
        { foodName: "蛋白餐", calories: 450 },
        { foodName: "豆腐飯", calories: 520 },
      ],
    });
    assert.deepEqual(result.summaryHistoryFacts, {
      dailySummary: summary,
      meals: [
        { foodName: "蛋白餐", calories: 450 },
        { foodName: "豆腐飯", calories: 520 },
      ],
    });
    assert.equal(
      result.summary,
      `熱量 ${summary.totalCalories}kcal, P${summary.totalProtein}g, C${summary.totalCarbs}g, F${summary.totalFat}g`,
    );
  });

  it("get_daily_summary returns an empty persisted meal facts array without inventing aggregate item names", async () => {
    const call: ToolCall = {
      id: "call_empty_summary",
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
    assert.deepEqual(JSON.parse(result.result), {
      dailySummary: summary,
      meals: [],
    });
    assert.deepEqual(result.summaryHistoryFacts, {
      dailySummary: summary,
      meals: [],
    });
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
      mealPeriod: "lunch",
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
        resolvedMealTargets: [{ mealId: created.id, mealRevisionId: created.mealRevisionId }],
      },
    }, {
      currentUserMessage: "把蘋果熱量改成 48 卡",
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
    assert.equal(result.loggedMeal.mealPeriod, "lunch");
    assert.equal(result.loggedMeal.imageAssetId, null);
    assert.equal(result.loggedMeal.imageUrl, null);
  });

  it("stores resolver-owned meal id and revision identity from find_meals", async () => {
    const created = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 650,
      protein: 30,
      carbs: 80,
      fat: 20,
      loggedAt: "2026-03-25T04:30:00.000Z",
    });
    const mealCorrectionService = createMealCorrectionService(db);
    const toolSessionState = {
      resolvedMealTargets: [] as Array<{ mealId: string; mealRevisionId: string }>,
    };

    const call: ToolCall = {
      id: "call_find_meal_revision_target",
      type: "function",
      function: {
        name: "find_meals",
        arguments: JSON.stringify({
          action: "update",
          query: "把 3/25 的雞腿飯改成 500 卡",
        }),
      },
    };

    const result = await executeTool(call, deviceId, {
      foodLoggingService,
      summaryService,
      mealCorrectionService,
      toolSessionState,
    } as unknown as ToolDeps);

    assert.equal(result.summary, "status: resolved");
    assert.deepEqual(toolSessionState.resolvedMealTargets, [{
      mealId: created.id,
      mealRevisionId: created.mealRevisionId,
    }]);
  });

  it("Phase 68 D-02-D-06 extends renderer-owned find_meals clarification with typed facts", async () => {
    const sameDateLunch = await foodLoggingService.logFood(deviceId, {
      foodName: "蛋餅",
      calories: 330,
      protein: 12,
      carbs: 38,
      fat: 14,
      loggedAt: "2026-04-18T04:30:00.000Z",
    });
    const sameDateDinner = await foodLoggingService.logFood(deviceId, {
      foodName: "牛肉麵",
      calories: 520,
      protein: 24,
      carbs: 68,
      fat: 16,
      loggedAt: "2026-04-18T11:30:00.000Z",
    });
    await foodLoggingService.logFood(deviceId, {
      foodName: "鴨胸飯",
      calories: 610,
      protein: 31,
      carbs: 72,
      fat: 18,
      loggedAt: "2026-04-19T04:30:00.000Z",
    });
    const mealCorrectionService = createMealCorrectionService(db);
    const toolSessionState = {
      resolvedMealTargets: [{ mealId: "stale", mealRevisionId: "stale-rev" }],
    };

    const result = await executeTool({
      id: "call_find_meals_renderer_clarification",
      type: "function",
      function: {
        name: "find_meals",
        arguments: JSON.stringify({
          action: "update",
          query: "把 4/18 的鴨腿便當改成 500 卡",
        }),
      },
    }, deviceId, {
      foodLoggingService,
      summaryService,
      mealCorrectionService,
      toolSessionState,
    } as unknown as ToolDeps);

    assert.equal(result.summary, "status: needs_clarification");
    assert.equal(result.success, false);
    assert.equal(result.executed, false);
    assert.equal(result.failureReason, "guard");
    assert.deepEqual(result.controlledReply, {
      source: "renderer",
      reason: "meal_target_clarification",
      text: result.result,
    });
    assert.match(result.result, /請直接回覆編號/);
    assert.match(result.result, /1\./);
    assert.match(result.result, /2\./);
    assert.match(result.result, /蛋餅/);
    assert.match(result.result, /牛肉麵/);
    assert.doesNotMatch(result.result, /鴨胸飯|鴨腿便當/);
    assert.doesNotMatch(result.result, /330|520|12\s*g|24\s*g|已更新|已刪除/);
    const clarification = assertClarificationFact(result);
    assert.equal(clarification.kind, "meal_target");
    assert.equal(clarification.status, "needs_clarification");
    assert.equal(clarification.action, "update");
    assert.equal(clarification.prompt, result.result);
    const candidates = clarification.candidates as Array<Record<string, unknown>>;
    assert.equal(candidates.length, 2);
    assert.deepEqual(candidates.map((candidate) => candidate.optionNumber), [1, 2]);
    assert.deepEqual(candidates.map((candidate) => candidate.dateKey), ["2026-04-18", "2026-04-18"]);
    assert.deepEqual(candidates.map((candidate) => candidate.displayLabel), ["蛋餅", "牛肉麵"]);
    for (const candidate of candidates) {
      assertNoRawCandidateFields(candidate);
    }
    assert.equal((result as { contractResult?: unknown }).contractResult, undefined);
    assert.deepEqual(toolSessionState.resolvedMealTargets, []);
    assert.ok([sameDateLunch.id, sameDateDinner.id].every((id) => !toolSessionState.resolvedMealTargets.some((target) => target.mealId === id)));
  });

  it("Phase 67 D-30 returns renderer-owned date-specific no-meals copy for clear single-date find_meals misses", async () => {
    await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 650,
      protein: 30,
      carbs: 80,
      fat: 20,
      loggedAt: "2026-04-19T04:00:00.000Z",
    });
    const mealCorrectionService = createMealCorrectionService(db);
    const toolSessionState = {
      resolvedMealTargets: [{ mealId: "stale", mealRevisionId: "stale-rev" }],
    };

    const result = await executeTool({
      id: "call_find_meals_no_meals_for_date",
      type: "function",
      function: {
        name: "find_meals",
        arguments: JSON.stringify({
          action: "delete",
          query: "把 4/17 的鴨腿便當刪掉",
        }),
      },
    }, deviceId, {
      foodLoggingService,
      summaryService,
      mealCorrectionService,
      toolSessionState,
    } as unknown as ToolDeps);

    assert.equal(result.summary, "status: needs_clarification");
    assert.deepEqual(result.controlledReply, {
      source: "renderer",
      reason: "meal_target_clarification",
      text: result.result,
    });
    assert.match(result.result, /4\/17|2026-04-17/);
    assert.match(result.result, /沒有.*餐點|沒有紀錄/);
    assert.doesNotMatch(result.result, /雞腿飯|已刪除|成功/);
    assert.deepEqual(toolSessionState.resolvedMealTargets, []);
  });

  it("rejects update_meal when only id-only resolved state is present", async () => {
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
      id: "call_update_id_only_state",
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
    } as unknown as ToolDeps);
    const transaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, created.id))
    )[0];
    const revisions = await db.select().from(mealRevisions);

    assert.equal(result.success, false);
    assert.equal(result.executed, false);
    assert.equal(result.failureReason, "execute");
    assert.equal(transaction?.currentRevisionId, created.mealRevisionId);
    assert.equal(revisions.length, 1);
  });

  it("rejects delete_meal when only id-only resolved state is present", async () => {
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
      id: "call_delete_id_only_state",
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
    } as unknown as ToolDeps);
    const transaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, created.id))
    )[0];
    const revisions = await db.select().from(mealRevisions);

    assert.equal(result.success, false);
    assert.equal(result.executed, false);
    assert.equal(result.failureReason, "execute");
    assert.equal(transaction?.deletedAt, null);
    assert.equal(transaction?.currentRevisionId, created.mealRevisionId);
    assert.equal(revisions.length, 1);
  });

  it("returns stable stale revision codes for stale update_meal and delete_meal targets", async () => {
    const updateTarget = await foodLoggingService.logFood(deviceId, {
      foodName: "蘋果",
      calories: 95,
      protein: 0.5,
      carbs: 25,
      fat: 0.3,
      loggedAt: "2026-03-25T04:30:00.000Z",
    });
    const deleteTarget = await foodLoggingService.logFood(deviceId, {
      foodName: "牛肉麵",
      calories: 520,
      protein: 24,
      carbs: 68,
      fat: 16,
      loggedAt: "2026-03-25T10:30:00.000Z",
    });
    const mealCorrectionService = createMealCorrectionService(db);
    const updated = await foodLoggingService.updateMeal(deviceId, updateTarget.id, {
      expectedMealRevisionId: updateTarget.mealRevisionId,
      items: [{
        foodName: "新版蘋果",
        calories: 100,
        protein: 1,
        carbs: 26,
        fat: 0.3,
      }],
    });
    const deleteAdvanced = await foodLoggingService.updateMeal(deviceId, deleteTarget.id, {
      expectedMealRevisionId: deleteTarget.mealRevisionId,
      items: [{
        foodName: "新版牛肉麵",
        calories: 500,
        protein: 26,
        carbs: 60,
        fat: 15,
      }],
    });

    const staleUpdate = await executeTool({
      id: "call_stale_update",
      type: "function",
      function: {
        name: "update_meal",
        arguments: JSON.stringify({
          meal_id: updateTarget.id,
          calories: 48,
        }),
      },
    }, deviceId, {
      foodLoggingService,
      summaryService,
      mealCorrectionService,
      toolSessionState: {
        resolvedMealTargets: [{
          mealId: updateTarget.id,
          mealRevisionId: updateTarget.mealRevisionId,
        }],
      },
    });
    const staleDelete = await executeTool({
      id: "call_stale_delete",
      type: "function",
      function: {
        name: "delete_meal",
        arguments: JSON.stringify({
          meal_id: deleteTarget.id,
        }),
      },
    }, deviceId, {
      foodLoggingService,
      summaryService,
      mealCorrectionService,
      toolSessionState: {
        resolvedMealTargets: [{
          mealId: deleteTarget.id,
          mealRevisionId: deleteTarget.mealRevisionId,
        }],
      },
    });
    const updateTransaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, updateTarget.id))
    )[0];
    const deleteTransaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, deleteTarget.id))
    )[0];

    assert.equal(staleUpdate.success, false);
    assert.equal(staleUpdate.executed, false);
    assert.match(staleUpdate.result, /MEAL_REVISION_STALE/);
    assert.equal(staleUpdate.mealMutationKind, undefined);
    assert.equal(staleUpdate.summaryOutcome, undefined);
    assert.equal(updateTransaction?.currentRevisionId, updated.mealRevisionId);

    assert.equal(staleDelete.success, false);
    assert.equal(staleDelete.executed, false);
    assert.match(staleDelete.result, /MEAL_REVISION_STALE/);
    assert.equal(staleDelete.mealMutationKind, undefined);
    assert.equal(staleDelete.summaryOutcome, undefined);
    assert.equal(deleteTransaction?.currentRevisionId, deleteAdvanced.mealRevisionId);
    assert.equal(deleteTransaction?.deletedAt, null);
  });

  it("returns stable stale revision codes when update_meal target was deleted", async () => {
    const updateTarget = await foodLoggingService.logFood(deviceId, {
      foodName: "鮭魚飯",
      calories: 610,
      protein: 34,
      carbs: 58,
      fat: 24,
      loggedAt: "2026-03-25T04:30:00.000Z",
    });
    const mealCorrectionService = createMealCorrectionService(db);
    const deleted = await foodLoggingService.deleteMeal(deviceId, updateTarget.id, updateTarget.mealRevisionId);

    const staleUpdate = await executeTool({
      id: "call_stale_deleted_update",
      type: "function",
      function: {
        name: "update_meal",
        arguments: JSON.stringify({
          meal_id: updateTarget.id,
          calories: 420,
        }),
      },
    }, deviceId, {
      foodLoggingService,
      summaryService,
      mealCorrectionService,
      toolSessionState: {
        resolvedMealTargets: [{
          mealId: updateTarget.id,
          mealRevisionId: updateTarget.mealRevisionId,
        }],
      },
    });
    const transaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, updateTarget.id))
    )[0];

    assert.equal(staleUpdate.success, false);
    assert.equal(staleUpdate.executed, false);
    assert.match(staleUpdate.result, /MEAL_REVISION_STALE/);
    assert.equal(staleUpdate.mealMutationKind, undefined);
    assert.equal(staleUpdate.summaryOutcome, undefined);
    assert.equal(transaction?.currentRevisionId, `${updateTarget.id}:r2`);
    assert.equal(transaction?.currentRevisionId, `${deleted.transactionId}:r2`);
    assert.notEqual(transaction?.deletedAt, null);
  });

  it("Phase 67 D-44/D-45 returns renderer-owned no-mutation copy when a selected pending update target goes stale before write", async () => {
    const older = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 650,
      protein: 30,
      carbs: 80,
      fat: 20,
      loggedAt: "2026-04-19T04:00:00.000Z",
    });
    const newer = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿飯",
      calories: 620,
      protein: 29,
      carbs: 78,
      fat: 18,
      loggedAt: "2026-04-19T04:30:00.000Z",
    });
    const mealCorrectionService = createMealCorrectionService(db);
    const toolSessionState = {
      resolvedMealTargets: [] as Array<{ mealId: string; mealRevisionId: string }>,
    };

    await executeTool({
      id: "call_pending_options",
      type: "function",
      function: {
        name: "find_meals",
        arguments: JSON.stringify({
          action: "update",
          query: "把 4/19 午餐的雞腿飯蛋白質改 28g",
        }),
      },
    }, deviceId, {
      foodLoggingService,
      summaryService,
      mealCorrectionService,
      toolSessionState,
    });
    const selected = await executeTool({
      id: "call_select_pending_option",
      type: "function",
      function: {
        name: "find_meals",
        arguments: JSON.stringify({
          action: "update",
          query: "2，蛋白質改 28g",
        }),
      },
    }, deviceId, {
      foodLoggingService,
      summaryService,
      mealCorrectionService,
      toolSessionState,
    });
    assert.equal(selected.summary, "status: resolved");
    assert.deepEqual(toolSessionState.resolvedMealTargets, [{
      mealId: older.id,
      mealRevisionId: older.mealRevisionId,
    }]);

    await foodLoggingService.updateMeal(deviceId, older.id, {
      expectedMealRevisionId: older.mealRevisionId,
      items: [{
        foodName: "新版雞腿飯",
        calories: 640,
        protein: 31,
        carbs: 80,
        fat: 19,
      }],
    });
    const staleUpdate = await executeTool({
      id: "call_stale_selected_update",
      type: "function",
      function: {
        name: "update_meal",
        arguments: JSON.stringify({
          meal_id: older.id,
          protein: 28,
        }),
      },
    }, deviceId, {
      foodLoggingService,
      summaryService,
      mealCorrectionService,
      toolSessionState,
    }, {
      currentUserMessage: "2，蛋白質改 28g",
    });
    const revisions = await db.select().from(mealRevisions);

    assert.equal(staleUpdate.success, false);
    assert.equal(staleUpdate.executed, false);
    assert.equal(staleUpdate.failureReason, "guard");
    assert.deepEqual(staleUpdate.controlledReply, {
      source: "renderer",
      reason: "meal_target_clarification",
      text: staleUpdate.result,
    });
    assert.equal(staleUpdate.mealMutationKind, undefined);
    assert.equal(staleUpdate.summaryOutcome, undefined);
    assert.match(staleUpdate.result, /請直接回覆編號/);
    assert.match(staleUpdate.result, /新版雞腿飯/);
    assert.match(staleUpdate.result, /雞腿飯/);
    assert.doesNotMatch(staleUpdate.result, /MEAL_REVISION_STALE|已更新|成功/);
    assert.equal(revisions.length, 3);
    assert.ok(newer.id);
  });

  it("returns update_meal committed facts with unavailable summaryOutcome and no compatibility dailySummary", async () => {
    const created = await foodLoggingService.logFood(deviceId, {
      foodName: "蘋果",
      calories: 95,
      protein: 0.5,
      carbs: 25,
      fat: 0.3,
      loggedAt: "2026-03-25T04:30:00.000Z",
    });
    const unavailableMealCorrectionService = createMealCorrectionService(db, {
      summaryService: {
        async getDailySummary() {
          throw new Error("summary computation failed");
        },
      },
      foodLoggingService: {
        async getMealsByDate() {
          throw new Error("persisted meal recovery failed");
        },
      },
    });

    const call: ToolCall = {
      id: "call_update_unavailable",
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
      mealCorrectionService: unavailableMealCorrectionService,
      toolSessionState: {
        resolvedMealTargets: [{ mealId: created.id, mealRevisionId: created.mealRevisionId }],
      },
    }, {
      currentUserMessage: "把蘋果熱量改成 48 卡",
    });

    assert.equal(result.mealMutationKind, "update");
    assert.equal(result.affectedDate, "2026-03-25");
    assert.deepEqual(result.summaryOutcome, { status: "unavailable", reason: "recompute_failed" });
    assert.equal(result.dailySummary, undefined);
    assert.ok(result.loggedMeal);
    assert.equal(result.loggedMeal.mealId, created.id);
    assert.equal(result.loggedMeal.foodName, "蘋果");
    assert.equal(result.loggedMeal.calories, 48);
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
        resolvedMealTargets: [{ mealId: created.id, mealRevisionId: created.mealRevisionId }],
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

  it("returns delete_meal service-provided recovered summaryOutcome with compatibility dailySummary", async () => {
    const created = await foodLoggingService.logFood(deviceId, {
      foodName: "牛肉麵",
      calories: 520,
      protein: 24,
      carbs: 68,
      fat: 16,
      loggedAt: "2026-03-25T10:30:00.000Z",
    });
    const recoveredMealCorrectionService = createMealCorrectionService(db, {
      summaryService: {
        async getDailySummary() {
          throw new Error("summary computation failed");
        },
      },
      foodLoggingService,
    });

    const call: ToolCall = {
      id: "call_delete_recovered",
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
      mealCorrectionService: recoveredMealCorrectionService,
      toolSessionState: {
        resolvedMealTargets: [{ mealId: created.id, mealRevisionId: created.mealRevisionId }],
      },
    });

    assert.equal(result.mealMutationKind, "delete");
    assert.equal(result.affectedDate, "2026-03-25");
    assert.equal(result.summaryOutcome?.status, "recovered");
    assert.equal(result.summaryOutcome?.reason, "recompute_failed");
    assert.equal(result.summaryOutcome?.dailySummary.mealCount, 0);
    assert.equal(result.dailySummary, result.summaryOutcome?.dailySummary);
    assert.ok(result.deletedMeal);
    assert.equal(result.deletedMeal.mealId, created.id);
    assert.equal(result.deletedMeal.foodName, "牛肉麵");
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

  it("persists source-text explicit mealPeriod over raw model meal_period", async () => {
    const lunchTextWithBreakfastArg: ToolCall = {
      id: "call_source_text_lunch_raw_breakfast",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "雞腿便當",
          calories: 640,
          protein: 30,
          carbs: 78,
          fat: 20,
          date_text: "2026-03-25",
          meal_period: "breakfast",
          protein_sources: [
            { name: "雞腿", protein: 24, is_primary: true, certainty: "clear" },
          ],
        }),
      },
    };

    const result = await executeTool(
      lunchTextWithBreakfastArg,
      deviceId,
      { foodLoggingService, summaryService },
      { currentUserMessage: "幫我補記 2026-03-25 午餐我吃了雞腿便當" },
    );

    assert.equal(result.summary, "成功");
    assert.ok(result.loggedMeal);
    assert.equal((result.loggedMeal as { mealPeriod?: string | null }).mealPeriod, "lunch");
    assert.equal(new Date(result.loggedMeal.loggedAt).getHours(), 8);

    const transaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, result.loggedMeal.mealId))
    )[0];
    assert.equal(transaction?.mealPeriod, "lunch");
  });

  it("does not persist time-of-day words as explicit mealPeriod while preserving historical midpoint", async () => {
    const noonTextWithLunchArg: ToolCall = {
      id: "call_noon_time_word",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "雞腿便當",
          calories: 640,
          protein: 30,
          carbs: 78,
          fat: 20,
          date_text: "2026-03-25",
          meal_period: "lunch",
          protein_sources: [
            { name: "雞腿", protein: 24, is_primary: true, certainty: "clear" },
          ],
        }),
      },
    };

    const result = await executeTool(
      noonTextWithLunchArg,
      deviceId,
      { foodLoggingService, summaryService },
      { currentUserMessage: "幫我補記 2026-03-25 中午吃了雞腿便當" },
    );

    assert.equal(result.summary, "成功");
    assert.ok(result.loggedMeal);
    assert.equal((result.loggedMeal as { mealPeriod?: string | null }).mealPeriod, undefined);
    assert.equal(new Date(result.loggedMeal.loggedAt).getHours(), 12);
    assert.equal(new Date(result.loggedMeal.loggedAt).getMinutes(), 30);

    const transaction = (
      await db
        .select()
        .from(mealTransactions)
        .where(eq(mealTransactions.id, result.loggedMeal.mealId))
    )[0];
    assert.equal(transaction?.mealPeriod, null);
  });

  it("does not map snack source text to a late-night historical loggedAt", async () => {
    const snackText: ToolCall = {
      id: "call_snack_historical_word",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "蛋餅",
          calories: 320,
          protein: 7,
          carbs: 48,
          fat: 10,
          date_text: "2026-03-25",
          protein_sources: [
            { name: "蛋餅", protein: 7, is_primary: true, certainty: "clear" },
          ],
        }),
      },
    };

    const result = await executeTool(
      snackText,
      deviceId,
      { foodLoggingService, summaryService },
      { currentUserMessage: "幫我補記 2026-03-25 下午茶吃蛋餅" },
    );

    assert.equal(result.summary, "成功");
    assert.ok(result.loggedMeal);
    assert.equal((result.loggedMeal as { mealPeriod?: string | null }).mealPeriod, undefined);
    assert.equal(new Date(result.loggedMeal.loggedAt).getHours(), 12);
    assert.equal(new Date(result.loggedMeal.loggedAt).getMinutes(), 0);
  });

  it("Phase 68 D-10/D-11/D-17/D-18 returns typed terminal log_food clarification facts for historical ambiguity", async () => {
    const call: ToolCall = {
      id: "call_historical_log_multiple_dates",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({
          food_name: "蛋餅",
          calories: 320,
          protein: 7,
          carbs: 48,
          fat: 10,
          date_text: "昨天和前天",
          protein_sources: [
            { name: "蛋餅", protein: 7, is_primary: true, certainty: "clear" },
          ],
        }),
      },
    };

    const result = await executeTool(
      call,
      deviceId,
      { foodLoggingService, summaryService },
      { currentUserMessage: "幫我補昨天和前天吃蛋餅" },
    );
    const clarification = assertClarificationFact(result);
    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());

    assert.equal(result.success, false);
    assert.equal(result.executed, false);
    assert.equal(result.failureReason, "guard");
    assert.equal(result.summary, "status: needs_clarification");
    assert.deepEqual(result.controlledReply, {
      source: "renderer",
      reason: "historical_date_clarification",
      text: result.result,
    });
    assert.equal(clarification.kind, "historical_log");
    assert.equal(clarification.status, "needs_clarification");
    assert.equal(clarification.reason, "multiple_dates");
    assert.match(String(clarification.prompt), /一次告訴我一個日期/);
    assert.match(result.result, /一次告訴我一個日期/);
    assert.equal(result.loggedMeal, undefined);
    assert.equal(result.mealMutationKind, undefined);
    assert.equal(result.summaryOutcome, undefined);
    assert.equal(result.dailySummary, undefined);
    assert.equal((result as { contractResult?: unknown }).contractResult, undefined);
    assert.equal(meals.length, 0);
  });

  it("Phase 68 D-12/D-13/D-15/D-18a returns typed terminal get_daily_summary clarification facts", async () => {
    const call: ToolCall = {
      id: "call_summary_unsupported_date",
      type: "function",
      function: {
        name: "get_daily_summary",
        arguments: JSON.stringify({ date_text: "前幾天" }),
      },
    };

    const result = await executeTool(
      call,
      deviceId,
      { foodLoggingService, summaryService },
      { currentUserMessage: "前幾天吃多少蛋白質？" },
    );
    const clarification = assertClarificationFact(result);

    assert.equal(result.success, false);
    assert.equal(result.executed, false);
    assert.equal(result.failureReason, "guard");
    assert.equal(result.summary, "status: needs_clarification");
    assert.deepEqual(result.controlledReply, {
      source: "renderer",
      reason: "historical_summary_clarification",
      text: result.result,
    });
    assert.equal(clarification.kind, "historical_summary");
    assert.equal(clarification.status, "needs_clarification");
    assert.equal(clarification.reason, "unsupported");
    assert.match(String(clarification.prompt), /我還不能確定是哪一天/);
    assert.equal(result.loggedMeal, undefined);
    assert.equal(result.mealMutationKind, undefined);
    assert.equal(result.summaryOutcome, undefined);
    assert.equal(result.dailySummary, undefined);
    assert.equal(result.summaryHistoryFacts, undefined);
    assert.equal((result as { contractResult?: unknown }).contractResult, undefined);
  });

  it("Phase 68 D-12/D-13/D-16/D-18a returns a controlled multiple_targets outcome for multi-date summary requests", async () => {
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
    const expectedDateKeys = [formatLocalDate(yesterday), formatLocalDate(dayBeforeYesterday)];
    const clarification = assertClarificationFact(result);
    assert.deepEqual(result.controlledReply, {
      source: "renderer",
      reason: "historical_summary_clarification",
      text: result.result,
    });
    assert.equal(clarification.kind, "historical_summary");
    assert.equal(clarification.status, "multiple_targets");
    assert.deepEqual(clarification.dateKeys, expectedDateKeys);
    assert.match(result.result, /請.*一天|一個日期|哪一天/);
    for (const dateKey of expectedDateKeys) {
      assert.match(result.result, new RegExp(dateKey));
    }
    assert.equal(result.loggedMeal, undefined);
    assert.equal(result.mealMutationKind, undefined);
    assert.equal(result.summaryOutcome, undefined);
    assert.equal(result.dailySummary, undefined);
    assert.equal(result.summaryHistoryFacts, undefined);
    assert.equal((result as { contractResult?: unknown }).contractResult, undefined);
  });

  it("Phase 68 D-18a multiple_targets renderer copy does not carry forward as one historical log date", async () => {
    const summaryResult = await executeTool(
      {
        id: "call_multi_summary_copy",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: JSON.stringify({}),
        },
      },
      deviceId,
      { foodLoggingService, summaryService },
      { currentUserMessage: "昨天和前天各吃多少蛋白質？" },
    );
    const previousAssistantMessage = summaryResult.controlledReply?.text;
    assert.equal(typeof previousAssistantMessage, "string");

    const logResult = await executeTool(
      {
        id: "call_after_multi_summary_copy",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            food_name: "蛋餅",
            calories: 320,
            protein: 7,
            carbs: 48,
            fat: 10,
            protein_sources: [
              { name: "蛋餅", protein: 7, is_primary: true, certainty: "clear" },
            ],
          }),
        },
      },
      deviceId,
      { foodLoggingService, summaryService },
      {
        currentUserMessage: "蛋餅",
        previousAssistantMessage,
      },
    );
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const dayBeforeYesterday = new Date();
    dayBeforeYesterday.setDate(dayBeforeYesterday.getDate() - 2);

    assert.equal(logResult.summary, "成功");
    assert.ok(logResult.loggedMeal);
    assert.notEqual(logResult.loggedMeal.dateKey, formatLocalDate(yesterday));
    assert.notEqual(logResult.loggedMeal.dateKey, formatLocalDate(dayBeforeYesterday));
    assert.equal(logResult.loggedMeal.dateKey, formatLocalDate(new Date()));
  });

  it("allows explicit current-turn update_meal numeric evidence and preserves the resolver revision", async () => {
    const created = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿",
      calories: 220,
      protein: 24,
      carbs: 0,
      fat: 9,
      loggedAt: "2026-03-25T04:30:00.000Z",
    });
    const mealCorrectionService = createMealCorrectionService(db);
    const calls: string[] = [];

    const result = await executeTool({
      id: "call_explicit_update",
      type: "function",
      function: {
        name: "update_meal",
        arguments: JSON.stringify({
          meal_id: created.id,
          protein: 28,
        }),
      },
    }, deviceId, {
      foodLoggingService,
      summaryService,
      mealCorrectionService: {
        ...mealCorrectionService,
        async updateMeal(
          calledDeviceId: string,
          calledMealId: string,
          input: Parameters<typeof mealCorrectionService.updateMeal>[2],
          expectedMealRevisionId?: string | null,
        ) {
          calls.push(`${calledDeviceId}:${calledMealId}:${expectedMealRevisionId ?? ""}`);
          return mealCorrectionService.updateMeal(calledDeviceId, calledMealId, input, expectedMealRevisionId);
        },
      },
      toolSessionState: {
        resolvedMealTargets: [{ mealId: created.id, mealRevisionId: created.mealRevisionId }],
      },
    } as ToolDeps, {
      currentUserMessage: "蛋白質改成 28g",
    });

    assert.equal(result.summary, "成功");
    assert.equal(result.loggedMeal?.protein, 28);
    assert.deepEqual(calls, [`${deviceId}:${created.id}:${created.mealRevisionId}`]);
  });

  it("blocks vague model-estimated update_meal numeric patches before service writes", async () => {
    const created = await foodLoggingService.logFood(deviceId, {
      foodName: "雞腿",
      calories: 220,
      protein: 24,
      carbs: 0,
      fat: 9,
      loggedAt: "2026-03-25T04:30:00.000Z",
    });
    const mealCorrectionService = createMealCorrectionService(db);
    let updateCalls = 0;

    const result = await executeTool({
      id: "call_vague_update",
      type: "function",
      function: {
        name: "update_meal",
        arguments: JSON.stringify({
          meal_id: created.id,
          protein: 28,
        }),
      },
    }, deviceId, {
      foodLoggingService,
      summaryService,
      mealCorrectionService: {
        ...mealCorrectionService,
        async updateMeal(...args: Parameters<typeof mealCorrectionService.updateMeal>) {
          updateCalls += 1;
          return mealCorrectionService.updateMeal(...args);
        },
      },
      toolSessionState: {
        resolvedMealTargets: [{ mealId: created.id, mealRevisionId: created.mealRevisionId }],
      },
    } as ToolDeps, {
      currentUserMessage: "蛋白質怪怪的，幫我改合理一點",
    });
    const revisions = await db.select().from(mealRevisions);

    assert.equal(result.success, false);
    assert.equal(result.executed, false);
    assert.equal(result.failureReason, "guard");
    assert.equal(result.result, renderMealNumericAuthorityFailureCopy({ field: "protein" }));
    assert.deepEqual(result.controlledReply, {
      source: "renderer",
      reason: "meal_numeric_authority_failure",
      text: renderMealNumericAuthorityFailureCopy({ field: "protein" }),
    });
    assert.equal(updateCalls, 0);
    assert.equal(revisions.length, 1);
    assert.equal(result.mealMutationKind, undefined);
    assert.equal(result.summaryOutcome, undefined);
  });

  it("blocks unauthorized items[] numeric replacements before service writes", async () => {
    const created = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:30:00.000Z",
      items: [
        { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
      ],
    });
    const mealCorrectionService = createMealCorrectionService(db);
    let updateCalls = 0;

    const result = await executeTool({
      id: "call_items_update",
      type: "function",
      function: {
        name: "update_meal",
        arguments: JSON.stringify({
          meal_id: created.id,
          items: [
            { food_name: "雞腿", calories: 260, protein: 28, carbs: 0, fat: 12 },
            { food_name: "白飯", calories: 250, protein: 4, carbs: 62, fat: 0.5 },
          ],
        }),
      },
    }, deviceId, {
      foodLoggingService,
      summaryService,
      mealCorrectionService: {
        ...mealCorrectionService,
        async updateMeal(...args: Parameters<typeof mealCorrectionService.updateMeal>) {
          updateCalls += 1;
          return mealCorrectionService.updateMeal(...args);
        },
      },
      toolSessionState: {
        resolvedMealTargets: [{ mealId: created.id, mealRevisionId: created.mealRevisionId }],
      },
    } as ToolDeps, {
      currentUserMessage: "雞腿蛋白質 28g",
    });
    const revisions = await db.select().from(mealRevisions);

    assert.equal(result.success, false);
    assert.equal(result.executed, false);
    assert.equal(result.failureReason, "guard");
    assert.match(result.result, /^這次沒有更新餐點紀錄。/);
    assert.equal(updateCalls, 0);
    assert.equal(revisions.length, 1);
  });

  it("registers propose_meal_numeric_correction and stores backend-computed proposal copy without mutating meals", async () => {
    const created = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:30:00.000Z",
      items: [
        { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
      ],
    });
    const mealCorrectionService = createMealCorrectionService(db);
    const mealNumericProposalService = createMealNumericProposalService(db);
    const contract = toolRegistry.get("propose_meal_numeric_correction");
    assert.ok(contract, "propose_meal_numeric_correction contract must be registered");
    assert.equal(contract.zodSchema.safeParse({
      meal_id: created.id,
      fields: ["protein"],
      operator: "half",
    }).success, true);
    assert.equal(contract.zodSchema.safeParse({
      meal_id: created.id,
      fields: ["protein"],
      operator: "reasonable",
    }).success, false);
    assert.equal(contract.zodSchema.safeParse({
      meal_id: created.id,
      fields: ["protein"],
      operator: "half",
      protein: 28,
    }).success, false);

    const result = await executeTool({
      id: "call_propose_meal_numeric",
      type: "function",
      function: {
        name: "propose_meal_numeric_correction",
        arguments: JSON.stringify({
          meal_id: created.id,
          fields: ["protein"],
          operator: "half",
        }),
      },
    }, deviceId, {
      foodLoggingService,
      summaryService,
      mealCorrectionService,
      mealNumericProposalService,
      toolSessionState: {
        resolvedMealTargets: [{ mealId: created.id, mealRevisionId: created.mealRevisionId }],
      },
    } as ToolDeps, {
      currentUserMessage: "蛋白質減半",
    });
    const proposal = await mealNumericProposalService.getLatest(deviceId);
    const revisions = await db.select().from(mealRevisions);

    assert.ok(proposal);
    assert.equal(proposal.mealId, created.id);
    assert.equal(proposal.expectedMealRevisionId, created.mealRevisionId);
    assert.deepEqual(proposal.updateInput, { protein: 14 });
    assert.deepEqual(proposal.affectedFields, [{ field: "protein", before: 28, after: 14 }]);
    assert.equal(proposal.sourceOperator, "half");
    assert.equal(result.result, renderMealNumericProposalCopy({
      mealLabel: "雞腿、白飯",
      affectedFields: proposal.affectedFields,
      sourceOperator: proposal.sourceOperator,
    }));
    assert.deepEqual(result.controlledReply, {
      source: "renderer",
      reason: "meal_numeric_proposal",
      text: result.result,
    });
    assert.equal(revisions.length, 1);
    assert.equal(result.mealMutationKind, undefined);
    assert.equal(result.summaryOutcome, undefined);
  });
});
