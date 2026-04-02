import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createSummaryService } from "../../server/services/summary.js";
import { createChatService } from "../../server/services/chat.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { RealtimePublisher } from "../../server/realtime/publisher.js";
import { createOrchestrator } from "../../server/orchestrator/index.js";

describe("Orchestrator - didLogMeal", () => {
  let orchestrator: ReturnType<typeof createOrchestrator>;
  let mockLLM: MockLLMProvider;
  let deviceId: string;
  let foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  let shouldFailSummary = false;

  beforeEach(async () => {
    const db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    foodLoggingService = createFoodLoggingService(db);
    const summaryService = createSummaryService(db);
    const chatService = createChatService(db);
    mockLLM = new MockLLMProvider();
    const publisher = new RealtimePublisher();
    shouldFailSummary = false;

    orchestrator = createOrchestrator({
      llmProvider: mockLLM,
      chatService,
      summaryService: {
        async getDailySummary(deviceId, date) {
          if (shouldFailSummary) {
            throw new Error("summary recomputation failed");
          }

          return summaryService.getDailySummary(deviceId, date);
        },
      },
      foodLoggingService,
      deviceService,
      publisher,
    });

    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
  });

  it("handleMessage returns { reply, didLogMeal: true } when log_food is executed", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "蘋果", calories: 100, protein: 1, carbs: 20, fat: 0.5 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已幫你記錄蘋果！" });

    const result = await orchestrator.handleMessage(deviceId, "我吃了蘋果");
    assert.equal(result.reply, "已幫你記錄蘋果！");
    assert.equal(result.didLogMeal, true);
  });

  it("handleMessage returns { reply, didLogMeal: false } when log_food is not called", async () => {
    mockLLM.queueChatResponse({ content: "今天天氣真好！" });

    const result = await orchestrator.handleMessage(deviceId, "今天天氣怎麼樣？");
    assert.equal(result.reply, "今天天氣真好！");
    assert.equal(result.didLogMeal, false);
  });

  it("handleMessage returns didLogMeal: true when log_food succeeded but final LLM round fails", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "蘋果", calories: 100, protein: 1, carbs: 20, fat: 0.5 }),
        },
      }],
    });
    mockLLM.queueChatError(new Error("API timeout"));

    const result = await orchestrator.handleMessage(deviceId, "我吃了蘋果");
    assert.equal(result.didLogMeal, true);
  });

  it("handleMessage throws when log_food persists but summary recomputation fails afterward", async () => {
    shouldFailSummary = true;
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "蘋果", calories: 100, protein: 1, carbs: 20, fat: 0.5 }),
        },
      }],
    });

    await assert.rejects(
      orchestrator.handleMessage(deviceId, "我吃了蘋果"),
      /summary recomputation failed/
    );

    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals.length, 1);
    assert.equal(meals[0]?.foodName, "蘋果");
  });

  it("handleMessage returns didLogMeal: false after MAX_ROUNDS fallback", async () => {
    for (let i = 0; i < 3; i++) {
      mockLLM.queueChatResponse({
        toolCalls: [{
          id: `call_${i}`,
          type: "function",
          function: { name: "get_daily_summary", arguments: "{}" },
        }],
      });
    }

    const result = await orchestrator.handleMessage(deviceId, "test");
    assert.equal(result.reply, "抱歉，我現在無法完成這個請求，請稍後再試。");
    assert.equal(result.didLogMeal, false);
  });
});
