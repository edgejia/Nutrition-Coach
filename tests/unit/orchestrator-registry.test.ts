import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createSummaryService } from "../../server/services/summary.js";
import {
  assertRegistryPolicies,
  executeTool,
  FatalToolError,
  getToolDefinitions,
  KNOWN_TOOL_POLICY_CLASSES,
  toolRegistry,
} from "../../server/orchestrator/tools.js";
import type { ToolCall } from "../../server/llm/types.js";
import type { ToolContract } from "../../server/orchestrator/tool-contract.js";

describe("Phase 10-02: orchestrator tool registry", () => {
  describe("getToolDefinitions() derives definitions from toolRegistry", () => {
    it("Test 1: returns the full public tool registry including meal correction and goal tools", () => {
      const defs = getToolDefinitions();
      const names = defs.map((d) => d.function.name).sort();
      assert.deepEqual(names, [
        "delete_meal",
        "find_meals",
        "get_daily_summary",
        "log_food",
        "propose_goals",
        "propose_meal_numeric_correction",
        "update_goals",
        "update_meal",
      ]);
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

    it("Test 2b: tool schemas avoid OpenAI-rejected top-level composition keywords", () => {
      const forbiddenTopLevelKeywords = ["anyOf", "oneOf", "allOf", "enum", "not"];
      for (const def of getToolDefinitions()) {
        for (const keyword of forbiddenTopLevelKeywords) {
          assert.equal(
            Object.hasOwn(def.function.parameters, keyword),
            false,
            `${def.function.name} parameters must not contain top-level ${keyword}`,
          );
        }
      }
    });
  });

  describe("side-effect policy metadata", () => {
    it("Test 2c: every registered tool exposes the locked side-effect policy class", () => {
      assert.deepEqual(KNOWN_TOOL_POLICY_CLASSES, {
        log_food: "execute-and-report",
        get_daily_summary: "direct-execute",
        find_meals: "clarify-first",
        propose_goals: "confirm-first",
        update_goals: "direct-execute",
        propose_meal_numeric_correction: "confirm-first",
        update_meal: "direct-execute",
        delete_meal: "direct-execute",
      });

      assert.doesNotThrow(() => assertRegistryPolicies(toolRegistry, KNOWN_TOOL_POLICY_CLASSES));

      for (const [toolName, expectedClass] of Object.entries(KNOWN_TOOL_POLICY_CLASSES)) {
        const contract = toolRegistry.get(toolName);
        assert.ok(contract, `contract must exist for ${toolName}`);
        assert.equal(contract.policyClass, expectedClass);
      }
    });

    it("Test 2d: registered policy drift fails closed instead of receiving a default class", () => {
      const baseContract = toolRegistry.get("log_food");
      assert.ok(baseContract, "log_food contract must exist");

      const missingPolicyContract = {
        ...baseContract,
        name: "log_food",
      } as unknown as ToolContract<any, any>;
      delete (missingPolicyContract as Partial<ToolContract<any, any>>).policyClass;

      const missingPolicyRegistry = new Map<string, ToolContract<any, any>>([
        ["log_food", missingPolicyContract],
      ]);
      assert.throws(
        () => assertRegistryPolicies(missingPolicyRegistry, { log_food: "execute-and-report" }),
        /missing side-effect policy/i,
      );

      const invalidPolicyRegistry = new Map<string, ToolContract<any, any>>([
        [
          "log_food",
          {
            ...baseContract,
            policyClass: "confirm-first",
          } as ToolContract<any, any>,
        ],
      ]);
      assert.throws(
        () => assertRegistryPolicies(invalidPolicyRegistry, { log_food: "execute-and-report" }),
        /side-effect policy mismatch/i,
      );
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
            items: [
              {
                food_name: "蘋果",
                calories: 100,
                protein: 1,
                carbs: 20,
                fat: 0.5,
              },
            ],
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
