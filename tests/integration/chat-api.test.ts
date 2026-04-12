process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { FastifyInstance } from "fastify";

interface SSEEvent {
  event: string;
  data: string;
}

function parseSSEEvents(raw: string): SSEEvent[] {
  return raw
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      return {
        event: lines.find((line) => line.startsWith("event: "))?.slice("event: ".length) ?? "",
        data: lines.find((line) => line.startsWith("data: "))?.slice("data: ".length) ?? "",
      };
    });
}

async function readUntilEventCount(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  targetEvent: string,
  targetCount: number,
  maxReads = 80,
): Promise<{ raw: string; observedAt: number }> {
  const decoder = new TextDecoder();
  let raw = "";

  for (let i = 0; i < maxReads; i += 1) {
    const chunk = await reader.read();
    if (chunk.value) {
      raw += decoder.decode(chunk.value, { stream: !chunk.done });
    }
    if (parseSSEEvents(raw).filter((frame) => frame.event === targetEvent).length >= targetCount) {
      return { raw, observedAt: Date.now() };
    }
    if (chunk.done) {
      break;
    }
  }

  throw new Error(`Expected ${targetCount} ${targetEvent} event(s), got ${parseSSEEvents(raw).filter((frame) => frame.event === targetEvent).length}`);
}

