import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { eq } from "drizzle-orm";
import { createDb } from "../../server/db/client.js";
import { chatMessages } from "../../server/db/schema.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createSummaryService } from "../../server/services/summary.js";
import { createChatService } from "../../server/services/chat.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { createOrchestrator, type OrchestratorResult } from "../../server/orchestrator/index.js";
import { createStructuredHooks } from "../../server/orchestrator/hooks.js";
import { formatLocalDate } from "../../server/lib/time.js";
import { createSpyHooks } from "../helpers/spy-hooks.js";
import type { DailyTargets } from "../../server/services/device.js";

function assertReplyResult(result: OrchestratorResult): asserts result is Extract<OrchestratorResult, { reply: string }> {
  assert.ok("reply" in result);
}

describe("Orchestrator", () => {
  let orchestrator: ReturnType<typeof createOrchestrator>;
  let mockLLM: MockLLMProvider;
  let foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  let chatService: ReturnType<typeof createChatService>;
  let deviceService: ReturnType<typeof createDeviceService>;
  let db: ReturnType<typeof createDb>;
  let deviceId: string;
  let spyHooks: ReturnType<typeof createSpyHooks>;
  let publishedGoals: Array<{ deviceId: string; targets: DailyTargets }>;

  beforeEach(async () => {
    db = createDb(":memory:");
    deviceService = createDeviceService(db);
    foodLoggingService = createFoodLoggingService(db);
    const summaryService = createSummaryService(db);
    chatService = createChatService(db);
    mockLLM = new MockLLMProvider();
    publishedGoals = [];

    orchestrator = createOrchestrator({
      llmProvider: mockLLM,
      chatService,
      summaryService,
      foodLoggingService,
      deviceService,
      publisher: {
        publishGoalsUpdate(id: string, targets: DailyTargets) {
          publishedGoals.push({ deviceId: id, targets });
          return { sent: 1 };
        },
      },
    } as Parameters<typeof createOrchestrator>[0]);

    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
    spyHooks = createSpyHooks(); // fresh mocks each test — never at module scope (Pitfall 6)
  });

  it("returns text reply when LLM responds with content", async () => {
    mockLLM.queueChatResponse({ content: "你好！我是你的營養教練。" });
    const result = await orchestrator.handleMessage(deviceId, "你好");
    assertReplyResult(result);
    assert.equal(result.reply, "你好！我是你的營養教練。");
    assert.equal(result.didLogMeal, false);
  });

  it("executes tool calls and returns final reply", async () => {
    // Round 1: LLM calls get_daily_summary (registry-known tool; pre-Phase-10
    // this round used the legacy lenient `analyze_food` unknown-tool path, but
    // unknown tools now throw `FatalToolError("unknown tool")` per Phase 10 D-03,
    // so the test now uses an existing tool to model a multi-round flow).
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: { name: "get_daily_summary", arguments: JSON.stringify({}) },
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

    const result = await orchestrator.handleMessage(deviceId, "我吃了蘋果");
    assertReplyResult(result);
    assert.equal(result.reply, "已幫你記錄蘋果！");
    assert.equal(result.didLogMeal, true);
    assert.deepEqual(result.dailySummary, {
      totalCalories: 100,
      totalProtein: 5,
      totalCarbs: 20,
      totalFat: 2,
      mealCount: 1,
      date: formatLocalDate(new Date()),
    });
    assert.equal(mockLLM.chatCalls.length, 3);
    const secondRound = mockLLM.chatCalls[1].messages;
    assert.equal(secondRound[secondRound.length - 2].role, "assistant");
    assert.equal(secondRound[secondRound.length - 1].role, "tool");
  });

  it("persists uploaded image metadata while sending the data URI to the LLM", async () => {
    // Round 1: previously simulated `analyze_food` (legacy lenient unknown-tool
    // path); Phase 10-02 D-03 makes unknown tools fatal, so we now model the
    // multi-round flow with the registry-known `get_daily_summary` tool.
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: JSON.stringify({}),
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

    const result = await orchestrator.handleMessage(
      deviceId,
      "(圖片)",
      "data:image/png;base64,abc123",
      "asset:meal-image"
    );
    assertReplyResult(result);
    assert.equal(result.reply, "已先依照片做保守估算並完成記錄：沙拉，約 180 kcal。若你想更精準，我可以再依份量幫你調整。");
    assert.equal(result.didLogMeal, true);

    const firstRoundUserMessage = mockLLM.chatCalls[0].messages.find((message) => Array.isArray(message.content));
    assert.ok(Array.isArray(firstRoundUserMessage?.content));
    assert.deepEqual(firstRoundUserMessage.content[1], {
      type: "image_url",
      image_url: { url: "data:image/png;base64,abc123" },
    });

    const history = await chatService.getHistory(deviceId, 10);
    assert.equal(history[0].imagePath, "asset:meal-image");

    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals[0].imagePath, "asset:meal-image");
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
    const result = await orchestrator.handleMessage(deviceId, "test");
    assertReplyResult(result);
    assert.equal(result.reply, "抱歉，我現在無法完成這個請求，請稍後再試。");
    assert.equal(result.didLogMeal, false);
  });

  it("OBS-01: fires onLLMStart and onLLMEnd for a single-round reply", async () => {
    mockLLM.queueChatResponse({ content: "你好！" });
    await orchestrator.handleMessage(deviceId, "你好", undefined, undefined, { hooks: spyHooks });
    assert.equal(spyHooks.onLLMStart.mock.callCount(), 1, "onLLMStart should fire once");
    assert.equal(spyHooks.onLLMStart.mock.calls[0].arguments[0], 1, "round should be 1 (1-indexed)");
    assert.equal(spyHooks.onLLMEnd.mock.callCount(), 1, "onLLMEnd should fire once");
    assert.equal(spyHooks.onLLMEnd.mock.calls[0].arguments[0], 1, "round should be 1");
    assert.equal(spyHooks.onLLMEnd.mock.calls[0].arguments[1], false, "hadToolCalls should be false");
    assert.equal(spyHooks.onFallback.mock.callCount(), 0, "onFallback should not fire");
  });

  it("OBS-01: fires onToolReceived and onToolResult during tool call round", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "c1",
        type: "function",
        function: { name: "get_daily_summary", arguments: "{}" },
      }],
    });
    mockLLM.queueChatResponse({ content: "今日攝取：熱量 500kcal" });
    await orchestrator.handleMessage(deviceId, "查看今日攝取", undefined, undefined, { hooks: spyHooks });
    assert.equal(spyHooks.onLLMStart.mock.callCount(), 2, "onLLMStart should fire for each round");
    assert.equal(spyHooks.onToolReceived.mock.callCount(), 1, "onToolReceived should fire once");
    assert.equal(spyHooks.onToolReceived.mock.calls[0].arguments[0], "get_daily_summary");
    assert.equal(spyHooks.onToolResult.mock.callCount(), 1, "onToolResult should fire once");
    assert.equal(spyHooks.onToolResult.mock.calls[0].arguments[0].success, true);
    assert.equal(spyHooks.onToolResult.mock.calls[0].arguments[0].executed, true);
    assert.equal(spyHooks.onLLMEnd.mock.callCount(), 2, "onLLMEnd should fire twice: tool-round (hadToolCalls=true) and content-round (hadToolCalls=false)");
    assert.equal(spyHooks.onLLMEnd.mock.calls[0].arguments[1], true, "First onLLMEnd should have hadToolCalls=true");
    assert.equal(spyHooks.onLLMEnd.mock.calls[1].arguments[1], false, "Second onLLMEnd should have hadToolCalls=false");
  });

  it("OBS-02: fires onFallback('max_rounds') after 3 rounds of only tool calls", async () => {
    for (let i = 0; i < 3; i++) {
      mockLLM.queueChatResponse({
        toolCalls: [{
          id: `c${i}`,
          type: "function",
          function: { name: "get_daily_summary", arguments: "{}" },
        }],
      });
    }
    await orchestrator.handleMessage(deviceId, "test", undefined, undefined, { hooks: spyHooks });
    assert.equal(spyHooks.onFallback.mock.callCount(), 1, "onFallback should fire exactly once");
    assert.equal(spyHooks.onFallback.mock.calls[0].arguments[0], "max_rounds");
  });

  it("OBS-03: hook payloads contain no raw deviceId and no raw meal text", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "c1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "蘋果", calories: 100, protein: 1, carbs: 25, fat: 0.5 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已記錄" });
    const mealText = "我吃了蘋果測試PII";
    await orchestrator.handleMessage(deviceId, mealText, undefined, undefined, { hooks: spyHooks });

    const allPayloads = JSON.stringify([
      ...spyHooks.onLLMStart.mock.calls.map((c) => c.arguments),
      ...spyHooks.onLLMEnd.mock.calls.map((c) => c.arguments),
      ...spyHooks.onToolReceived.mock.calls.map((c) => c.arguments),
      ...spyHooks.onToolResult.mock.calls.map((c) => c.arguments),
      ...spyHooks.onFallback.mock.calls.map((c) => c.arguments),
    ]);
    assert.ok(!allPayloads.includes(deviceId), `deviceId must not appear in any hook payload. Got: ${allPayloads.slice(0, 200)}`);
    assert.ok(!allPayloads.includes(mealText), `meal text must not appear in any hook payload. Got: ${allPayloads.slice(0, 200)}`);
    // Verify redacted summary IS present (not absent — that would mean hooks didn't fire)
    assert.equal(spyHooks.onToolReceived.mock.callCount(), 1, "onToolReceived should fire");
    const argsRedacted = spyHooks.onToolReceived.mock.calls[0].arguments[1] as string;
    assert.ok(argsRedacted.includes("kcal"), `argsRedacted should contain 'kcal' from redactToolArgs: ${argsRedacted}`);
  });

  it("HOOK-01: fires onToolResult with executed:false when validation fails (FatalToolError)", async () => {
    // Queue a tool call with invalid log_food arguments (missing required numeric fields)
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "c1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "bad food" }), // missing calories, protein, carbs, fat
        },
      }],
    });
    // FatalToolError propagates — do NOT queue a second reply

    // Assert that handleMessage REJECTS (error propagates)
    await assert.rejects(
      () => orchestrator.handleMessage(deviceId, "記錄一個壞食物", undefined, undefined, { hooks: spyHooks }),
      (err: unknown) => err instanceof Error,
      "handleMessage should reject when FatalToolError is not caught"
    );

    // Despite the rejection, onToolResult must have fired BEFORE the error propagated
    assert.equal(spyHooks.onToolResult.mock.callCount(), 1, "onToolResult should fire once for the validation failure");
    const payload = spyHooks.onToolResult.mock.calls[0].arguments[0];
    assert.equal(payload.tool, "log_food");
    assert.equal(payload.success, false);
    assert.equal(payload.executed, false, "executed:false — tool validation failed before execution");
    assert.ok(typeof payload.failureReason === "string" && payload.failureReason.length > 0);
    assert.ok(!payload.failureReason?.includes(deviceId), "failureReason must not contain deviceId");
  });

  it("GOAL-06: passes current user text and immediately previous assistant message to update_goals", async () => {
    await chatService.saveMessage(deviceId, "assistant", "確認要把蛋白質改成 130 g 嗎?");
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_call",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 1800, protein: 130 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g" });

    const result = await orchestrator.handleMessage(deviceId, "卡路里改 1800，是", undefined, undefined, { hooks: spyHooks });
    assertReplyResult(result);
    assert.match(result.reply, /已更新每日目標/);

    const device = await deviceService.getDevice(deviceId);
    assert.equal(device?.dailyCalories, 1800);
    assert.equal(device?.dailyProtein, 130);
    assert.equal(publishedGoals.length, 1);
  });

  it("GOAL-05: controlled validation failure saves a tool message, returns to the LLM, and does not throw", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_validation",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 99999 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "請提供 500 到 8000 之間的卡路里目標。" });

    const result = await orchestrator.handleMessage(deviceId, "卡路里改 99999", undefined, undefined, { hooks: spyHooks });
    assertReplyResult(result);
    assert.equal(result.didLogMeal, false);
    assert.equal(result.reply, "請提供 500 到 8000 之間的卡路里目標。");

    const payload = spyHooks.onToolResult.mock.calls[0].arguments[0];
    assert.equal(payload.tool, "update_goals");
    assert.equal(payload.success, false);
    assert.equal(payload.executed, false);
    assert.match(payload.failureReason ?? "", /validation/);

    const secondRoundMessages = mockLLM.chatCalls[1].messages;
    const toolMessage = secondRoundMessages.find((message) => message.role === "tool");
    assert.ok(toolMessage, "validation failure should be pushed into the next LLM round");
    assert.match(String(toolMessage.content), /validation/);

    const storedMessages = await db.select().from(chatMessages).where(eq(chatMessages.deviceId, deviceId));
    assert.equal(storedMessages.some((message) => message.role === "tool" && message.toolName === "update_goals"), true);
  });

  it("GOAL-06: controlled guard failure records failureReason:\"guard\" and keeps the fatal unknown-tool path unchanged", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_guard",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 1800 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "你想把卡路里調整成多少？" });

    const result = await orchestrator.handleMessage(deviceId, "少吃一點", undefined, undefined, { hooks: spyHooks });
    assertReplyResult(result);
    assert.equal(result.didLogMeal, false);
    const payload = spyHooks.onToolResult.mock.calls[0].arguments[0];
    assert.equal(payload.tool, "update_goals");
    assert.equal(payload.success, false);
    assert.equal(payload.executed, false);
    assert.match(payload.failureReason ?? "", /guard/);

    mockLLM.reset();
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "unknown_tool",
        type: "function",
        function: { name: "unknown_goal_tool", arguments: "{}" },
      }],
    });
    await assert.rejects(
      orchestrator.handleMessage(deviceId, "測試未知工具", undefined, undefined, { hooks: spyHooks }),
      /unknown tool/,
    );
  });

  it("OBS-03: onToolReceived for update_goals exposes field names only, not target numbers, raw user text, or deviceId", async () => {
    const rawUserText = `raw user text ${deviceId} 卡路里 1800 蛋白質 130`;
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_redaction",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 1800, protein: 130 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g" });

    await orchestrator.handleMessage(deviceId, rawUserText, undefined, undefined, { hooks: spyHooks });

    assert.equal(spyHooks.onToolReceived.mock.callCount(), 1);
    const argsRedacted = spyHooks.onToolReceived.mock.calls[0].arguments[1];
    assert.match(argsRedacted, /updatedFields: calories,protein/);
    assert.doesNotMatch(argsRedacted, /1800/);
    assert.doesNotMatch(argsRedacted, /130/);
    assert.doesNotMatch(argsRedacted, /raw user text/);
    assert.doesNotMatch(argsRedacted, new RegExp(deviceId));
  });

  it("OBS-02: structured goal hook events carry only field names, failureReason, and event names", () => {
    const captured: Array<Record<string, unknown>> = [];
    const log = {
      info(payload: Record<string, unknown>) {
        captured.push(payload);
      },
      warn(payload: Record<string, unknown>) {
        captured.push(payload);
      },
    };
    const hooks = createStructuredHooks(log as never);

    hooks.onToolResult?.({
      tool: "update_goals",
      success: true,
      executed: true,
      summary: "updatedFields: calories,protein",
      updatedFields: ["calories", "protein"],
      publishedEvents: ["goals_update"],
    });
    hooks.onToolResult?.({
      tool: "update_goals",
      success: false,
      executed: false,
      failureReason: "guard",
      summary: "failureReason: guard",
    });

    const goalEvents = captured.filter((payload) =>
      ["goal_update_success", "goal_update_rejected", "goals_update_published"].includes(String(payload.event)),
    );
    assert.deepEqual(goalEvents.map((payload) => payload.event), [
      "goal_update_success",
      "goals_update_published",
      "goal_update_rejected",
    ]);

    const rawUserText = "raw user text 卡路里 1800 蛋白質 130";
    for (const payload of goalEvents) {
      const keys = Object.keys(payload).sort();
      if (payload.event === "goal_update_rejected") {
        assert.deepEqual(keys, ["event", "failureReason"]);
      } else {
        assert.deepEqual(keys, ["event", "updatedFields"]);
      }
      const serialized = JSON.stringify(payload);
      assert.doesNotMatch(serialized, /1800/);
      assert.doesNotMatch(serialized, /130/);
      assert.doesNotMatch(serialized, new RegExp(deviceId));
      assert.doesNotMatch(serialized, new RegExp(rawUserText));
    }
  });
});
