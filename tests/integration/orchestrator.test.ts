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

describe("Orchestrator", () => {
  let orchestrator: ReturnType<typeof createOrchestrator>;
  let mockLLM: MockLLMProvider;
  let foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  let chatService: ReturnType<typeof createChatService>;
  let deviceId: string;

  beforeEach(async () => {
    const db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    foodLoggingService = createFoodLoggingService(db);
    const summaryService = createSummaryService(db);
    chatService = createChatService(db);
    mockLLM = new MockLLMProvider();
    const publisher = new RealtimePublisher();

    orchestrator = createOrchestrator({
      llmProvider: mockLLM,
      chatService,
      summaryService,
      foodLoggingService,
      deviceService,
      publisher,
    });

    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
  });

  it("returns text reply when LLM responds with content", async () => {
    mockLLM.queueChatResponse({ content: "你好！我是你的營養教練。" });
    const { reply } = await orchestrator.handleMessage(deviceId, "你好");
    assert.equal(reply, "你好！我是你的營養教練。");
  });

  it("executes tool calls and returns final reply", async () => {
    // Round 1: orchestrator model calls log_food directly
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "蘋果", calories: 100, protein: 5, carbs: 20, fat: 2 }),
        },
      }],
    });
    // Round 2: same model responds with final text
    mockLLM.queueChatResponse({ content: "已幫你記錄蘋果！" });

    const { reply } = await orchestrator.handleMessage(deviceId, "我吃了蘋果");
    assert.equal(reply, "已幫你記錄蘋果！");
    assert.equal(mockLLM.chatCalls.length, 2);
    assert.deepEqual(
      mockLLM.chatCalls[0].tools.map((tool) => tool.function.name),
      ["log_food", "get_daily_summary"]
    );
    const secondRound = mockLLM.chatCalls[1].messages;
    assert.equal(secondRound[secondRound.length - 2].role, "assistant");
    assert.equal(secondRound[secondRound.length - 1].role, "tool");
  });

  it("persists uploaded image metadata while only sending the data URI in the user content parts", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "沙拉", calories: 180, protein: 8, carbs: 12, fat: 10 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已幫你記錄這份餐點！" });

    const { reply } = await orchestrator.handleMessage(
      deviceId,
      "(圖片)",
      "data:image/png;base64,abc123",
      "server/uploads/meal.png"
    );
    assert.equal(reply, "已幫你記錄這份餐點！");

    assert.deepEqual(
      mockLLM.chatCalls[0].tools.map((tool) => tool.function.name),
      ["log_food", "get_daily_summary"]
    );

    const firstRoundMessages = mockLLM.chatCalls[0].messages;
    const lastUserMessage = [...firstRoundMessages].reverse().find((message) => message.role === "user");
    assert.deepEqual(lastUserMessage?.content, [
      { type: "text", text: "(圖片)" },
      { type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
    ]);

    const history = await chatService.getHistory(deviceId, 10);
    assert.equal(history[0].imagePath, "server/uploads/meal.png");

    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals[0].imagePath, "server/uploads/meal.png");
  });

  it("returns fallback after 3 rounds of only tool calls", async () => {
    for (let i = 0; i < 3; i++) {
      mockLLM.queueChatResponse({
        toolCalls: [{
          id: `call_${i}`,
          type: "function",
          function: { name: "get_daily_summary", arguments: "{}" },
        }],
      });
    }
    const { reply } = await orchestrator.handleMessage(deviceId, "test");
    assert.equal(reply, "抱歉，我現在無法完成這個請求，請稍後再試。");
  });
});
