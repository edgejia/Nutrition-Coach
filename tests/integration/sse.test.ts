process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { buildApp, type AppServices } from "../../server/app.js";
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

function toNamedCookieHeader(res: Awaited<ReturnType<FastifyInstance["inject"]>>, name: string) {
  const cookie = getSetCookieHeaders(res).find((value) => value.startsWith(`${name}=`));
  assert.ok(cookie, `expected ${name} cookie`);
  return cookie.split(";", 1)[0]!;
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

function observabilityEvents(logLines: string[], eventName: string) {
  return parseLogLines(logLines).filter((record) => record.event === eventName);
}

function assertLogEventApplicationKeys(event: Record<string, unknown>, allowedKeys: readonly string[]) {
  const pinoKeys = new Set(["level", "time", "pid", "hostname", "msg", "reqId"]);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(event)) {
    assert.ok(pinoKeys.has(key) || allowed.has(key), `expected ${event.event} event to exclude metadata key ${key}`);
  }
}

function assertLogEventsExclude(events: readonly Record<string, unknown>[], forbiddenValues: readonly string[]) {
  const serialized = events.map((event) => JSON.stringify(event)).join("\n");
  for (const value of forbiddenValues) {
    assert.ok(!serialized.includes(value), `expected logs to exclude ${value}`);
  }
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

async function readSSEFrames(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expectedEvent: string,
  expectedCount: number,
  maxReads = 20,
): Promise<SSEFrame[]> {
  const decoder = new TextDecoder();
  let raw = "";

  for (let i = 0; i < maxReads; i += 1) {
    const chunk = await reader.read();
    if (chunk.value) {
      raw += decoder.decode(chunk.value, { stream: !chunk.done });
    }
    const frames = parseSSEFrames(raw).filter((candidate) => candidate.event === expectedEvent);
    if (frames.length >= expectedCount) {
      return frames;
    }
    if (chunk.done) break;
  }

  throw new Error(`Expected ${expectedCount} SSE event(s) ${expectedEvent}, got ${raw}`);
}

function assertInitialDailySummaryEnvelope(frame: SSEFrame) {
  const payload = JSON.parse(frame.data) as Record<string, unknown>;

  assert.deepEqual(Object.keys(payload).sort(), ["affectedDate", "source", "summary"].sort());
  assert.equal(payload.source, "initial");
  assert.equal(typeof payload.affectedDate, "string");

  assert.ok(payload.summary && typeof payload.summary === "object" && !Array.isArray(payload.summary));
  const summary = payload.summary as Record<string, unknown>;
  assert.equal(payload.affectedDate, summary.date);
  assert.match(summary.date as string, /^\d{4}-\d{2}-\d{2}$/);
  for (const field of ["totalCalories", "totalProtein", "totalCarbs", "totalFat", "mealCount"]) {
    assert.equal(typeof summary[field], "number", `Expected summary.${field} to be numeric`);
  }
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
  let deviceId: string;
  let services: AppServices;

  beforeEach(async () => {
    mockLLM = new MockLLMProvider();
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: mockLLM,
      onServicesReady: (readyServices) => {
        services = readyServices;
      },
    });
    const res = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    deviceId = res.json().deviceId as string;
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

  it("GET /api/sse rejects valid-cookie raw selectors before hijack with metadata-only events", async () => {
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
      const res = await fetch(`${address}/api/sse?deviceId=${encodeURIComponent(logDeviceId)}`, {
        headers: { cookie: logCookieHeader, "x-device-id": logDeviceId },
        signal: controller.signal,
      });

      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: "Raw device selector is not allowed" });
      assert.equal(res.headers.get("content-type")?.includes("text/event-stream"), false);
      reader = res.body?.getReader();

      const ownershipEvents = observabilityEvents(logLines, "ownership_bypass_blocked");
      assert.equal(ownershipEvents.length, 1);
      assert.deepEqual(
        {
          event: ownershipEvents[0]!.event,
          reason: ownershipEvents[0]!.reason,
          route: ownershipEvents[0]!.route,
          operation: ownershipEvents[0]!.operation,
        },
        {
          event: "ownership_bypass_blocked",
          reason: "raw_device_id_param",
          route: "api_sse",
          operation: "sse_subscribe",
        },
      );
      assertLogEventApplicationKeys(ownershipEvents[0]!, ["event", "reason", "route", "operation", "requestId"]);
      assertLogEventsExclude(
        [ownershipEvents[0]!],
        [logDeviceId, "x-device-id", "deviceId", "guest_session", "guest_session_resume", "cookie"],
      );
      assert.equal(sseStateEvents(logLines).some((event) => event.state === "opened"), false);
    } finally {
      await reader?.cancel().catch(() => {});
      controller.abort();
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
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      timeout = setTimeout(() => controller.abort(), 1000);
      const res = await fetch(`${address}/api/sse`, {
        headers: { cookie: sessionCookieHeader },
        signal: controller.signal,
      });
      if (timeout) clearTimeout(timeout);
      assert.equal(res.headers.get("content-type"), "text/event-stream");
      reader = res.body?.getReader();
      assert.ok(reader);
      const firstChunk = await reader.read();
      const text = new TextDecoder().decode(firstChunk.value);
      assert.match(text, /event: daily_summary/);
      assert.match(text, /data: /);
      const initialFrame = parseSSEFrames(text).find((frame) => frame.event === "daily_summary");
      assert.ok(initialFrame);
      assertInitialDailySummaryEnvelope(initialFrame);
      controller.abort();
    } finally {
      if (timeout) clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      controller.abort();
      if (app.server.listening) {
        await app.close();
      }
    }
  });

  it("GET /api/sse refreshes cookies from a resume cookie before manual writeHead", async () => {
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
    const resumeCookieHeader = toNamedCookieHeader(deviceRes, "guest_session_resume");
    const address = await logApp.listen({ port: 0 });
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/sse`, {
        headers: { cookie: resumeCookieHeader },
        signal: controller.signal,
      });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/event-stream");
      const setCookie = res.headers.get("set-cookie") ?? "";
      assert.match(setCookie, /guest_session=/);
      assert.match(setCookie, /guest_session_resume=/);

      reader = res.body?.getReader();
      assert.ok(reader);
      const frame = await readSSEFrame(reader, "daily_summary");
      assertInitialDailySummaryEnvelope(frame);
      await waitForSseState(logLines, "opened");

      await reader.cancel();
      controller.abort();
      await waitForSseState(logLines, "closed");
    } finally {
      await reader?.cancel().catch(() => {});
      controller.abort();
      await logApp.close();
    }
  });

  it("subscribes before the initial daily_summary so pending connection mutations are not dropped", async () => {
    const originalGetDailySummary = services.summaryService.getDailySummary.bind(services.summaryService);
    let markSummaryRequested!: () => void;
    let releaseSummary!: () => void;
    const summaryRequested = new Promise<void>((resolve) => {
      markSummaryRequested = resolve;
    });
    const summaryReleased = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    services.summaryService.getDailySummary = async (...args) => {
      markSummaryRequested();
      await summaryReleased;
      return originalGetDailySummary(...args);
    };

    const address = await app.listen({ port: 0 });
    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      timeout = setTimeout(() => controller.abort(), 3000);
      const sseResPromise = fetch(`${address}/api/sse`, {
        headers: { cookie: sessionCookieHeader },
        signal: controller.signal,
      });

      await summaryRequested;
      const mutationSummary = {
        date: "2026-05-18",
        totalCalories: 95,
        totalProtein: 0.5,
        totalCarbs: 25,
        totalFat: 0.3,
        mealCount: 1,
      };
      services.publisher.publishDailySummary(deviceId, {
        summary: mutationSummary,
        affectedDate: mutationSummary.date,
        source: "meal_mutation",
      });
      releaseSummary();

      const sseRes = await sseResPromise;
      assert.equal(sseRes.status, 200);
      reader = sseRes.body?.getReader();
      assert.ok(reader);
      const frames = await readSSEFrames(reader, "daily_summary", 2);
      const payloads = frames.map((frame) => JSON.parse(frame.data) as Record<string, unknown>);

      assert.ok(
        payloads.some((payload) => payload.source === "meal_mutation" && payload.affectedDate === mutationSummary.date),
        `expected pending connection mutation envelope, got ${JSON.stringify(payloads)}`,
      );
      assert.ok(payloads.some((payload) => payload.source === "initial"));
    } finally {
      if (timeout) clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      controller.abort();
      services.summaryService.getDailySummary = originalGetDailySummary;
      if (app.server.listening) {
        await app.close();
      }
    }
  });

  it("does not start keepalive after the client closes during the initial summary load", async () => {
    const originalGetDailySummary = services.summaryService.getDailySummary.bind(services.summaryService);
    const originalSetInterval = globalThis.setInterval;
    const createdKeepalives: unknown[] = [];
    let markSummaryRequested!: () => void;
    let releaseSummary!: () => void;
    const summaryRequested = new Promise<void>((resolve) => {
      markSummaryRequested = resolve;
    });
    const summaryReleased = new Promise<void>((resolve) => {
      releaseSummary = resolve;
    });
    services.summaryService.getDailySummary = async (...args) => {
      markSummaryRequested();
      await summaryReleased;
      return originalGetDailySummary(...args);
    };

    const address = await app.listen({ port: 0 });
    const controller = new AbortController();
    let fetchResult: Promise<Response | undefined> | undefined;

    try {
      fetchResult = fetch(`${address}/api/sse`, {
        headers: { cookie: sessionCookieHeader },
        signal: controller.signal,
      }).catch(() => undefined);
      await summaryRequested;
      controller.abort();
      await new Promise((resolve) => setTimeout(resolve, 50));
      globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        const interval = originalSetInterval(handler, timeout, ...args);
        createdKeepalives.push(interval);
        return interval;
      }) as typeof setInterval;
      releaseSummary();
      await new Promise((resolve) => setTimeout(resolve, 20));
      await fetchResult.catch(() => undefined);

      assert.equal(createdKeepalives.length, 0);
    } finally {
      globalThis.setInterval = originalSetInterval;
      for (const interval of createdKeepalives) {
        clearInterval(interval as ReturnType<typeof setInterval>);
      }
      services.summaryService.getDailySummary = originalGetDailySummary;
      controller.abort();
      await fetchResult?.catch(() => undefined);
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
          arguments: JSON.stringify({ items: [{ food_name: "蘋果", calories: 95, protein: 0.5, carbs: 25, fat: 0.3 }] }),
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
          arguments: JSON.stringify({ items: [{ food_name: "沙拉", calories: 180, protein: 8, carbs: 12, fat: 10 }] }),
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
      const meal = mealsRes.json().meals[0] as { id: string; mealRevisionId: string };

      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 2000);
      const sseRes = await fetch(`${address}/api/sse`, {
        headers: { cookie: sessionCookieHeader },
        signal: controller.signal,
      });
      const reader = sseRes.body?.getReader();
      assert.ok(reader);

      await reader.read(); // initial daily_summary

      await fetch(`${address}/api/meals/${meal.id}`, {
        method: "DELETE",
        headers: { cookie: sessionCookieHeader, "content-type": "application/json" },
        body: JSON.stringify({ expectedMealRevisionId: meal.mealRevisionId }),
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
          arguments: JSON.stringify({ mode: "current_turn_values", calories: 1800, protein: 130 }),
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
