process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { FastifyInstance } from "fastify";

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
    assert.equal(body.reply, "抱歉，目前無法處理您的請求，請稍後再試。");
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
    // Even if the model outputs log_food or get_daily_summary in its reply text,
    // the route must strip them before they reach the client.
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
  });
});
