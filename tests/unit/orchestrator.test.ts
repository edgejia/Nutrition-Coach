import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createSummaryService } from "../../server/services/summary.js";
import { createChatService } from "../../server/services/chat.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { ChatMessage, ToolDefinition, LLMResponse, LLMRoundResult, LLMProvider } from "../../server/llm/types.js";
import { createOrchestrator } from "../../server/orchestrator/index.js";
import { CHOICE_PROMPT_PATTERN } from "../../server/orchestrator/patterns.js";

function assertString(value: unknown): asserts value is string {
  assert.equal(typeof value, "string");
}

class StreamingLLMProvider implements LLMProvider {
  private chatQueue: Array<LLMResponse | Error> = [];
  private roundQueue: Array<LLMRoundResult | Error> = [];
  private callIndex = 0;
  public chatCalls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];

  queueChatResponse(response: LLMResponse) {
    this.chatQueue.push(response);
  }

  queueChatError(error: Error) {
    this.chatQueue.push(error);
  }

  queueChatStream(tokens: string[]) {
    this.roundQueue.push({ kind: "stream", streamGenerator: streamTokens(tokens) });
  }

  queueChatStreamError(tokens: string[], error: Error) {
    this.roundQueue.push({ kind: "stream", streamGenerator: streamTokensThenThrow(tokens, error) });
  }

  queueRoundResponse(response: LLMResponse) {
    this.roundQueue.push({ kind: "response", response });
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    this.chatCalls.push({ messages, tools });
    if (this.callIndex < this.chatQueue.length) {
      const item = this.chatQueue[this.callIndex++];
      if (item instanceof Error) {
        throw item;
      }
      return item;
    }

    return { content: "Mock: 已記錄您的飲食！" };
  }

  async chatRound(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMRoundResult> {
    this.chatCalls.push({ messages, tools });
    const item = this.roundQueue.shift();
    if (item instanceof Error) {
      throw item;
    }
    if (item) {
      return item;
    }
    return { kind: "response", response: { content: "Mock: 已記錄您的飲食！" } };
  }

  reset() {
    this.chatQueue = [];
    this.roundQueue = [];
    this.callIndex = 0;
    this.chatCalls = [];
  }
}

async function* streamTokens(tokens: string[]): AsyncGenerator<string> {
  for (const token of tokens) {
    yield token;
  }
}

async function* streamTokensThenThrow(tokens: string[], error: Error): AsyncGenerator<string> {
  for (const token of tokens) {
    yield token;
  }
  throw error;
}

