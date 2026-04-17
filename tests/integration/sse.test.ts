process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { FastifyInstance } from "fastify";

describe("SSE API", () => {
  let app: FastifyInstance;
  let mockLLM: MockLLMProvider;
  let deviceId: string;

  beforeEach(async () => {
    mockLLM = new MockLLMProvider();
    app = await buildApp({ dbPath: ":memory:", llmProvider: mockLLM });
    const res = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    deviceId = res.json().deviceId;
  });

  afterEach(async () => {
    if (app.server.listening) {
      await app.close();
    }
  });

  it("GET /api/sse returns 401 without device id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sse",
    });
    assert.equal(res.statusCode, 401);
  });

  it("GET /api/sse accepts the EventSource query-param fallback", async () => {
    // Use a real HTTP request since hijack() bypasses inject() response collection
    const address = await app.listen({ port: 0 });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 1000);
      const res = await fetch(`${address}/api/sse?deviceId=${deviceId}`, {
        signal: controller.signal,
      });
      if (timeout) clearTimeout(timeout);
      assert.equal(res.headers.get("content-type"), "text/event-stream");
      const reader = res.body?.getReader();
      assert.ok(reader);
      const firstChunk = await reader.read();
      const text = new TextDecoder().decode(firstChunk.value);
      assert.match(text, /event: daily_summary/);
      assert.match(text, /data: /);
      // SUM-01: initial daily_summary payload carries date YYYY-MM-DD
      assert.match(text, /"date":"\d{4}-\d{2}-\d{2}"/);
      controller.abort();
    } finally {
      if (timeout) clearTimeout(timeout);
      if (app.server.listening) {
        await app.close();
      }
    }
  });

  it("GET /api/sse receives another daily_summary after log_food succeeds", async () => {
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
    mockLLM.queueChatResponse({ content: "已記錄！" });

    const address = await app.listen({ port: 0 });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 2000);
      const sseRes = await fetch(`${address}/api/sse?deviceId=${deviceId}`, {
        signal: controller.signal,
      });
      const reader = sseRes.body?.getReader();
      assert.ok(reader);

      await reader.read(); // initial daily_summary

      const form = new FormData();
      form.append("message", "我吃了蘋果");
      await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId },
        body: form,
      });

      const secondChunk = await reader.read();
      const text = new TextDecoder().decode(secondChunk.value);
      assert.match(text, /event: daily_summary/);
      // SUM-01: post-log daily_summary payload carries date YYYY-MM-DD
      assert.match(text, /"date":"\d{4}-\d{2}-\d{2}"/);
      controller.abort();
    } finally {
      if (timeout) clearTimeout(timeout);
      if (app.server.listening) {
        await app.close();
      }
    }
  });

  it('after deleting a meal over HTTP, SSE emits a daily_summary payload containing "mealCount":0', async () => {
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
    mockLLM.queueChatResponse({ content: "已記錄！" });

    const address = await app.listen({ port: 0 });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const form = new FormData();
      form.append("message", "這是我的午餐");
      await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId },
        body: form,
      });

      const mealsRes = await app.inject({
        method: "GET",
        url: "/api/meals",
        headers: { "x-device-id": deviceId },
      });
      const mealId = mealsRes.json().meals[0].id as string;

      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 2000);
      const sseRes = await fetch(`${address}/api/sse?deviceId=${deviceId}`, {
        signal: controller.signal,
      });
      const reader = sseRes.body?.getReader();
      assert.ok(reader);

      await reader.read(); // initial daily_summary

      await fetch(`${address}/api/meals/${mealId}`, {
        method: "DELETE",
        headers: { "x-device-id": deviceId },
      });

      const secondChunk = await reader.read();
      const text = new TextDecoder().decode(secondChunk.value);
      assert.match(text, /event: daily_summary/);
      assert.match(text, /"mealCount":0/);
      // SUM-01: post-delete daily_summary payload carries date YYYY-MM-DD
      assert.match(text, /"date":"\d{4}-\d{2}-\d{2}"/);
      controller.abort();
    } finally {
      if (timeout) clearTimeout(timeout);
      if (app.server.listening) {
        await app.close();
      }
    }
  });
});
