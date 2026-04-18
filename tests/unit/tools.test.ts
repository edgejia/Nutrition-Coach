import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
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
    const db = createDb(":memory:");
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
    assert.equal(result.loggedMeal.protein, 1);
    assert.equal(result.loggedMeal.carbs, 20);
    assert.equal(result.loggedMeal.fat, 0.5);

    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals.length, 1);
    assert.equal(meals[0].foodName, "蘋果");
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
});
