process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../server/app.js";
import type { FastifyInstance } from "fastify";
import type { ChatMessage, LLMProvider, LLMResponse, LLMRoundResult, ToolCall, ToolDefinition } from "../../server/llm/types.js";

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

  queueRoundError(error: Error) {
    this.roundQueue.push(error);
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

function createLogFoodToolCall(): ToolCall {
  return {
    id: "call_1",
    type: "function",
    function: {
      name: "log_food",
      arguments: JSON.stringify({
        food_name: "蘋果",
        calories: 95,
        protein: 0.5,
        carbs: 25,
        fat: 0.3,
      }),
    },
  };
}

function createLogFoodToolCallWithArguments(argumentsText: string): ToolCall {
  return {
    id: "call_invalid",
    type: "function",
    function: {
      name: "log_food",
      arguments: argumentsText,
    },
  };
}

function createUpdateGoalsToolCall(): ToolCall {
  return {
    id: "goal_stream",
    type: "function",
    function: {
      name: "update_goals",
      arguments: JSON.stringify({ calories: 1800, protein: 130 }),
    },
  };
}

async function readStreamUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  expectedText: string,
  maxReads = 20,
): Promise<string> {
  const decoder = new TextDecoder();
  let combined = "";

  for (let index = 0; index < maxReads; index += 1) {
    const chunk = await reader.read();
    if (chunk.value) {
      combined += decoder.decode(chunk.value, { stream: !chunk.done });
    }
    if (combined.includes(expectedText)) {
      return combined;
    }
    if (chunk.done) {
      break;
    }
  }

  return combined;
}

function parseSSEEvents(body: string): Array<{ event: string; data: string }> {
  return body
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      const event = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length) ?? "";
      const data = lines.find((line) => line.startsWith("data: "))?.slice("data: ".length) ?? "";
      return { event, data };
    });
}

