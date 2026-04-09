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
}

async function* streamTokens(tokens: string[]): AsyncGenerator<string> {
  for (const token of tokens) {
    yield token;
  }
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
        headers: { "x-device-id": deviceId },
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
        headers: { "x-device-id": deviceId },
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
        headers: { "x-device-id": deviceId },
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
        headers: { "x-device-id": deviceId },
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

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);

      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");

      assert.match(text, /event: status/);
      assert.match(text, /分析圖片中/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat stream includes event: status with 記錄餐點中 when didLogMeal is true", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createLogFoodToolCall()] });
    mockLLM.queueChatStream(["餐點已記錄，繼續保持！"]);

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { "x-device-id": deviceId },
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
});
