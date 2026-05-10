import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createMealCorrectionService } from "../../server/services/meal-correction.js";
import { createSummaryService } from "../../server/services/summary.js";
import { createChatService } from "../../server/services/chat.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { ChatMessage, ToolDefinition, LLMResponse, LLMRoundResult, LLMProvider } from "../../server/llm/types.js";
import { createOrchestrator } from "../../server/orchestrator/index.js";
import { CHOICE_PROMPT_PATTERN } from "../../server/orchestrator/patterns.js";

function assertString(value: unknown): asserts value is string {
  assert.equal(typeof value, "string");
}

function codePointLength(value: string) {
  return [...value].length;
}

function assertSuccessfulLogReplyShape(
  reply: string,
  opts: {
    fullFoodName: string;
    expectsUncertainty: boolean;
    allowsNextStep?: boolean;
  },
) {
  assert.doesNotMatch(reply, /\n/, "successful log replies must not contain newlines");
  assert.doesNotMatch(reply, /[\u{1F300}-\u{1FAFF}]/u, "successful log replies must not contain emoji");
  assert.doesNotMatch(reply, /^#/m, "successful log replies must not contain markdown headings");
  assert.doesNotMatch(reply, /(?:^|\n)\s*[-*•]\s|[|].*[|]/, "successful log replies must not contain bullets or tables");
  assert.match(reply, /已記錄/);
  assert.match(reply, new RegExp(opts.fullFoodName));
  assert.match(reply, /kcal/);
  assert.match(reply, /蛋白質\s*\d+(?:\.\d+)?\s*g/);
  assert.ok(codePointLength(reply) <= 120, "successful log replies must be <= 120 JavaScript code points");

  const nextStepClauses = reply
    .split("。")
    .filter((clause) => /(下次|建議|可以再|若你|如果|調整)/.test(clause));
  assert.ok(nextStepClauses.length <= 1, "successful log replies may include at most one next-step clause");
  if (opts.allowsNextStep === false) {
    assert.equal(nextStepClauses.length, 0, "successful log replies without deterministic precision trigger should not include a next step");
  }

  if (opts.expectsUncertainty === true) {
    assert.doesNotMatch(reply, /\d+\s*[-~－]\s*\d+\s*kcal|區間/);
    assert.doesNotMatch(reply, /(份量|油脂與飯量|湯底與份量).*主要誤差/);
  } else {
    assert.doesNotMatch(reply, /\d+\s*[-~－]\s*\d+\s*kcal|區間/);
    assert.doesNotMatch(reply, /(份量|油脂與飯量|湯底與份量).*主要誤差/);
  }

  assert.doesNotMatch(reply, /log_food|protein_sources|usedConservativeAssumption|quantityUncertaintyReason|missing_quantity/);
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

class ChatStreamOnlyProvider implements LLMProvider {
  private chatQueue: Array<LLMResponse | Error> = [];
  private streamTokens: string[] = [];
  public chatCalls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];

  queueChatResponse(response: LLMResponse) {
    this.chatQueue.push(response);
  }

  queueChatStream(tokens: string[]) {
    this.streamTokens = tokens;
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    this.chatCalls.push({ messages, tools });
    const item = this.chatQueue.shift();
    if (item instanceof Error) {
      throw item;
    }
    return item ?? { content: "Mock: 已記錄您的飲食！" };
  }

  async *chatStream(messages: ChatMessage[], tools: ToolDefinition[]): AsyncGenerator<string> {
    this.chatCalls.push({ messages, tools });
    yield* streamTokens(this.streamTokens);
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

  it("builds committed MutationEffects for every successful mutation family", () => {
    const source = readFileSync(new URL("../../server/orchestrator/index.ts", import.meta.url), "utf8");

    assert.match(source, /let mutationEffects: MutationEffects \| undefined/);
    for (const kind of ["log", "update", "delete", "goals"]) {
      assert.match(source, new RegExp(`kind: "${kind}"`));
    }
    assert.doesNotMatch(source, /successfulGoalReceipt|ensureGoalReceipt/);
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
    const result = await orchestrator.handleMessage(deviceId, "我吃了雞腿便當");
    if (!("reply" in result)) throw new Error("expected reply result");
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "蘋果",
      expectsUncertainty: true,
      allowsNextStep: true,
    });
    assert.match(result.reply, /蛋白質 0 g/);
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

  it("returns affectedDate when a historical log succeeds", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_historical_log",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            food_name: "牛肉麵",
            calories: 520,
            protein: 24,
            carbs: 68,
            fat: 16,
            date_text: "2026-03-25",
            meal_period: "dinner",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已幫你記到 3/25。" });

    const result = await orchestrator.handleMessage(deviceId, "幫我補記 2026-03-25 晚餐吃牛肉麵");
    if (!("reply" in result)) throw new Error("expected reply result");

    assert.equal(result.didLogMeal, true);
    assert.equal(result.affectedDate, "2026-03-25");
    assert.equal(result.dailySummary?.date, "2026-03-25");
  });

  it("returns affectedDate for non-today summary queries", async () => {
    await foodLoggingService.logFood(deviceId, {
      foodName: "雞胸肉",
      calories: 220,
      protein: 32,
      carbs: 0,
      fat: 5,
      loggedAt: "2026-03-25T04:00:00.000Z",
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_historical_summary",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: JSON.stringify({ date_text: "2026-03-25" }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "你在 3/25 共吃了 32g 蛋白質。" });

    const result = await orchestrator.handleMessage(deviceId, "2026-03-25 吃了多少蛋白質？");
    if (!("reply" in result)) throw new Error("expected reply result");

    assert.equal(result.didLogMeal, false);
    assert.equal(result.affectedDate, "2026-03-25");
    assert.equal(result.dailySummary?.date, "2026-03-25");
  });

  it("handleMessage returns didLogMeal: true with projected copy after log_food succeeds", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            food_name: "雞腿便當",
            calories: 620,
            protein: 30,
            carbs: 70,
            fat: 18,
            protein_sources: [
              { name: "雞腿", protein: 24, is_primary: true, certainty: "clear" },
              { name: "白飯", protein: 4, is_primary: false, certainty: "clear" },
              { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
            ],
          }),
        },
      }],
    });
    const result = await orchestrator.handleMessage(deviceId, "我吃了蘋果");
    assert.equal(result.didLogMeal, true);
    if (!("reply" in result)) throw new Error("expected reply result");
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "雞腿便當",
      expectsUncertainty: true,
      allowsNextStep: true,
    });
    assert.match(result.reply, /蛋白質 24 g。/);
    assert.doesNotMatch(result.reply, /已完成記錄，但回覆生成失敗|headline/);
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

  it("returns a renderer-owned goal update receipt before any later model rounds", async () => {
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;
    const localLLM = new MockLLMProvider();

    orchestrator = createOrchestrator({
      llmProvider: localLLM,
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

    localLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_max_rounds",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 1800, protein: 130 }),
        },
      }],
    });
    localLLM.queueChatResponse({ content: "模型前綴：我已經幫你更新好了。" });

    const result = await orchestrator.handleMessage(localDeviceId, "卡路里 1800 蛋白質 130");

    assert.ok("reply" in result);
    assert.equal(result.reply, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(result.didLogMeal, false);
    assert.equal(localLLM.chatCalls.length, 1);
  });

  it("returns the goal update receipt when a later tool in the same batch fails fatally", async () => {
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;
    const localLLM = new MockLLMProvider();

    orchestrator = createOrchestrator({
      llmProvider: localLLM,
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

    localLLM.queueChatResponse({
      toolCalls: [
        {
          id: "goal_batch_success",
          type: "function",
          function: {
            name: "update_goals",
            arguments: JSON.stringify({ calories: 1800, protein: 130 }),
          },
        },
        {
          id: "unknown_after_goal",
          type: "function",
          function: { name: "unknown_tool", arguments: "{}" },
        },
      ],
    });

    const result = await orchestrator.handleMessage(localDeviceId, "卡路里 1800 蛋白質 130");

    assert.ok("reply" in result);
    assert.equal(result.reply, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
    const device = await localDeviceService.getDevice(localDeviceId);
    assert.equal(device?.dailyCalories, 1800);
    assert.equal(device?.dailyProtein, 130);
  });

  it("returns a deterministic logged reply for image-only uploads after log_food succeeds", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            food_name: "豬肉燒烤飯盒",
            calories: 680,
            protein: 35,
            carbs: 86,
            fat: 22,
            protein_sources: [
              { name: "豬肉", protein: 28, is_primary: true, certainty: "clear" },
              { name: "白飯", protein: 5, is_primary: false, certainty: "clear" },
              { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
            ],
          }),
        },
      }],
    });

    const result = await orchestrator.handleMessage(
      deviceId,
      "(圖片)",
      "data:image/png;base64,abc123",
      "asset:meal-image",
    );

    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(result.didLogMeal, true);
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "豬肉燒烤飯盒",
      expectsUncertainty: true,
      allowsNextStep: true,
    });
    assert.match(result.reply, /蛋白質 28 g。/);
    assert.doesNotMatch(result.reply, /保守估算|headline/);
    assert.equal(mockLLM.chatCalls.length, 1, "image-only logging should not require a second LLM round");
  });

  it("projects correction clarification copy from user terms and full grouped candidate names", async () => {
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const localMealCorrectionService = createMealCorrectionService(db);
    const localLLM = new MockLLMProvider();
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;

    await localFoodLoggingService.logGroupedMeal(localDeviceId, {
      loggedAt: "2026-04-19T09:30:00.000Z",
      items: [
        { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
        { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
        { foodName: "青菜", calories: 80, protein: 2, carbs: 10, fat: 4 },
      ],
    });
    await localFoodLoggingService.logGroupedMeal(localDeviceId, {
      loggedAt: "2026-04-19T10:00:00.000Z",
      items: [
        { foodName: "排骨", calories: 300, protein: 26, carbs: 8, fat: 18 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
        { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
        { foodName: "青菜", calories: 80, protein: 2, carbs: 10, fat: 4 },
      ],
    });

    orchestrator = createOrchestrator({
      llmProvider: localLLM,
      chatService: localChatService,
      summaryService: localSummaryService,
      foodLoggingService: localFoodLoggingService,
      mealCorrectionService: localMealCorrectionService,
      deviceService: localDeviceService,
    });

    localLLM.queueChatResponse({
      toolCalls: [{
        id: "find_ambiguous_grouped_item",
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: "update",
            query: "把中午雞腿便當的滷蛋改成兩顆水煮蛋",
          }),
        },
      }],
    });
    localLLM.queueChatResponse({ content: "你是要修改中午雞腿便當嗎？" });

    const result = await orchestrator.handleMessage(localDeviceId, "滷蛋改成兩顆水煮蛋");

    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(result.didMutateMeal, false);
    assert.match(result.reply, /滷蛋/);
    assert.match(result.reply, /雞腿、白飯、滷蛋、青菜/);
    assert.match(result.reply, /排骨、白飯、滷蛋、青菜/);
    assert.doesNotMatch(result.reply, /中午雞腿便當/);
  });

  it("renders missing-quantity successful logs from committed facts without implementation copy", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_grouped_image",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              { food_name: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
              { food_name: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
              { food_name: "青菜", calories: 80, protein: 2, carbs: 10, fat: 4 },
            ],
            protein_sources: [
              { name: "雞腿", protein: 24, is_primary: true, certainty: "clear" },
              { name: "白飯", protein: 4, is_primary: false, certainty: "clear" },
              { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
            ],
          }),
        },
      }],
    });

    const result = await orchestrator.handleMessage(
      deviceId,
      "(圖片)",
      "data:image/png;base64,abc123",
      "asset:grouped-image",
    );

    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(result.loggedMeal?.quantityUncertaintyReason, "missing_quantity");
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "雞腿、白飯、青菜",
      expectsUncertainty: true,
      allowsNextStep: true,
    });
    assert.doesNotMatch(result.reply, /可再補份量修正/);
    assert.doesNotMatch(result.reply, /保守估算/);
  });

  it("omits uncertainty and next steps for clear quantified image logs", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_quantified_image",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              { food_name: "雞胸肉 120g", calories: 198, protein: 37, carbs: 0, fat: 4, quantity_g: 120 },
            ],
            protein_sources: [
              { name: "雞胸肉", protein: 37, is_primary: true, certainty: "clear" },
            ],
          }),
        },
      }],
    });

    const result = await orchestrator.handleMessage(
      deviceId,
      "(圖片)",
      "data:image/png;base64,abc123",
      "asset:clear-image",
    );

    if (!("reply" in result)) throw new Error("expected reply result");
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "雞胸肉 120g",
      expectsUncertainty: false,
      allowsNextStep: false,
    });
    assert.doesNotMatch(result.reply, /可再補份量修正/);
  });

  it("renders high-variance image categories from committed facts without uncertainty prose", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_high_variance_image",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            food_name: "牛肉麵",
            calories: 650,
            protein: 31,
            carbs: 82,
            fat: 20,
            quantity: 1,
            unit: "碗",
            protein_sources: [
              { name: "牛肉", protein: 31, is_primary: true, certainty: "clear" },
            ],
          }),
        },
      }],
    });

    const result = await orchestrator.handleMessage(
      deviceId,
      "(圖片)",
      "data:image/png;base64,abc123",
      "asset:noodle-image",
    );

    if (!("reply" in result)) throw new Error("expected reply result");
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "牛肉麵",
      expectsUncertainty: true,
      allowsNextStep: false,
    });
    assert.doesNotMatch(result.reply, /湯底與份量.*主要誤差/);
    assert.doesNotMatch(result.reply, /可再補份量修正/);
  });

  it("adds a concrete date for historical successful image logs", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_historical_image",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            food_name: "鮭魚飯",
            calories: 520,
            protein: 34,
            carbs: 58,
            fat: 16,
            quantity: 1,
            unit: "份",
            date_text: "2026-03-25",
            meal_period: "dinner",
            protein_sources: [
              { name: "鮭魚", protein: 34, is_primary: true, certainty: "clear" },
            ],
          }),
        },
      }],
    });

    const result = await orchestrator.handleMessage(
      deviceId,
      "(圖片)",
      "data:image/png;base64,abc123",
      "asset:historical-image",
    );

    if (!("reply" in result)) throw new Error("expected reply result");
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "鮭魚飯",
      expectsUncertainty: false,
      allowsNextStep: false,
    });
    assert.match(result.reply, /3\/25/);
  });

  it("recovers locally when the user replies 2 to a previously hallucinated choice prompt", async () => {
    await chatService.saveMessage(deviceId, "user", "(圖片)", { imagePath: "asset:meal-image" });
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

  it("handleMessage projects successful text log replies from normalized loggedMeal instead of model stream", async () => {
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

    assert.ok("reply" in result);
    assert.equal(result.didLogMeal, true);
    assert.ok(result.dailySummary);
    assert.equal(streamingLLM.chatCalls.length, 1);
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "蘋果",
      expectsUncertainty: true,
      allowsNextStep: true,
    });
    assert.match(result.reply, /蛋白質 0 g/);
    assert.doesNotMatch(result.reply, /已幫你記錄蘋果/);

    const historyBeforeStream = await localChatService.getHistory(localDeviceId, 10);
    assert.equal(historyBeforeStream.filter((message) => message.role === "assistant").length, 0);
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

  it("returns a renderer goal receipt instead of streaming model prefix/suffix text", async () => {
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

    assert.ok("reply" in result);
    assert.equal(result.reply, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    const device = await localDeviceService.getDevice(localDeviceId);
    assert.equal(device?.dailyCalories, 1800);
    assert.equal(device?.dailyProtein, 130);
  });

  it("does not wait for a streamed final reply after a goal mutation succeeds", async () => {
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

    assert.ok("reply" in result);
    assert.equal(result.reply, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
    assert.equal(result.finalReplySource, "renderer");
  });

  it("does not enter legacy chatStream after a goal mutation succeeds", async () => {
    const streamingLLM = new ChatStreamOnlyProvider();
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

    streamingLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_legacy_stream",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 1800, protein: 130 }),
        },
      }],
    });
    streamingLLM.queueChatStream(["已經", "更新好了"]);

    const result = await orchestrator.handleMessage(localDeviceId, "卡路里 1800 蛋白質 130");

    assert.ok("reply" in result);
    assert.equal(result.reply, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
    assert.equal(result.finalReplySource, "renderer");
  });
});
