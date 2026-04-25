process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { FastifyInstance } from "fastify";

interface SSEFrame {
  event: string;
  data: string;
}

function getSetCookieHeaders(res: Awaited<ReturnType<FastifyInstance["inject"]>>) {
  const rawHeader = res.headers["set-cookie"];
  if (Array.isArray(rawHeader)) {
    return rawHeader;
  }
  return typeof rawHeader === "string" ? [rawHeader] : [];
}

function toCookieHeader(res: Awaited<ReturnType<FastifyInstance["inject"]>>) {
  return getSetCookieHeaders(res).map((value) => value.split(";", 1)[0]).join("; ");
}

function parseSSEFrames(raw: string): SSEFrame[] {
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

function createLogCapture() {
  const logLines: string[] = [];
  const stream = new Writable({
    write(chunk, _, cb) {
      chunk.toString().split("\n").filter(Boolean).forEach((line: string) => logLines.push(line));
      cb();
    },
  });

  return { logLines, stream };
}

function parseLogLines(logLines: string[]) {
  const records: Record<string, unknown>[] = [];
  for (const line of logLines) {
    try {
      records.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // Ignore non-JSON logger diagnostics.
    }
  }
  return records;
}

function sseStateEvents(logLines: string[]) {
  return parseLogLines(logLines).filter((record) => record.event === "sse_connection_state");
}

async function waitForSseState(logLines: string[], state: string, timeoutMs = 1000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const event = sseStateEvents(logLines).find((record) => record.state === state);
    if (event) {
      return event;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Expected sse_connection_state ${state}, got ${JSON.stringify(sseStateEvents(logLines))}`);
}

async function readSSEFrame(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expectedEvent: string,
  maxReads = 20,
): Promise<SSEFrame> {
  const decoder = new TextDecoder();
  let raw = "";

  for (let i = 0; i < maxReads; i += 1) {
    const chunk = await reader.read();
    if (chunk.value) {
      raw += decoder.decode(chunk.value, { stream: !chunk.done });
    }
    const frame = parseSSEFrames(raw).find((candidate) => candidate.event === expectedEvent);
    if (frame) {
      return frame;
    }
    if (chunk.done) break;
  }

  throw new Error(`Expected SSE event ${expectedEvent}, got ${raw}`);
}

async function readOptionalSSEChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<string | null> {
  const decoder = new TextDecoder();
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const read = reader.read().then((chunk) => chunk.value ? decoder.decode(chunk.value) : "");
  return Promise.race([read, timeout]);
}

describe("SSE API", () => {
  let app: FastifyInstance;
  let mockLLM: MockLLMProvider;
  let sessionCookieHeader: string;

  beforeEach(async () => {
    mockLLM = new MockLLMProvider();
    app = await buildApp({ dbPath: ":memory:", llmProvider: mockLLM });
    const res = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    sessionCookieHeader = toCookieHeader(res);
  });

  afterEach(async () => {
    if (app.server.listening) {
      await app.close();
    }
  });

  it("GET /api/sse returns 401 without a guest session", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/sse",
    });
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { error: "Guest session required" });
  });

  it("logs rejected SSE connection state without device identifiers", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      logger: { level: "info", stream: logStream },
    });
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logDeviceId = deviceRes.json().deviceId as string;

    try {
      const res = await logApp.inject({
        method: "GET",
        url: "/api/sse",
      });

      assert.equal(res.statusCode, 401);
      const events = sseStateEvents(logLines);
      assert.deepEqual(events.map((event) => event.state), ["rejected"]);
      assert.ok(!JSON.stringify(parseLogLines(logLines)).includes(logDeviceId));
    } finally {
      await logApp.close();
    }
  });

  it("logs opened and closed SSE states while preserving the initial daily_summary frame", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      logger: { level: "info", stream: logStream },
    });
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logDeviceId = deviceRes.json().deviceId as string;
    const logCookieHeader = toCookieHeader(deviceRes);
    const address = await logApp.listen({ port: 0 });
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/sse`, {
        headers: { cookie: logCookieHeader },
        signal: controller.signal,
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/event-stream");
      reader = res.body?.getReader();
      assert.ok(reader);

      const frame = await readSSEFrame(reader, "daily_summary");
      assert.match(frame.data, /"date":"\d{4}-\d{2}-\d{2}"/);
      await waitForSseState(logLines, "opened");

      await reader.cancel();
      controller.abort();
      await waitForSseState(logLines, "closed");

      const states = sseStateEvents(logLines).map((event) => event.state);
      assert.deepEqual(states, ["opened", "closed"]);
      assert.ok(!JSON.stringify(parseLogLines(logLines)).includes(logDeviceId));
    } finally {
      await reader?.cancel().catch(() => {});
      controller.abort();
      await logApp.close();
    }
  });

  it("GET /api/sse accepts cookie-backed guest sessions for EventSource", async () => {
    // Use a real HTTP request since hijack() bypasses inject() response collection
    const address = await app.listen({ port: 0 });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 1000);
      const res = await fetch(`${address}/api/sse`, {
        headers: { cookie: sessionCookieHeader },
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
      const sseRes = await fetch(`${address}/api/sse`, {
        headers: { cookie: sessionCookieHeader },
        signal: controller.signal,
      });
      const reader = sseRes.body?.getReader();
      assert.ok(reader);

      await reader.read(); // initial daily_summary

      const form = new FormData();
      form.append("message", "我吃了蘋果");
      await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader },
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
        headers: { cookie: sessionCookieHeader },
        body: form,
      });

      const mealsRes = await app.inject({
        method: "GET",
        url: "/api/meals",
        headers: { cookie: sessionCookieHeader },
      });
      const mealId = mealsRes.json().meals[0].id as string;

      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 2000);
      const sseRes = await fetch(`${address}/api/sse`, {
        headers: { cookie: sessionCookieHeader },
        signal: controller.signal,
      });
      const reader = sseRes.body?.getReader();
      assert.ok(reader);

      await reader.read(); // initial daily_summary

      await fetch(`${address}/api/meals/${mealId}`, {
        method: "DELETE",
        headers: { cookie: sessionCookieHeader },
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

  it("GET /api/sse emits goals_update after a successful chat goal mutation", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_sse",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 1800, protein: 130 }),
        },
      }],
    });
    mockLLM.queueChatResponse({
      content: "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g",
    });

    const address = await app.listen({ port: 0 });
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 3000);
      const sseRes = await fetch(`${address}/api/sse`, {
        headers: { cookie: sessionCookieHeader },
        signal: controller.signal,
      });
      reader = sseRes.body?.getReader();
      assert.ok(reader);

      await readSSEFrame(reader, "daily_summary");

      const form = new FormData();
      form.append("message", "卡路里改成 1800，蛋白質 130 克");
      const chatRes = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader },
        body: form,
      });
      assert.equal(chatRes.status, 200);

      const goalsFrame = await readSSEFrame(reader, "goals_update");
      const payload = JSON.parse(goalsFrame.data) as {
        targets: { calories: number; protein: number; carbs: number; fat: number };
      };
      assert.deepEqual(payload, {
        targets: {
          calories: 1800,
          protein: 130,
          carbs: 150,
          fat: 50,
        },
      });

      const extraChunk = await readOptionalSSEChunk(reader, 100);
      if (extraChunk) {
        assert.doesNotMatch(extraChunk, /event: daily_summary/);
      }
      controller.abort();
    } finally {
      if (timeout) clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      if (app.server.listening) {
        await app.close();
      }
    }
  });
});
