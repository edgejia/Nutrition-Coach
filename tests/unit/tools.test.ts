import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createSummaryService } from "../../server/services/summary.js";
import { RealtimePublisher } from "../../server/realtime/publisher.js";
import { executeTool } from "../../server/orchestrator/tools.js";
import type { ToolCall } from "../../server/llm/types.js";

describe("executeTool - log_food dailySummary contract", () => {
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

  it("fails when required dailySummary computation throws after DB write", async () => {
    const throwingSummary = {
      getDailySummary: async () => {
        throw new Error("summary computation failed");
      },
    } as unknown as typeof summaryService;

    await assert.rejects(
      executeTool(logFoodCall, deviceId, {
        foodLoggingService,
        summaryService: throwingSummary,
        publisher: new RealtimePublisher(),
      }),
      /summary computation failed/
    );

    // Verify meal was actually persisted to DB
    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals.length, 1);
    assert.equal(meals[0].foodName, "蘋果");
  });

  it("returns the required dailySummary even when publisher.publishDailySummary throws", async () => {
    const throwingPublisher = {
      publishDailySummary: () => {
        throw new Error("SSE publish failed");
      },
    } as unknown as RealtimePublisher;

    const result = await executeTool(logFoodCall, deviceId, {
      foodLoggingService,
      summaryService,
      publisher: throwingPublisher,
    });

    assert.equal(result.result, "食物已成功記錄");
    assert.ok(result.dailySummary);
    assert.equal(result.dailySummary.mealCount, 1);

    // Verify meal was actually persisted to DB
    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals.length, 1);
    assert.equal(meals[0].foodName, "蘋果");
  });
});
