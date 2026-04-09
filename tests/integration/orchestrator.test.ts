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
    // Round 1: LLM calls analyze_food
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: { name: "analyze_food", arguments: JSON.stringify({ description: "蘋果" }) },
      }],
    });
    // Round 2: LLM calls log_food
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_2",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "蘋果", calories: 100, protein: 5, carbs: 20, fat: 2 }),
        },
      }],
    });
    // Round 3: LLM responds with text
    mockLLM.queueChatResponse({ content: "已幫你記錄蘋果！" });

    const { reply } = await orchestrator.handleMessage(deviceId, "我吃了蘋果");
    assert.equal(reply, "已幫你記錄蘋果！");
    assert.equal(mockLLM.chatCalls.length, 3);
    const secondRound = mockLLM.chatCalls[1].messages;
    assert.equal(secondRound[secondRound.length - 2].role, "assistant");
    assert.equal(secondRound[secondRound.length - 1].role, "tool");
  });

  it("persists uploaded image metadata while sending the data URI to the analyzer", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "analyze_food",
          arguments: JSON.stringify({ description: "(圖片)", image_base64: "data:image/png;base64,abc123" }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_2",
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

    const history = await chatService.getHistory(deviceId, 10);
    assert.equal(history[0].imagePath, "server/uploads/meal.png");

    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals[0].imagePath, "server/uploads/meal.png");
  });

  it("first LLM round receives sanitized system prompt without raw tool names", async () => {
    mockLLM.queueChatResponse({ content: "你好！" });
    await orchestrator.handleMessage(deviceId, "你好");
    assert.ok(mockLLM.chatCalls.length >= 1);
    const firstRound = mockLLM.chatCalls[0].messages;
    const systemMsg = firstRound.find((m) => m.role === "system");
    assert.ok(systemMsg, "first round must have a system message");
    const systemContent = String(systemMsg!.content);
    assert.doesNotMatch(systemContent, /log_food|get_daily_summary/,
      "system prompt must not contain raw tool identifiers");
    assert.match(systemContent, /不要向使用者提及任何內部工具名稱/,
      "system prompt must contain the sanitization instruction");
  });

  it("second LLM round receives sanitized tool context instead of raw tool names", async () => {
    // Round 1: LLM calls log_food
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "蘋果", calories: 100, protein: 0.5, carbs: 25, fat: 0.3 }),
        },
      }],
    });
    // Round 2: LLM responds with text
    mockLLM.queueChatResponse({ content: "已記錄蘋果！" });

    await orchestrator.handleMessage(deviceId, "我吃了蘋果");
    assert.ok(mockLLM.chatCalls.length >= 2);

    // Check the second round's messages for tool context
    const secondRound = mockLLM.chatCalls[1].messages;
    const toolMessages = secondRound.filter((m) => m.role === "tool");
    assert.ok(toolMessages.length >= 1, "second round must have at least one tool result");
    for (const tm of toolMessages) {
      assert.doesNotMatch(String(tm.content), /log_food|get_daily_summary/,
        "tool result content must not contain raw tool identifiers");
    }
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
