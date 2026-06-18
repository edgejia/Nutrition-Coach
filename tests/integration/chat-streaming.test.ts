process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { buildApp } from "../../server/app.js";
import type { AppServices } from "../../server/app.js";
import { LLMProviderError } from "../../server/llm/errors.js";
import { formatLocalDate } from "../../server/lib/time.js";
import { createLlmTraceRecorder } from "../../server/orchestrator/llm-trace.js";
import { renderMealNumericAuthorityFailureCopy } from "../../server/orchestrator/mutation-receipts.js";
import type { SummaryOutcome } from "../../server/services/summary-outcome.js";
import type { FastifyInstance } from "fastify";
import type {
  ChatMessage,
  GenerateObjectRequest,
  GenerateObjectResult,
  LLMProvider,
  LLMResponse,
  LLMRoundResult,
  ProviderErrorMetadata,
  ToolCall,
  ToolDefinition,
} from "../../server/llm/types.js";
import { validJpegBytes, validPngBytes } from "../fixtures/image-bytes.js";

type LLMCallOptions = { signal?: AbortSignal };
type RoundQueueItem = LLMRoundResult | Error | ((opts?: LLMCallOptions) => LLMRoundResult);

class StreamingLLMProvider implements LLMProvider {
  private chatQueue: Array<LLMResponse | Error> = [];
  private roundQueue: Array<RoundQueueItem> = [];
  private callIndex = 0;
  public chatCalls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];
  public lastSignal: AbortSignal | undefined;
  public abortObserved: Promise<void> = Promise.resolve();

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

  queueAbortableChatStream(tokens: string[]) {
    let resolveAbort: () => void = () => {};
    this.abortObserved = new Promise<void>((resolve) => {
      resolveAbort = resolve;
    });
    this.roundQueue.push((opts?: LLMCallOptions) => {
      this.lastSignal = opts?.signal;
      return {
        kind: "stream",
        streamGenerator: streamTokensUntilAbort(tokens, opts?.signal, resolveAbort),
      };
    });
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

  async chatRound(
    messages: ChatMessage[],
    tools: ToolDefinition[],
    opts?: LLMCallOptions,
  ): Promise<LLMRoundResult> {
    this.chatCalls.push({ messages, tools });
    const item = this.roundQueue.shift();
    if (item instanceof Error) {
      throw item;
    }
    if (typeof item === "function") {
      return item(opts);
    }
    if (item) {
      return item;
    }
    return { kind: "response", response: { content: "Mock: 已記錄您的飲食！" } };
  }

  async generateObject<T>(
    _messages: ChatMessage[],
    _request: GenerateObjectRequest<T>,
  ): Promise<GenerateObjectResult<T>> {
    throw new Error("generateObject unexpectedly called by this test provider");
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

async function* streamTokensUntilAbort(
  tokens: string[],
  signal: AbortSignal | undefined,
  onAbort: () => void,
): AsyncGenerator<string> {
  const [firstToken, ...remainingTokens] = tokens;
  if (firstToken) {
    yield firstToken;
  }

  if (!signal) {
    return;
  }

  if (!signal.aborted) {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 2_000);
      signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timeout);
          onAbort();
          resolve();
        },
        { once: true },
      );
    });
  } else {
    onAbort();
  }

  if (signal.aborted) {
    return;
  }

  for (const token of remainingTokens) {
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
        items: [
          {
            food_name: "蘋果",
            calories: 95,
            protein: 0.5,
            carbs: 25,
            fat: 0.3,
          },
        ],
      }),
    },
  };
}