describe("chat-streaming", () => {
  let app: FastifyInstance;
  let mockLLM: StreamingLLMProvider;
  let deviceId: string;
  let address: string;

  beforeEach(async () => {
    mockLLM = new StreamingLLMProvider();
    app = await buildApp({ dbPath: ":memory:", llmProvider: mockLLM });

    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    deviceId = res.json().deviceId;
    address = await app.listen({ port: 0 });
  });

  afterEach(async () => {
    if (app.server.listening) {
      await app.close();
    }
  });

  it("POST /api/chat returns content-type: text/event-stream", async () => {
    mockLLM.queueChatStream(["直接", "回覆"]);

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (app.server.listening) {
        await app.close();
      }
    }
  });

  it("POST /api/chat stream includes event: chunk", async () => {
    mockLLM.queueChatStream(["直接", "回覆"]);

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      const reader = res.body?.getReader();
      assert.ok(reader);

      const text = await readStreamUntil(reader, "event: chunk");
      assert.match(text, /event: chunk/);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (app.server.listening) {
        await app.close();
      }
    }
  });

  it("POST /api/chat stream ends with event: done", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createLogFoodToolCall()] });
    mockLLM.queueChatStream(["測試", "回覆"]);

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      const reader = res.body?.getReader();
      assert.ok(reader);

      const text = await readStreamUntil(reader, "event: done");
      assert.match(text, /event: done/);

      const doneDataMatch = text.match(/event: done\s+data: (.+)\s*/);
      assert.ok(doneDataMatch);
      assert.doesNotThrow(() => JSON.parse(doneDataMatch[1]));

      const historyRes = await fetch(`${address}/api/chat/history?limit=5`, {
        headers: { "x-device-id": deviceId },
      });
      assert.equal(historyRes.status, 200);
      const historyJson = await historyRes.json();
      assert.equal(historyJson.messages.at(-1)?.role, "assistant");
      assert.equal(historyJson.messages.at(-1)?.content, "測試回覆");
    } finally {
      if (timeout) clearTimeout(timeout);
      if (app.server.listening) {
        await app.close();
      }
    }
  });

  it("POST /api/chat stream done includes dailyTargets after update_goals succeeds", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createUpdateGoalsToolCall()] });
    mockLLM.queueChatStream(["已經", "更新好了"]);

    const form = new FormData();
    form.append("message", "卡路里改成 1800，蛋白質 130 克");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");
      const doneDataMatch = text.match(/event: done\s+data: (.+)\s*/);
      assert.ok(doneDataMatch);
      const donePayload = JSON.parse(doneDataMatch[1]) as {
        didLogMeal: boolean;
        dailyTargets?: { calories: number; protein: number; carbs: number; fat: number };
      };
      assert.equal(donePayload.didLogMeal, false);
      assert.deepEqual(donePayload.dailyTargets, {
        calories: 1800,
        protein: 130,
        carbs: 150,
        fat: 50,
      });
      assert.match(text, /已更新每日目標/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat stream response includes CORS header", async () => {
    mockLLM.queueChatStream(["直接", "回覆"]);

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.notEqual(res.headers.get("access-control-allow-origin"), null);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (app.server.listening) {
        await app.close();
      }
    }
  });

  it("POST /api/chat stream includes event: status with 分析圖片中 when image is present", async () => {
    mockLLM.queueChatStream(["回覆"]);

    const form = new FormData();
    form.append("message", "這是什麼食物");
    const jpegBytes = new Uint8Array([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      ...new Array(50).fill(0x00),
    ]);
    form.append("image", new Blob([jpegBytes], { type: "image/jpeg" }), "food.jpg");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);

      reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");

      assert.match(text, /event: status/);
      assert.match(text, /分析圖片中/);
    } finally {
      clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      controller.abort();
    }
  });

  it("POST /api/chat stream includes event: status with 記錄餐點中 when didLogMeal is true", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createLogFoodToolCall()] });
    mockLLM.queueChatStream(["餐點已記錄，繼續保持！"]);

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);

      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");

      assert.match(text, /event: status/);
      assert.match(text, /記錄餐點中/);
      assert.match(text, /event: done/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat with SSE accept header shows 分析圖片中 before first chunk", async () => {
    // D-03: 分析圖片中 must appear before the first chunk token
    mockLLM.queueChatStream(["回覆文字"]);

    const form = new FormData();
    form.append("message", "這是什麼食物");
    const jpegBytes = new Uint8Array([
      0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
      0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
      ...new Array(50).fill(0x00),
    ]);
    form.append("image", new Blob([jpegBytes], { type: "image/jpeg" }), "food.jpg");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");

      // status event must appear before the first chunk
      const statusPos = text.indexOf("分析圖片中");
      const chunkPos = text.indexOf("event: chunk");
      assert.ok(statusPos !== -1, "expected 分析圖片中 in stream");
      assert.ok(chunkPos !== -1, "expected event: chunk in stream");
      assert.ok(statusPos < chunkPos, "分析圖片中 must appear before first event: chunk");
    } finally {
      clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      controller.abort();
    }
  });

  it("POST /api/chat with SSE accept header sanitizes raw tool names in streamed reply", async () => {
    mockLLM.queueChatStream([
      "我可以幫你",
      "計算並log",
      "_food，接著",
      "再get_daily_",
      "summary後回答",
    ]);

    const form = new FormData();
    form.append("message", "記錄午餐");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");
      const events = parseSSEEvents(text);
      const chunkEvents = events.filter((event) => event.event === "chunk");
      const doneEvents = events.filter((event) => event.event === "done");
      const combinedChunkText = chunkEvents
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");

      assert.doesNotMatch(text, /log_food/, "log_food must not appear in SSE stream");
      assert.doesNotMatch(text, /get_daily_summary/, "get_daily_summary must not appear in SSE stream");
      assert.ok(chunkEvents.length >= 2, "expected multiple progressive chunk events before done");
      assert.equal(doneEvents.length, 1, "expected a single done event");
      assert.match(combinedChunkText, /完成記錄/);
      assert.match(combinedChunkText, /查詢今日攝取/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat with SSE accept header bridges non-stream reply into chunk and done events", async () => {
    // When the provider returns a plain { reply } instead of a streamGenerator,
    // the route must still emit event: chunk + event: done so sendMessageStream() works.
    // Use queueRoundResponse so chatRound() returns a non-stream response (chatQueue
    // is only consumed by chat(); chatRound() uses its own roundQueue).
    mockLLM.queueRoundResponse({ content: "純文字回覆" });

    const form = new FormData();
    form.append("message", "你好");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.match(res.headers.get("content-type") ?? "", /text\/event-stream/);
      assert.ok(res.body);

      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");

      assert.match(text, /event: chunk/, "expected event: chunk for bridged non-stream reply");
      assert.match(text, /event: done/, "expected event: done");

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { "x-device-id": deviceId },
      });
      assert.equal(historyRes.status, 200);
      const historyJson = await historyRes.json() as {
        messages: Array<{ role: string; content: string }>;
      };
      const assistantMessages = historyJson.messages.filter((message) => message.role === "assistant");

      const chunkMatch = text.match(/event: chunk\s+data: (.+)/);
      assert.ok(chunkMatch, "expected chunk data line");
      const chunkData = JSON.parse(chunkMatch[1]) as { token: string };
      assert.equal(chunkData.token, "純文字回覆");
      assert.equal(assistantMessages.length, 1, "fallback SSE must persist the assistant reply exactly once");
      assert.equal(assistantMessages[0]?.content, "純文字回覆");
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat hallucinationGuard truncates stream on 方式1/方式2 pattern and writes retry-prompt to history", async () => {
    mockLLM.queueChatStream([
      "我提供",
      "方式1 直接依照片估算記錄\n",
      "方式2 請補充份量後再記錄",
    ]);

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");

      assert.doesNotMatch(text, /方式1 直接依照片估算記錄/);
      assert.doesNotMatch(text, /方式2 請補充份量後再記錄/);
      assert.match(text, /無法辨識這次的請求/);

      const doneMatch = text.match(/event: done\s+data: (.+)/);
      assert.ok(doneMatch, "expected done event");
      const donePayload = JSON.parse(doneMatch[1]) as { didLogMeal: boolean };
      assert.equal(donePayload.didLogMeal, false);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { "x-device-id": deviceId },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((m) => m.role === "assistant");
      assert.equal(assistantMsgs.length, 1, "exactly one assistant reply expected");
      assert.match(assistantMsgs[0]!.content, /無法辨識這次的請求/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat hallucinationGuard does not trigger on normal stream", async () => {
    mockLLM.queueChatStream(["豬肉飯", " 680 kcal", "，已記錄"]);

    const form = new FormData();
    form.append("message", "記錄午餐");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");
      const events = parseSSEEvents(text);
      const combinedChunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");

      assert.match(combinedChunkText, /豬肉飯/);
      assert.match(combinedChunkText, /680 kcal/);
      assert.match(text, /event: done/);
      assert.doesNotMatch(text, /無法辨識這次的請求/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat catch block writes unified fallback to history when orchestrator throws", async () => {
    mockLLM.queueRoundError(new Error("Vision API timeout"));

    const form = new FormData();
    form.append("message", "記錄午餐");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");
      const events = parseSSEEvents(text);
      const combinedChunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");

      assert.match(text, /event: done/);
      assert.match(combinedChunkText, /抱歉|無法/, "live SSE path must surface the fallback reply before done");

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { "x-device-id": deviceId },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((m) => m.role === "assistant");
      assert.equal(assistantMsgs.length, 1, "catch block must write exactly one assistant fallback");
      assert.match(assistantMsgs[0]!.content, /抱歉|無法/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat treats invalid log_food JSON as fatal and writes unified route fallback", async () => {
    mockLLM.queueRoundResponse({
      toolCalls: [createLogFoodToolCallWithArguments("{bad json")],
    });

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");

      assert.match(text, /event: done/);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { "x-device-id": deviceId },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((m) => m.role === "assistant");
      assert.equal(assistantMsgs.length, 1, "invalid log_food JSON must write exactly one route fallback");
      assert.match(assistantMsgs[0]!.content, /這次無法完成請求/);
      assert.doesNotMatch(assistantMsgs[0]!.content, /log_food|FatalToolError|bad json/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat treats invalid log_food required fields as fatal and writes unified route fallback", async () => {
    mockLLM.queueRoundResponse({
      toolCalls: [createLogFoodToolCallWithArguments(JSON.stringify({
        food_name: {},
        calories: null,
        protein: "",
        carbs: null,
        fat: null,
      }))],
    });

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");

      assert.match(text, /event: done/);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { "x-device-id": deviceId },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((m) => m.role === "assistant");
      assert.equal(assistantMsgs.length, 1, "invalid log_food fields must write exactly one route fallback");
      assert.match(assistantMsgs[0]!.content, /這次無法完成請求/);
      assert.doesNotMatch(assistantMsgs[0]!.content, /log_food|FatalToolError|object|null/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat D-09: when log_food succeeds but chatRound final-reply throws, meal is kept and partial-success fallback written to history", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createLogFoodToolCall()] });
    mockLLM.queueRoundError(new Error("LLM reply generation failed"));

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");

      assert.match(text, /event: done/);
      const doneMatch = text.match(/event: done\s+data: (.+)/);
      assert.ok(doneMatch);
      const donePayload = JSON.parse(doneMatch[1]) as { didLogMeal?: boolean; dailySummary?: { date?: string } };
      assert.equal(donePayload.didLogMeal, true, "D-09: didLogMeal must remain true after log_food succeeded");
      assert.ok(donePayload.dailySummary, "D-09: dailySummary must be preserved after log_food succeeded");
      assert.match(
        donePayload.dailySummary?.date ?? "",
        /^\d{4}-\d{2}-\d{2}$/,
        "D-09 partial-success: dailySummary.date must survive final-reply failure",
      );

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { "x-device-id": deviceId },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((m) => m.role === "assistant");
      assert.equal(assistantMsgs.length, 1, "D-10 invariant: exactly one assistant reply per user message");
      assert.match(
        assistantMsgs[0]!.content,
        /已完成記錄，但回覆生成失敗/,
        "D-09 must use the partial-success fallback, not the generic route catch fallback",
      );

      const mealsRes = await fetch(`${address}/api/meals`, {
        headers: { "x-device-id": deviceId },
      });
      const mealsJson = await mealsRes.json() as { meals: Array<{ foodName: string }> };
      assert.ok(mealsJson.meals.some((m) => m.foodName === "蘋果"), "meal must be kept even when final reply fails");
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat D-09: when streamed final reply throws after log_food, meal state is preserved", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createLogFoodToolCall()] });
    mockLLM.queueChatStreamError(["已"], new Error("stream interrupted after log_food"));

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");

      const doneMatch = text.match(/event: done\s+data: (.+)/);
      assert.ok(doneMatch);
      const donePayload = JSON.parse(doneMatch[1]) as { didLogMeal?: boolean; dailySummary?: { date?: string } };
      assert.equal(donePayload.didLogMeal, true, "stream failure after log_food must preserve didLogMeal");
      assert.ok(donePayload.dailySummary, "stream failure after log_food must preserve dailySummary");
      assert.match(
        donePayload.dailySummary?.date ?? "",
        /^\d{4}-\d{2}-\d{2}$/,
        "stream failure after log_food must preserve dailySummary.date",
      );

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { "x-device-id": deviceId },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((m) => m.role === "assistant");
      assert.equal(assistantMsgs.length, 1, "D-10 invariant: exactly one assistant reply per user message");
      assert.match(assistantMsgs[0]!.content, /已完成記錄，但回覆生成失敗/);
    } finally {
      clearTimeout(timeout);
    }
  });
});
