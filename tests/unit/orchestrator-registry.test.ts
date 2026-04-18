import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createSummaryService } from "../../server/services/summary.js";
import {
  executeTool,
  FatalToolError,
  getToolDefinitions,
  toolRegistry,
} from "../../server/orchestrator/tools.js";
import type { ToolCall } from "../../server/llm/types.js";

describe("Phase 10-02: orchestrator tool registry", () => {
  describe("getToolDefinitions() derives definitions from toolRegistry", () => {
    it("Test 1: returns exactly log_food, get_daily_summary, and update_goals", () => {
      const defs = getToolDefinitions();
      const names = defs.map((d) => d.function.name).sort();
      assert.deepEqual(names, ["get_daily_summary", "log_food", "update_goals"]);
    });

    it("Test 2: definitions reuse each contract's description and parameters", () => {
      const defs = getToolDefinitions();
      for (const def of defs) {
        const contract = toolRegistry.get(def.function.name);
        assert.ok(contract, `contract must exist for ${def.function.name}`);
        assert.equal(def.type, "function");
        assert.equal(def.function.description, contract!.description);
        assert.deepEqual(def.function.parameters, contract!.parameters);
      }
    });
  });

  describe("executeTool dispatches via toolRegistry", () => {
    let deviceId: string;
    let foodLoggingService: ReturnType<typeof createFoodLoggingService>;
    let summaryService: ReturnType<typeof createSummaryService>;

    beforeEach(async () => {
      const db = createDb(":memory:");
      const deviceService = createDeviceService(db);
      foodLoggingService = createFoodLoggingService(db);
      summaryService = createSummaryService(db);
      deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
    });

    it("Test 3: dispatches known log_food via runContract and persists the meal", async () => {
      const call: ToolCall = {
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
      const res = await executeTool(call, deviceId, {
        foodLoggingService,
        summaryService,
      });
      assert.equal(res.result, "食物已成功記錄");
      assert.equal(res.summary, "成功");
      assert.ok(res.dailySummary);
      assert.equal(res.dailySummary!.mealCount, 1);

      const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
      assert.equal(meals.length, 1);
      assert.equal(meals[0].foodName, "蘋果");
    });

    it("Test 4: unknown tool rejects with FatalToolError message exactly 'unknown tool'", async () => {
      const call: ToolCall = {
        id: "call_x",
        type: "function",
        function: {
          name: "definitely_not_a_tool",
          arguments: "{}",
        },
      };
      await assert.rejects(
        executeTool(call, deviceId, {
          foodLoggingService,
          summaryService,
        }),
        (err: unknown) => {
          assert.ok(err instanceof FatalToolError, "must be FatalToolError");
          assert.equal((err as FatalToolError).message, "unknown tool");
          return true;
        },
      );
    });
  });
});