function createTrustedLogFoodToolCall(): ToolCall {
  return {
    id: "call_trusted_1",
    type: "function",
    function: {
      name: "log_food",
      arguments: JSON.stringify({
        items: [
          {
            food_name: "雞腿便當",
            calories: 620,
            protein: 30,
            carbs: 70,
            fat: 18,
          },
        ],
        protein_sources: [
          { name: "雞腿", protein: 24, is_primary: true, certainty: "clear" },
          { name: "白飯", protein: 4, is_primary: false, certainty: "clear" },
          { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
        ],
      }),
    },
  };
}

function createGroupedLogFoodToolCall(): ToolCall {
  return {
    id: "call_grouped",
    type: "function",
    function: {
      name: "log_food",
      arguments: JSON.stringify({
        items: [
          {
            food_name: "蘋果",
            calories: 95,
            protein: 0.5,
            carbs: 25,
            fat: 0.3,
          },
          {
            food_name: "優格",
            calories: 120,
            protein: 8,
            carbs: 12,
            fat: 4,
          },
          {
            food_name: "水煮蛋",
            calories: 80,
            protein: 7,
            carbs: 1,
            fat: 5,
          },
        ],
      }),
    },
  };
}

function createFailedRecognitionLogFoodToolCall(id: string): ToolCall {
  return {
    id,
    type: "function",
    function: {
      name: "log_food",
      arguments: JSON.stringify({
        items: [
          {
            food_name: "無法辨識內容",
            calories: 0,
            protein: 0,
            carbs: 0,
            fat: 0,
          },
        ],
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
      arguments: JSON.stringify({ mode: "current_turn_values", calories: 1800, protein: 130 }),
    },
  };
}

function createFindMealsToolCall(action: "update" | "delete", query: string): ToolCall {
  return {
    id: `find_${action}`,
    type: "function",
    function: {
      name: "find_meals",
      arguments: JSON.stringify({ action, query }),
    },
  };
}

function createUpdateMealToolCall(mealId: string): ToolCall {
  return {
    id: "update_meal_1",
    type: "function",
    function: {
      name: "update_meal",
      arguments: JSON.stringify({
        meal_id: mealId,
        food_name: "半碗牛肉麵",
        calories: 360,
        protein: 20,
        carbs: 45,
        fat: 10,
      }),
    },
  };
}

function createProteinUpdateMealToolCall(mealId: string, protein: number): ToolCall {
  return {
    id: "update_meal_protein",
    type: "function",
    function: {
      name: "update_meal",
      arguments: JSON.stringify({
        meal_id: mealId,
        protein,
      }),
    },
  };
}

function createDeleteMealToolCall(mealId: string): ToolCall {
  return {
    id: "delete_meal_1",
    type: "function",
    function: {
      name: "delete_meal",
      arguments: JSON.stringify({ meal_id: mealId }),
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
      // Ignore non-JSON diagnostic output from the logger stream.
    }
  }
  return records;
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

function assertNoSuccessfulLogInternalCopy(text: string) {
  assert.doesNotMatch(text, /log_food|protein_sources|usedConservativeAssumption|quantityUncertaintyReason|missing_quantity/);
}

function assertUnavailableSummaryOutcome(summaryOutcome: SummaryOutcome | undefined) {
  assert.deepEqual(summaryOutcome, { status: "unavailable", reason: "recompute_failed" });
}

function assertNoPublishFailurePayload(payload: unknown) {
  assert.doesNotMatch(JSON.stringify(payload), /publish_failed|summary_publish_failed/);
}

const TERMINAL_CLARIFICATION_SUCCESS_COPY = /已記錄|完成記錄|已更新|已刪除|成功/;
const FAILED_RECOGNITION_NO_SAVE_REPLY = "我沒有把這張照片存成餐點紀錄。請先補充餐點內容和份量，我再幫你估算。";

function assertNoTerminalClarificationDoneSideEffects(payload: {
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  loggedMeal?: unknown;
  dailySummary?: unknown;
  summaryOutcome?: unknown;
}) {
  assert.equal(payload.didLogMeal, false);
  assert.equal(payload.didMutateMeal, false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "loggedMeal"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "dailySummary"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, "summaryOutcome"), false);
}

type MaybeAtomicReceiptChatService = Omit<AppServices["chatService"], "saveAssistantReplyWithReceipt"> & {
  saveAssistantReplyWithReceipt?: (...args: unknown[]) => Promise<unknown>;
};

function jsonForRedactionCheck(value: unknown) {
  return JSON.stringify(value, (_key, nestedValue) =>
    typeof nestedValue === "function" ? "[function]" : nestedValue,
  );
}

function installAtomicReceiptPersistenceFailure(chatService: AppServices["chatService"]) {
  const service = chatService as MaybeAtomicReceiptChatService;
  const original = service.saveAssistantReplyWithReceipt;
  if (typeof original !== "function") {
    return false;
  }

  service.saveAssistantReplyWithReceipt = async (...args: unknown[]) => {
    const serializedArgs = jsonForRedactionCheck(args);
    if (/receipt|mealTransactionId|mealRevisionId/i.test(serializedArgs)) {
      throw new Error("AtomicReceiptPersistenceFailure");
    }
    return original.apply(chatService, args);
  };
  return true;
}

function assertNoReceiptIdentityProjection(payload: unknown, label: string) {
  assert.ok(payload && typeof payload === "object", `${label} must be an object`);
  const objectPayload = payload as Record<string, unknown>;
  const serializedPayload = jsonForRedactionCheck(payload);

  assert.equal(Object.prototype.hasOwnProperty.call(objectPayload, "loggedMeal"), false, `${label} must omit loggedMeal`);
  assert.doesNotMatch(serializedPayload, /"mealId"|"mealRevisionId"|"dateKey"|"deviceId"|"currentRevisionId"/);
  assert.doesNotMatch(serializedPayload, /AtomicReceiptPersistenceFailure|SseReceiptAssistantPersistFailure|raw-provider-body|toolCalls|log_food|protein_sources/);
  assert.doesNotMatch(serializedPayload, /雞腿便當|已幫你記錄雞腿便當|這段不應曝光/);
}

function latestAssistantMessage<T extends { role: string }>(messages: T[]) {
  return messages.filter((message) => message.role === "assistant").at(-1);
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const providerMetadataFixture: ProviderErrorMetadata = {
  provider: "openai",
  operation: "chat",
  model: "gpt-sse-route-fixture",
  aborted: false,
  status: 429,
  providerRequestId: "req_sse_route_fixture",
  errorName: "RateLimitError",
  errorType: "rate_limit_exceeded",
  errorCode: "rate_limit",
};

const canonicalSummaryText = "今天已記錄 2 餐，共 900 kcal：豆腐飯 520 kcal、鮭魚飯 380 kcal。";
const unsafeSummaryFactPattern = /牛肉飯|滷肉飯|豆腐飯 900 kcal/;

describe("chat-streaming", () => {
  let app: FastifyInstance;
  let mockLLM: StreamingLLMProvider;
  let deviceId: string;
  let sessionCookieHeader: string;
  let address: string;
  let tempRoot: string;
  let uploadsDir: string;
  let assetsDir: string;
  let services: AppServices | undefined;
  let traceRecorders: Array<ReturnType<typeof createLlmTraceRecorder>>;
  let logLines: string[];

  function toCookieHeader(rawHeader: string | string[] | undefined) {
    const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
    return values.map((value) => value.split(";", 1)[0]).join("; ");
  }

  beforeEach(async () => {
    mockLLM = new StreamingLLMProvider();
    services = undefined;
    traceRecorders = [];
    tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-chat-streaming-"));
    uploadsDir = path.join(tempRoot, "uploads");
    assetsDir = path.join(tempRoot, "assets");
    const logCapture = createLogCapture();
    logLines = logCapture.logLines;
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: mockLLM,
      uploadsDir,
      assetsDir,
      logger: { level: "info", stream: logCapture.stream },
      onServicesReady: (readyServices) => {
        services = readyServices;
      },
      llmTraceRecorderFactory: () => {
        const recorder = createLlmTraceRecorder();
        traceRecorders.push(recorder);
        return recorder;
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    deviceId = res.json().deviceId;
    sessionCookieHeader = toCookieHeader(res.headers["set-cookie"]);
    address = await app.listen({ port: 0 });
  });

  afterEach(async () => {
    if (app.server.listening) {
      await app.close();
    }
    await rm(tempRoot, { recursive: true, force: true });
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
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
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

  it("POST /api/chat SSE stream records streamed final reply trace and still emits done", async () => {
    mockLLM.queueChatStream(["直接", "回覆"]);

    const form = new FormData();
    form.append("message", "你好");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      assert.match(text, /event: done/);
      assert.equal(traceRecorders.length, 1);

      const trace = traceRecorders[0]!.build({ scenario: "chat-streaming-test", status: "pass" });
      assert.deepEqual(trace.summary.finalReply, {
        source: "model",
        shape: "streamed_text",
      });
      const latencyMs = trace.summary.latencyMs;
      assert.ok(latencyMs !== undefined);
      assert.equal(typeof latencyMs, "number");
      assert.ok(latencyMs >= 0);
      assert.deepEqual(trace.timeline.at(-1), {
        type: "route_completion",
        transport: "sse",
        turnId: JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data).turnId,
        didLogMeal: false,
        didMutateMeal: false,
        completed: true,
      });

      const donePayload = JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data) as { turnId?: string };
      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 1);
      assert.equal(fallbackEvents.length, 0);
      assert.equal(completedEvents[0]!.source, "sse");
      assert.equal(completedEvents[0]!.turnId, donePayload.turnId);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat SSE emits start before any status, chunk, done, or stopped frame and reuses that turnId", async () => {
    mockLLM.queueChatStream(["直接", "回覆"]);

    const form = new FormData();
    form.append("message", "你好");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const events = parseSSEEvents(text);

      assert.equal(events[0]?.event, "start", "first SSE frame must be event: start");
      const startPayload = JSON.parse(events[0]!.data) as { turnId?: string };
      assert.match(startPayload.turnId ?? "", UUID_PATTERN);

      const firstNonStartIndex = events.findIndex((event) =>
        ["status", "chunk", "done", "stopped"].includes(event.event)
      );
      assert.equal(firstNonStartIndex, 1, "no status, chunk, done, or stopped frame may precede start");

      for (const event of events) {
        if (event.event === "status" || event.event === "done" || event.event === "stopped") {
          const payload = JSON.parse(event.data) as { turnId?: string };
          assert.equal(payload.turnId, startPayload.turnId, `${event.event} must reuse start.turnId`);
        }
        if (event.event === "chunk") {
          const payload = JSON.parse(event.data) as { turnId?: string; token?: string };
          assert.equal("turnId" in payload, false, "chunk payloads remain text-only");
        }
      }
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat SSE projected log_food reply records projected final reply trace", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createLogFoodToolCall()] });

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      assert.match(text, /event: done/);

      const trace = traceRecorders[0]!.build({ scenario: "chat-streaming-test", status: "pass" });
      assert.deepEqual(trace.summary.finalReply, {
        source: "renderer",
        shape: "plain_text",
      });
      assert.deepEqual(trace.timeline.at(-1), {
        type: "route_completion",
        transport: "sse",
        turnId: JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data).turnId,
        didLogMeal: true,
        didMutateMeal: true,
        completed: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat SSE route fallback records fallback trace and one assistant fallback", async () => {
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
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      assert.match(text, /event: done/);

      const trace = traceRecorders[0]!.build({ scenario: "chat-streaming-test", status: "pass" });
      assert.deepEqual(trace.summary.finalReply, {
        source: "fallback",
        shape: "fallback_text",
      });
      const latencyMs = trace.summary.latencyMs;
      assert.ok(latencyMs !== undefined);
      assert.equal(typeof latencyMs, "number");
      assert.ok(latencyMs >= 0);
      const donePayload = JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data) as { turnId?: string };
      assert.deepEqual(trace.timeline.at(-1), {
        type: "route_fallback",
        transport: "sse",
        turnId: donePayload.turnId,
        fallbackSource: "route_catch",
        didLogMeal: false,
        didMutateMeal: false,
        reason: "route_catch",
        catchSite: "sse_outer",
      });

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      assert.equal(historyRes.status, 200);
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMessages = historyJson.messages.filter((message) => message.role === "assistant");
      assert.equal(assistantMessages.length, 1);
      assert.match(assistantMessages[0]!.content, /這次無法完成請求/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat returns readable validation error for unsupported upload types", async () => {
    const form = new FormData();
    form.append("message", "這是什麼食物");
    form.append("image", new Blob(["not-heic"], { type: "image/heic" }), "food.heic");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: form,
    });

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Invalid image type. Allowed: jpeg, png, webp" });
    assert.equal(mockLLM.chatCalls.length, 0);
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
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
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

  it("POST /api/chat stream ends with event: done and structured loggedMeal", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createTrustedLogFoodToolCall()] });
    mockLLM.queueChatStream(["測試", "回覆"]);

    const form = new FormData();
    form.append("message", "午餐我吃了雞腿便當");
    form.append("image", new Blob([validPngBytes()], { type: "image/png" }), "lunch.png");

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      const reader = res.body?.getReader();
      assert.ok(reader);

      const text = await readStreamUntil(reader, "event: done");
      assert.match(text, /event: done/);
      assert.equal(parseSSEEvents(text).filter((event) => event.event === "done").length, 1);

      const doneDataMatch = text.match(/event: done\s+data: (.+)\s*/);
      assert.ok(doneDataMatch);
      const donePayload = JSON.parse(doneDataMatch[1]) as {
        didLogMeal: boolean;
        didMutateMeal?: boolean;
        dailySummary?: unknown;
        loggedMeal?: {
          receiptStatus?: string;
          mealId?: string;
          mealRevisionId?: string;
          dateKey?: string;
          loggedAt?: string;
          mealPeriod?: string;
          imageAssetId?: string | null;
          imageUrl?: string | null;
          foodName?: string;
          calories?: unknown;
          protein?: unknown;
          carbs?: unknown;
          fat?: unknown;
        };
      };
      assert.equal(donePayload.didLogMeal, true);
      assert.equal(donePayload.didMutateMeal, true);
      assert.ok(donePayload.dailySummary);
      assert.equal(donePayload.loggedMeal?.receiptStatus, "active");
      assert.match(donePayload.loggedMeal?.mealId ?? "", /^[0-9a-f-]{36}$/);
      assert.match(donePayload.loggedMeal?.mealRevisionId ?? "", /^[0-9a-f-]{36}:r\d+$/);
      assert.match(donePayload.loggedMeal?.dateKey ?? "", /^\d{4}-\d{2}-\d{2}$/);
      assert.match(donePayload.loggedMeal?.loggedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
      assert.equal(donePayload.loggedMeal?.mealPeriod, "lunch");
      assert.equal(Object.prototype.hasOwnProperty.call(donePayload.loggedMeal ?? {}, "inferredMealPeriod"), false);
      assert.ok(donePayload.loggedMeal?.imageAssetId);
      assert.equal(donePayload.loggedMeal?.imageUrl, `/api/assets/${donePayload.loggedMeal.imageAssetId}`);
      assert.equal(donePayload.loggedMeal?.foodName, "雞腿便當");
      assert.equal(typeof donePayload.loggedMeal?.calories, "number");
      assert.equal(typeof donePayload.loggedMeal?.protein, "number");
      assert.equal(typeof donePayload.loggedMeal?.carbs, "number");
      assert.equal(typeof donePayload.loggedMeal?.fat, "number");

      const historyRes = await fetch(`${address}/api/chat/history?limit=5`, {
        headers: { cookie: sessionCookieHeader },
      });
      assert.equal(historyRes.status, 200);
      const historyJson = await historyRes.json() as {
        messages: Array<{
          role: string;
          content: string;
          loggedMeal?: {
            receiptStatus?: string;
            mealId?: string;
            mealRevisionId?: string;
            imageAssetId?: string | null;
            imageUrl?: string | null;
          };
        }>;
      };
      assert.equal(historyJson.messages.at(-1)?.role, "assistant");
      assert.match(historyJson.messages.at(-1)?.content ?? "", /已記錄雞腿便當/);
      assert.equal(historyJson.messages.at(-1)?.loggedMeal?.receiptStatus, "active");
      assert.equal(historyJson.messages.at(-1)?.loggedMeal?.mealId, donePayload.loggedMeal?.mealId);
      assert.equal(
        historyJson.messages.at(-1)?.loggedMeal?.mealRevisionId,
        donePayload.loggedMeal?.mealRevisionId,
      );
      assert.equal(historyJson.messages.at(-1)?.loggedMeal?.imageAssetId, donePayload.loggedMeal?.imageAssetId);
      assert.equal(historyJson.messages.at(-1)?.loggedMeal?.imageUrl, donePayload.loggedMeal?.imageUrl);
    } finally {
      if (timeout) clearTimeout(timeout);
      if (app.server.listening) {
        await app.close();
      }
    }
  });

  it("POST /api/chat SSE keeps accepted failed-image recognition as no-save for small and large bodies", async () => {
    assert.ok(services, "expected app services");

    const publishedPayloads: unknown[] = [];
    const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
    services.publisher.publishDailySummary = (publishDeviceId, payload) => {
      publishedPayloads.push({ publishDeviceId, payload });
      return originalPublishDailySummary(publishDeviceId, payload);
    };

    const beforeMealsRes = await fetch(`${address}/api/meals`, {
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(beforeMealsRes.status, 200);
    const beforeMealsBody = await beforeMealsRes.json() as {
      meals: Array<{ calories?: number; protein?: number; carbs?: number; fat?: number }>;
    };
    const beforeSummary = await services.summaryService.getDailySummary(deviceId, new Date());
    const beforeChatCalls = mockLLM.chatCalls.length;

    const acceptedFailedImages = [
      {
        name: "small",
        bytes: validPngBytes(),
        filename: "failed-small.png",
      },
      {
        name: "large",
        bytes: validPngBytes(64 * 1024),
        filename: "failed-large.png",
      },
    ];

    try {
      for (const [index, imageCase] of acceptedFailedImages.entries()) {
        mockLLM.queueRoundResponse({
          toolCalls: [createFailedRecognitionLogFoodToolCall(`failed_recognition_no_save_${imageCase.name}`)],
        });

        const boundary = `----nutrition-failed-recognition-${imageCase.name}`;
        const payload = Buffer.concat([
          Buffer.from(
            `--${boundary}\r\n`
            + `Content-Disposition: form-data; name="message"\r\n\r\n`
            + `\r\n`
            + `--${boundary}\r\n`
            + `Content-Disposition: form-data; name="image"; filename="${imageCase.filename}"\r\n`
            + `Content-Type: image/png\r\n\r\n`,
          ),
          Buffer.from(imageCase.bytes),
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]);
        const res = await app.inject({
          method: "POST",
          url: "/api/chat",
          headers: {
            cookie: sessionCookieHeader,
            Accept: "text/event-stream",
            "content-type": `multipart/form-data; boundary=${boundary}`,
          },
          payload,
        });
        assert.equal(res.statusCode, 200, imageCase.name);
        const text = res.payload;
        const events = parseSSEEvents(text);
        const statusEvents = events.filter((event) => event.event === "status");
        const chunkEvents = events.filter((event) => event.event === "chunk");
        const doneEvents = events.filter((event) => event.event === "done");
        assert.ok(statusEvents.length >= 2, imageCase.name);
        assert.equal(chunkEvents.length, 1, imageCase.name);
        assert.equal(doneEvents.length, 1, imageCase.name);
        assert.equal(events.at(-1)?.event, "done", imageCase.name);
        assert.ok(
          events.findIndex((event) => event.event === "status") < events.findIndex((event) => event.event === "chunk"),
          imageCase.name,
        );
        assert.ok(
          events.findIndex((event) => event.event === "chunk") < events.findIndex((event) => event.event === "done"),
          imageCase.name,
        );

        const chunkText = chunkEvents
          .map((event) => (JSON.parse(event.data) as { token?: string }).token ?? "")
          .join("");
        assert.equal(chunkText, FAILED_RECOGNITION_NO_SAVE_REPLY, imageCase.name);
        assert.doesNotMatch(chunkText, TERMINAL_CLARIFICATION_SUCCESS_COPY, imageCase.name);

        const donePayload = JSON.parse(doneEvents[0]!.data) as {
          didLogMeal?: boolean;
          didMutateMeal?: boolean;
          loggedMeal?: unknown;
          dailySummary?: unknown;
          summaryOutcome?: unknown;
          deletedMealId?: unknown;
        };
        assert.equal(donePayload.didLogMeal, false, imageCase.name);
        assert.equal(donePayload.didMutateMeal, false, imageCase.name);
        assert.equal(Object.prototype.hasOwnProperty.call(donePayload, "loggedMeal"), false, imageCase.name);
        assert.equal(Object.prototype.hasOwnProperty.call(donePayload, "dailySummary"), false, imageCase.name);
        assert.equal(Object.prototype.hasOwnProperty.call(donePayload, "summaryOutcome"), false, imageCase.name);
        assert.equal(Object.prototype.hasOwnProperty.call(donePayload, "deletedMealId"), false, imageCase.name);

        const mealsRes = await fetch(`${address}/api/meals`, {
          headers: { cookie: sessionCookieHeader },
        });
        assert.equal(mealsRes.status, 200, imageCase.name);
        const mealsBody = await mealsRes.json() as {
          meals: Array<{ calories?: number; protein?: number; carbs?: number; fat?: number }>;
        };
        assert.deepEqual(mealsBody.meals, beforeMealsBody.meals, imageCase.name);

        const afterSummary = await services.summaryService.getDailySummary(deviceId, new Date());
        assert.equal(afterSummary.mealCount, beforeSummary.mealCount, imageCase.name);
        assert.equal(afterSummary.totalCalories, beforeSummary.totalCalories, imageCase.name);
        assert.equal(afterSummary.totalProtein, beforeSummary.totalProtein, imageCase.name);
        assert.equal(afterSummary.totalCarbs, beforeSummary.totalCarbs, imageCase.name);
        assert.equal(afterSummary.totalFat, beforeSummary.totalFat, imageCase.name);
        assert.deepEqual(publishedPayloads, [], imageCase.name);
        assert.deepEqual(await readdir(uploadsDir).catch(() => []), [], imageCase.name);
        assert.equal(
          mockLLM.chatCalls.length,
          beforeChatCalls + index + 1,
          `${imageCase.name} failed-recognition no-save must not consume a recovery model call`,
        );
      }
    } finally {
      services.publisher.publishDailySummary = originalPublishDailySummary;
    }
  });

  it("POST /api/chat SSE done omits receipt identity when assistant receipt persistence fails after log_food", async () => {
    assert.ok(services, "expected app services");
    installAtomicReceiptPersistenceFailure(services.chatService);
    mockLLM.queueRoundResponse({ toolCalls: [createTrustedLogFoodToolCall()] });
    mockLLM.queueChatStream(["已幫你記錄雞腿便當！這段不應曝光。"]);

    const form = new FormData();
    form.append("message", "raw-user-food-雞腿便當");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const donePayload = JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data) as Record<string, unknown>;
      assert.equal(donePayload.didLogMeal, true);
      assertNoReceiptIdentityProjection(donePayload, "SSE done atomic persistence failure payload");

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      assert.equal(historyRes.status, 200);
      const historyJson = await historyRes.json() as {
        messages: Array<{ role: string; content?: string; loggedMeal?: unknown }>;
      };
      const assistant = latestAssistantMessage(historyJson.messages);
      if (assistant) {
        assertNoReceiptIdentityProjection(assistant, "SSE done atomic persistence failure history assistant");
      }
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat SSE successful missing quantity reply hides internal metadata and keeps grouped name", async () => {
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_grouped_missing_quantity_sse",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              { food_name: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
              { food_name: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
              { food_name: "青菜", calories: 40, protein: 2, carbs: 8, fat: 1 },
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
    mockLLM.queueChatStream([
      "已記錄雞腿、白飯、青菜，約 580 kcal，可信蛋白 99 g。",
      "log_food protein_sources usedConservativeAssumption quantityUncertaintyReason missing_quantity",
    ]);

    const form = new FormData();
    form.append("message", "我吃了雞腿、白飯和青菜");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");
      const events = parseSSEEvents(text);
      const chunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");

      assert.match(chunkText, /580 kcal/);
      assert.match(chunkText, /蛋白質 24 g/);
      assert.doesNotMatch(chunkText, /份量是主要誤差|可再補份量修正|區間/);
      assert.doesNotMatch(chunkText, /約 580 kcal，可信蛋白 99 g/);
      assertNoSuccessfulLogInternalCopy(chunkText);

      const doneEvent = events.find((event) => event.event === "done");
      assert.ok(doneEvent);
      const donePayload = JSON.parse(doneEvent.data) as {
        loggedMeal?: {
          foodName?: string;
          itemCount?: number;
          items?: Array<{
            name: string;
            position: number;
            calories: number;
            protein: number;
            carbs: number;
            fat: number;
          }>;
        };
      };
      assert.equal(donePayload.loggedMeal?.foodName, "雞腿、白飯、青菜");
      assert.equal(donePayload.loggedMeal?.itemCount, 3);
      assert.deepEqual(donePayload.loggedMeal?.items, [
        { name: "雞腿", position: 0, calories: 260, protein: 24, carbs: 0, fat: 12 },
        { name: "白飯", position: 1, calories: 280, protein: 0, carbs: 62, fat: 0.5 },
        { name: "青菜", position: 2, calories: 40, protein: 0, carbs: 8, fat: 1 },
      ]);
      assertNoSuccessfulLogInternalCopy(JSON.stringify(donePayload.loggedMeal));
    } finally {
      clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      controller.abort();
    }
  });

  it("POST /api/chat SSE successful soy log ignores model filler when receipt has no protein explanation trigger", async () => {
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_soy_sse",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "豆漿",
                quantity_ml: 300,
                calories: 120,
                protein: 8,
                carbs: 10,
                fat: 4,
              },
            ],
            protein_sources: [
              { name: "豆漿", protein: 8, is_primary: true, certainty: "clear" },
            ],
          }),
        },
      }],
    });
    mockLLM.queueChatStream(["已記錄豆漿，約 120 kcal、可信蛋白 8 g。豆漿為主要蛋白來源。"]);

    const form = new FormData();
    form.append("message", "一杯豆漿");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");
      const events = parseSSEEvents(text);
      const chunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");
      const doneEvent = events.find((event) => event.event === "done");
      assert.ok(doneEvent);
      const donePayload = JSON.parse(doneEvent.data) as { loggedMeal?: { protein?: number } };

      assert.match(chunkText, /已記錄豆漿/);
      assert.match(chunkText, /120 kcal/);
      assert.match(chunkText, /蛋白質 8 g/);
      assert.equal(donePayload.loggedMeal?.protein, 8);
      assert.doesNotMatch(chunkText, /豆漿為主要蛋白來源|可信蛋白/);
    } finally {
      clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      controller.abort();
    }
  });

  it("POST /api/chat/stop gracefully stops the active turn and persists stopped partial content", async () => {
    mockLLM.queueAbortableChatStream(["這是一段安全的飲食建議內容", "後續內容"]);

    const form = new FormData();
    form.append("message", "請給我一些飲食建議");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      reader = res.body.getReader();
      const firstText = await readStreamUntil(reader, "event: chunk");
      const firstEvents = parseSSEEvents(firstText);
      const startPayload = firstEvents
        .filter((event) => event.event === "start")
        .map((event) => JSON.parse(event.data) as { turnId?: string })
        .find((payload) => typeof payload.turnId === "string");
      const turnId = startPayload?.turnId;

      assert.match(turnId ?? "", UUID_PATTERN, "stream must expose a server UUID turnId before stop");

      const stopRes = await fetch(`${address}/api/chat/stop`, {
        method: "POST",
        headers: {
          cookie: sessionCookieHeader,
          "content-type": "application/json",
        },
        body: JSON.stringify({ turnId }),
      });
      assert.equal(stopRes.status, 200);
      assert.deepEqual(await stopRes.json(), { stopped: true, turnId });
      await mockLLM.abortObserved;

      const stoppedText = firstText + await readStreamUntil(reader, "event: stopped");
      const events = parseSSEEvents(stoppedText);
      const stoppedEvents = events.filter((event) => event.event === "stopped");
      const doneEvents = events.filter((event) => event.event === "done");
      assert.equal(stoppedEvents.length, 1);
      assert.equal(doneEvents.length, 0, "stopped stream must not also emit done");
      assert.equal(mockLLM.lastSignal?.aborted, true, "provider AbortSignal must be aborted");

      const stoppedPayload = JSON.parse(stoppedEvents[0]!.data) as {
        stopped?: boolean;
        turnId?: string;
        tokensStreamed?: number;
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        dailySummary?: unknown;
        loggedMeal?: { mealId?: string; foodName?: string; imageAssetId?: string | null };
      };
      assert.equal(stoppedPayload.stopped, true);
      assert.equal(stoppedPayload.turnId, turnId);
      assert.equal(stoppedPayload.tokensStreamed, 1);
      assert.equal(stoppedPayload.didLogMeal, false);
      assert.equal(stoppedPayload.didMutateMeal, false);
      assert.equal(stoppedPayload.dailySummary, undefined);
      assert.equal(stoppedPayload.loggedMeal, undefined);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      assert.equal(historyRes.status, 200);
      const historyJson = await historyRes.json() as {
        messages: Array<{
          role: string;
          content: string;
          status?: string;
          loggedMeal?: { mealId?: string; foodName?: string; imageAssetId?: string | null };
        }>;
      };
      const assistantMessages = historyJson.messages.filter((message) => message.role === "assistant");
      assert.equal(assistantMessages.length, 1, "stopped stream must persist one assistant row");
      assert.equal(assistantMessages[0]?.content, "這是一段安全的飲食建議內容");
      assert.equal(assistantMessages[0]?.status, "stopped");
      assert.equal(assistantMessages[0]?.loggedMeal, undefined);

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 1);
      assert.equal(fallbackEvents.length, 0);
      assert.equal(completedEvents[0]!.source, "sse");
      assert.equal(completedEvents[0]!.turnId, turnId);
      assert.equal(completedEvents[0]!.stopped, true);
      assert.equal(completedEvents[0]!.tokensStreamed, 1);

      const trace = traceRecorders[0]!.build({ scenario: "chat-streaming-stopped", status: "pass" });
      assert.deepEqual(
        trace.timeline.filter((event) => event.type === "route_completion"),
        [{
          type: "route_completion",
          transport: "sse",
          turnId,
          didLogMeal: false,
          didMutateMeal: false,
          completed: true,
        }],
      );
      assert.equal(trace.timeline.some((event) => event.type === "route_fallback"), false);
    } finally {
      clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      controller.abort();
    }
  });

  it("POST /api/chat/stop cannot stop a foreign active turn through raw selectors and logs metadata only", async () => {
    const foreignDeviceRes = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "muscle_gain" },
    });
    const foreignDeviceId = foreignDeviceRes.json().deviceId as string;
    const foreignCookieHeader = toCookieHeader(foreignDeviceRes.headers["set-cookie"]);
    mockLLM.queueAbortableChatStream(["foreign stream keeps running", " and completes"]);

    const form = new FormData();
    form.append("message", "foreign active turn");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const foreignStream = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: foreignCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });
      assert.equal(foreignStream.status, 200);
      assert.ok(foreignStream.body);
      reader = foreignStream.body.getReader();
      const firstText = await readStreamUntil(reader, "event: chunk");
      const foreignTurnId = parseSSEEvents(firstText)
        .filter((event) => event.event === "start")
        .map((event) => JSON.parse(event.data) as { turnId?: string })
        .find((payload) => typeof payload.turnId === "string")
        ?.turnId;
      assert.match(foreignTurnId ?? "", UUID_PATTERN);

      const forgedStopRes = await fetch(`${address}/api/chat/stop?deviceId=${encodeURIComponent(foreignDeviceId)}`, {
        method: "POST",
        headers: {
          cookie: sessionCookieHeader,
          "content-type": "application/json",
          "x-device-id": foreignDeviceId,
        },
        body: JSON.stringify({ turnId: foreignDeviceId }),
      });
      assert.equal(forgedStopRes.status, 404);
      assert.deepEqual(await forgedStopRes.json(), { error: "Active turn not found" });

      const stopRes = await fetch(`${address}/api/chat/stop?deviceId=${encodeURIComponent(foreignDeviceId)}`, {
        method: "POST",
        headers: {
          cookie: sessionCookieHeader,
          "content-type": "application/json",
          "x-device-id": foreignDeviceId,
        },
        body: JSON.stringify({ turnId: foreignTurnId }),
      });
      assert.equal(stopRes.status, 404);
      assert.deepEqual(await stopRes.json(), { error: "Active turn not found" });
      assert.equal(mockLLM.lastSignal?.aborted, false);

      const completedText = firstText + await readStreamUntil(reader, "event: done");
      const events = parseSSEEvents(completedText);
      assert.equal(events.filter((event) => event.event === "stopped").length, 0);
      assert.equal(events.filter((event) => event.event === "done").length, 1);

      const ownershipEvents = observabilityEvents(logLines, "ownership_bypass_blocked");
      assert.equal(ownershipEvents.length, 2);
      for (const event of ownershipEvents) {
        assert.equal(typeof event.requestId, "string");
        assert.equal("turnId" in event, false);
        assert.deepEqual(
          {
            event: event.event,
            reason: event.reason,
            route: event.route,
            operation: event.operation,
          },
          {
            event: "ownership_bypass_blocked",
            reason: "raw_device_id_param",
            route: "api_chat_stop",
            operation: "chat_stop",
          },
        );
        assertLogEventApplicationKeys(event, ["event", "reason", "route", "operation", "requestId"]);
      }
      assertLogEventsExclude(
        ownershipEvents,
        [
          deviceId,
          foreignDeviceId,
          foreignTurnId ?? "",
          "x-device-id",
          "deviceId",
          "guest_session",
          "cookie",
          "foreign active turn",
          "foreign stream keeps running",
          "image",
          "snippet",
        ],
      );
    } finally {
      clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      controller.abort();
    }
  });

  it("POST /api/chat/stop omits receipt identity when stopped receipt persistence fails after log_food", async () => {
    assert.ok(services, "expected app services");
    const loggedMeal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      mealPeriod: "lunch",
      items: [
        { foodName: "雞腿便當", calories: 620, protein: 24, carbs: 70, fat: 18 },
      ],
    });
    installAtomicReceiptPersistenceFailure(services.chatService);
    const originalHandleMessage = services.orchestrator.handleMessage.bind(services.orchestrator);
    services.orchestrator.handleMessage = async (_requestDeviceId, _userMessage, _imageBase64, _assetRef, opts) => {
      opts?.onUserMessageSaved?.();
      return {
        streamGenerator: streamTokensUntilAbort(["已幫你記錄雞腿便當！這段不應曝光。"], opts?.signal, () => {}),
        didLogMeal: true,
        didMutateMeal: true,
        affectedDate: "2026-04-19",
        loggedMeal: {
          mealId: loggedMeal.id,
          mealRevisionId: loggedMeal.mealRevisionId,
          dateKey: "2026-04-19",
          loggedAt: loggedMeal.loggedAt,
          mealPeriod: "lunch",
          imageAssetId: null,
          imageUrl: null,
          foodName: loggedMeal.foodName,
          calories: loggedMeal.calories,
          protein: loggedMeal.protein,
          carbs: loggedMeal.carbs,
          fat: loggedMeal.fat,
          itemCount: loggedMeal.itemCount,
          countedSources: [],
          excludedSources: [],
          usedConservativeAssumption: false,
        },
      };
    };

    const form = new FormData();
    form.append("message", "raw-user-food-雞腿便當");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      reader = res.body.getReader();
      const firstText = await readStreamUntil(reader, "event: chunk");
      const startPayload = parseSSEEvents(firstText)
        .filter((event) => event.event === "start")
        .map((event) => JSON.parse(event.data) as { turnId?: string })
        .find((payload) => typeof payload.turnId === "string");
      const turnId = startPayload?.turnId;
      assert.match(turnId ?? "", UUID_PATTERN);

      const stopRes = await fetch(`${address}/api/chat/stop`, {
        method: "POST",
        headers: {
          cookie: sessionCookieHeader,
          "content-type": "application/json",
        },
        body: JSON.stringify({ turnId }),
      });
      assert.equal(stopRes.status, 200);
      await mockLLM.abortObserved;

      const stoppedText = firstText + await readStreamUntil(reader, "event: stopped");
      const stoppedPayload = JSON.parse(
        parseSSEEvents(stoppedText).find((event) => event.event === "stopped")!.data,
      ) as Record<string, unknown>;
      assert.equal(stoppedPayload.stopped, true);
      assert.equal(stoppedPayload.didLogMeal, true);
      assertNoReceiptIdentityProjection(stoppedPayload, "SSE stopped atomic persistence failure payload");

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      assert.equal(historyRes.status, 200);
      const historyJson = await historyRes.json() as {
        messages: Array<{ role: string; content?: string; loggedMeal?: unknown }>;
      };
      const assistant = latestAssistantMessage(historyJson.messages);
      if (assistant) {
        assertNoReceiptIdentityProjection(assistant, "SSE stopped atomic persistence failure history assistant");
      }
    } finally {
      services.orchestrator.handleMessage = originalHandleMessage;
      clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      controller.abort();
    }
  });

  it("POST /api/chat SSE provider llm_error fallback emits route fallback only with provider metadata", async () => {
    mockLLM.queueRoundError(new LLMProviderError(providerMetadataFixture));

    const form = new FormData();
    form.append("message", "這段文字不應進 fallback event");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const donePayload = JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data) as { turnId?: string };
      assert.match(donePayload.turnId ?? "", UUID_PATTERN);

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.equal(fallbackEvents[0]!.source, "sse");
      assert.equal(fallbackEvents[0]!.turnId, donePayload.turnId);
      assert.equal(fallbackEvents[0]!.fallbackSource, "orchestrator");
      assert.equal(fallbackEvents[0]!.reason, "llm_error");
      assert.deepEqual(fallbackEvents[0]!.providerMetadata, providerMetadataFixture);

      const trace = traceRecorders[0]!.build({ scenario: "sse-llm-error-fallback", status: "pass" });
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.transport, "sse");
      assert.equal(routeFallbacks[0]!.turnId, donePayload.turnId);
      assert.equal(routeFallbacks[0]!.fallbackSource, "orchestrator");
      assert.equal(routeFallbacks[0]!.reason, "llm_error");
      assert.deepEqual(routeFallbacks[0]!.providerMetadata, providerMetadataFixture);
      assert.equal(trace.timeline.some((event) => event.type === "route_completion"), false);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat SSE provider stream continuation llm_error fallback emits route fallback only with provider metadata", async () => {
    mockLLM.queueChatStreamError(["partial token"], new LLMProviderError(providerMetadataFixture));

    const form = new FormData();
    form.append("message", "這段文字不應進 stream fallback event");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const events = parseSSEEvents(text);
      assert.equal(events.filter((event) => event.event === "done").length, 1);
      const donePayload = JSON.parse(events.find((event) => event.event === "done")!.data) as { turnId?: string };
      assert.match(donePayload.turnId ?? "", UUID_PATTERN);

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.equal(fallbackEvents[0]!.source, "sse");
      assert.equal(fallbackEvents[0]!.turnId, donePayload.turnId);
      assert.equal(fallbackEvents[0]!.fallbackSource, "orchestrator");
      assert.equal(fallbackEvents[0]!.reason, "llm_error");
      assert.deepEqual(fallbackEvents[0]!.providerMetadata, providerMetadataFixture);
      assert.equal("catchSite" in fallbackEvents[0]!, false);

      const trace = traceRecorders[0]!.build({ scenario: "sse-provider-stream-fallback", status: "pass" });
      const llmErrors = trace.timeline.filter((event) => event.type === "llm_error");
      const orchestratorFallbacks = trace.timeline.filter((event) => event.type === "orchestrator_fallback");
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.ok(llmErrors.length >= 1);
      assert.ok(orchestratorFallbacks.some((event) =>
        event.reason === "llm_error"
        && JSON.stringify(event.providerMetadata) === JSON.stringify(providerMetadataFixture)
      ));
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.transport, "sse");
      assert.equal(routeFallbacks[0]!.turnId, donePayload.turnId);
      assert.equal(routeFallbacks[0]!.fallbackSource, "orchestrator");
      assert.equal(routeFallbacks[0]!.reason, "llm_error");
      assert.deepEqual(routeFallbacks[0]!.providerMetadata, providerMetadataFixture);
      assert.equal("catchSite" in routeFallbacks[0]!, false);
      assert.equal(trace.timeline.some((event) => event.type === "route_completion"), false);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("SSE fallback classifier gates provider metadata to llm_error, not partial_success", async () => {
    const routeSource = await readFile("server/routes/chat.ts", "utf8");

    assert.match(routeSource, /result\.fallbackOutcomeContext\.reason === "llm_error"/);
    assert.match(routeSource, /reason: result\.fallbackOutcomeContext\.reason/);
    assert.doesNotMatch(routeSource, /providerFallbackContext[\s\S]{0,160}partial_success/);
  });

  it("POST /api/chat SSE partial_success fallback result emits route fallback only without provider metadata", async () => {
    assert.ok(services);
    const originalHandleMessage = services.orchestrator.handleMessage.bind(services.orchestrator);
    services.orchestrator.handleMessage = async (requestDeviceId, userMessage, _imageBase64, _assetRef, opts) => {
      await services!.chatService.saveMessage(requestDeviceId, "user", userMessage);
      opts?.onUserMessageSaved?.();
      return {
        reply: "已完成記錄，但回覆生成失敗，請稍後確認今日攝取摘要。",
        didLogMeal: true,
        didMutateMeal: true,
        dailySummary: {
          totalCalories: 95,
          totalProtein: 0,
          totalCarbs: 25,
          totalFat: 0.3,
          mealCount: 1,
          date: formatLocalDate(new Date()),
        },
        finalReplySource: "fallback",
        finalReplyShape: "fallback_text",
        fallbackOutcomeContext: {
          fallbackSource: "orchestrator",
          reason: "partial_success",
          round: 2,
          lastTool: "log_food",
        },
      };
    };

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const events = parseSSEEvents(text);
      assert.equal(events.filter((event) => event.event === "done").length, 1);
      const donePayload = JSON.parse(events.find((event) => event.event === "done")!.data) as {
        turnId?: string;
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
      };
      assert.match(donePayload.turnId ?? "", UUID_PATTERN);
      assert.equal(donePayload.didLogMeal, true);
      assert.equal(donePayload.didMutateMeal, true);

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.equal(fallbackEvents[0]!.source, "sse");
      assert.equal(fallbackEvents[0]!.turnId, donePayload.turnId);
      assert.equal(fallbackEvents[0]!.fallbackSource, "orchestrator");
      assert.equal(fallbackEvents[0]!.reason, "partial_success");
      assert.equal(fallbackEvents[0]!.didLogMeal, true);
      assert.equal(fallbackEvents[0]!.didMutateMeal, true);
      assert.equal(fallbackEvents[0]!.round, 2);
      assert.equal(fallbackEvents[0]!.lastTool, "log_food");
      assert.equal("providerMetadata" in fallbackEvents[0]!, false);

      const trace = traceRecorders[0]!.build({ scenario: "sse-partial-success-fallback", status: "pass" });
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.transport, "sse");
      assert.equal(routeFallbacks[0]!.turnId, donePayload.turnId);
      assert.equal(routeFallbacks[0]!.fallbackSource, "orchestrator");
      assert.equal(routeFallbacks[0]!.reason, "partial_success");
      assert.equal(routeFallbacks[0]!.didLogMeal, true);
      assert.equal(routeFallbacks[0]!.didMutateMeal, true);
      assert.equal("providerMetadata" in routeFallbacks[0]!, false);
      assert.equal(trace.timeline.some((event) => event.type === "route_completion"), false);
    } finally {
      clearTimeout(timeout);
      services.orchestrator.handleMessage = originalHandleMessage;
    }
  });

  it("POST /api/chat SSE max_rounds fallback emits route fallback only without provider metadata", async () => {
    for (let i = 0; i < 3; i += 1) {
      mockLLM.queueRoundResponse({
        toolCalls: [{
          id: `max_round_sse_${i}`,
          type: "function",
          function: { name: "get_daily_summary", arguments: "{}" },
        }],
      });
    }

    const form = new FormData();
    form.append("message", "查一下摘要");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const donePayload = JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data) as { turnId?: string };

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.equal(fallbackEvents[0]!.turnId, donePayload.turnId);
      assert.equal(fallbackEvents[0]!.fallbackSource, "orchestrator");
      assert.equal(fallbackEvents[0]!.reason, "max_rounds");
      assert.equal("providerMetadata" in fallbackEvents[0]!, false);

      const trace = traceRecorders[0]!.build({ scenario: "sse-max-rounds-fallback", status: "pass" });
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.turnId, donePayload.turnId);
      assert.equal(routeFallbacks[0]!.fallbackSource, "orchestrator");
      assert.equal(routeFallbacks[0]!.reason, "max_rounds");
      assert.equal("providerMetadata" in routeFallbacks[0]!, false);
      assert.equal(trace.timeline.some((event) => event.type === "route_completion"), false);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat SSE route-owned hallucination fallback emits route fallback only", async () => {
    mockLLM.queueChatStream(["方式1 直接記錄\n", "方式2 補充描述"]);

    const form = new FormData();
    form.append("message", "請記錄一餐");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      assert.match(text, /event: done/);
      const donePayload = JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data) as { turnId?: string };

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.equal(fallbackEvents[0]!.source, "sse");
      assert.equal(fallbackEvents[0]!.turnId, donePayload.turnId);
      assert.equal(fallbackEvents[0]!.fallbackSource, "route_hallucination");
      assert.equal(fallbackEvents[0]!.reason, "hallucination_detected");
      assert.equal("providerMetadata" in fallbackEvents[0]!, false);

      const trace = traceRecorders[0]!.build({ scenario: "sse-hallucination-fallback", status: "pass" });
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.turnId, donePayload.turnId);
      assert.equal(routeFallbacks[0]!.fallbackSource, "route_hallucination");
      assert.equal(routeFallbacks[0]!.reason, "hallucination_detected");
      assert.equal("providerMetadata" in routeFallbacks[0]!, false);
      assert.equal(trace.timeline.some((event) => event.type === "route_completion"), false);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat stream done can include affectedDate for historical logs", async () => {
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_historical_stream",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "牛肉麵",
                calories: 520,
                protein: 24,
                carbs: 68,
                fat: 16,
              },
            ],
            date_text: "2026-03-25",
            meal_period: "dinner",
          }),
        },
      }],
    });
    mockLLM.queueChatStream(["已", "幫你", "記到 3/25。"]);

    const form = new FormData();
    form.append("message", "幫我補記 2026-03-25 晚餐吃牛肉麵");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");
      const doneDataMatch = text.match(/event: done\s+data: (.+)\s*/);
      assert.ok(doneDataMatch);
      const donePayload = JSON.parse(doneDataMatch[1]) as {
        didLogMeal: boolean;
        affectedDate?: string;
        dailySummary?: { date?: string };
        loggedMeal?: { mealId?: string; dateKey?: string; loggedAt?: string; foodName?: string };
      };

      assert.equal(donePayload.didLogMeal, true);
      assert.equal(donePayload.affectedDate, "2026-03-25");
      assert.equal(donePayload.dailySummary?.date, "2026-03-25");
      assert.match(donePayload.loggedMeal?.mealId ?? "", /^[0-9a-f-]{36}$/);
      assert.equal(donePayload.loggedMeal?.dateKey, "2026-03-25");
      assert.match(donePayload.loggedMeal?.loggedAt ?? "", /^2026-03-25T/);
      assert.equal(donePayload.loggedMeal?.foodName, "牛肉麵");
    } finally {
      await reader?.cancel();
      controller.abort();
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat SSE persists terminal historical log_food clarification without side effects or publish", async () => {
    assert.ok(services);
    const publishedPayloads: unknown[] = [];
    const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
    services.publisher.publishDailySummary = (publishDeviceId, payload) => {
      publishedPayloads.push({ publishDeviceId, payload });
      return originalPublishDailySummary(publishDeviceId, payload);
    };
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_historical_stream_multiple_dates",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "牛肉麵",
                calories: 520,
                protein: 24,
                carbs: 68,
                fat: 16,
              },
            ],
            date_text: "2026-03-25 和 2026-03-26",
          }),
        },
      }],
    });
    mockLLM.queueChatStream(["已記錄牛肉麵。"]);

    const form = new FormData();
    form.append("message", "幫我補記 2026-03-25 和 2026-03-26 吃牛肉麵");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");
      const events = parseSSEEvents(text);
      const chunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");
      const donePayload = JSON.parse(events.find((event) => event.event === "done")!.data) as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        loggedMeal?: unknown;
        dailySummary?: unknown;
        summaryOutcome?: unknown;
      };

      assert.equal(chunkText, "這次沒有記錄餐點。我還不能確定你要記錄哪一天，請一次告訴我一個日期。");
      assert.doesNotMatch(chunkText, TERMINAL_CLARIFICATION_SUCCESS_COPY);
      assertNoTerminalClarificationDoneSideEffects(donePayload);
      assert.equal(mockLLM.chatCalls.length, 1, "terminal clarification must not consume a second model reply");
      assert.deepEqual(publishedPayloads, []);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      assert.equal(historyRes.status, 200);
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const latestAssistant = historyJson.messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
      assert.equal(latestAssistant, chunkText);
    } finally {
      services.publisher.publishDailySummary = originalPublishDailySummary;
      await reader?.cancel().catch(() => {});
      controller.abort();
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat SSE persists get_daily_summary clarification without summary or publish", async () => {
    assert.ok(services);
    const publishedPayloads: unknown[] = [];
    const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
    services.publisher.publishDailySummary = (publishDeviceId, payload) => {
      publishedPayloads.push({ publishDeviceId, payload });
      return originalPublishDailySummary(publishDeviceId, payload);
    };
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_summary_stream_needs_clarification",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: JSON.stringify({ date_text: "前幾天" }),
        },
      }],
    });
    mockLLM.queueChatStream(["已查詢完成。"]);

    const form = new FormData();
    form.append("message", "前幾天吃了多少？");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");
      const events = parseSSEEvents(text);
      const chunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");
      const donePayload = JSON.parse(events.find((event) => event.event === "done")!.data) as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        loggedMeal?: unknown;
        dailySummary?: unknown;
        summaryOutcome?: unknown;
      };

      assert.equal(chunkText, "我還不能確定是哪一天，請再說一次日期。");
      assert.doesNotMatch(chunkText, TERMINAL_CLARIFICATION_SUCCESS_COPY);
      assertNoTerminalClarificationDoneSideEffects(donePayload);
      assert.equal(mockLLM.chatCalls.length, 1, "terminal clarification must not consume a second model reply");
      assert.deepEqual(publishedPayloads, []);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      assert.equal(historyRes.status, 200);
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const latestAssistant = historyJson.messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
      assert.equal(latestAssistant, chunkText);
    } finally {
      services.publisher.publishDailySummary = originalPublishDailySummary;
      await reader?.cancel().catch(() => {});
      controller.abort();
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat SSE multiple_targets follow-up does not carry one listed date into a later log", async () => {
    assert.ok(services);
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_summary_stream_multiple_targets",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: JSON.stringify({ date_text: "2026-03-25 和 2026-03-26" }),
        },
      }],
    });

    const firstForm = new FormData();
    firstForm.append("message", "2026-03-25 和 2026-03-26 各吃了多少？");

    const firstController = new AbortController();
    const firstTimeout = setTimeout(() => firstController.abort(), 3000);
    let firstReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const firstRes = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: firstController.signal,
        body: firstForm,
      });
      assert.ok(firstRes.body);
      firstReader = firstRes.body.getReader();
      const firstText = await readStreamUntil(firstReader, "event: done");
      const firstEvents = parseSSEEvents(firstText);
      const firstChunkText = firstEvents
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");
      const firstDonePayload = JSON.parse(firstEvents.find((event) => event.event === "done")!.data) as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        loggedMeal?: unknown;
        dailySummary?: unknown;
        summaryOutcome?: unknown;
      };
      assert.match(firstChunkText, /我目前一次只能看一個日期/);
      assert.match(firstChunkText, /1\. 2026-03-25/);
      assert.match(firstChunkText, /2\. 2026-03-26/);
      assertNoTerminalClarificationDoneSideEffects(firstDonePayload);
    } finally {
      await firstReader?.cancel().catch(() => {});
      firstController.abort();
      clearTimeout(firstTimeout);
    }

    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_follow_up_drink_after_multiple_targets",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "豆漿",
                calories: 120,
                protein: 8,
                carbs: 12,
                fat: 4,
              },
            ],
          }),
        },
      }],
    });
    mockLLM.queueChatStream(["已", "記錄豆漿。"]);

    const secondForm = new FormData();
    secondForm.append("message", "再加一杯豆漿");
    const secondController = new AbortController();
    const secondTimeout = setTimeout(() => secondController.abort(), 3000);
    let secondReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const secondRes = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: secondController.signal,
        body: secondForm,
      });
      assert.ok(secondRes.body);
      secondReader = secondRes.body.getReader();
      const secondText = await readStreamUntil(secondReader, "event: done");
      const secondEvents = parseSSEEvents(secondText);
      const secondDonePayload = JSON.parse(secondEvents.find((event) => event.event === "done")!.data) as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        affectedDate?: string;
        dailySummary?: { date?: string };
        loggedMeal?: { dateKey?: string };
      };

      if (secondDonePayload.didLogMeal) {
        const forbiddenCarriedDates = new Set(["2026-03-25", "2026-03-26"]);
        assert.equal(forbiddenCarriedDates.has(secondDonePayload.affectedDate ?? ""), false);
        assert.equal(forbiddenCarriedDates.has(secondDonePayload.dailySummary?.date ?? ""), false);
        assert.equal(forbiddenCarriedDates.has(secondDonePayload.loggedMeal?.dateKey ?? ""), false);
      } else {
        assertNoTerminalClarificationDoneSideEffects(secondDonePayload);
      }

      const march25Meals = await services.foodLoggingService.getMealsByDate(deviceId, new Date("2026-03-25T12:00:00+08:00"));
      const march26Meals = await services.foodLoggingService.getMealsByDate(deviceId, new Date("2026-03-26T12:00:00+08:00"));
      assert.equal(march25Meals.length, 0);
      assert.equal(march26Meals.length, 0);
    } finally {
      await secondReader?.cancel().catch(() => {});
      secondController.abort();
      clearTimeout(secondTimeout);
    }
  });

  it("POST /api/chat stream done includes structured loggedMeal for update_meal mutations", async () => {
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "seed_historical_meal",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "牛肉麵",
                calories: 520,
                protein: 24,
                carbs: 68,
                fat: 16,
              },
            ],
            date_text: "2026-03-25",
            meal_period: "dinner",
          }),
        },
      }],
    });
    const seedForm = new FormData();
    seedForm.append("message", "幫我補記 2026-03-25 晚餐吃牛肉麵");
    const seedRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: seedForm,
    });
    assert.ok(seedRes.body);
    const seedText = await readStreamUntil(seedRes.body.getReader(), "event: done");
    const seedDoneMatch = seedText.match(/event: done\s+data: (.+)\s*/);
    assert.ok(seedDoneMatch);
    const seedDonePayload = JSON.parse(seedDoneMatch[1]) as { loggedMeal?: { mealId?: string } };
    const mealId = seedDonePayload.loggedMeal?.mealId;
    assert.ok(mealId);

    mockLLM.queueRoundResponse({
      toolCalls: [
        createFindMealsToolCall("update", "2026-03-25 晚餐牛肉麵"),
        createUpdateMealToolCall(mealId),
      ],
    });
    mockLLM.queueChatStream(["已更新蛋餅，330 kcal，可信蛋白 14 g。（5/5）"]);

    const form = new FormData();
    form.append("message", "把 2026-03-25 晚餐牛肉麵改成半碗，熱量 360 卡，蛋白質 20g，碳水 45g，脂肪 10g");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: form,
    });

    assert.ok(res.body);
    const text = await readStreamUntil(res.body.getReader(), "event: done");
    const events = parseSSEEvents(text);
    const chunkText = events
      .filter((event) => event.event === "chunk")
      .map((event) => JSON.parse(event.data) as { token: string })
      .map((payload) => payload.token)
      .join("");
    const doneDataMatch = text.match(/event: done\s+data: (.+)\s*/);
    assert.ok(doneDataMatch);
    const donePayload = JSON.parse(doneDataMatch[1]) as {
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      affectedDate?: string;
      loggedMeal?: {
        mealId?: string;
        mealRevisionId?: string;
        dateKey?: string;
        loggedAt?: string;
        foodName?: string;
        calories?: number;
        protein?: number;
        carbs?: number;
        fat?: number;
        items?: Array<{
          name: string;
          position: number;
          calories: number;
          protein: number;
          carbs: number;
          fat: number;
        }>;
      };
    };

    assert.equal(donePayload.didLogMeal, false);
    assert.equal(donePayload.didMutateMeal, true);
    assert.equal(donePayload.affectedDate, "2026-03-25");
    assert.equal(donePayload.loggedMeal?.mealId, mealId);
    assert.match(donePayload.loggedMeal?.mealRevisionId ?? "", /^[0-9a-f-]{36}:r\d+$/);
    assert.equal(donePayload.loggedMeal?.dateKey, "2026-03-25");
    assert.match(donePayload.loggedMeal?.loggedAt ?? "", /^2026-03-25T/);
    assert.equal(donePayload.loggedMeal?.foodName, "半碗牛肉麵");
    assert.equal(donePayload.loggedMeal?.calories, 360);
    assert.equal(donePayload.loggedMeal?.protein, 20);
    assert.equal(donePayload.loggedMeal?.carbs, 45);
    assert.equal(donePayload.loggedMeal?.fat, 10);
    assert.deepEqual(donePayload.loggedMeal?.items, [
      { name: "半碗牛肉麵", position: 0, calories: 360, protein: 20, carbs: 45, fat: 10 },
    ]);
    assert.match(chunkText, /已更新(?:3\/25 )?半碗牛肉麵，360 kcal，蛋白質 20 g/);
    assert.doesNotMatch(chunkText, /蛋餅|330 kcal|14 g|5\/5|（5\/5）|可信蛋白/);
  });

  it("POST /api/chat stream done projects unavailable summaryOutcome for committed log mutations", async () => {
    assert.ok(services, "expected app services");
    services.summaryService.getDailySummary = async () => {
      throw new Error("summary recomputation failed after stream log");
    };
    services.foodLoggingService.getMealsByDate = async () => {
      throw new Error("summary recovery failed after stream log");
    };
    mockLLM.queueRoundResponse({ toolCalls: [createTrustedLogFoodToolCall()] });

    const form = new FormData();
    form.append("message", "我吃了雞腿便當");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: form,
    });

    assert.ok(res.body);
    const text = await readStreamUntil(res.body.getReader(), "event: done");
    const donePayload = JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data) as {
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      loggedMeal?: { mealId?: string; foodName?: string };
      dailySummary?: unknown;
      summaryOutcome?: SummaryOutcome;
    };

    assert.equal(donePayload.didLogMeal, true);
    assert.equal(donePayload.didMutateMeal, true);
    assert.match(donePayload.loggedMeal?.mealId ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(donePayload.loggedMeal?.foodName, "雞腿便當");
    assertUnavailableSummaryOutcome(donePayload.summaryOutcome);
    assert.equal(Object.prototype.hasOwnProperty.call(donePayload, "dailySummary"), false);
    assertNoPublishFailurePayload(donePayload);
  });

  it("POST /api/chat stream done projects unavailable summaryOutcome for committed update mutations", async () => {
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "seed_update_unavailable_stream",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "牛肉麵",
                calories: 520,
                protein: 24,
                carbs: 68,
                fat: 16,
              },
            ],
            date_text: "2026-03-25",
            meal_period: "dinner",
          }),
        },
      }],
    });
    const seedForm = new FormData();
    seedForm.append("message", "幫我補記 2026-03-25 晚餐吃牛肉麵");
    const seedRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: seedForm,
    });
    assert.ok(seedRes.body);
    const seedText = await readStreamUntil(seedRes.body.getReader(), "event: done");
    const seedPayload = JSON.parse(parseSSEEvents(seedText).find((event) => event.event === "done")!.data) as {
      loggedMeal?: { mealId?: string };
    };
    const mealId = seedPayload.loggedMeal?.mealId;
    assert.ok(mealId);

    assert.ok(services, "expected app services");
    services.summaryService.getDailySummary = async () => {
      throw new Error("summary recomputation failed after stream update");
    };
    services.foodLoggingService.getMealsByDate = async () => {
      throw new Error("summary recovery failed after stream update");
    };
    mockLLM.queueRoundResponse({
      toolCalls: [
        createFindMealsToolCall("update", "2026-03-25 晚餐牛肉麵"),
        createUpdateMealToolCall(mealId),
      ],
    });
    mockLLM.queueChatStream(["已更新半碗牛肉麵。"]);

    const form = new FormData();
    form.append("message", "把 2026-03-25 晚餐牛肉麵改成半碗，熱量 360 卡，蛋白質 20g，碳水 45g，脂肪 10g");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: form,
    });

    assert.ok(res.body);
    const text = await readStreamUntil(res.body.getReader(), "event: done");
    const donePayload = JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data) as {
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      affectedDate?: string;
      loggedMeal?: { mealId?: string; foodName?: string };
      dailySummary?: unknown;
      summaryOutcome?: SummaryOutcome;
    };

    assert.equal(donePayload.didLogMeal, false);
    assert.equal(donePayload.didMutateMeal, true);
    assert.equal(donePayload.affectedDate, "2026-03-25");
    assert.equal(donePayload.loggedMeal?.mealId, mealId);
    assert.equal(donePayload.loggedMeal?.foodName, "半碗牛肉麵");
    assertUnavailableSummaryOutcome(donePayload.summaryOutcome);
    assert.equal(Object.prototype.hasOwnProperty.call(donePayload, "dailySummary"), false);
    assertNoPublishFailurePayload(donePayload);
  });

  it("POST /api/chat SSE blocked numeric correction emits renderer no-update terminal payload", async () => {
    assert.ok(services, "expected app services");
    const original = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    mockLLM.queueRoundResponse({
      toolCalls: [
        createFindMealsToolCall("update", "雞腿飯蛋白質怪怪的，幫我改合理一點"),
        createProteinUpdateMealToolCall(original.id, 24),
      ],
    });
    mockLLM.queueChatStream(["已更新雞腿飯，蛋白質 24 g。"]);

    const form = new FormData();
    form.append("message", "雞腿飯蛋白質怪怪的，幫我改合理一點");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: form,
    });

    assert.ok(res.body);
    const text = await readStreamUntil(res.body.getReader(), "event: done");
    const events = parseSSEEvents(text);
    const chunkText = events
      .filter((event) => event.event === "chunk")
      .map((event) => JSON.parse(event.data) as { token: string })
      .map((payload) => payload.token)
      .join("");
    const donePayload = JSON.parse(events.find((event) => event.event === "done")!.data) as {
      didLogMeal?: boolean;
      didMutateMeal?: boolean;
      dailySummary?: unknown;
      summaryOutcome?: unknown;
      loggedMeal?: unknown;
    };

    assert.equal(chunkText, renderMealNumericAuthorityFailureCopy({ field: "protein" }));
    assert.doesNotMatch(chunkText, /已更新|更新好了|已經幫你更新|蛋白質 24 g/);
    assert.equal(donePayload.didLogMeal, false);
    assert.equal(donePayload.didMutateMeal, false);
    assert.equal(donePayload.loggedMeal, undefined);
    assert.equal(Object.prototype.hasOwnProperty.call(donePayload, "dailySummary"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(donePayload, "summaryOutcome"), false);

    const meals = await services.foodLoggingService.getMealsByDate(
      deviceId,
      new Date("2026-04-19T12:00:00+08:00"),
    );
    const current = meals.find((meal) => meal.id === original.id);
    assert.equal(current?.mealRevisionId, original.mealRevisionId);
    assert.equal(current?.protein, 30);
  });

  it("POST /api/chat stream done projects unavailable summaryOutcome for committed delete mutations", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createTrustedLogFoodToolCall()] });
    const seedForm = new FormData();
    seedForm.append("message", "我吃了雞腿便當");
    const seedRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: seedForm,
    });
    assert.ok(seedRes.body);
    await readStreamUntil(seedRes.body.getReader(), "event: done");

    const mealsRes = await fetch(`${address}/api/meals`, {
      headers: { cookie: sessionCookieHeader },
    });
    const mealsJson = await mealsRes.json() as { meals: Array<{ id: string }> };
    const mealId = mealsJson.meals[0]?.id;
    assert.ok(mealId);

    mockLLM.queueRoundResponse({
      toolCalls: [
        createFindMealsToolCall("delete", "雞腿便當"),
        createDeleteMealToolCall(mealId),
      ],
    });

    const form = new FormData();
    form.append("message", "刪除雞腿便當");

    const setupRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: form,
    });

    assert.ok(setupRes.body);
    const setupText = await readStreamUntil(setupRes.body.getReader(), "event: done");
    const setupPayload = JSON.parse(parseSSEEvents(setupText).find((event) => event.event === "done")!.data) as {
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      deletedMealId?: string;
      summaryOutcome?: SummaryOutcome;
    };
    assert.equal(setupPayload.didLogMeal, false);
    assert.equal(setupPayload.didMutateMeal, false);
    assert.equal(setupPayload.deletedMealId, undefined);
    assert.equal(setupPayload.summaryOutcome, undefined);
    assert.match(setupText, /即將刪除：雞腿便當/);

    assert.ok(services, "expected app services");
    services.summaryService.getDailySummary = async () => {
      throw new Error("summary recomputation failed after stream delete");
    };
    services.foodLoggingService.getMealsByDate = async () => {
      throw new Error("summary recovery failed after stream delete");
    };
    const confirmForm = new FormData();
    confirmForm.append("message", "好");
    const confirmRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: confirmForm,
    });

    assert.ok(confirmRes.body);
    const text = await readStreamUntil(confirmRes.body.getReader(), "event: done");
    const donePayload = JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data) as {
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      affectedDate?: string;
      deletedMealId?: string;
      loggedMeal?: unknown;
      dailySummary?: unknown;
      summaryOutcome?: SummaryOutcome;
    };

    assert.equal(donePayload.didLogMeal, false);
    assert.equal(donePayload.didMutateMeal, true);
    assert.equal(donePayload.deletedMealId, mealId);
    assert.match(donePayload.affectedDate ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(donePayload.loggedMeal, undefined);
    assertUnavailableSummaryOutcome(donePayload.summaryOutcome);
    assert.equal(Object.prototype.hasOwnProperty.call(donePayload, "dailySummary"), false);
    assertNoPublishFailurePayload(donePayload);
  });

  it("POST /api/chat stopped stream projects summaryOutcome for committed mutations", async () => {
    assert.ok(services, "expected app services");
    const originalHandleMessage = services.orchestrator.handleMessage.bind(services.orchestrator);
    services.orchestrator.handleMessage = async (_requestDeviceId, _userMessage, _imageBase64, _assetRef, opts) => {
      opts?.onUserMessageSaved?.();
      return {
        streamGenerator: streamTokensUntilAbort(["已"], opts?.signal, () => {}),
        didLogMeal: false,
        didMutateMeal: true,
        affectedDate: "2026-03-25",
        summaryOutcome: { status: "unavailable", reason: "recompute_failed" },
      };
    };

    const form = new FormData();
    form.append("message", "刪除 2026-03-25 牛肉麵");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: form,
    });
    assert.ok(res.body);
    const reader = res.body.getReader();
    const startText = await readStreamUntil(reader, "event: chunk");
    const startPayload = parseSSEEvents(startText).find((event) => event.event === "start");
    assert.ok(startPayload);
    const turnId = (JSON.parse(startPayload.data) as { turnId?: string }).turnId;
    assert.ok(turnId);

    const stopRes = await fetch(`${address}/api/chat/stop`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ turnId }),
    });
    assert.equal(stopRes.status, 200);

    try {
      const stoppedText = startText + await readStreamUntil(reader, "event: stopped");
      const stoppedPayload = JSON.parse(parseSSEEvents(stoppedText).find((event) => event.event === "stopped")!.data) as {
        stopped?: boolean;
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        affectedDate?: string;
        dailySummary?: unknown;
        summaryOutcome?: SummaryOutcome;
      };
      assert.equal(stoppedPayload.stopped, true);
      assert.equal(stoppedPayload.didLogMeal, false);
      assert.equal(stoppedPayload.didMutateMeal, true);
      assert.equal(stoppedPayload.affectedDate, "2026-03-25");
      assertUnavailableSummaryOutcome(stoppedPayload.summaryOutcome);
      assert.equal(Object.prototype.hasOwnProperty.call(stoppedPayload, "dailySummary"), false);
      assertNoPublishFailurePayload(stoppedPayload);
    } finally {
      services.orchestrator.handleMessage = originalHandleMessage;
      await reader.cancel().catch(() => {});
    }
  });

  it("POST /api/chat stream done keeps delete_meal confirmations non-editable", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createTrustedLogFoodToolCall()] });
    const seedForm = new FormData();
    seedForm.append("message", "我吃了雞腿便當");
    const seedRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: seedForm,
    });
    assert.ok(seedRes.body);
    await readStreamUntil(seedRes.body.getReader(), "event: done");

    const mealsRes = await fetch(`${address}/api/meals`, {
      headers: { cookie: sessionCookieHeader },
    });
    const mealsJson = await mealsRes.json() as { meals: Array<{ id: string }> };
    const mealId = mealsJson.meals[0]?.id;
    assert.ok(mealId);

    mockLLM.queueRoundResponse({
      toolCalls: [
        createFindMealsToolCall("delete", "雞腿便當"),
        createDeleteMealToolCall(mealId),
      ],
    });

    const form = new FormData();
    form.append("message", "刪除雞腿便當");

    const setupRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: form,
    });

    assert.ok(setupRes.body);
    const setupText = await readStreamUntil(setupRes.body.getReader(), "event: done");
    assert.match(setupText, /即將刪除：雞腿便當/);
    assert.doesNotMatch(setupText, /已刪除雞腿便當/);
    const setupDoneDataMatch = setupText.match(/event: done\s+data: (.+)\s*/);
    assert.ok(setupDoneDataMatch);
    const setupDonePayload = JSON.parse(setupDoneDataMatch[1]) as {
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      deletedMealId?: string;
    };
    assert.equal(setupDonePayload.didLogMeal, false);
    assert.equal(setupDonePayload.didMutateMeal, false);
    assert.equal(setupDonePayload.deletedMealId, undefined);
    const mealsAfterSetupRes = await fetch(`${address}/api/meals`, {
      headers: { cookie: sessionCookieHeader },
    });
    const mealsAfterSetupJson = await mealsAfterSetupRes.json() as { meals: Array<{ id: string }> };
    assert.equal(mealsAfterSetupJson.meals.some((meal) => meal.id === mealId), true);

    const confirmForm = new FormData();
    confirmForm.append("message", "好");
    const confirmRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: confirmForm,
    });

    assert.ok(confirmRes.body);
    const text = await readStreamUntil(confirmRes.body.getReader(), "event: done");
    assert.match(text, /已刪除雞腿便當，已從當日紀錄移除。/);
    assert.doesNotMatch(text, /無法辨識這次的請求/);
    const doneDataMatch = text.match(/event: done\s+data: (.+)\s*/);
    assert.ok(doneDataMatch);
    const donePayload = JSON.parse(doneDataMatch[1]) as {
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      deletedMealId?: string;
      loggedMeal?: unknown;
    };
    assert.equal(donePayload.didLogMeal, false);
    assert.equal(donePayload.didMutateMeal, true);
    assert.equal(donePayload.deletedMealId, mealId);
    assert.equal(donePayload.loggedMeal, undefined);

    const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
      headers: { cookie: sessionCookieHeader },
    });
    const historyJson = await historyRes.json() as {
      messages: Array<{
        role: string;
        content?: string;
        loggedMeal?: {
          receiptStatus?: string;
          mealId?: string;
          mealRevisionId?: string;
          dateKey?: string;
          foodName?: string;
          calories?: number;
        };
      }>;
    };
    const loggedReceiptMessage = historyJson.messages.find((message) =>
      message.role === "assistant" && message.loggedMeal?.foodName === "雞腿便當"
    );
    assert.equal(loggedReceiptMessage?.loggedMeal?.receiptStatus, "deleted");
    assert.equal(loggedReceiptMessage?.loggedMeal?.mealId, undefined);
    assert.equal(loggedReceiptMessage?.loggedMeal?.mealRevisionId, undefined);
    assert.equal(loggedReceiptMessage?.loggedMeal?.dateKey, undefined);
    assert.equal(loggedReceiptMessage?.loggedMeal?.calories, 620);

    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_summary_after_delete",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatStream(["今天還有雞腿便當", "，約 620 kcal。"]);

    const summaryForm = new FormData();
    summaryForm.append("message", "今天吃了什麼？");
    const summaryRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: summaryForm,
    });
    assert.ok(summaryRes.body);
    const summaryText = await readStreamUntil(summaryRes.body.getReader(), "event: done");
    const summaryEvents = parseSSEEvents(summaryText);
    const chunkText = summaryEvents
      .filter((event) => event.event === "chunk")
      .map((event) => JSON.parse(event.data) as { token: string })
      .map((payload) => payload.token)
      .join("");
    const summaryDonePayload = JSON.parse(summaryEvents.find((event) => event.event === "done")!.data) as {
      didLogMeal?: boolean;
      didMutateMeal?: boolean;
      dailySummary?: { mealCount?: number; totalCalories?: number };
    };
    assert.equal(summaryDonePayload.didLogMeal, false);
    assert.equal(summaryDonePayload.didMutateMeal, false);
    assert.equal(summaryDonePayload.dailySummary?.mealCount, 0);
    assert.equal(summaryDonePayload.dailySummary?.totalCalories, 0);
    assert.doesNotMatch(chunkText, /雞腿便當|620 kcal/);
  });

  it("POST /api/chat JSON path replaces delete_meal choice prompt after mutation", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createTrustedLogFoodToolCall()] });
    const seedForm = new FormData();
    seedForm.append("message", "我吃了雞腿便當");
    const seedRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: seedForm,
    });
    assert.ok(seedRes.body);
    await readStreamUntil(seedRes.body.getReader(), "event: done");

    const mealsBeforeRes = await fetch(`${address}/api/meals`, {
      headers: { cookie: sessionCookieHeader },
    });
    const mealsBeforeJson = await mealsBeforeRes.json() as { meals: Array<{ id: string }> };
    const mealId = mealsBeforeJson.meals[0]?.id;
    assert.ok(mealId);

    mockLLM.queueRoundResponse({
      toolCalls: [
        createFindMealsToolCall("delete", "雞腿便當"),
        createDeleteMealToolCall(mealId),
      ],
    });
    mockLLM.queueChatStream([
      "方式1 直接刪除這筆餐點\n",
      "方式2 先不要刪除",
    ]);

    const form = new FormData();
    form.append("message", "刪除雞腿便當");

    const setupRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(setupRes.status, 200);
    const setupBody = await setupRes.json() as {
      reply: string;
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      deletedMealId?: string;
      loggedMeal?: unknown;
    };
    assert.equal(setupBody.didLogMeal, false);
    assert.equal(setupBody.didMutateMeal, false);
    assert.equal(setupBody.deletedMealId, undefined);
    assert.equal(setupBody.loggedMeal, undefined);
    assert.match(setupBody.reply, /即將刪除：雞腿便當/);
    assert.doesNotMatch(setupBody.reply, /已刪除|方式1|方式2|無法辨識/);
    const mealsAfterSetupRes = await fetch(`${address}/api/meals`, {
      headers: { cookie: sessionCookieHeader },
    });
    const mealsAfterSetupJson = await mealsAfterSetupRes.json() as { meals: Array<{ id: string }> };
    assert.equal(mealsAfterSetupJson.meals.some((meal) => meal.id === mealId), true);

    const confirmForm = new FormData();
    confirmForm.append("message", "好");
    const confirmRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: confirmForm,
    });

    assert.equal(confirmRes.status, 200);
    const body = await confirmRes.json() as {
      reply: string;
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      deletedMealId?: string;
      loggedMeal?: unknown;
    };
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.equal(body.deletedMealId, mealId);
    assert.equal(body.loggedMeal, undefined);
    assert.match(body.reply, /已刪除雞腿便當，已從當日紀錄移除。/);
    assert.doesNotMatch(body.reply, /方式1|方式2|無法辨識/);

    const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(historyRes.status, 200);
    const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
    const assistantMessages = historyJson.messages.filter((message) => message.role === "assistant");
    const latestAssistant = assistantMessages.at(-1)?.content ?? "";
    assert.match(latestAssistant, /已刪除雞腿便當，已從當日紀錄移除。/);
    assert.doesNotMatch(latestAssistant, /方式1|方式2|無法辨識/);

    const mealsAfterRes = await fetch(`${address}/api/meals`, {
      headers: { cookie: sessionCookieHeader },
    });
    const mealsAfterJson = await mealsAfterRes.json() as { meals: Array<{ id: string }> };
    assert.equal(mealsAfterJson.meals.some((meal) => meal.id === mealId), false);
  });

  it("POST /api/chat stream bridges non-stream delete_meal replies through deterministic copy", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createTrustedLogFoodToolCall()] });
    const seedForm = new FormData();
    seedForm.append("message", "我吃了雞腿便當");
    const seedRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: seedForm,
    });
    assert.ok(seedRes.body);
    await readStreamUntil(seedRes.body.getReader(), "event: done");

    const mealsBeforeRes = await fetch(`${address}/api/meals`, {
      headers: { cookie: sessionCookieHeader },
    });
    const mealsBeforeJson = await mealsBeforeRes.json() as { meals: Array<{ id: string }> };
    const mealId = mealsBeforeJson.meals[0]?.id;
    assert.ok(mealId);

    mockLLM.queueRoundResponse({
      toolCalls: [
        createFindMealsToolCall("delete", "雞腿便當"),
        createDeleteMealToolCall(mealId),
      ],
    });
    mockLLM.queueRoundResponse({ content: "方式1 直接刪除這筆餐點\n方式2 先不要刪除" });

    const form = new FormData();
    form.append("message", "刪除雞腿便當");

    const setupRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: form,
    });

    assert.ok(setupRes.body);
    const setupText = await readStreamUntil(setupRes.body.getReader(), "event: done");
    assert.match(setupText, /即將刪除：雞腿便當/);
    assert.doesNotMatch(setupText, /已刪除|方式1|方式2|無法辨識|回覆生成失敗/);
    const setupDoneDataMatch = setupText.match(/event: done\s+data: (.+)\s*/);
    assert.ok(setupDoneDataMatch);
    const setupDonePayload = JSON.parse(setupDoneDataMatch[1]) as {
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      loggedMeal?: unknown;
    };
    assert.equal(setupDonePayload.didLogMeal, false);
    assert.equal(setupDonePayload.didMutateMeal, false);
    assert.equal(setupDonePayload.loggedMeal, undefined);
    const mealsAfterSetupRes = await fetch(`${address}/api/meals`, {
      headers: { cookie: sessionCookieHeader },
    });
    const mealsAfterSetupJson = await mealsAfterSetupRes.json() as { meals: Array<{ id: string }> };
    assert.equal(mealsAfterSetupJson.meals.some((meal) => meal.id === mealId), true);

    const confirmForm = new FormData();
    confirmForm.append("message", "好");
    const confirmRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: confirmForm,
    });

    assert.ok(confirmRes.body);
    const text = await readStreamUntil(confirmRes.body.getReader(), "event: done");
    assert.match(text, /已刪除雞腿便當，已從當日紀錄移除。/);
    assert.doesNotMatch(text, /方式1|方式2|無法辨識|回覆生成失敗/);
    const doneDataMatch = text.match(/event: done\s+data: (.+)\s*/);
    assert.ok(doneDataMatch);
    const donePayload = JSON.parse(doneDataMatch[1]) as {
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      loggedMeal?: unknown;
    };
    assert.equal(donePayload.didLogMeal, false);
    assert.equal(donePayload.didMutateMeal, true);
    assert.equal(donePayload.loggedMeal, undefined);

    const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
      headers: { cookie: sessionCookieHeader },
    });
    const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
    const latestAssistant = historyJson.messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
    assert.match(latestAssistant, /已刪除雞腿便當，已從當日紀錄移除。/);
    assert.doesNotMatch(latestAssistant, /方式1|方式2|無法辨識|回覆生成失敗/);
  });

  it("POST /api/chat JSON bridges non-stream delete_meal replies through deterministic copy", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createTrustedLogFoodToolCall()] });
    const seedForm = new FormData();
    seedForm.append("message", "我吃了雞腿便當");
    const seedRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
      body: seedForm,
    });
    assert.ok(seedRes.body);
    await readStreamUntil(seedRes.body.getReader(), "event: done");

    const mealsBeforeRes = await fetch(`${address}/api/meals`, {
      headers: { cookie: sessionCookieHeader },
    });
    const mealsBeforeJson = await mealsBeforeRes.json() as { meals: Array<{ id: string }> };
    const mealId = mealsBeforeJson.meals[0]?.id;
    assert.ok(mealId);

    mockLLM.queueRoundResponse({
      toolCalls: [
        createFindMealsToolCall("delete", "雞腿便當"),
        createDeleteMealToolCall(mealId),
      ],
    });
    mockLLM.queueRoundResponse({ content: "抱歉，無法辨識這次的請求，可以再試一次嗎？" });

    const form = new FormData();
    form.append("message", "刪除雞腿便當");

    const setupRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(setupRes.status, 200);
    const setupBody = await setupRes.json() as {
      reply: string;
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      loggedMeal?: unknown;
    };
    assert.equal(setupBody.didLogMeal, false);
    assert.equal(setupBody.didMutateMeal, false);
    assert.equal(setupBody.loggedMeal, undefined);
    assert.match(setupBody.reply, /即將刪除：雞腿便當/);
    assert.doesNotMatch(setupBody.reply, /方式1|方式2|無法辨識|回覆生成失敗|已刪除/);
    const mealsAfterSetupRes = await fetch(`${address}/api/meals`, {
      headers: { cookie: sessionCookieHeader },
    });
    const mealsAfterSetupJson = await mealsAfterSetupRes.json() as { meals: Array<{ id: string }> };
    assert.equal(mealsAfterSetupJson.meals.some((meal) => meal.id === mealId), true);

    const confirmForm = new FormData();
    confirmForm.append("message", "好");
    const confirmRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: confirmForm,
    });

    assert.equal(confirmRes.status, 200);
    const body = await confirmRes.json() as {
      reply: string;
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      loggedMeal?: unknown;
    };
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.equal(body.loggedMeal, undefined);
    assert.match(body.reply, /已刪除雞腿便當，已從當日紀錄移除。/);
    assert.doesNotMatch(body.reply, /方式1|方式2|無法辨識|回覆生成失敗/);

    const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
      headers: { cookie: sessionCookieHeader },
    });
    const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
    const latestAssistant = historyJson.messages.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
    assert.match(latestAssistant, /已刪除雞腿便當，已從當日紀錄移除。/);
    assert.doesNotMatch(latestAssistant, /方式1|方式2|無法辨識|回覆生成失敗/);
  });

  it("POST /api/chat stream appends a concrete date when the model only says yesterday", async () => {
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_historical_stream_relative_copy",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "牛肉麵",
                calories: 520,
                protein: 24,
                carbs: 68,
                fat: 16,
              },
            ],
            date_text: "2026-03-25",
            meal_period: "dinner",
          }),
        },
      }],
    });
    mockLLM.queueChatStream(["已幫你補記昨天晚餐：牛肉麵。"]);

    const form = new FormData();
    form.append("message", "幫我補記 2026-03-25 晚餐吃牛肉麵");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");
      assert.match(text, /3\/25/);

      const historyRes = await fetch(`${address}/api/chat/history?limit=5`, {
        headers: { cookie: sessionCookieHeader },
      });
      const historyJson = await historyRes.json();
      assert.match(historyJson.messages.at(-1)?.content ?? "", /3\/25/);
    } finally {
      await reader?.cancel();
      controller.abort();
      clearTimeout(timeout);
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
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
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

  it("POST /api/chat stream response includes local Vite CORS header", async () => {
    mockLLM.queueChatStream(["直接", "回覆"]);

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const controller = new AbortController();
    let timeout: ReturnType<typeof setTimeout> | undefined;

    try {
      timeout = setTimeout(() => controller.abort(), 2000);
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: {
          cookie: sessionCookieHeader,
          "Accept": "text/event-stream",
          "Origin": "http://localhost:5173",
        },
        signal: controller.signal,
        body: form,
      });

      assert.equal(res.headers.get("access-control-allow-origin"), "http://localhost:5173");
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
    form.append("image", new Blob([validJpegBytes()], { type: "image/jpeg" }), "food.jpg");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
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
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
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
    form.append("image", new Blob([validJpegBytes()], { type: "image/jpeg" }), "food.jpg");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
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
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
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
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
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
        headers: { cookie: sessionCookieHeader },
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
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
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
      const donePayload = JSON.parse(doneMatch[1]) as { didLogMeal: boolean; turnId?: string };
      assert.equal(donePayload.didLogMeal, false);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((m) => m.role === "assistant");
      assert.equal(assistantMsgs.length, 1, "exactly one assistant reply expected");
      assert.match(assistantMsgs[0]!.content, /無法辨識這次的請求/);

      const trace = traceRecorders[0]!.build({ scenario: "chat-streaming-test", status: "pass" });
      assert.deepEqual(trace.summary.finalReply, {
        source: "fallback",
        shape: "fallback_text",
      });
      assert.deepEqual(trace.timeline.at(-1), {
        type: "route_fallback",
        transport: "sse",
        turnId: donePayload.turnId,
        fallbackSource: "route_hallucination",
        didLogMeal: false,
        didMutateMeal: false,
        reason: "hallucination_detected",
      });
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
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
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
      assert.doesNotMatch(combinedChunkText, /已記錄|完成記錄/);
      assert.match(combinedChunkText, /還沒有把這餐寫入紀錄/);
      assert.match(text, /event: done/);
      assert.doesNotMatch(text, /無法辨識這次的請求/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat summary-context stream preserves empty-day summary semantics before visible chunks", async () => {
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_streaming_summary_false_log",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatStream(["今天", "已記錄", "牛肉飯", "，650 kcal。"]);

    const form = new FormData();
    form.append("message", "今天吃了什麼？");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const events = parseSSEEvents(text);
      const chunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");
      const donePayload = JSON.parse(events.find((event) => event.event === "done")!.data) as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        dailySummary?: { mealCount?: number; totalCalories?: number };
      };

      assert.equal(donePayload.didLogMeal, false);
      assert.equal(donePayload.didMutateMeal, false);
      assert.equal(donePayload.dailySummary?.mealCount, 0);
      assert.equal(donePayload.dailySummary?.totalCalories, 0);
      assert.equal(chunkText, "今天已記錄 0 餐，共 0 kcal。");
      assert.doesNotMatch(chunkText, /今天已記錄牛肉飯|已記錄牛肉飯|牛肉飯，650 kcal/);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((message) => message.role === "assistant");
      assert.equal(assistantMsgs.length, 1);
      assert.equal(assistantMsgs[0]!.content, chunkText);
      assert.equal(assistantMsgs[0]!.content, "今天已記錄 0 餐，共 0 kcal。");
      assert.doesNotMatch(assistantMsgs[0]!.content, /今天已記錄牛肉飯|已記錄牛肉飯|牛肉飯，650 kcal/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat summary-context stream preserves legitimate one-meal summary replies", async () => {
    assert.ok(services);
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "豆腐飯", calories: 520, protein: 24, carbs: 70, fat: 14 },
      ],
    });
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_streaming_summary_tofu",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatStream(["目前已記錄的餐點有", "豆腐飯", "，約 520 kcal。"]);

    const form = new FormData();
    form.append("message", "列出今天記錄的餐點");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const events = parseSSEEvents(text);
      const chunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");
      const donePayload = JSON.parse(events.find((event) => event.event === "done")!.data) as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        dailySummary?: { mealCount?: number; totalCalories?: number };
      };

      assert.equal(donePayload.didLogMeal, false);
      assert.equal(donePayload.didMutateMeal, false);
      assert.equal(donePayload.dailySummary?.mealCount, 1);
      assert.equal(donePayload.dailySummary?.totalCalories, 520);
      assert.equal(chunkText, "今天已記錄 1 餐，共 520 kcal：豆腐飯 520 kcal。");

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((message) => message.role === "assistant");
      assert.equal(assistantMsgs.length, 1);
      assert.equal(assistantMsgs[0]!.content, "今天已記錄 1 餐，共 520 kcal：豆腐飯 520 kcal。");
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat summary-context stream preserves legitimate aggregate summary replies", async () => {
    assert.ok(services);
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "雞胸肉", calories: 450, protein: 45, carbs: 30, fat: 10 },
      ],
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "鮭魚飯", calories: 450, protein: 35, carbs: 45, fat: 14 },
      ],
    });
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_streaming_summary_aggregate",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatStream(["今天已記錄 ", "2 餐，", "共 900 kcal。"]);

    const form = new FormData();
    form.append("message", "今天吃了多少？");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const events = parseSSEEvents(text);
      const chunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");
      const donePayload = JSON.parse(events.find((event) => event.event === "done")!.data) as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        dailySummary?: { mealCount?: number; totalCalories?: number };
      };

      assert.equal(donePayload.didLogMeal, false);
      assert.equal(donePayload.didMutateMeal, false);
      assert.equal(donePayload.dailySummary?.mealCount, 2);
      assert.equal(donePayload.dailySummary?.totalCalories, 900);
      assert.equal(chunkText, "今天已記錄 2 餐，共 900 kcal：雞胸肉 450 kcal、鮭魚飯 450 kcal。");

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((message) => message.role === "assistant");
      assert.equal(assistantMsgs.length, 1);
      assert.equal(assistantMsgs[0]!.content, "今天已記錄 2 餐，共 900 kcal：雞胸肉 450 kcal、鮭魚飯 450 kcal。");
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat summary-context stream emits composed persisted facts without unsafe model meal facts", async () => {
    assert.ok(services);
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "豆腐飯", calories: 520, protein: 24, carbs: 70, fat: 14 },
      ],
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "鮭魚飯", calories: 380, protein: 30, carbs: 42, fat: 12 },
      ],
    });
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_streaming_summary_canonical",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatStream(["今天已記錄 2 餐，", "共 900 kcal，", "其中包含牛肉飯和滷肉飯，", "豆腐飯 900 kcal。"]);

    const form = new FormData();
    form.append("message", "今天吃了什麼？");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const events = parseSSEEvents(text);
      const chunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");
      const donePayload = JSON.parse(events.find((event) => event.event === "done")!.data) as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        dailySummary?: { mealCount?: number; totalCalories?: number };
      };

      assert.equal(donePayload.didLogMeal, false);
      assert.equal(donePayload.didMutateMeal, false);
      assert.equal(donePayload.dailySummary?.mealCount, 2);
      assert.equal(donePayload.dailySummary?.totalCalories, 900);
      assert.equal(chunkText, canonicalSummaryText);
      assert.doesNotMatch(chunkText, unsafeSummaryFactPattern);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((message) => message.role === "assistant");
      assert.equal(assistantMsgs.length, 1);
      assert.equal(assistantMsgs[0]!.content, chunkText);
      assert.equal(assistantMsgs[0]!.content, canonicalSummaryText);
      assert.doesNotMatch(assistantMsgs[0]!.content, unsafeSummaryFactPattern);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat summary-context stream rejects assigning the daily total to one named meal", async () => {
    assert.ok(services);
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "雞胸肉", calories: 450, protein: 45, carbs: 30, fat: 10 },
      ],
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "鮭魚飯", calories: 450, protein: 35, carbs: 45, fat: 14 },
      ],
    });
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_streaming_summary_single_total",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatStream(["今天已記錄 2 餐，", "共 900 kcal，", "其中包含雞胸肉 900 kcal。"]);

    const form = new FormData();
    form.append("message", "今天吃了什麼？");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const events = parseSSEEvents(text);
      const chunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");
      const donePayload = JSON.parse(events.find((event) => event.event === "done")!.data) as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        dailySummary?: { mealCount?: number; totalCalories?: number };
      };

      assert.equal(donePayload.didLogMeal, false);
      assert.equal(donePayload.didMutateMeal, false);
      assert.equal(donePayload.dailySummary?.mealCount, 2);
      assert.equal(donePayload.dailySummary?.totalCalories, 900);
      assert.equal(chunkText, "今天已記錄 2 餐，共 900 kcal：雞胸肉 450 kcal、鮭魚飯 450 kcal。");
      assert.doesNotMatch(chunkText, /其中包含雞胸肉 900 kcal|雞胸肉 900 kcal/);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((message) => message.role === "assistant");
      assert.equal(assistantMsgs.length, 1);
      assert.equal(assistantMsgs[0]!.content, chunkText);
      assert.doesNotMatch(assistantMsgs[0]!.content, /其中包含雞胸肉 900 kcal|雞胸肉 900 kcal/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat summary-context stream rejects fake meal lists even when count and total match", async () => {
    assert.ok(services);
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "雞胸肉", calories: 450, protein: 45, carbs: 30, fat: 10 },
      ],
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "鮭魚飯", calories: 450, protein: 35, carbs: 45, fat: 14 },
      ],
    });
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_streaming_summary_fake_list",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatStream(["今天已記錄 2 餐，", "共 900 kcal，", "其中包含牛肉飯 900 kcal。"]);

    const form = new FormData();
    form.append("message", "今天吃了什麼？");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const events = parseSSEEvents(text);
      const chunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");
      const donePayload = JSON.parse(events.find((event) => event.event === "done")!.data) as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        dailySummary?: { mealCount?: number; totalCalories?: number };
      };

      assert.equal(donePayload.didLogMeal, false);
      assert.equal(donePayload.didMutateMeal, false);
      assert.equal(donePayload.dailySummary?.mealCount, 2);
      assert.equal(donePayload.dailySummary?.totalCalories, 900);
      assert.equal(chunkText, "今天已記錄 2 餐，共 900 kcal：雞胸肉 450 kcal、鮭魚飯 450 kcal。");
      assert.doesNotMatch(chunkText, /牛肉飯/);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((message) => message.role === "assistant");
      assert.equal(assistantMsgs.length, 1);
      assert.equal(assistantMsgs[0]!.content, chunkText);
      assert.doesNotMatch(assistantMsgs[0]!.content, /牛肉飯/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat summary-context stream rejects aggregate summary count and calorie mismatches", async () => {
    assert.ok(services);
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "雞胸肉", calories: 450, protein: 45, carbs: 30, fat: 10 },
      ],
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "鮭魚飯", calories: 450, protein: 35, carbs: 45, fat: 14 },
      ],
    });
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_streaming_summary_aggregate_mismatch",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatStream(["今天已記錄 ", "3 餐，", "共 1200 kcal。"]);

    const form = new FormData();
    form.append("message", "今天吃了多少？");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const events = parseSSEEvents(text);
      const chunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");
      const donePayload = JSON.parse(events.find((event) => event.event === "done")!.data) as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        dailySummary?: { mealCount?: number; totalCalories?: number };
      };

      assert.equal(donePayload.didLogMeal, false);
      assert.equal(donePayload.didMutateMeal, false);
      assert.equal(donePayload.dailySummary?.mealCount, 2);
      assert.equal(donePayload.dailySummary?.totalCalories, 900);
      assert.equal(chunkText, "今天已記錄 2 餐，共 900 kcal：雞胸肉 450 kcal、鮭魚飯 450 kcal。");
      assert.doesNotMatch(chunkText, /3 餐|1200 kcal/);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((message) => message.role === "assistant");
      assert.equal(assistantMsgs.length, 1);
      assert.equal(assistantMsgs[0]!.content, chunkText);
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
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
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
        headers: { cookie: sessionCookieHeader },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((m) => m.role === "assistant");
      assert.equal(assistantMsgs.length, 1, "catch block must write exactly one assistant fallback");
      assert.match(assistantMsgs[0]!.content, /抱歉|無法/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat SSE outer catch emits sanitized route fallback without completed turn", async () => {
    assert.ok(services);
    const originalGetCompressedHistory = services.chatService.getCompressedHistory.bind(services.chatService);
    services.chatService.getCompressedHistory = async () => {
      throw new Error("SseOuterSafeFailure");
    };

    const form = new FormData();
    form.append("message", "今天午餐是豆腐");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const donePayload = JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data) as { turnId?: string };
      assert.match(donePayload.turnId ?? "", UUID_PATTERN);

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.deepEqual({
        source: fallbackEvents[0]!.source,
        turnId: fallbackEvents[0]!.turnId,
        fallbackSource: fallbackEvents[0]!.fallbackSource,
        reason: fallbackEvents[0]!.reason,
        catchSite: fallbackEvents[0]!.catchSite,
        errorName: fallbackEvents[0]!.errorName,
        errorMessage: fallbackEvents[0]!.errorMessage,
      }, {
        source: "sse",
        turnId: donePayload.turnId,
        fallbackSource: "route_catch",
        reason: "route_catch",
        catchSite: "sse_outer",
        errorName: "Error",
        errorMessage: "SseOuterSafeFailure",
      });

      const trace = traceRecorders[0]!.build({ scenario: "sse-route-catch", status: "pass" });
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.turnId, donePayload.turnId);
      assert.equal(routeFallbacks[0]!.fallbackSource, "route_catch");
      assert.equal(routeFallbacks[0]!.reason, "route_catch");
      assert.equal(routeFallbacks[0]!.catchSite, "sse_outer");
      assert.equal(routeFallbacks[0]!.errorName, "Error");
      assert.equal(routeFallbacks[0]!.errorMessage, "SseOuterSafeFailure");
      assert.equal(trace.timeline.some((event) => event.type === "route_completion"), false);
    } finally {
      services.chatService.getCompressedHistory = originalGetCompressedHistory;
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat SSE persistence catch emits sse_persist route fallback", async () => {
    assert.ok(services);
    const originalGetCompressedHistory = services.chatService.getCompressedHistory.bind(services.chatService);
    const originalSaveMessage = services.chatService.saveMessage.bind(services.chatService);
    services.chatService.getCompressedHistory = async () => {
      throw new Error("SseOuterBeforePersist");
    };
    services.chatService.saveMessage = async () => {
      throw new Error("SsePersistSafeFailure");
    };

    const form = new FormData();
    form.append("message", "今天午餐是豆腐");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const donePayload = JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data) as { turnId?: string };
      assert.match(text, /event: done/);

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.equal(fallbackEvents[0]!.turnId, donePayload.turnId);
      assert.equal(fallbackEvents[0]!.fallbackSource, "route_catch");
      assert.equal(fallbackEvents[0]!.reason, "route_catch");
      assert.equal(fallbackEvents[0]!.catchSite, "sse_persist");
      assert.equal(fallbackEvents[0]!.errorName, "Error");
      assert.equal(fallbackEvents[0]!.errorMessage, "SsePersistSafeFailure");

      const trace = traceRecorders[0]!.build({ scenario: "sse-route-persist-catch", status: "pass" });
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.turnId, donePayload.turnId);
      assert.equal(routeFallbacks[0]!.catchSite, "sse_persist");
      assert.equal(routeFallbacks[0]!.errorMessage, "SsePersistSafeFailure");
      assert.equal(trace.timeline.some((event) => event.type === "route_completion"), false);
    } finally {
      services.chatService.getCompressedHistory = originalGetCompressedHistory;
      services.chatService.saveMessage = originalSaveMessage;
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat SSE persistence catch omits receipt identity after committed log_food", async () => {
    assert.ok(services, "expected app services");
    const chatService = services.chatService;
    installAtomicReceiptPersistenceFailure(chatService);
    const originalSaveMessage = chatService.saveMessage.bind(chatService);
    chatService.saveMessage = async (
      ...args: Parameters<typeof chatService.saveMessage>
    ) => {
      const [, role] = args;
      if (role === "assistant") {
        throw new Error("SseReceiptAssistantPersistFailure");
      }
      return originalSaveMessage(...args);
    };

    mockLLM.queueRoundResponse({ toolCalls: [createTrustedLogFoodToolCall()] });
    mockLLM.queueChatStream(["已幫你記錄雞腿便當！這段不應曝光。"]);

    const form = new FormData();
    form.append("message", "raw-user-food-雞腿便當");
    form.append("image", new Blob([validPngBytes()], { type: "image/png" }), "meal.png");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");
      const donePayload = JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data) as Record<string, unknown>;
      assert.equal(donePayload.didLogMeal, true);
      assert.deepEqual(await readdir(uploadsDir).catch(() => []), [], "staged uploads must be cleaned after receipt persistence failure");
      assertNoReceiptIdentityProjection(donePayload, "SSE persistence catch atomic failure payload");

      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(fallbackEvents.at(-1)?.catchSite, "sse_persist");

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      assert.equal(historyRes.status, 200);
      const historyJson = await historyRes.json() as {
        messages: Array<{ role: string; content?: string; loggedMeal?: unknown }>;
      };
      const assistant = latestAssistantMessage(historyJson.messages);
      if (assistant) {
        assertNoReceiptIdentityProjection(assistant, "SSE persistence catch atomic failure history assistant");
      }
    } finally {
      chatService.saveMessage = originalSaveMessage;
      clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      controller.abort();
    }
  });

  it("POST /api/chat SSE catch omits unsafe thrown material from fallback logs and trace", async () => {
    assert.ok(services);
    const originalGetCompressedHistory = services.chatService.getCompressedHistory.bind(services.chatService);
    const rawMealText = "機密營養文字";
    const unsafeErrorMessage = `prompt ${rawMealText} provider body header tool payload assistant final text data:image guest_session`;
    services.chatService.getCompressedHistory = async () => {
      const error = new Error(unsafeErrorMessage);
      (error as Error & { cause?: unknown }).cause = new Error("CAUSE_SECRET");
      throw error;
    };

    const form = new FormData();
    form.append("message", rawMealText);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const text = await readStreamUntil(res.body.getReader(), "event: done");
      const donePayload = JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data) as { turnId?: string };
      assert.match(donePayload.turnId ?? "", UUID_PATTERN);

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.equal(fallbackEvents[0]!.catchSite, "sse_outer");
      assert.equal("errorName" in fallbackEvents[0]!, false);
      assert.equal("errorMessage" in fallbackEvents[0]!, false);

      const trace = traceRecorders[0]!.build({ scenario: "sse-route-catch-redaction", status: "pass" });
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.catchSite, "sse_outer");
      assert.equal("errorName" in routeFallbacks[0]!, false);
      assert.equal("errorMessage" in routeFallbacks[0]!, false);

      const serializedLogs = JSON.stringify(parseLogLines(logLines));
      const serializedTrace = JSON.stringify(trace);
      for (const serialized of [serializedLogs, serializedTrace]) {
        assert.ok(!serialized.includes(rawMealText));
        assert.doesNotMatch(serialized, /CAUSE_SECRET|prompt 機密營養文字|provider body|header|tool payload|assistant final text|data:image|guest_session|stack/);
      }
    } finally {
      services.chatService.getCompressedHistory = originalGetCompressedHistory;
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
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");

      assert.match(text, /event: done/);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
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

  it("POST /api/chat feeds invalid log_food required fields back for retry and falls back deterministically when rounds exhaust", async () => {
    // Phase 83 (D-02): schema_validation no longer throws to the route catch.
    // Every round queues the same schema-invalid call so MAX_ROUNDS exhausts and
    // the deterministic orchestrator FALLBACK copy terminates the turn (D-03).
    // No terminal model text is queued, so guardNoMutationLoggingClaim cannot
    // fire (83-RESEARCH OQ-3).
    for (let i = 0; i < 3; i += 1) {
      mockLLM.queueRoundResponse({
        toolCalls: [createLogFoodToolCallWithArguments(JSON.stringify({
          items: [
            {
              food_name: {},
              calories: null,
              protein: "",
              carbs: null,
              fat: null,
            },
          ],
        }))],
      });
    }

    const form = new FormData();
    form.append("message", "我吃了蘋果");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");

      assert.match(text, /event: done/);
      const donePayload = JSON.parse(parseSSEEvents(text).find((event) => event.event === "done")!.data) as {
        didLogMeal?: boolean;
        dailySummary?: unknown;
      };
      assert.equal(donePayload.didLogMeal, false, "failed validation rounds must not log a meal");
      assert.equal(donePayload.dailySummary, undefined, "no daily summary may be projected without a mutation");

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((m) => m.role === "assistant");
      assert.equal(assistantMsgs.length, 1, "rounds-exhausted fallback must write exactly one assistant reply");
      assert.match(assistantMsgs[0]!.content, /我現在無法完成這個請求/);
      assert.doesNotMatch(assistantMsgs[0]!.content, /log_food|FatalToolError|object|null/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat SSE legacy single-item log_food shape + grouped retry logs exactly one meal", async () => {
    // SHIM-01 criterion 1 / D-02 SSE parity twin: the pre-collapse legacy
    // single-item shape fails schema validation and feeds back; the grouped
    // items[] retry logs exactly one meal with a normal receipt while frame
    // order (status before chunk/done) is preserved.
    assert.ok(services, "expected app services");
    const publishedPayloads: unknown[] = [];
    const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
    services.publisher.publishDailySummary = (publishDeviceId, payload) => {
      publishedPayloads.push({ publishDeviceId, payload });
      return originalPublishDailySummary(publishDeviceId, payload);
    };
    // Round 1: legacy single-item shape exactly as it existed pre-collapse.
    mockLLM.queueRoundResponse({
      toolCalls: [createLogFoodToolCallWithArguments(JSON.stringify({
        food_name: "雞腿便當",
        calories: 620,
        protein: 30,
        carbs: 70,
        fat: 18,
      }))],
    });
    // Round 2: the model self-corrects with the grouped items[] shape.
    mockLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_grouped_retry_sse",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              { food_name: "雞腿便當", calories: 620, protein: 30, carbs: 70, fat: 18 },
            ],
          }),
        },
      }],
    });
    // Round 3: streamed final reply.
    mockLLM.queueChatStream(["已記錄", "雞腿便當。"]);

    const form = new FormData();
    form.append("message", "我吃了雞腿便當");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");
      const events = parseSSEEvents(text);

      // SSE invariant: status frames precede chunk and done frames.
      const firstStatusIndex = events.findIndex((event) => event.event === "status");
      const firstChunkIndex = events.findIndex((event) => event.event === "chunk");
      const doneIndex = events.findIndex((event) => event.event === "done");
      assert.ok(firstStatusIndex >= 0, "expected a status frame");
      assert.ok(doneIndex >= 0, "expected a done frame");
      assert.ok(firstChunkIndex > firstStatusIndex, "status must precede the first chunk");
      assert.ok(doneIndex > firstStatusIndex, "status must precede done");

      const donePayload = JSON.parse(events[doneIndex]!.data) as {
        didLogMeal?: boolean;
        dailySummary?: unknown;
        loggedMeal?: {
          mealId?: string;
          mealRevisionId?: string;
          foodName?: string;
          itemCount?: number;
        };
      };
      assert.equal(donePayload.didLogMeal, true, "grouped retry must commit a normal meal log");
      assert.ok(donePayload.dailySummary, "committed log must carry a daily summary");
      assert.match(donePayload.loggedMeal?.mealId ?? "", /^[0-9a-f-]{36}$/);
      assert.match(donePayload.loggedMeal?.mealRevisionId ?? "", /^[0-9a-f-]{36}:r\d+$/);
      assert.equal(donePayload.loggedMeal?.foodName, "雞腿便當");
      assert.equal(donePayload.loggedMeal?.itemCount, 1);

      const mealsRes = await fetch(`${address}/api/meals`, {
        headers: { cookie: sessionCookieHeader },
      });
      assert.equal(mealsRes.status, 200);
      const mealsJson = await mealsRes.json() as { meals: Array<{ foodName: string }> };
      assert.equal(mealsJson.meals.length, 1, "exactly one meal row after legacy-then-grouped rounds");
      assert.equal(mealsJson.meals[0]?.foodName, "雞腿便當");

      assert.equal(publishedPayloads.length, 1, "daily_summary must publish exactly once for the single committed meal");
    } finally {
      services.publisher.publishDailySummary = originalPublishDailySummary;
      await reader?.cancel().catch(() => {});
      controller.abort();
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat SSE legacy single-item log_food shape without recovery fails closed with FALLBACK copy and zero mutation", async () => {
    // SHIM-01 criterion 1 / D-03 SSE parity twin: rounds exhaust without a
    // grouped retry, the canonical backend FALLBACK terminates the turn, and
    // the done frame carries no loggedMeal and no mutation summary fields.
    // Every queued round is a tool call (no logging-claim text), so
    // NO_MUTATION_LOGGING_FALLBACK cannot fire (83-RESEARCH OQ-3).
    assert.ok(services, "expected app services");
    const publishedPayloads: unknown[] = [];
    const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
    services.publisher.publishDailySummary = (publishDeviceId, payload) => {
      publishedPayloads.push({ publishDeviceId, payload });
      return originalPublishDailySummary(publishDeviceId, payload);
    };
    for (let i = 0; i < 3; i += 1) {
      mockLLM.queueRoundResponse({
        toolCalls: [createLogFoodToolCallWithArguments(JSON.stringify({
          food_name: "雞腿便當",
          calories: 620,
          protein: 30,
          carbs: 70,
          fat: 18,
        }))],
      });
    }

    const form = new FormData();
    form.append("message", "我吃了雞腿便當");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");
      const events = parseSSEEvents(text);

      // SSE invariant: status frames precede chunk and done frames.
      const firstStatusIndex = events.findIndex((event) => event.event === "status");
      const firstChunkIndex = events.findIndex((event) => event.event === "chunk");
      const doneIndex = events.findIndex((event) => event.event === "done");
      assert.ok(firstStatusIndex >= 0, "expected a status frame");
      assert.ok(doneIndex >= 0, "expected a done frame");
      assert.ok(firstChunkIndex > firstStatusIndex, "status must precede the first chunk");
      assert.ok(doneIndex > firstStatusIndex, "status must precede done");

      const chunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => (JSON.parse(event.data) as { token: string }).token)
        .join("");
      assert.equal(chunkText, "抱歉，我現在無法完成這個請求，請稍後再試。");

      const donePayload = JSON.parse(events[doneIndex]!.data) as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
      };
      assert.equal(donePayload.didLogMeal, false);
      assert.equal(
        Object.prototype.hasOwnProperty.call(donePayload, "loggedMeal"),
        false,
        "done frame must omit loggedMeal on the fail-closed path",
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(donePayload, "dailySummary"),
        false,
        "done frame must omit dailySummary on the fail-closed path",
      );
      assert.equal(
        Object.prototype.hasOwnProperty.call(donePayload, "summaryOutcome"),
        false,
        "done frame must omit mutation summaryOutcome on the fail-closed path",
      );

      const mealsRes = await fetch(`${address}/api/meals`, {
        headers: { cookie: sessionCookieHeader },
      });
      assert.equal(mealsRes.status, 200);
      const mealsJson = await mealsRes.json() as { meals: unknown[] };
      assert.equal(mealsJson.meals.length, 0, "legacy single-item shape must never create a meal row");

      assert.deepEqual(publishedPayloads, [], "no daily_summary publish may happen without a committed mutation");

      // Each failed round still produced a controlled failed tool result.
      const failedToolResults = observabilityEvents(logLines, "tool_result").filter((record) =>
        record.tool === "log_food" && record.success === false && record.executed === false,
      );
      assert.equal(failedToolResults.length, 3, "each round must fail as a controlled validation result");

      // Phase 72 contract: no committed-mutation marker after failed legacy calls.
      const compressed = await services.chatService.getCompressedHistory(deviceId, 10);
      const compressedText = compressed.map((message) => message.content).join("\n");
      assert.doesNotMatch(compressedText, /系統已記錄餐點|系統已更新餐點|系統已刪除餐點|系統已完成餐點記錄/);
      assert.doesNotMatch(compressedText, /log_food/);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      assert.equal(historyRes.status, 200);
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const latestAssistant = latestAssistantMessage(historyJson.messages);
      assert.equal(latestAssistant?.content, "抱歉，我現在無法完成這個請求，請稍後再試。");
    } finally {
      services.publisher.publishDailySummary = originalPublishDailySummary;
      await reader?.cancel().catch(() => {});
      controller.abort();
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat D-09: when log_food succeeds but chatRound final-reply throws, meal is kept and partial-success fallback written to history", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createTrustedLogFoodToolCall()] });
    const form = new FormData();
    form.append("message", "我吃了雞腿便當");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
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
        headers: { cookie: sessionCookieHeader },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((m) => m.role === "assistant");
      assert.equal(assistantMsgs.length, 1, "D-10 invariant: exactly one assistant reply per user message");
      assert.match(assistantMsgs[0]!.content, /已記錄雞腿便當/);
      assert.match(assistantMsgs[0]!.content, /蛋白質 24 g。/);
      assert.doesNotMatch(assistantMsgs[0]!.content, /已完成記錄，但回覆生成失敗|headline/);

      const mealsRes = await fetch(`${address}/api/meals`, {
        headers: { cookie: sessionCookieHeader },
      });
      const mealsJson = await mealsRes.json() as { meals: Array<{ foodName: string }> };
      assert.ok(mealsJson.meals.some((m) => m.foodName === "雞腿便當"), "meal must be kept even when final reply fails");
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat SSE returns a committed receipt when summary recomputation fails after log_food persistence", async () => {
    assert.ok(services, "expected app services");
    services.summaryService.getDailySummary = async () => {
      throw new Error("summary recomputation failed after persistence");
    };
    mockLLM.queueRoundResponse({ toolCalls: [createTrustedLogFoodToolCall()] });
    const form = new FormData();
    form.append("message", "我吃了雞腿便當");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");

      assert.match(text, /已記錄雞腿便當，620 kcal，蛋白質 24 g。若份量不同，可以再調整。/);
      const doneMatch = text.match(/event: done\s+data: (.+)/);
      assert.ok(doneMatch);
      const donePayload = JSON.parse(doneMatch[1]) as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        loggedMeal?: { mealId?: string; foodName?: string };
        dailySummary?: { mealCount?: number; totalCalories?: number; totalProtein?: number; date?: string };
      };
      assert.equal(donePayload.didLogMeal, true);
      assert.equal(donePayload.didMutateMeal, true);
      assert.match(donePayload.loggedMeal?.mealId ?? "", /^[0-9a-f-]{36}$/);
      assert.equal(donePayload.loggedMeal?.foodName, "雞腿便當");
      assert.equal(donePayload.dailySummary?.mealCount, 1);
      assert.equal(donePayload.dailySummary?.totalCalories, 620);
      assert.equal(donePayload.dailySummary?.totalProtein, 24);
      assert.match(donePayload.dailySummary?.date ?? "", /^\d{4}-\d{2}-\d{2}$/);
      assert.doesNotMatch(text, /無法辨識|回覆生成失敗|這次無法完成請求|headline/);
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat D-09: when a committed log stream throws, meal state is preserved", async () => {
    assert.ok(services);
    const originalHandleMessage = services.orchestrator.handleMessage.bind(services.orchestrator);
    const persistedMeal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "雞腿便當", calories: 620, protein: 24, carbs: 70, fat: 18 },
      ],
    });
    const dateKey = formatLocalDate(new Date(persistedMeal.loggedAt));
    const loggedMeal = {
      mealId: persistedMeal.id,
      mealRevisionId: persistedMeal.mealRevisionId,
      dateKey,
      loggedAt: persistedMeal.loggedAt,
      imageAssetId: null,
      imageUrl: null,
      foodName: persistedMeal.foodName,
      calories: persistedMeal.calories,
      protein: persistedMeal.protein,
      carbs: persistedMeal.carbs,
      fat: persistedMeal.fat,
      itemCount: persistedMeal.itemCount,
      countedSources: [{ name: "雞腿", protein: 24, category: "anchor" as const, certainty: "clear" as const }],
      excludedSources: [],
      usedConservativeAssumption: false,
    };
    async function* failingCommittedStream(): AsyncGenerator<string> {
      yield "模型部分回覆";
      throw new LLMProviderError(providerMetadataFixture);
    }
    services.orchestrator.handleMessage = async (requestDeviceId, userMessage, _imageBase64, _assetRef, opts) => {
      await services!.chatService.saveMessage(requestDeviceId, "user", userMessage);
      opts?.onUserMessageSaved?.();
      return {
        streamGenerator: failingCommittedStream(),
        didLogMeal: true,
        didMutateMeal: true,
        dailySummary: {
          totalCalories: 620,
          totalProtein: 24,
          totalCarbs: 70,
          totalFat: 18,
          mealCount: 1,
          date: dateKey,
        },
        affectedDate: dateKey,
        loggedMeal,
        mutationOutcomeFact: {
          action: "log_food",
          affectedDate: dateKey,
          foodName: "雞腿便當",
          calories: 620,
          protein: 24,
          carbs: 70,
          fat: 18,
        },
      };
    };
    const form = new FormData();
    form.append("message", "我吃了雞腿便當");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");
      const events = parseSSEEvents(text);

      const donePayload = JSON.parse(events.find((event) => event.event === "done")!.data) as {
        turnId?: string;
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        dailySummary?: { date?: string };
        loggedMeal?: { mealId?: string; foodName?: string };
      };
      assert.match(donePayload.turnId ?? "", UUID_PATTERN);
      assert.equal(donePayload.didLogMeal, true, "stream failure after log_food must preserve didLogMeal");
      assert.equal(donePayload.didMutateMeal, true, "stream failure after log_food must preserve didMutateMeal");
      assert.ok(donePayload.dailySummary, "stream failure after log_food must preserve dailySummary");
      assert.match(
        donePayload.dailySummary?.date ?? "",
        /^\d{4}-\d{2}-\d{2}$/,
        "stream failure after log_food must preserve dailySummary.date",
      );
      assert.match(donePayload.loggedMeal?.mealId ?? "", UUID_PATTERN);
      assert.equal(donePayload.loggedMeal?.foodName, "雞腿便當");

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((m) => m.role === "assistant");
      assert.equal(assistantMsgs.length, 1, "D-10 invariant: exactly one assistant reply per user message");
      assert.match(assistantMsgs[0]!.content, /已完成記錄，但回覆生成失敗/);
      assert.match(assistantMsgs[0]!.content, /蛋白質先按雞腿作為主要來源估算/);
      assert.doesNotMatch(assistantMsgs[0]!.content, /模型部分回覆/);

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.equal(fallbackEvents[0]!.source, "sse");
      assert.equal(fallbackEvents[0]!.turnId, donePayload.turnId);
      assert.equal(fallbackEvents[0]!.fallbackSource, "orchestrator");
      assert.equal(fallbackEvents[0]!.reason, "partial_success");
      assert.equal(fallbackEvents[0]!.didLogMeal, true);
      assert.equal(fallbackEvents[0]!.didMutateMeal, true);
      assert.equal("providerMetadata" in fallbackEvents[0]!, false);

      const trace = traceRecorders[0]!.build({ scenario: "sse-stream-partial-success-fallback", status: "pass" });
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.transport, "sse");
      assert.equal(routeFallbacks[0]!.turnId, donePayload.turnId);
      assert.equal(routeFallbacks[0]!.fallbackSource, "orchestrator");
      assert.equal(routeFallbacks[0]!.reason, "partial_success");
      assert.equal(routeFallbacks[0]!.didLogMeal, true);
      assert.equal(routeFallbacks[0]!.didMutateMeal, true);
      assert.equal("providerMetadata" in routeFallbacks[0]!, false);
      assert.equal(trace.timeline.some((event) => event.type === "route_completion"), false);
    } finally {
      services.orchestrator.handleMessage = originalHandleMessage;
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat preserves loggedMeal history when streamed hallucination fallback follows log_food", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createTrustedLogFoodToolCall()] });
    mockLLM.queueChatStream([
      "方式1 直接依照片估算記錄\n",
      "方式2 請補充份量後再記錄",
    ]);
    const form = new FormData();
    form.append("message", "我吃了雞腿便當");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");

      assert.match(text, /已記錄雞腿便當/);
      assert.doesNotMatch(text, /無法辨識這次的請求/);
      const doneMatch = text.match(/event: done\s+data: (.+)/);
      assert.ok(doneMatch);
      const donePayload = JSON.parse(doneMatch[1]) as {
        didLogMeal?: boolean;
        loggedMeal?: { mealId?: string; foodName?: string; imageAssetId?: string | null };
      };
      assert.equal(donePayload.didLogMeal, true);
      assert.match(donePayload.loggedMeal?.mealId ?? "", /^[0-9a-f-]{36}$/);
      assert.equal(donePayload.loggedMeal?.foodName, "雞腿便當");

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      const historyJson = await historyRes.json() as {
        messages: Array<{
          role: string;
          content: string;
          loggedMeal?: { mealId?: string; foodName?: string; imageAssetId?: string | null };
        }>;
      };
      const assistantMsgs = historyJson.messages.filter((m) => m.role === "assistant");
      assert.equal(assistantMsgs.length, 1, "hallucination fallback must persist exactly one assistant reply");
      assert.match(assistantMsgs[0]!.content, /已記錄雞腿便當/);
      assert.equal(assistantMsgs[0]!.loggedMeal?.mealId, donePayload.loggedMeal?.mealId);
      assert.equal(assistantMsgs[0]!.loggedMeal?.foodName, "雞腿便當");
    } finally {
      clearTimeout(timeout);
    }
  });

  it("POST /api/chat grouped log_food keeps didLogMeal and dailySummary when the final reply fails", async () => {
    mockLLM.queueRoundResponse({ toolCalls: [createGroupedLogFoodToolCall()] });
    const form = new FormData();
    form.append("message", "我吃了蘋果和優格");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
        signal: controller.signal,
        body: form,
      });

      assert.ok(res.body);
      const reader = res.body.getReader();
      const text = await readStreamUntil(reader, "event: done");

      const doneMatch = text.match(/event: done\s+data: (.+)/);
      assert.ok(doneMatch);
      const donePayload = JSON.parse(doneMatch[1]) as {
        didLogMeal?: boolean;
        dailySummary?: { mealCount?: number; totalCalories?: number; date?: string };
        loggedMeal?: { itemCount?: number; foodName?: string };
      };
      assert.equal(donePayload.didLogMeal, true, "grouped log_food must still mark didLogMeal after partial success");
      assert.equal(donePayload.dailySummary?.mealCount, 1);
      assert.equal(donePayload.dailySummary?.totalCalories, 295);
      assert.match(donePayload.dailySummary?.date ?? "", /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(donePayload.loggedMeal?.foodName, "蘋果、優格、水煮蛋");
      assert.equal(donePayload.loggedMeal?.itemCount, 3);

      const mealsRes = await fetch(`${address}/api/meals`, {
        headers: { cookie: sessionCookieHeader },
      });
      const mealsJson = await mealsRes.json() as { meals: Array<{ foodName: string; itemCount?: number }> };
      assert.deepEqual(
        mealsJson.meals.map((meal) => ({ foodName: meal.foodName, itemCount: meal.itemCount })),
        [{ foodName: "蘋果、優格、水煮蛋", itemCount: 3 }],
        "grouped log_food should persist one transaction row for the turn",
      );

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const assistantMsgs = historyJson.messages.filter((message) => message.role === "assistant");
      assert.equal(assistantMsgs.length, 1);
      assert.match(assistantMsgs[0]!.content, /已記錄蘋果、優格、水煮蛋/);
      assert.match(assistantMsgs[0]!.content, /蛋白質 15 g。/);
    } finally {
      clearTimeout(timeout);
    }
  });
});