describe("orchestrator shared patterns", () => {
  it("matches the known 方式1/方式2 hallucinated choice prompt shape", () => {
    assert.equal(
      CHOICE_PROMPT_PATTERN.test("若你選擇方式1，我會請你補充份量；若你選擇方式2，我會直接估算。"),
      true,
    );
    assert.equal(CHOICE_PROMPT_PATTERN.test("我會直接依照片估算並完成記錄。"), false);
  });
});

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
    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(result.reply, "已幫你記錄蘋果！");
    assert.equal(result.didLogMeal, true);

    const history = await chatService.getHistory(deviceId, 10);
    assert.equal(history.filter((message) => message.role === "assistant").length, 0);
  });

  it("handleMessage returns { reply, didLogMeal: false } when log_food is not called", async () => {
    mockLLM.queueChatResponse({ content: "今天天氣真好！" });

    const result = await orchestrator.handleMessage(deviceId, "今天天氣怎麼樣？");
    if (!("reply" in result)) throw new Error("expected reply result");
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
    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(result.reply, "抱歉，我現在無法完成這個請求，請稍後再試。");
    assert.equal(result.didLogMeal, false);

    const history = await chatService.getHistory(deviceId, 10);
    assert.equal(history.filter((message) => message.role === "assistant").length, 0);
  });

  it("returns a deterministic logged reply for image-only uploads after log_food succeeds", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "豬肉燒烤飯盒", calories: 680, protein: 35, carbs: 86, fat: 22 }),
        },
      }],
    });

    const result = await orchestrator.handleMessage(
      deviceId,
      "(圖片)",
      "data:image/png;base64,abc123",
      "server/uploads/meal.png",
    );

    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(result.didLogMeal, true);
    assert.match(result.reply, /已先依照片做保守估算並完成記錄：豬肉燒烤飯盒，約 680 kcal。若你想更精準，我可以再依份量幫你調整。/);
    assert.equal(mockLLM.chatCalls.length, 1, "image-only logging should not require a second LLM round");
  });

  it("recovers locally when the user replies 2 to a previously hallucinated choice prompt", async () => {
    await chatService.saveMessage(deviceId, "user", "(圖片)", { imagePath: "server/uploads/meal.png" });
    await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    await chatService.saveMessage(
      deviceId,
      "assistant",
      "已收到圖片。若你選擇方式1，我會請你補充份量；若你選擇方式2，我會直接估算並記錄。",
    );

    const result = await orchestrator.handleMessage(deviceId, "2");

    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(result.didLogMeal, false);
    assert.equal(
      result.reply,
      "這餐剛剛已先依目前估算完成記錄。若你想更精準，我可以再依份量幫你調整。"
    );
    assert.equal(mockLLM.chatCalls.length, 0, "recovery path should not call the model again");
  });

  it("handleMessage returns streamGenerator and defers assistant persistence when chatStream is available", async () => {
    const streamingLLM = new StreamingLLMProvider();
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;

    orchestrator = createOrchestrator({
      llmProvider: streamingLLM,
      chatService: localChatService,
      summaryService: localSummaryService,
      foodLoggingService: localFoodLoggingService,
      deviceService: localDeviceService,
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
    streamingLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "蘋果", calories: 100, protein: 1, carbs: 20, fat: 0.5 }),
        },
      }],
    });
    streamingLLM.queueChatStream(["已幫", "你記錄", "蘋果！"]);

    const result = await orchestrator.handleMessage(localDeviceId, "我吃了蘋果");

    assert.ok("streamGenerator" in result);
    assert.equal(result.didLogMeal, true);
    assert.ok(result.dailySummary);
    assert.equal(streamingLLM.chatCalls.length, 2);

    const historyBeforeStream = await localChatService.getHistory(localDeviceId, 10);
    assert.equal(historyBeforeStream.filter((message) => message.role === "assistant").length, 0);

    const streamedTokens: string[] = [];
    for await (const token of result.streamGenerator) {
      streamedTokens.push(token);
    }
    assert.deepEqual(streamedTokens, ["已幫", "你記錄", "蘋果！"]);

    const historyAfterStream = await localChatService.getHistory(localDeviceId, 10);
    assert.equal(historyAfterStream.filter((message) => message.role === "assistant").length, 0);
  });

  it("handleMessage streams direct text replies when the provider exposes a round-level stream", async () => {
    const streamingLLM = new StreamingLLMProvider();
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;

    orchestrator = createOrchestrator({
      llmProvider: streamingLLM,
      chatService: localChatService,
      summaryService: localSummaryService,
      foodLoggingService: localFoodLoggingService,
      deviceService: localDeviceService,
    });

    streamingLLM.queueChatStream(["直接", "回覆"]);

    const result = await orchestrator.handleMessage(localDeviceId, "你好");

    assert.ok("streamGenerator" in result);
    const streamedTokens: string[] = [];
    for await (const token of result.streamGenerator) {
      streamedTokens.push(token);
    }
    assert.deepEqual(streamedTokens, ["直接", "回覆"]);
    assert.equal(result.didLogMeal, false);
    assert.equal(streamingLLM.chatCalls.length, 1);
  });

  it("appends a successful goal update receipt to streamed final replies", async () => {
    const streamingLLM = new StreamingLLMProvider();
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;

    orchestrator = createOrchestrator({
      llmProvider: streamingLLM,
      chatService: localChatService,
      summaryService: localSummaryService,
      foodLoggingService: localFoodLoggingService,
      deviceService: localDeviceService,
      publisher: {
        publishGoalsUpdate() {
          return { sent: 1 };
        },
      },
    });

    streamingLLM.queueRoundResponse({
      toolCalls: [{
        id: "goal_stream",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 1800, protein: 130 }),
        },
      }],
    });
    streamingLLM.queueChatStream(["已經", "更新好了"]);

    const result = await orchestrator.handleMessage(localDeviceId, "卡路里 1800 蛋白質 130");
    assert.ok("streamGenerator" in result);

    const streamedTokens: string[] = [];
    for await (const token of result.streamGenerator) {
      streamedTokens.push(token);
    }

    assert.equal(streamedTokens.join(""), "已經更新好了\n\n已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
    const device = await localDeviceService.getDevice(localDeviceId);
    assert.equal(device?.dailyCalories, 1800);
    assert.equal(device?.dailyProtein, 130);
  });

  it("yields the goal update receipt when streamed final reply generation fails", async () => {
    const streamingLLM = new StreamingLLMProvider();
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;

    orchestrator = createOrchestrator({
      llmProvider: streamingLLM,
      chatService: localChatService,
      summaryService: localSummaryService,
      foodLoggingService: localFoodLoggingService,
      deviceService: localDeviceService,
      publisher: {
        publishGoalsUpdate() {
          return { sent: 1 };
        },
      },
    });

    streamingLLM.queueRoundResponse({
      toolCalls: [{
        id: "goal_stream_error",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 1800, protein: 130 }),
        },
      }],
    });
    streamingLLM.queueChatStreamError(["處理中"], new Error("stream broke"));

    const result = await orchestrator.handleMessage(localDeviceId, "卡路里 1800 蛋白質 130");
    assert.ok("streamGenerator" in result);

    const streamedTokens: string[] = [];
    for await (const token of result.streamGenerator) {
      streamedTokens.push(token);
    }

    assert.equal(streamedTokens.join(""), "處理中\n\n已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
  });
});
