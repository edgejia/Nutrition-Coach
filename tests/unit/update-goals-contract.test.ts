import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService, type DailyTargets } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createGoalProposalService } from "../../server/services/goal-proposals.js";
import { createSummaryService } from "../../server/services/summary.js";
import {
  executeTool,
  toolRegistry,
  type ToolDeps,
} from "../../server/orchestrator/tools.js";
import type { ToolCall } from "../../server/llm/types.js";

function updateGoalsCall(args: unknown): ToolCall {
  return {
    id: "call_update_goals",
    type: "function",
    function: {
      name: "update_goals",
      arguments: JSON.stringify(args),
    },
  };
}

describe("update_goals ToolContract", () => {
  let deviceId: string;
  let deviceService: ReturnType<typeof createDeviceService>;
  let foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  let goalProposalService: ReturnType<typeof createGoalProposalService>;
  let summaryService: ReturnType<typeof createSummaryService>;
  let published: Array<{ deviceId: string; targets: DailyTargets }>;
  let deps: ToolDeps;

  beforeEach(async () => {
    const db = createDb(":memory:");
    deviceService = createDeviceService(db);
    foodLoggingService = createFoodLoggingService(db);
    goalProposalService = createGoalProposalService(db);
    summaryService = createSummaryService(db);
    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
    published = [];
    deps = {
      foodLoggingService,
      summaryService,
      deviceService,
      goalProposalService,
      publisher: {
        publishGoalsUpdate(id: string, targets: DailyTargets) {
          published.push({ deviceId: id, targets });
          return { sent: 1 };
        },
      },
    } as ToolDeps;
  });

  it("Test 1: rejects empty args and unknown fields with failureReason:\"validation\"", async () => {
    const empty = await executeTool(updateGoalsCall({}), deviceId, deps, {
      currentUserMessage: "",
    });
    assert.equal(empty.success, false);
    assert.equal(empty.executed, false);
    assert.equal(empty.failureReason, "validation");

    const unknown = await executeTool(updateGoalsCall({ calories: 1800, sugar: 20 }), deviceId, deps, {
      currentUserMessage: "卡路里 1800",
    });
    assert.equal(unknown.success, false);
    assert.equal(unknown.executed, false);
    assert.equal(unknown.failureReason, "validation");
  });

  it("Test 2: ranges are exactly calories 500-8000, protein 0-400, carbs 0-1000, fat 0-300", async () => {
    const contract = toolRegistry.get("update_goals");
    assert.ok(contract, "update_goals contract must be registered");

    assert.deepEqual(contract.zodSchema.safeParse({ calories: 500 }).success, true);
    assert.deepEqual(contract.zodSchema.safeParse({ calories: 8000 }).success, true);
    assert.deepEqual(contract.zodSchema.safeParse({ calories: 499 }).success, false);
    assert.deepEqual(contract.zodSchema.safeParse({ calories: 8001 }).success, false);
    assert.deepEqual(contract.zodSchema.safeParse({ protein: 0 }).success, true);
    assert.deepEqual(contract.zodSchema.safeParse({ protein: 400 }).success, true);
    assert.deepEqual(contract.zodSchema.safeParse({ protein: -1 }).success, false);
    assert.deepEqual(contract.zodSchema.safeParse({ protein: 401 }).success, false);
    assert.deepEqual(contract.zodSchema.safeParse({ carbs: 0 }).success, true);
    assert.deepEqual(contract.zodSchema.safeParse({ carbs: 1000 }).success, true);
    assert.deepEqual(contract.zodSchema.safeParse({ carbs: -1 }).success, false);
    assert.deepEqual(contract.zodSchema.safeParse({ carbs: 1001 }).success, false);
    assert.deepEqual(contract.zodSchema.safeParse({ fat: 0 }).success, true);
    assert.deepEqual(contract.zodSchema.safeParse({ fat: 300 }).success, true);
    assert.deepEqual(contract.zodSchema.safeParse({ fat: -1 }).success, false);
    assert.deepEqual(contract.zodSchema.safeParse({ fat: 301 }).success, false);

    const properties = contract.parameters.properties as Record<string, { minimum: number; maximum: number }>;
    assert.equal(properties.calories.minimum, 500);
    assert.equal(properties.calories.maximum, 8000);
    assert.equal(properties.protein.minimum, 0);
    assert.equal(properties.protein.maximum, 400);
    assert.equal(properties.carbs.minimum, 0);
    assert.equal(properties.carbs.maximum, 1000);
    assert.equal(properties.fat.minimum, 0);
    assert.equal(properties.fat.maximum, 300);
  });

  it("Test 3: partial update persists only provided fields and receipt lists all four latest values", async () => {
    const result = await executeTool(updateGoalsCall({ calories: 1800, protein: 130 }), deviceId, deps, {
      currentUserMessage: "卡路里改 1800，蛋白質 130 克",
    });

    assert.equal(result.success, true);
    assert.equal(result.result, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
    assert.equal(result.summary, "updatedFields: calories,protein");

    const device = await deviceService.getDevice(deviceId);
    assert.equal(device?.dailyCalories, 1800);
    assert.equal(device?.dailyProtein, 130);
    assert.equal(device?.dailyCarbs, 150);
    assert.equal(device?.dailyFat, 50);
  });

  it("Test 4: logSummary returns field names only, never target numbers", () => {
    const contract = toolRegistry.get("update_goals");
    assert.ok(contract);
    const summary = contract.logSummary({ calories: 1800, protein: 130 });
    const serialized = JSON.stringify(summary);
    assert.match(serialized, /calories/);
    assert.match(serialized, /protein/);
    assert.doesNotMatch(serialized, /1800/);
    assert.doesNotMatch(serialized, /130/);
  });

  it("Test 5: successful execute publishes goals_update and does not call summaryService.getDailySummary", async () => {
    let getSummaryCalls = 0;
    const summarySpy = {
      getDailySummary: async (...args: Parameters<typeof summaryService.getDailySummary>) => {
        getSummaryCalls += 1;
        return summaryService.getDailySummary(...args);
      },
    } as typeof summaryService;
    const localDeps = { ...deps, summaryService: summarySpy } as ToolDeps;

    await executeTool(updateGoalsCall({ calories: 1800 }), deviceId, localDeps, {
      currentUserMessage: "卡路里 1800",
    });

    assert.equal(getSummaryCalls, 0, "summaryService.getDailySummary must not be called");
    assert.equal(published.length, 1);
    assert.deepEqual(published[0], {
      deviceId,
      targets: { calories: 1800, protein: 120, carbs: 150, fat: 50 },
    });
  });

  it("Test 6: successful execute returns field-name-only metadata with no target numbers", async () => {
    const result = await executeTool(updateGoalsCall({ calories: 1800, protein: 130 }), deviceId, deps, {
      currentUserMessage: "卡路里 1800 蛋白質 130",
    });

    assert.deepEqual(result.updatedFields, ["calories", "protein"]);
    assert.deepEqual(result.publishedEvents, ["goals_update"]);
    const serializedMetadata = JSON.stringify({
      summary: result.summary,
      updatedFields: result.updatedFields,
      publishedEvents: result.publishedEvents,
    });
    assert.doesNotMatch(serializedMetadata, /1800/);
    assert.doesNotMatch(serializedMetadata, /130/);
  });
});
