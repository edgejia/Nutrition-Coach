import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createSummaryService } from "../../server/services/summary.js";
import { createChatService } from "../../server/services/chat.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { ChatMessage, ToolDefinition } from "../../server/llm/types.js";
import { RealtimePublisher } from "../../server/realtime/publisher.js";
import { createOrchestrator } from "../../server/orchestrator/index.js";

function assertString(value: unknown): asserts value is string {
  assert.equal(typeof value, "string");
}

class StreamingLLMProvider extends MockLLMProvider {
  public streamCalls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];
  private streamQueue: string[][] = [];

  queueChatStream(tokens: string[]) {
    this.streamQueue.push(tokens);
  }

  async *chatStream(messages: ChatMessage[], tools: ToolDefinition[]): AsyncGenerator<string> {
    this.streamCalls.push({ messages, tools });
    const tokens = this.streamQueue.shift() ?? [];
    for (const token of tokens) {
      yield token;
    }
  }
}

describe("Orchestrator - didLogMeal", () => {
  let orchestrator: ReturnType<typeof createOrchestrator>;
  let mockLLM: MockLLMProvider;
  let deviceId: string;
  let deviceService: ReturnType<typeof createDeviceService>;
  let foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  let chatService: ReturnType<typeof createChatService>;
  let shouldFailSummary = false;

  beforeEach(async () => {
    const db = createDb(":memory:");
    deviceService = createDeviceService(db);
    foodLoggingService = createFoodLoggingService(db);
    const summaryService = createSummaryService(db);
    chatService = createChatService(db);
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

  it("forwards device intake data into the system prompt", async () => {
    const { deviceId: intakeDeviceId } = await deviceService.createDevice("fat_loss", {
      sex: "male",
      age: 30,
      heightCm: 175,
      weightKg: 80,
      activityLevel: "moderate",
      trainingFrequency: "3_4",
      allergies: "花生",
      goalClarification: "不想影響重訓表現",
      bodyFatPercent: 18,
      tdee: 1800,
      advancedNotes: "晚餐常外食",
    });

    mockLLM.queueChatResponse({ content: "已收到" });

    await orchestrator.handleMessage(intakeDeviceId, "我想先看一下建議");

    const systemPrompt = mockLLM.chatCalls[0]?.messages[0]?.content;
    assertString(systemPrompt);
    assert.match(systemPrompt, /使用者背景資料/);
    assert.match(systemPrompt, /性別：男/);
    assert.match(systemPrompt, /年齡：30/);
    assert.match(systemPrompt, /身高：175 cm/);
    assert.match(systemPrompt, /體重：80 kg/);
    assert.match(systemPrompt, /活動量：moderate/);
    assert.match(systemPrompt, /訓練頻率：3_4/);
    assert.match(systemPrompt, /過敏\/飲食限制：花生/);
    assert.match(systemPrompt, /目標補充：不想影響重訓表現/);
    assert.match(systemPrompt, /體脂率：18%/);
    assert.match(systemPrompt, /TDEE：1800 kcal/);
    assert.match(systemPrompt, /備註：晚餐常外食/);
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

  it("handleMessage returns streamGenerator and defers assistant persistence when chatStream is available", async () => {
    const streamingLLM = new StreamingLLMProvider();
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const publisher = new RealtimePublisher();
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;

    orchestrator = createOrchestrator({
      llmProvider: streamingLLM,
      chatService: localChatService,
      summaryService: localSummaryService,
      foodLoggingService: localFoodLoggingService,
      deviceService: localDeviceService,
      publisher,
    });

    streamingLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "蘋果", calories: 100, protein: 1, carbs: 20, fat: 0.5 }),
        },
      }],
    });
    streamingLLM.queueChatResponse({ content: "已幫你記錄蘋果！" });
    streamingLLM.queueChatStream(["已幫", "你記錄", "蘋果！"]);

    const result = await orchestrator.handleMessage(localDeviceId, "我吃了蘋果");

    assert.ok("streamGenerator" in result);
    assert.equal(result.didLogMeal, true);
    assert.ok(result.dailySummary);
    assert.equal(streamingLLM.streamCalls.length, 1);
    assert.deepEqual(streamingLLM.streamCalls[0]?.tools, []);

    const streamedTokens: string[] = [];
    for await (const token of result.streamGenerator) {
      streamedTokens.push(token);
    }
    assert.deepEqual(streamedTokens, ["已幫", "你記錄", "蘋果！"]);

    const history = await localChatService.getHistory(localDeviceId, 10);
    assert.equal(history.filter((message) => message.role === "assistant").length, 0);
  });
});