describe("Chat API", () => {
  let app: FastifyInstance;
  let mockLLM: MockLLMProvider;
  let address: string;
  let deviceId: string;

  beforeEach(async () => {
    mockLLM = new MockLLMProvider();
    app = await buildApp({ dbPath: ":memory:", llmProvider: mockLLM });
    const res = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    deviceId = res.json().deviceId;
    address = await app.listen({ port: 0 });
  });

  afterEach(async () => {
    if (app.server.listening) {
      await app.close();
    }
  });

  it("POST /api/chat accepts multipart text-only requests", async () => {
    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.reply);
  });

  it("POST /api/chat accepts multipart image upload", async () => {
    const form = new FormData();
    form.append("message", "");
    form.append("image", new Blob(["fake image"], { type: "image/png" }), "meal.png");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.reply);
  });

  it("POST /api/chat rejects invalid image types", async () => {
    const form = new FormData();
    form.append("message", "");
    form.append("image", new Blob(["not an image"], { type: "text/plain" }), "meal.txt");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });

    assert.equal(res.status, 400);
  });

  it("POST /api/chat rejects images larger than 5MB", async () => {
    const form = new FormData();
    form.append("message", "");
    form.append("image", new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/png" }), "too-big.png");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });

    assert.equal(res.status, 400);
  });

  it("POST /api/chat returns 401 without device id", async () => {
    const form = new FormData();
    form.append("message", "hello");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      body: form,
    });
    assert.equal(res.status, 401);
  });

  it("GET /api/chat/history returns messages", async () => {
    const form = new FormData();
    form.append("message", "你好");
    await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/history?limit=50",
      headers: { "x-device-id": deviceId },
    });
    assert.equal(res.statusCode, 200);
    const { messages } = res.json();
    assert.ok(messages.length >= 2);
    assert.equal(messages[0].role, "user");
    assert.equal(messages[1].role, "assistant");
  });

  it("POST /api/chat returns didLogMeal=true when mealCount increases", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "蘋果", calories: 95, protein: 0.5, carbs: 25, fat: 0.3 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已幫你記錄蘋果！" });

    const form = new FormData();
    form.append("message", "我吃了蘋果");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.didLogMeal, true);
  });

  it("POST /api/chat returns dailySummary when didLogMeal is true", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "蘋果", calories: 95, protein: 0.5, carbs: 25, fat: 0.3 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已幫你記錄蘋果！" });

    const form = new FormData();
    form.append("message", "我吃了蘋果");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.didLogMeal, true);
    assert.deepEqual(body.dailySummary, {
      totalCalories: 95,
      totalProtein: 0.5,
      totalCarbs: 25,
      totalFat: 0.3,
      mealCount: 1,
    });
  });

  it("POST /api/chat does not include dailySummary when no food is logged", async () => {
    mockLLM.queueChatResponse({ content: "今天狀態不錯，記得多喝水。" });

    const form = new FormData();
    form.append("message", "今天天氣真好");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.didLogMeal, false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "dailySummary"), false);
  });

  it("POST /api/chat returns didLogMeal: true even when final LLM round fails after log_food succeeded", async () => {
    // log_food persists to DB, then the model's reply generation throws.
    // The meal is in the DB; the API must reflect that even though it returns an error message.
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "香蕉", calories: 90, protein: 1, carbs: 23, fat: 0.3 }),
        },
      }],
    });
    mockLLM.queueChatError(new Error("API timeout"));

    const form = new FormData();
    form.append("message", "我吃了香蕉");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.didLogMeal, true, "meal was persisted; didLogMeal must survive LLM failure");
    assert.equal(body.reply, "已完成記錄，但回覆生成失敗，請稍後確認今日攝取摘要。");
    assert.deepEqual(body.dailySummary, {
      totalCalories: 90,
      totalProtein: 1,
      totalCarbs: 23,
      totalFat: 0.3,
      mealCount: 1,
    });
  });

  it("GET /api/chat/history keeps didLogMeal=true for persisted meal-logging replies", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "蘋果", calories: 95, protein: 0.5, carbs: 25, fat: 0.3 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已幫你記錄蘋果！" });

    const form = new FormData();
    form.append("message", "我吃了蘋果");
    await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });

    const historyRes = await app.inject({
      method: "GET",
      url: "/api/chat/history?limit=50",
      headers: { "x-device-id": deviceId },
    });

    assert.equal(historyRes.statusCode, 200);
    const historyBody = historyRes.json();
    const assistantMessage = historyBody.messages.find((message: { role: string }) => message.role === "assistant");
    assert.equal(assistantMessage.didLogMeal, true);
  });

  it("POST /api/chat without SSE accept header still returns JSON", async () => {
    mockLLM.queueChatResponse({ content: "純文字回覆" });

    const form = new FormData();
    form.append("message", "你好");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });

    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type") ?? "", /application\/json/);
    const body = await res.json();
    assert.ok(body.reply, "expected a reply field in JSON response");
  });

  it("GET /api/chat/history rejects invalid limit", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/history?limit=0",
      headers: { "x-device-id": deviceId },
    });
    assert.equal(res.statusCode, 400);
  });

  it("GET /api/chat/history rejects limit above 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/history?limit=201",
      headers: { "x-device-id": deviceId },
    });
    assert.equal(res.statusCode, 400);
  });

  it("GET /api/chat/history returns 401 without device id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/history",
    });
    assert.equal(res.statusCode, 401);
  });

  it("POST /api/chat returns 401 with invalid device id", async () => {
    const form = new FormData();
    form.append("message", "hello");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": "non-existent-id" },
      body: form,
    });
    assert.equal(res.status, 401);
  });

  it("POST /api/chat returns 400 when message and image are both missing", async () => {
    const form = new FormData();
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });
    assert.equal(res.status, 400);
  });

  it("POST /api/chat sanitizes raw tool names in JSON reply", async () => {
    mockLLM.queueChatResponse({ content: "我可以幫你計算並log_food這道菜，稍後也會get_daily_summary給你。" });

    const form = new FormData();
    form.append("message", "記錄午餐");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { reply: string };
    assert.doesNotMatch(body.reply, /log_food/, "log_food must not appear in JSON reply");
    assert.doesNotMatch(body.reply, /get_daily_summary/, "get_daily_summary must not appear in JSON reply");

    const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
      headers: { "x-device-id": deviceId },
    });
    assert.equal(historyRes.status, 200);

    const historyBody = await historyRes.json() as {
      messages: Array<{ role: string; content: string }>;
    };
    const assistantMessages = historyBody.messages.filter((message) => message.role === "assistant");

    assert.equal(assistantMessages.length, 1, "JSON chat should persist a single assistant message");
    assert.equal(assistantMessages[0]?.content, body.reply);
    assert.doesNotMatch(assistantMessages[0]?.content ?? "", /log_food/);
    assert.doesNotMatch(assistantMessages[0]?.content ?? "", /get_daily_summary/);
  });

  it("POST /api/chat JSON path treats invalid log_food JSON as friendly fallback", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_bad_json",
        type: "function",
        function: {
          name: "log_food",
          arguments: "{bad json",
        },
      }],
    });

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { reply: string; didLogMeal: boolean; dailySummary?: unknown };
    assert.equal(body.didLogMeal, false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "dailySummary"), false);
    assert.match(body.reply, /這次無法完成請求/);
    assert.doesNotMatch(body.reply, /log_food|FatalToolError|bad json/);

    const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
      headers: { "x-device-id": deviceId },
    });
    const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
    const assistantMsgs = historyJson.messages.filter((m) => m.role === "assistant");
    assert.equal(assistantMsgs.length, 1, "JSON fallback must persist exactly one assistant reply");
    assert.match(assistantMsgs[0]!.content, /這次無法完成請求/);
  });

  it("SSE path: done payload has didLogMeal:true and exactly one assistant message when LLM fails after log_food", async () => {
    // D-04 SSE branch: log_food persists meal, then final reply generation throws.
    // Invariant: done has didLogMeal:true and history has exactly one assistant message.
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_sse_fail",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "燕麥粥", calories: 150, protein: 5, carbs: 27, fat: 2.5 }),
        },
      }],
    });
    mockLLM.queueChatError(new Error("stream generation failed"));

    const form = new FormData();
    form.append("message", "我吃了燕麥粥");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, Accept: "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.equal(res.status, 200);
      assert.ok(res.body);

      reader = res.body.getReader();
      const { raw } = await readUntilEventCount(reader, "done", 1);
      const doneEvent = parseSSEEvents(raw).find((frame) => frame.event === "done");
      assert.ok(doneEvent, "SSE stream must emit event: done");

      const donePayload = JSON.parse(doneEvent.data) as {
        didLogMeal: boolean;
        dailySummary?: { mealCount: number; totalCalories: number };
      };
      assert.equal(donePayload.didLogMeal, true, "meal was persisted before LLM failure");
      assert.equal(donePayload.dailySummary?.mealCount, 1);
      assert.equal(donePayload.dailySummary?.totalCalories, 150);
    } finally {
      clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      controller.abort();
    }

    const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
      headers: { "x-device-id": deviceId },
    });
    assert.equal(historyRes.status, 200);

    const historyBody = await historyRes.json() as {
      messages: Array<{ role: string; content: string }>;
    };
    const assistantMsgs = historyBody.messages.filter((message) => message.role === "assistant");
    assert.equal(assistantMsgs.length, 1);
    assert.match(assistantMsgs[0]?.content ?? "", /已完成記錄，但回覆生成失敗/);
  });

  it("JSON path: exactly one assistant message in history when orchestrator throws after log_food (D-04 JSON branch)", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_json_fail",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "地瓜", calories: 180, protein: 2, carbs: 41, fat: 0.2 }),
        },
      }],
    });
    mockLLM.queueChatError(new Error("json generation failed"));

    const form = new FormData();
    form.append("message", "我吃了地瓜");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "x-device-id": deviceId },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { didLogMeal: boolean; dailySummary?: { mealCount: number } };
    assert.equal(body.didLogMeal, true);
    assert.equal(body.dailySummary?.mealCount, 1);

    const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
      headers: { "x-device-id": deviceId },
    });
    assert.equal(historyRes.status, 200);

    const historyBody = await historyRes.json() as {
      messages: Array<{ role: string; content: string }>;
    };
    const assistantMsgs = historyBody.messages.filter((message) => message.role === "assistant");
    assert.equal(assistantMsgs.length, 1);
    assert.match(assistantMsgs[0]?.content ?? "", /已完成記錄，但回覆生成失敗/);
  });

  it("D-03: daily_summary SSE push arrives on /api/sse AFTER done event is emitted on chat stream", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_order",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "優格", calories: 120, protein: 8, carbs: 15, fat: 3 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已記錄優格！" });

    const sseController = new AbortController();
    const timeout = setTimeout(() => sseController.abort(), 5000);
    let sseReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let chatReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const sseRes = await fetch(`${address}/api/sse?deviceId=${deviceId}`, {
        signal: sseController.signal,
      });
      assert.equal(sseRes.status, 200);
      assert.ok(sseRes.body);
      sseReader = sseRes.body.getReader();

      await readUntilEventCount(sseReader, "daily_summary", 1);
      const dailySummaryPromise = readUntilEventCount(sseReader, "daily_summary", 1);

      const form = new FormData();
      form.append("message", "我吃了優格");

      const chatRes = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, Accept: "text/event-stream" },
        body: form,
      });
      assert.equal(chatRes.status, 200);
      assert.ok(chatRes.body);

      chatReader = chatRes.body.getReader();
      const chatDoneEvent = await readUntilEventCount(chatReader, "done", 1);
      const dailySummaryEvent = await dailySummaryPromise;

      assert.ok(
        dailySummaryEvent.observedAt >= chatDoneEvent.observedAt,
        `daily_summary observed at ${dailySummaryEvent.observedAt}, before chat done at ${chatDoneEvent.observedAt}`,
      );

      const doneFrame = parseSSEEvents(chatDoneEvent.raw).find((frame) => frame.event === "done");
      assert.ok(doneFrame);
      const donePayload = JSON.parse(doneFrame.data) as { didLogMeal: boolean; dailySummary?: { mealCount: number } };
      assert.equal(donePayload.didLogMeal, true);
      assert.equal(donePayload.dailySummary?.mealCount, 1);
    } finally {
      clearTimeout(timeout);
      await chatReader?.cancel().catch(() => {});
      await sseReader?.cancel().catch(() => {});
      sseController.abort();
    }
  });

  it("POST /api/chat JSON body returns 401 when x-device-id header is missing", async () => {
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "test" }),
    });

    assert.equal(res.status, 401);
  });

  it("POST /api/chat multipart returns 401 when x-device-id header is missing", async () => {
    const form = new FormData();
    form.append("message", "test");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      body: form,
    });

    assert.equal(res.status, 401);
  });

  it("GET /api/chat/history returns 401 with invalid (non-existent) device id", async () => {
    const res = await fetch(`${address}/api/chat/history?limit=10`, {
      headers: { "x-device-id": "non-existent-id" },
    });

    assert.equal(res.status, 401);
  });

  it("GET /api/sse returns 401 with invalid device id via query param", async () => {
    const res = await fetch(`${address}/api/sse?deviceId=non-existent-id`);

    assert.equal(res.status, 401);
  });
});
