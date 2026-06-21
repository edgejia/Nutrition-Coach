process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import Database from "better-sqlite3";
import { buildApp } from "../../server/app.js";
import type { AppServices } from "../../server/app.js";
import { applyMigrations } from "../../server/db/migrate.js";
import { LLMProviderError } from "../../server/llm/errors.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type {
  ChatMessage,
  GenerateObjectRequest,
  GenerateObjectResult,
  LLMProvider,
  LLMResponse,
  ProviderErrorMetadata,
  ToolDefinition,
} from "../../server/llm/types.js";
import { formatLocalDate } from "../../server/lib/time.js";
import { createLlmTraceRecorder } from "../../server/orchestrator/llm-trace.js";
import type { SummaryOutcome } from "../../server/services/summary-outcome.js";
import type { FastifyInstance } from "fastify";
import { validJpegBytes, validPngBytes, validWebpBytes } from "../fixtures/image-bytes.js";

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
      const parsed = JSON.parse(line) as Record<string, unknown>;
      records.push(parsed);
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

function assertFreshSummaryOutcome(summaryOutcome: SummaryOutcome | undefined) {
  assert.equal(summaryOutcome?.status, "fresh");
  assert.ok(summaryOutcome && "dailySummary" in summaryOutcome);
}

function assertNoPublishFailurePayload(payload: unknown) {
  assert.doesNotMatch(JSON.stringify(payload), /publish_failed|summary_publish_failed/);
}

function assertMealMutationSummaryEnvelope(payload: unknown, affectedDate: string) {
  assert.ok(payload && typeof payload === "object");
  const envelope = payload as {
    source?: unknown;
    affectedDate?: unknown;
    summary?: { date?: unknown };
    summaryOutcome?: unknown;
    mealId?: unknown;
    mealRevisionId?: unknown;
  };
  assert.equal(envelope.source, "meal_mutation");
  assert.equal(envelope.affectedDate, affectedDate);
  assert.ok(envelope.summary && typeof envelope.summary === "object");
  assert.equal(envelope.summary.date, affectedDate);
  assert.equal(Object.prototype.hasOwnProperty.call(envelope, "summaryOutcome"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(envelope, "mealId"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(envelope, "mealRevisionId"), false);
}

const TERMINAL_CLARIFICATION_SUCCESS_COPY = /已記錄|完成記錄|已更新|已刪除|成功/;
const FAILED_RECOGNITION_NO_SAVE_REPLY = "我沒有把這張照片存成餐點紀錄。請先補充餐點內容和份量，我再幫你估算。";

function assertNoTerminalClarificationSideEffects(body: {
  reply?: string;
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  loggedMeal?: unknown;
  dailySummary?: unknown;
  summaryOutcome?: unknown;
}) {
  assert.equal(body.didLogMeal, false);
  assert.equal(body.didMutateMeal, false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "loggedMeal"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "dailySummary"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(body, "summaryOutcome"), false);
  assert.doesNotMatch(body.reply ?? "", TERMINAL_CLARIFICATION_SUCCESS_COPY);
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
  assert.doesNotMatch(serializedPayload, /AtomicReceiptPersistenceFailure|raw-provider-body|toolCalls|log_food|protein_sources/);
  assert.doesNotMatch(serializedPayload, /雞腿便當|已幫你記錄雞腿便當|這段不應曝光/);
}

function latestEventPayload(raw: string, eventName: string) {
  const frames = parseSSEEvents(raw).filter((frame) => frame.event === eventName);
  assert.ok(frames.length > 0, `expected ${eventName} frame in ${raw}`);
  return JSON.parse(frames.at(-1)!.data);
}

function chatTurnCompletedMetadata(record: Record<string, unknown>) {
  return {
    event: record.event,
    source: record.source,
    didLogMeal: record.didLogMeal,
    didMutateMeal: record.didMutateMeal,
    hadImage: record.hadImage,
    latencyMs: record.latencyMs,
  };
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const providerMetadataFixture: ProviderErrorMetadata = {
  provider: "openai",
  operation: "chat",
  model: "gpt-json-route-fixture",
  aborted: false,
  status: 429,
  providerRequestId: "req_json_route_fixture",
  errorName: "RateLimitError",
  errorType: "rate_limit_exceeded",
  errorCode: "rate_limit",
};

const authProviderMetadataFixture: ProviderErrorMetadata = {
  provider: "openai",
  operation: "chat",
  model: "gpt-auth-trace-fixture",
  aborted: false,
  status: 401,
  providerRequestId: "req_auth_trace_fixture",
  errorName: "AuthenticationError",
  errorType: "invalid_request_error",
  errorCode: "invalid_api_key",
};

const PROVIDER_METADATA_KEYS = [
  "aborted",
  "errorCode",
  "errorName",
  "errorType",
  "model",
  "operation",
  "provider",
  "providerRequestId",
  "status",
];

const canonicalSummaryText = "今天已記錄 2 餐，共 900 kcal：豆腐飯 520 kcal、鮭魚飯 380 kcal。";
const unsafeSummaryFactPattern = /牛肉飯|滷肉飯|豆腐飯 900 kcal/;

async function* streamTokens(tokens: string[]): AsyncGenerator<string> {
  for (const token of tokens) {
    yield token;
  }
}

class JsonHallucinationStreamProvider implements LLMProvider {
  public chatCalls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    this.chatCalls.push({ messages, tools });
    return { content: "unused" };
  }

  async chatRound(messages: ChatMessage[], tools: ToolDefinition[]) {
    this.chatCalls.push({ messages, tools });
    return {
      kind: "stream" as const,
      streamGenerator: this.streamChoicePrompt(),
    };
  }

  async generateObject<T>(
    _messages: ChatMessage[],
    _request: GenerateObjectRequest<T>,
  ): Promise<GenerateObjectResult<T>> {
    throw new Error("generateObject unexpectedly called by this test provider");
  }

  private async *streamChoicePrompt(): AsyncGenerator<string> {
    yield "請選擇方式 1 或方式 2";
  }
}

class JsonProviderStreamErrorProvider implements LLMProvider {
  public chatCalls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];

  constructor(private readonly error: LLMProviderError) {}

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    this.chatCalls.push({ messages, tools });
    return { content: "unused" };
  }

  async chatRound(messages: ChatMessage[], tools: ToolDefinition[]) {
    this.chatCalls.push({ messages, tools });
    return {
      kind: "stream" as const,
      streamGenerator: this.streamThenThrow(),
    };
  }

  async generateObject<T>(
    _messages: ChatMessage[],
    _request: GenerateObjectRequest<T>,
  ): Promise<GenerateObjectResult<T>> {
    throw new Error("generateObject unexpectedly called by this test provider");
  }

  private async *streamThenThrow(): AsyncGenerator<string> {
    yield "partial token";
    throw this.error;
  }
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

async function readOptionalSSEChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<string | null> {
  const decoder = new TextDecoder();
  const timeout = new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs));
  const read = reader.read()
    .then((chunk) => (chunk.value ? decoder.decode(chunk.value, { stream: !chunk.done }) : ""))
    .catch(() => "");
  return Promise.race([read, timeout]);
}

describe("Chat API", () => {
  let app: FastifyInstance;
  let mockLLM: MockLLMProvider;
  let address: string;
  let deviceId: string;
  let sessionCookieHeader: string;
  let tempRoot: string;
  let uploadsDir: string;
  let assetsDir: string;
  let dbPath: string;
  let services: AppServices | undefined;
  let logLines: string[];

  function toCookieHeader(rawHeader: string | string[] | undefined) {
    const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
    return values.map((value) => value.split(";", 1)[0]).join("; ");
  }

  beforeEach(async () => {
    mockLLM = new MockLLMProvider();
    tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-chat-api-"));
    uploadsDir = path.join(tempRoot, "uploads");
    assetsDir = path.join(tempRoot, "assets");
    dbPath = path.join(tempRoot, "nutrition.db");
    const sqlite = new Database(dbPath);
    applyMigrations(sqlite);
    sqlite.close();
    const logCapture = createLogCapture();
    logLines = logCapture.logLines;
    app = await buildApp({
      dbPath,
      llmProvider: mockLLM,
      uploadsDir,
      assetsDir,
      logger: { level: "info", stream: logCapture.stream },
      onServicesReady: (readyServices) => {
        services = readyServices;
      },
    });
    const res = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
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

  it("POST /api/chat accepts multipart text-only requests", async () => {
    const form = new FormData();
    form.append("message", "午餐我吃了蘋果");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.reply);
  });

  it("POST /api/chat SSE replaces no-mutation model logging claims before chunk and history", async () => {
    mockLLM.queueChatResponse({ content: "已記錄牛肉飯，650 kcal，蛋白質 28 g。" });
    const form = new FormData();
    form.append("message", "你好");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, Accept: "text/event-stream" },
      body: form,
    });

    assert.equal(res.status, 200);
    const reader = res.body?.getReader();
    assert.ok(reader);
    try {
      const { raw } = await readUntilEventCount(reader, "done", 1);
      const events = parseSSEEvents(raw);
      const chunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => (JSON.parse(event.data) as { token?: string }).token ?? "")
        .join("");
      const donePayload = JSON.parse(events.find((event) => event.event === "done")?.data ?? "{}") as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
      };

      assert.equal(donePayload.didLogMeal, false);
      assert.equal(donePayload.didMutateMeal, false);
      assert.doesNotMatch(chunkText, /已記錄|完成記錄/);

      const history = await services?.chatService.getHistory(deviceId, 10);
      const assistant = [...(history ?? [])].reverse().find((message) => message.role === "assistant");
      assert.ok(assistant);
      assert.doesNotMatch(String(assistant.content), /已記錄|完成記錄/);
    } finally {
      await reader.cancel().catch(() => {});
    }
  });

  it("POST /api/chat JSON replaces no-mutation model logging claims before response and history", async () => {
    mockLLM.queueChatResponse({ content: "已完成記錄，這餐是雞肉沙拉。" });
    const form = new FormData();
    form.append("message", "你好");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      reply?: string;
      didLogMeal?: boolean;
      didMutateMeal?: boolean;
    };

    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.doesNotMatch(body.reply ?? "", /已記錄|完成記錄/);

    const history = await services?.chatService.getHistory(deviceId, 10);
    const assistant = [...(history ?? [])].reverse().find((message) => message.role === "assistant");
    assert.ok(assistant);
    assert.doesNotMatch(String(assistant.content), /已記錄|完成記錄/);
  });

  it("POST /api/chat JSON preserves get_daily_summary replies that mention recorded meals", async () => {
    assert.ok(services, "expected app services");
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
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_route_summary_json",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "今天已記錄 2 餐，共 900 kcal。" });

    const form = new FormData();
    form.append("message", "今天吃了多少？");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      reply?: string;
      didLogMeal?: boolean;
      didMutateMeal?: boolean;
      dailySummary?: { mealCount?: number; totalCalories?: number };
    };
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.reply, "今天已記錄 2 餐，共 900 kcal：雞胸肉 450 kcal、鮭魚飯 450 kcal。");
    assert.equal(body.dailySummary?.mealCount, 2);
    assert.equal(body.dailySummary?.totalCalories, 900);

    const history = await services.chatService.getHistory(deviceId, 10);
    const assistant = [...history].reverse().find((message) => message.role === "assistant");
    assert.ok(assistant);
    assert.equal(assistant.content, "今天已記錄 2 餐，共 900 kcal：雞胸肉 450 kcal、鮭魚飯 450 kcal。");
  });

  it("POST /api/chat JSON composes summary/history replies from persisted meal facts", async () => {
    assert.ok(services, "expected app services");
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
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_route_summary_canonical_json",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "今天已記錄 2 餐，共 900 kcal，其中包含牛肉飯和滷肉飯，豆腐飯 900 kcal。" });

    const form = new FormData();
    form.append("message", "今天吃了什麼？");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      reply?: string;
      didLogMeal?: boolean;
      didMutateMeal?: boolean;
      dailySummary?: { mealCount?: number; totalCalories?: number };
    };
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.dailySummary?.mealCount, 2);
    assert.equal(body.dailySummary?.totalCalories, 900);
    assert.equal(body.reply, canonicalSummaryText);
    assert.doesNotMatch(body.reply ?? "", unsafeSummaryFactPattern);

    const history = await services.chatService.getHistory(deviceId, 10);
    const assistant = [...history].reverse().find((message) => message.role === "assistant");
    assert.ok(assistant);
    assert.equal(assistant.content, canonicalSummaryText);
    assert.doesNotMatch(assistant.content, unsafeSummaryFactPattern);
  });

  it("POST /api/chat JSON preserves safe summary/history advice already accepted by the renderer", async () => {
    assert.ok(services, "expected app services");
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
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_route_summary_safe_advice_json",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "可以保持清淡，晚餐多補水。" });

    const form = new FormData();
    form.append("message", "今天吃了什麼？");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      reply?: string;
      didLogMeal?: boolean;
      didMutateMeal?: boolean;
      dailySummary?: { mealCount?: number; totalCalories?: number };
    };
    const expectedReply = `${canonicalSummaryText}\n\n可以保持清淡，晚餐多補水。`;
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.dailySummary?.mealCount, 2);
    assert.equal(body.dailySummary?.totalCalories, 900);
    assert.equal(body.reply, expectedReply);

    const history = await services.chatService.getHistory(deviceId, 10);
    const assistant = [...history].reverse().find((message) => message.role === "assistant");
    assert.ok(assistant);
    assert.equal(assistant.content, expectedReply);
  });

  it("POST /api/chat JSON drains stream summary/history replies through the shared composition boundary", async () => {
    assert.ok(services, "expected app services");
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
    const dailySummary = await services.summaryService.getDailySummary(deviceId, new Date());
    const originalHandleMessage = services.orchestrator.handleMessage.bind(services.orchestrator);
    services.orchestrator.handleMessage = async (requestDeviceId, userMessage, _imageBase64, _assetRef, opts) => {
      await services!.chatService.saveMessage(requestDeviceId, "user", userMessage);
      opts?.onUserMessageSaved?.();
      return {
        streamGenerator: streamTokens(["今天已記錄 2 餐，", "共 900 kcal，", "其中包含牛肉飯和滷肉飯，豆腐飯 900 kcal。"]),
        didLogMeal: false,
        didMutateMeal: false,
        dailySummary,
        summaryHistoryFacts: {
          dailySummary,
          meals: [
            { foodName: "豆腐飯", calories: 520 },
            { foodName: "鮭魚飯", calories: 380 },
          ],
        },
      };
    };

    try {
      const form = new FormData();
      form.append("message", "今天吃了什麼？");
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as {
        reply?: string;
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        dailySummary?: { mealCount?: number; totalCalories?: number };
      };
      assert.equal(body.didLogMeal, false);
      assert.equal(body.didMutateMeal, false);
      assert.equal(body.dailySummary?.mealCount, 2);
      assert.equal(body.dailySummary?.totalCalories, 900);
      assert.equal(body.reply, canonicalSummaryText);
      assert.doesNotMatch(body.reply ?? "", unsafeSummaryFactPattern);

      const history = await services.chatService.getHistory(deviceId, 10);
      const assistant = [...history].reverse().find((message) => message.role === "assistant");
      assert.ok(assistant);
      assert.equal(assistant.content, canonicalSummaryText);
      assert.doesNotMatch(assistant.content, unsafeSummaryFactPattern);
    } finally {
      services.orchestrator.handleMessage = originalHandleMessage;
    }
  });

  it("POST /api/chat JSON rejects assigning the daily summary total to one persisted meal", async () => {
    assert.ok(services, "expected app services");
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
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_route_summary_single_total_json",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "今天已記錄 2 餐，共 900 kcal，其中包含雞胸肉 900 kcal。" });

    const form = new FormData();
    form.append("message", "今天吃了什麼？");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      reply?: string;
      didLogMeal?: boolean;
      didMutateMeal?: boolean;
      dailySummary?: { mealCount?: number; totalCalories?: number };
    };
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.dailySummary?.mealCount, 2);
    assert.equal(body.dailySummary?.totalCalories, 900);
    assert.doesNotMatch(body.reply ?? "", /其中包含雞胸肉 900 kcal|雞胸肉 900 kcal/);
    assert.equal(body.reply, "今天已記錄 2 餐，共 900 kcal：雞胸肉 450 kcal、鮭魚飯 450 kcal。");

    const history = await services.chatService.getHistory(deviceId, 10);
    const assistant = [...history].reverse().find((message) => message.role === "assistant");
    assert.ok(assistant);
    assert.doesNotMatch(assistant.content, /其中包含雞胸肉 900 kcal|雞胸肉 900 kcal/);
    assert.equal(assistant.content, "今天已記錄 2 餐，共 900 kcal：雞胸肉 450 kcal、鮭魚飯 450 kcal。");
  });

  it("POST /api/chat JSON rejects fake meal lists even when count and total match", async () => {
    assert.ok(services, "expected app services");
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
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_route_summary_fake_list_json",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "今天已記錄 2 餐，共 900 kcal，其中包含牛肉飯 900 kcal。" });

    const form = new FormData();
    form.append("message", "今天吃了什麼？");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      reply?: string;
      didLogMeal?: boolean;
      didMutateMeal?: boolean;
      dailySummary?: { mealCount?: number; totalCalories?: number };
    };
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.dailySummary?.mealCount, 2);
    assert.equal(body.dailySummary?.totalCalories, 900);
    assert.equal(body.reply, "今天已記錄 2 餐，共 900 kcal：雞胸肉 450 kcal、鮭魚飯 450 kcal。");
    assert.doesNotMatch(body.reply ?? "", /牛肉飯/);

    const history = await services.chatService.getHistory(deviceId, 10);
    const assistant = [...history].reverse().find((message) => message.role === "assistant");
    assert.ok(assistant);
    assert.equal(assistant.content, "今天已記錄 2 餐，共 900 kcal：雞胸肉 450 kcal、鮭魚飯 450 kcal。");
    assert.doesNotMatch(assistant.content, /牛肉飯/);
  });

  it("POST /api/chat JSON preserves empty-day summary semantics after get_daily_summary", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_route_summary_false_log_json",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "今天已記錄牛肉飯，650 kcal。" });

    const form = new FormData();
    form.append("message", "今天吃了什麼？");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      reply?: string;
      didLogMeal?: boolean;
      didMutateMeal?: boolean;
      dailySummary?: { mealCount?: number; totalCalories?: number };
    };
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.dailySummary?.mealCount, 0);
    assert.equal(body.dailySummary?.totalCalories, 0);
    assert.doesNotMatch(body.reply ?? "", /已記錄牛肉飯|650 kcal/);
    assert.equal(body.reply, "今天已記錄 0 餐，共 0 kcal。");

    const history = await services?.chatService.getHistory(deviceId, 10);
    const assistant = [...(history ?? [])].reverse().find((message) => message.role === "assistant");
    assert.ok(assistant);
    assert.equal(assistant.content, "今天已記錄 0 餐，共 0 kcal。");
    assert.doesNotMatch(String(assistant.content), /已記錄牛肉飯|650 kcal/);
  });

  it("POST /api/chat JSON preserves meal-specific get_daily_summary replies only when facts match", async () => {
    assert.ok(services, "expected app services");
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "豆腐飯", calories: 520, protein: 24, carbs: 70, fat: 14 },
      ],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_route_summary_tofu_json",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "目前已記錄的餐點有豆腐飯，約 520 kcal。" });

    const form = new FormData();
    form.append("message", "列出今天記錄的餐點");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      reply?: string;
      didLogMeal?: boolean;
      didMutateMeal?: boolean;
      dailySummary?: { mealCount?: number; totalCalories?: number };
    };
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.dailySummary?.mealCount, 1);
    assert.equal(body.dailySummary?.totalCalories, 520);
    assert.equal(body.reply, "今天已記錄 1 餐，共 520 kcal：豆腐飯 520 kcal。");

    const history = await services.chatService.getHistory(deviceId, 10);
    const assistant = [...history].reverse().find((message) => message.role === "assistant");
    assert.ok(assistant);
    assert.equal(assistant.content, "今天已記錄 1 餐，共 520 kcal：豆腐飯 520 kcal。");
  });

  it("POST /api/chat JSON rejects meal-specific get_daily_summary replies when facts mismatch", async () => {
    assert.ok(services, "expected app services");
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "豆腐飯", calories: 520, protein: 24, carbs: 70, fat: 14 },
      ],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_route_summary_mismatch_json",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "今天已記錄牛肉飯，650 kcal。" });

    const form = new FormData();
    form.append("message", "今天吃了什麼？");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      reply?: string;
      didLogMeal?: boolean;
      didMutateMeal?: boolean;
      dailySummary?: { mealCount?: number; totalCalories?: number };
    };
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, false);
    assert.equal(body.dailySummary?.mealCount, 1);
    assert.equal(body.dailySummary?.totalCalories, 520);
    assert.doesNotMatch(body.reply ?? "", /已記錄牛肉飯|650 kcal/);
    assert.equal(body.reply, "今天已記錄 1 餐，共 520 kcal：豆腐飯 520 kcal。");

    const history = await services.chatService.getHistory(deviceId, 10);
    const assistant = [...history].reverse().find((message) => message.role === "assistant");
    assert.ok(assistant);
    assert.doesNotMatch(assistant.content, /已記錄牛肉飯|650 kcal/);
    assert.equal(assistant.content, "今天已記錄 1 餐，共 520 kcal：豆腐飯 520 kcal。");
  });

  it("POST /api/chat SSE preserves get_daily_summary replies that mention recorded meals", async () => {
    assert.ok(services, "expected app services");
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "豆腐飯", calories: 520, protein: 24, carbs: 70, fat: 14 },
      ],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_route_summary_sse",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "目前已記錄的餐點有豆腐飯，約 520 kcal。" });

    const form = new FormData();
    form.append("message", "列出今天記錄的餐點");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, Accept: "text/event-stream" },
      body: form,
    });

    assert.equal(res.status, 200);
    const reader = res.body?.getReader();
    assert.ok(reader);
    try {
      const { raw } = await readUntilEventCount(reader, "done", 1);
      const events = parseSSEEvents(raw);
      const chunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => (JSON.parse(event.data) as { token?: string }).token ?? "")
        .join("");
      const donePayload = JSON.parse(events.find((event) => event.event === "done")?.data ?? "{}") as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        dailySummary?: { mealCount?: number; totalCalories?: number };
      };

      assert.equal(donePayload.didLogMeal, false);
      assert.equal(donePayload.didMutateMeal, false);
      assert.equal(donePayload.dailySummary?.mealCount, 1);
      assert.equal(donePayload.dailySummary?.totalCalories, 520);
      assert.equal(chunkText, "今天已記錄 1 餐，共 520 kcal：豆腐飯 520 kcal。");

      const history = await services.chatService.getHistory(deviceId, 10);
      const assistant = [...history].reverse().find((message) => message.role === "assistant");
      assert.ok(assistant);
      assert.equal(assistant.content, "今天已記錄 1 餐，共 520 kcal：豆腐飯 520 kcal。");
    } finally {
      await reader.cancel().catch(() => {});
    }
  });

  it("POST /api/chat SSE preserves safe summary/history advice already accepted by the renderer", async () => {
    assert.ok(services, "expected app services");
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
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_route_summary_safe_advice_sse",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "可以保持清淡，晚餐多補水。" });

    const form = new FormData();
    form.append("message", "列出今天記錄的餐點");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, Accept: "text/event-stream" },
      body: form,
    });

    assert.equal(res.status, 200);
    const reader = res.body?.getReader();
    assert.ok(reader);
    try {
      const { raw } = await readUntilEventCount(reader, "done", 1);
      const events = parseSSEEvents(raw);
      const chunkText = events
        .filter((event) => event.event === "chunk")
        .map((event) => (JSON.parse(event.data) as { token?: string }).token ?? "")
        .join("");
      const donePayload = JSON.parse(events.find((event) => event.event === "done")?.data ?? "{}") as {
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        dailySummary?: { mealCount?: number; totalCalories?: number };
      };
      const expectedReply = `${canonicalSummaryText}\n\n可以保持清淡，晚餐多補水。`;

      assert.equal(donePayload.didLogMeal, false);
      assert.equal(donePayload.didMutateMeal, false);
      assert.equal(donePayload.dailySummary?.mealCount, 2);
      assert.equal(donePayload.dailySummary?.totalCalories, 900);
      assert.equal(chunkText, expectedReply);

      const history = await services.chatService.getHistory(deviceId, 10);
      const assistant = [...history].reverse().find((message) => message.role === "assistant");
      assert.ok(assistant);
      assert.equal(assistant.content, expectedReply);
    } finally {
      await reader.cancel().catch(() => {});
    }
  });

  it("POST /api/chat accepts multipart image upload", async () => {
    const form = new FormData();
    form.append("message", "");
    form.append("image", new Blob([validPngBytes()], { type: "image/png" }), "meal.png");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.reply);

    const historyRes = await app.inject({
      method: "GET",
      url: "/api/chat/history?limit=10",
      headers: { cookie: sessionCookieHeader },
    });
    const history = historyRes.json() as {
      messages: Array<{
        role: string;
        imagePath?: string | null;
        imageAssetId?: string | null;
        imageUrl?: string | null;
      }>;
    };
    const userMessage = history.messages.find((message) => message.role === "user");
    assert.ok(userMessage);
    assert.match(userMessage.imagePath ?? "", /^asset:/);
    assert.doesNotMatch(userMessage.imagePath ?? "", /\/uploads\//);
    assert.ok(userMessage.imageAssetId);
    assert.equal(userMessage.imageUrl, `/api/assets/${userMessage.imageAssetId}`);

    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const references = sqlite
        .prepare(
          `SELECT ar.owner_type AS ownerType, ar.owner_id AS ownerId, ar.asset_id AS assetId
             FROM asset_references ar
            WHERE ar.owner_type = 'chat_message'`,
        )
        .all() as Array<{ ownerType: string; ownerId: string; assetId: string }>;
      const chatMessage = sqlite
        .prepare(
          `SELECT id
             FROM chat_messages
            WHERE device_id = ?
              AND role = 'user'
              AND image_path = ?
            LIMIT 1`,
        )
        .get(deviceId, userMessage.imagePath) as { id: string } | undefined;

      assert.equal(references.length, 1, "expected one normalized asset_references row for the user image");
      assert.equal(references[0]!.ownerType, "chat_message");
      assert.equal(references[0]!.assetId, userMessage.imageAssetId);
      assert.equal(references[0]!.ownerId, chatMessage?.id);
    } finally {
      sqlite.close();
    }
  });

  it("POST /api/chat accepts browser-generated WebP upload bytes", async () => {
    const form = new FormData();
    form.append("message", "");
    form.append("image", new Blob([validWebpBytes()], { type: "image/webp" }), "meal.webp");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(body.reply);
  });

  it("POST /api/chat JSON keeps accepted failed-image recognition as no-save for small and large bodies", async () => {
    assert.ok(services, "expected app services");

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
        bytes: validPngBytes(1024 * 1024),
        filename: "failed-large.png",
      },
    ];

    for (const [index, imageCase] of acceptedFailedImages.entries()) {
      mockLLM.queueChatResponse({
        toolCalls: [{
          id: `failed_recognition_no_save_${imageCase.name}`,
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
        }],
      });

      const form = new FormData();
      form.append("message", "");
      form.append("image", new Blob([imageCase.bytes], { type: "image/png" }), imageCase.filename);

      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200, imageCase.name);
      const body = await res.json() as {
        reply?: string;
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
        loggedMeal?: unknown;
        dailySummary?: unknown;
        summaryOutcome?: unknown;
        deletedMealId?: unknown;
      };
      assert.equal(body.reply, FAILED_RECOGNITION_NO_SAVE_REPLY, imageCase.name);
      assert.equal(body.didLogMeal, false, imageCase.name);
      assert.equal(body.didMutateMeal, false, imageCase.name);
      assert.equal(Object.prototype.hasOwnProperty.call(body, "loggedMeal"), false, imageCase.name);
      assert.equal(Object.prototype.hasOwnProperty.call(body, "dailySummary"), false, imageCase.name);
      assert.equal(Object.prototype.hasOwnProperty.call(body, "summaryOutcome"), false, imageCase.name);
      assert.equal(Object.prototype.hasOwnProperty.call(body, "deletedMealId"), false, imageCase.name);
      assert.doesNotMatch(body.reply ?? "", TERMINAL_CLARIFICATION_SUCCESS_COPY, imageCase.name);

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
      assert.equal(
        mockLLM.chatCalls.length,
        beforeChatCalls + index + 1,
        `${imageCase.name} failed-recognition no-save must not consume a recovery model call`,
      );
    }
  });

  it("POST /api/chat cleans staged uploads when a later image part is rejected", async () => {
    const form = new FormData();
    form.append("message", "這是我的午餐");
    form.append("image", new Blob([validPngBytes()], { type: "image/png" }), "meal.png");
    form.append("image", new Blob(["bad image"], { type: "image/heic" }), "meal.heic");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Invalid image type. Allowed: jpeg, png, webp" });
    assert.deepEqual(await readdir(uploadsDir).catch(() => []), []);
    assert.equal(mockLLM.chatCalls.length, 0);
  });

  it("POST /api/chat rejects duplicate valid image parts without leaking the first staged file", async () => {
    const form = new FormData();
    form.append("message", "這是我的午餐");
    form.append("image", new Blob([validPngBytes()], { type: "image/png" }), "meal.png");
    form.append("image", new Blob([validJpegBytes()], { type: "image/jpeg" }), "meal.jpg");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Only one image upload is allowed" });
    assert.deepEqual(await readdir(uploadsDir).catch(() => []), []);
    assert.equal(mockLLM.chatCalls.length, 0);
  });

  it("POST /api/chat multipart rejects header/query raw selectors before upload staging", async () => {
    const foreignDeviceRes = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "muscle_gain" },
    });
    const foreignDeviceId = foreignDeviceRes.json().deviceId as string;
    const beforeChatCalls = mockLLM.chatCalls.length;

    const form = new FormData();
    form.append("message", "header selector should reject");
    form.append("image", new Blob([validPngBytes()], { type: "image/png" }), "header-selector.png");

    const res = await fetch(`${address}/api/chat?deviceId=${encodeURIComponent(foreignDeviceId)}`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "x-device-id": foreignDeviceId },
      body: form,
    });

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Raw device selector is not allowed" });
    assert.deepEqual(await readdir(uploadsDir).catch(() => []), []);
    assert.equal(mockLLM.chatCalls.length, beforeChatCalls);

    const events = observabilityEvents(logLines, "ownership_bypass_blocked");
    assert.equal(events.length, 1);
    assert.deepEqual(
      {
        event: events[0]!.event,
        reason: events[0]!.reason,
        route: events[0]!.route,
        operation: events[0]!.operation,
      },
      {
        event: "ownership_bypass_blocked",
        reason: "raw_device_id_param",
        route: "api_chat",
        operation: "chat_message",
      },
    );
    assertLogEventApplicationKeys(events[0]!, ["event", "reason", "route", "operation", "requestId"]);
    assertLogEventsExclude(
      [events[0]!],
      [deviceId, foreignDeviceId, "x-device-id", "deviceId", "guest_session", "cookie", "header-selector.png"],
    );
  });

  it("POST /api/chat multipart body deviceId rejects after staging and cleans side effects", async () => {
    assert.ok(services, "expected app services");
    const beforeChatCalls = mockLLM.chatCalls.length;
    const publishedPayloads: unknown[] = [];
    const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
    services.publisher.publishDailySummary = (publishDeviceId, payload) => {
      publishedPayloads.push({ publishDeviceId, payload });
      return originalPublishDailySummary(publishDeviceId, payload);
    };

    try {
      const form = new FormData();
      form.append("message", "body selector should reject");
      form.append("image", new Blob([validPngBytes()], { type: "image/png" }), "body-selector.png");
      form.append("deviceId", deviceId);

      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader },
        body: form,
      });

      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: "Raw device selector is not allowed" });
      assert.deepEqual(await readdir(uploadsDir).catch(() => []), []);
      assert.equal(mockLLM.chatCalls.length, beforeChatCalls);
      assert.deepEqual(publishedPayloads, []);

      const history = await services.chatService.getHistory(deviceId, 10);
      assert.equal(history.some((message) => message.content === "body selector should reject"), false);
      assert.equal(history.some((message) => message.role === "assistant"), false);

      const sqlite = new Database(dbPath, { readonly: true });
      try {
        const chatRows = sqlite.prepare("SELECT COUNT(*) AS count FROM chat_messages").get() as { count: number };
        const assetRows = sqlite.prepare("SELECT COUNT(*) AS count FROM assets").get() as { count: number };
        const assetReferenceRows = sqlite.prepare("SELECT COUNT(*) AS count FROM asset_references").get() as { count: number };
        assert.equal(chatRows.count, 0);
        assert.equal(assetRows.count, 0);
        assert.equal(assetReferenceRows.count, 0);
      } finally {
        sqlite.close();
      }

      const events = observabilityEvents(logLines, "ownership_bypass_blocked");
      assert.equal(events.length, 1);
      assert.deepEqual(
        {
          event: events[0]!.event,
          reason: events[0]!.reason,
          route: events[0]!.route,
          operation: events[0]!.operation,
        },
        {
          event: "ownership_bypass_blocked",
          reason: "raw_device_id_param",
          route: "api_chat",
          operation: "chat_message",
        },
      );
      assertLogEventApplicationKeys(events[0]!, ["event", "reason", "route", "operation", "requestId"]);
      assertLogEventsExclude(
        [events[0]!],
        [
          deviceId,
          "x-device-id",
          "deviceId",
          "guest_session",
          "cookie",
          "body selector should reject",
          "body-selector.png",
          "data:image",
        ],
      );
    } finally {
      services.publisher.publishDailySummary = originalPublishDailySummary;
    }
  });

  it("POST /api/chat SSE backfills the user image message when failure happens before orchestrator persistence", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");
    const originalGetCompressedHistory = services.chatService.getCompressedHistory.bind(services.chatService);
    services.chatService.getCompressedHistory = async () => {
      throw new Error("pre-save history failure");
    };

    const form = new FormData();
    form.append("message", "");
    form.append("image", new Blob([validPngBytes()], { type: "image/png" }), "meal.png");
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, Accept: "text/event-stream" },
        body: form,
      });

      assert.equal(res.status, 200);
      reader = res.body?.getReader();
      assert.ok(reader);

      const { raw } = await readUntilEventCount(reader, "done", 1);
      const chunkText = parseSSEEvents(raw)
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");
      assert.match(chunkText, /抱歉|無法/);

      const historyRes = await app.inject({
        method: "GET",
        url: "/api/chat/history?limit=10",
        headers: { cookie: sessionCookieHeader },
      });
      const history = historyRes.json() as {
        messages: Array<{
          role: string;
          content: string;
          imagePath?: string | null;
          imageAssetId?: string | null;
          imageUrl?: string | null;
        }>;
      };

      const userMessages = history.messages.filter((message) => message.role === "user");
      const assistantMessages = history.messages.filter((message) => message.role === "assistant");

      assert.equal(userMessages.length, 1, "route catch should backfill exactly one failed user image message");
      assert.match(userMessages[0]!.imagePath ?? "", /^asset:/);
      assert.ok(userMessages[0]!.imageAssetId);
      assert.equal(userMessages[0]!.imageUrl, `/api/assets/${userMessages[0]!.imageAssetId}`);
      assert.equal(assistantMessages.length, 1);
      assert.match(assistantMessages[0]!.content, /抱歉|無法/);
    } finally {
      await reader?.cancel();
      services.chatService.getCompressedHistory = originalGetCompressedHistory;
    }
  });

  it("POST /api/chat SSE backfills the user text message when failure happens before orchestrator persistence", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");
    const originalGetCompressedHistory = services.chatService.getCompressedHistory.bind(services.chatService);
    services.chatService.getCompressedHistory = async () => {
      throw new Error("pre-save history failure");
    };

    const form = new FormData();
    form.append("message", "今天早餐是燕麥");
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, Accept: "text/event-stream" },
        body: form,
      });

      assert.equal(res.status, 200);
      reader = res.body?.getReader();
      assert.ok(reader);

      const { raw } = await readUntilEventCount(reader, "done", 1);
      const chunkText = parseSSEEvents(raw)
        .filter((event) => event.event === "chunk")
        .map((event) => JSON.parse(event.data) as { token: string })
        .map((payload) => payload.token)
        .join("");
      assert.match(chunkText, /抱歉|無法/);

      const historyRes = await app.inject({
        method: "GET",
        url: "/api/chat/history?limit=10",
        headers: { cookie: sessionCookieHeader },
      });
      const history = historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const userMessages = history.messages.filter((message) => message.role === "user");
      const assistantMessages = history.messages.filter((message) => message.role === "assistant");

      assert.equal(userMessages.length, 1, "route catch should backfill exactly one failed user text message");
      assert.equal(userMessages[0]!.content, "今天早餐是燕麥");
      assert.equal(assistantMessages.length, 1);
      assert.match(assistantMessages[0]!.content, /抱歉|無法/);
    } finally {
      await reader?.cancel();
      services.chatService.getCompressedHistory = originalGetCompressedHistory;
    }
  });

  it("POST /api/chat JSON backfills the user text message when failure happens before orchestrator persistence", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");
    const originalGetCompressedHistory = services.chatService.getCompressedHistory.bind(services.chatService);
    services.chatService.getCompressedHistory = async () => {
      throw new Error("pre-save history failure");
    };

    const form = new FormData();
    form.append("message", "今天午餐是雞肉沙拉");

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const json = await res.json() as { reply: string };
      assert.match(json.reply, /抱歉|無法/);

      const historyRes = await app.inject({
        method: "GET",
        url: "/api/chat/history?limit=10",
        headers: { cookie: sessionCookieHeader },
      });
      const history = historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const userMessages = history.messages.filter((message) => message.role === "user");
      const assistantMessages = history.messages.filter((message) => message.role === "assistant");

      assert.equal(userMessages.length, 1, "JSON catch should backfill exactly one failed user text message");
      assert.equal(userMessages[0]!.content, "今天午餐是雞肉沙拉");
      assert.equal(assistantMessages.length, 1);
      assert.match(assistantMessages[0]!.content, /抱歉|無法/);
    } finally {
      services.chatService.getCompressedHistory = originalGetCompressedHistory;
    }
  });

  it("POST /api/chat rejects invalid image types", async () => {
    const form = new FormData();
    form.append("message", "");
    form.append("image", new Blob(["not an image"], { type: "image/png" }), "meal.png");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Invalid image type. Allowed: jpeg, png, webp" });
    assert.equal(mockLLM.chatCalls.length, 0);

    const malformedPng = new Uint8Array([
      0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
      ...new Array(16).fill(0x41),
    ]);
    const spoofedForm = new FormData();
    spoofedForm.append("message", "");
    spoofedForm.append("image", new Blob([malformedPng.buffer as ArrayBuffer], { type: "image/png" }), "spoofed.png");

    const spoofedRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: spoofedForm,
    });

    assert.equal(spoofedRes.status, 400);
    assert.deepEqual(await spoofedRes.json(), { error: "Invalid image type. Allowed: jpeg, png, webp" });
    assert.equal(mockLLM.chatCalls.length, 0);

    const malformedWebp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x08, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x20,
    ]);
    const spoofedWebpForm = new FormData();
    spoofedWebpForm.append("message", "");
    spoofedWebpForm.append("image", new Blob([malformedWebp.buffer as ArrayBuffer], { type: "image/webp" }), "spoofed.webp");

    const spoofedWebpRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: spoofedWebpForm,
    });

    assert.equal(spoofedWebpRes.status, 400);
    assert.deepEqual(await spoofedWebpRes.json(), { error: "Invalid image type. Allowed: jpeg, png, webp" });
    assert.equal(mockLLM.chatCalls.length, 0);

    const fakeLossyWebp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x16, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x20,
      0x0A, 0x00, 0x00, 0x00,
      0x10, 0x00, 0x00,
      0x9D, 0x01, 0x2A,
      0x01, 0x00,
      0x01, 0x00,
    ]);
    const fakeLossyWebpForm = new FormData();
    fakeLossyWebpForm.append("message", "");
    fakeLossyWebpForm.append(
      "image",
      new Blob([fakeLossyWebp.buffer as ArrayBuffer], { type: "image/webp" }),
      "fake-lossy.webp",
    );

    const fakeLossyWebpRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: fakeLossyWebpForm,
    });

    assert.equal(fakeLossyWebpRes.status, 400);
    assert.deepEqual(await fakeLossyWebpRes.json(), { error: "Invalid image type. Allowed: jpeg, png, webp" });
    assert.equal(mockLLM.chatCalls.length, 0);

    const fakeLosslessWebp = new Uint8Array([
      0x52, 0x49, 0x46, 0x46,
      0x18, 0x00, 0x00, 0x00,
      0x57, 0x45, 0x42, 0x50,
      0x56, 0x50, 0x38, 0x4C,
      0x0C, 0x00, 0x00, 0x00,
      0x2F, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00,
    ]);
    const fakeLosslessWebpForm = new FormData();
    fakeLosslessWebpForm.append("message", "");
    fakeLosslessWebpForm.append(
      "image",
      new Blob([fakeLosslessWebp.buffer as ArrayBuffer], { type: "image/webp" }),
      "fake-lossless.webp",
    );

    const fakeLosslessWebpRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: fakeLosslessWebpForm,
    });

    assert.equal(fakeLosslessWebpRes.status, 400);
    assert.deepEqual(await fakeLosslessWebpRes.json(), { error: "Invalid image type. Allowed: jpeg, png, webp" });
    assert.equal(mockLLM.chatCalls.length, 0);
  });

  it("POST /api/chat rejects images larger than 5MB", async () => {
    const form = new FormData();
    form.append("message", "");
    form.append("image", new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "image/png" }), "too-big.png");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
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

  it("POST /api/chat rejects valid-cookie raw selectors before JSON chat side effects", async () => {
    assert.ok(services, "expected app services");
    const foreignDeviceRes = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "muscle_gain" },
    });
    const foreignDeviceId = foreignDeviceRes.json().deviceId as string;
    const userMessage = "ownership selector lunch sentinel";
    const loggedFoodName = "Cookie Owned Apple";
    const beforeChatCalls = mockLLM.chatCalls.length;
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_ownership_selector",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [{ food_name: loggedFoodName, calories: 95, protein: 0.5, carbs: 25, fat: 0.3 }],
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已幫你記錄蘋果。" });

    const form = new FormData();
    form.append("message", userMessage);
    const res = await fetch(`${address}/api/chat?deviceId=${encodeURIComponent(foreignDeviceId)}`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "x-device-id": foreignDeviceId },
      body: form,
    });

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Raw device selector is not allowed" });
    assert.equal(mockLLM.chatCalls.length, beforeChatCalls);

    const ownerHistory = await services.chatService.getHistory(deviceId, 10);
    const foreignHistory = await services.chatService.getHistory(foreignDeviceId, 10);
    assert.equal(ownerHistory.some((message) => message.content === userMessage), false);
    assert.equal(foreignHistory.some((message) => message.content === userMessage), false);

    const ownerMeals = await services.foodLoggingService.getMealsByDate(deviceId, new Date());
    const foreignMeals = await services.foodLoggingService.getMealsByDate(foreignDeviceId, new Date());
    assert.equal(ownerMeals.some((meal) => meal.foodName === loggedFoodName), false);
    assert.equal(foreignMeals.some((meal) => meal.foodName === loggedFoodName), false);

    const events = observabilityEvents(logLines, "ownership_bypass_blocked");
    assert.equal(events.length, 1);
    assert.equal(typeof events[0]!.requestId, "string");
    assert.equal("turnId" in events[0]!, false);
    assert.deepEqual(
      {
        event: events[0]!.event,
        reason: events[0]!.reason,
        route: events[0]!.route,
        operation: events[0]!.operation,
      },
      {
        event: "ownership_bypass_blocked",
        reason: "raw_device_id_param",
        route: "api_chat",
        operation: "chat_message",
      },
    );
    assertLogEventApplicationKeys(events[0]!, ["event", "reason", "route", "operation", "requestId"]);
    assertLogEventsExclude(
      [events[0]!],
      [
        deviceId,
        foreignDeviceId,
        "x-device-id",
        "deviceId",
        "guest_session",
        "cookie",
        userMessage,
        loggedFoodName,
        "image",
        "snippet",
      ],
    );
  });

  it("POST /api/chat rejects JSON body deviceId and preserves missing-cookie 401 precedence", async () => {
    assert.ok(services, "expected app services");
    const beforeChatCalls = mockLLM.chatCalls.length;

    const missingCookieRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello", deviceId }),
    });
    assert.equal(missingCookieRes.status, 401);

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader, "content-type": "application/json" },
      body: JSON.stringify({ message: "hello", deviceId }),
    });

    assert.equal(res.status, 400);
    assert.deepEqual(await res.json(), { error: "Raw device selector is not allowed" });
    assert.equal(mockLLM.chatCalls.length, beforeChatCalls);
    assert.deepEqual(await services.chatService.getHistory(deviceId, 10), []);

    const events = observabilityEvents(logLines, "ownership_bypass_blocked");
    assert.equal(events.length, 1);
    assert.deepEqual(
      {
        event: events[0]!.event,
        reason: events[0]!.reason,
        route: events[0]!.route,
        operation: events[0]!.operation,
      },
      {
        event: "ownership_bypass_blocked",
        reason: "raw_device_id_param",
        route: "api_chat",
        operation: "chat_message",
      },
    );
    assertLogEventApplicationKeys(events[0]!, ["event", "reason", "route", "operation", "requestId"]);
    assertLogEventsExclude([events[0]!], [deviceId, "deviceId", "guest_session", "cookie", "hello"]);
  });

  it("GET /api/chat/history returns messages", async () => {
    const form = new FormData();
    form.append("message", "你好");
    await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/history?limit=50",
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(res.statusCode, 200);
    const { messages } = res.json();
    assert.ok(messages.length >= 2);
    assert.equal(messages[0].role, "user");
    assert.equal(messages[1].role, "assistant");
  });

  it("GET /api/chat/history rejects valid-cookie raw selectors with metadata-only events", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/chat/history?limit=50&deviceId=${encodeURIComponent(deviceId)}`,
      headers: { cookie: sessionCookieHeader, "x-device-id": deviceId },
    });

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { error: "Raw device selector is not allowed" });

    const events = observabilityEvents(logLines, "ownership_bypass_blocked");
    assert.equal(events.length, 1);
    assert.deepEqual(
      {
        event: events[0]!.event,
        reason: events[0]!.reason,
        route: events[0]!.route,
        operation: events[0]!.operation,
      },
      {
        event: "ownership_bypass_blocked",
        reason: "raw_device_id_param",
        route: "api_chat_history",
        operation: "chat_history_list",
      },
    );
    assertLogEventApplicationKeys(events[0]!, ["event", "reason", "route", "operation", "requestId"]);
    assertLogEventsExclude([events[0]!], [deviceId, "x-device-id", "deviceId", "guest_session", "cookie"]);
  });

  it("POST /api/chat returns didLogMeal=true when mealCount increases", async () => {
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
    mockLLM.queueChatResponse({ content: "已幫你記錄蘋果！" });

    const form = new FormData();
    form.append("message", "午餐我吃了蘋果");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.didLogMeal, true);
  });

  it("POST /api/chat returns dailySummary when didLogMeal is true", async () => {
    assert.ok(services, "expected app services");
    const publishedPayloads: unknown[] = [];
    const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
    services.publisher.publishDailySummary = (publishDeviceId, payload) => {
      assert.equal(publishDeviceId, deviceId);
      publishedPayloads.push(payload);
      return originalPublishDailySummary(publishDeviceId, payload);
    };
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
    mockLLM.queueChatResponse({ content: "已幫你記錄蘋果！" });

    try {
      const form = new FormData();
      form.append("message", "我吃了蘋果");
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      const affectedDate = formatLocalDate(new Date());
      assert.equal(body.didLogMeal, true);
      assert.deepEqual(body.dailySummary, {
        totalCalories: 95,
        totalProtein: 0,
        totalCarbs: 25,
        totalFat: 0.3,
        mealCount: 1,
        date: affectedDate,
      });
      assert.equal(publishedPayloads.length, 1);
      assertMealMutationSummaryEnvelope(publishedPayloads[0], affectedDate);
    } finally {
      services.publisher.publishDailySummary = originalPublishDailySummary;
    }
  });

  it("POST /api/chat dailySummary uses trusted protein for a mixed lunchbox log", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_trusted_lunchbox",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "雞腿便當",
                calories: 640,
                protein: 30,
                carbs: 78,
                fat: 20,
              },
            ],
            protein_sources: [
              { name: "雞腿", protein: 18, is_primary: true, certainty: "clear" },
              { name: "滷蛋", protein: 6, is_primary: true, certainty: "clear" },
              { name: "白飯", protein: 4, is_primary: false, certainty: "clear" },
              { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
            ],
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已幫你記錄雞腿便當！" });

    const form = new FormData();
    form.append("message", "我午餐吃雞腿便當");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.didLogMeal, true);
    assert.equal(body.dailySummary?.totalProtein, 24);
    assert.equal(body.dailySummary?.totalCalories, 640);
  });

  it("POST /api/chat JSON projects explicit loggedMeal mealPeriod for committed lunch logs", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_json_lunch_receipt",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "雞腿便當",
                calories: 640,
                protein: 30,
                carbs: 78,
                fat: 20,
              },
            ],
            protein_sources: [
              { name: "雞腿", protein: 18, is_primary: true, certainty: "clear" },
              { name: "滷蛋", protein: 6, is_primary: true, certainty: "clear" },
              { name: "白飯", protein: 4, is_primary: false, certainty: "clear" },
              { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
            ],
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已幫你記錄雞腿便當！" });

    const form = new FormData();
    form.append("message", "午餐我吃了雞腿便當");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      didLogMeal?: boolean;
      didMutateMeal?: boolean;
      loggedMeal?: { mealPeriod?: string };
      summaryOutcome?: SummaryOutcome;
    };
    assert.equal(body.didLogMeal, true);
    assert.equal(body.didMutateMeal, true);
    assert.equal(body.loggedMeal?.mealPeriod, "lunch");
    assert.equal(Object.prototype.hasOwnProperty.call(body.loggedMeal ?? {}, "inferredMealPeriod"), false);
    assertFreshSummaryOutcome(body.summaryOutcome);
  });

  it("POST /api/chat JSON returns a committed receipt when summary recomputation fails after log_food persistence", async () => {
    assert.ok(services, "expected app services");
    services.summaryService.getDailySummary = async () => {
      throw new Error("summary recomputation failed after persistence");
    };
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_summary_fail_after_log",
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
      }],
    });

    const form = new FormData();
    form.append("message", "我吃了雞腿便當");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      reply: string;
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      loggedMeal?: { mealId?: string; foodName?: string };
      dailySummary?: { mealCount?: number; totalCalories?: number; totalProtein?: number; date?: string };
    };
    assert.equal(body.reply, "已記錄雞腿便當，620 kcal，蛋白質 24 g。若份量不同，可以再調整。");
    assert.equal(body.didLogMeal, true);
    assert.equal(body.didMutateMeal, true);
    assert.match(body.loggedMeal?.mealId ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(body.loggedMeal?.foodName, "雞腿便當");
    assert.equal(body.dailySummary?.mealCount, 1);
    assert.equal(body.dailySummary?.totalCalories, 620);
    assert.equal(body.dailySummary?.totalProtein, 24);
    assert.match(body.dailySummary?.date ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.doesNotMatch(body.reply, /無法辨識|回覆生成失敗|這次無法完成請求|headline/);
  });

  it("POST /api/chat JSON omits receipt identity when assistant receipt persistence fails after log_food", async () => {
    assert.ok(services, "expected app services");
    installAtomicReceiptPersistenceFailure(services.chatService);
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_atomic_receipt_json",
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
      }],
    });
    mockLLM.queueChatResponse({ content: "已幫你記錄雞腿便當！這段不應曝光。" });

    const form = new FormData();
    form.append("message", "raw-user-food-雞腿便當");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as Record<string, unknown>;

    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const mealRow = sqlite
        .prepare("SELECT id, current_revision_id AS currentRevisionId FROM meal_transactions WHERE device_id = ?")
        .get(deviceId) as { id: string; currentRevisionId: string } | undefined;
      assert.ok(mealRow, "meal mutation must be committed before receipt persistence failure is projected");
      assert.match(mealRow.id, /^[0-9a-f-]{36}$/);
      assert.match(mealRow.currentRevisionId, /^[0-9a-f-]{36}:r\d+$/);
    } finally {
      sqlite.close();
    }

    assertNoReceiptIdentityProjection(body, "JSON atomic persistence failure response");

    const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(historyRes.status, 200);
    const historyBody = await historyRes.json() as {
      messages: Array<{ role: string; content?: string; loggedMeal?: unknown }>;
    };
    const latestAssistant = historyBody.messages.filter((message) => message.role === "assistant").at(-1);
    if (latestAssistant) {
      assertNoReceiptIdentityProjection(latestAssistant, "JSON atomic persistence failure history assistant");
    }
  });

  it("POST /api/chat JSON projects unavailable summaryOutcome for committed log responses", async () => {
    assert.ok(services, "expected app services");
    const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
    let publishCalls = 0;
    services.summaryService.getDailySummary = async () => {
      throw new Error("summary recomputation failed after persistence");
    };
    services.foodLoggingService.getMealsByDate = async () => {
      throw new Error("summary recovery failed after persistence");
    };
    services.publisher.publishDailySummary = (...args) => {
      publishCalls += 1;
      return originalPublishDailySummary(...args);
    };
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_unavailable_summary_after_log",
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
      }],
    });

    const form = new FormData();
    form.append("message", "我吃了雞腿便當");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      loggedMeal?: { mealId?: string; foodName?: string };
      dailySummary?: unknown;
      summaryOutcome?: SummaryOutcome;
    };
    assert.equal(body.didLogMeal, true);
    assert.equal(body.didMutateMeal, true);
    assert.match(body.loggedMeal?.mealId ?? "", /^[0-9a-f-]{36}$/);
    assert.equal(body.loggedMeal?.foodName, "雞腿便當");
    assertUnavailableSummaryOutcome(body.summaryOutcome);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "dailySummary"), false);
    assertNoPublishFailurePayload(body);
    assert.equal(publishCalls, 0);
  });

  it("POST /api/chat returns affectedDate for historical logging without changing the summary payload shape", async () => {
    assert.ok(services, "expected app services");
    const publishedPayloads: unknown[] = [];
    const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
    services.publisher.publishDailySummary = (publishDeviceId, payload) => {
      assert.equal(publishDeviceId, deviceId);
      publishedPayloads.push(payload);
      return originalPublishDailySummary(publishDeviceId, payload);
    };
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_historical_log",
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
    mockLLM.queueChatResponse({ content: "已幫你記到 3/25。" });

    try {
      const form = new FormData();
      form.append("message", "幫我補記 2026-03-25 晚餐吃牛肉麵");
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.didLogMeal, true);
      assert.equal(body.affectedDate, "2026-03-25");
      assert.equal(body.dailySummary?.date, "2026-03-25");
      assert.equal(publishedPayloads.length, 1);
      assertMealMutationSummaryEnvelope(publishedPayloads[0], "2026-03-25");
    } finally {
      services.publisher.publishDailySummary = originalPublishDailySummary;
    }
  });

  it("POST /api/chat appends a concrete date when a historical mutation reply only says relative time", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_historical_log_relative_copy",
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
    mockLLM.queueChatResponse({ content: "已幫你補記昨天晚餐：牛肉麵。" });

    const form = new FormData();
    form.append("message", "幫我補記 2026-03-25 晚餐吃牛肉麵");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.affectedDate, "2026-03-25");
    assert.match(body.reply, /3\/25/);
  });

  it("historical chat mutations publish affected-date daily_summary envelopes into the SSE live loop", async () => {
    const sseController = new AbortController();
    const timeout = setTimeout(() => sseController.abort(), 3000);
    let sseReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const sseRes = await fetch(`${address}/api/sse`, {
        headers: { cookie: sessionCookieHeader },
        signal: sseController.signal,
      });
      assert.equal(sseRes.status, 200);
      assert.ok(sseRes.body);
      sseReader = sseRes.body.getReader();
      await sseReader.read();

      mockLLM.queueChatResponse({
        toolCalls: [{
          id: "call_historical_log_no_publish",
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
      mockLLM.queueChatResponse({ content: "已幫你記到 3/25。" });

      const form = new FormData();
      form.append("message", "幫我補記 2026-03-25 晚餐吃牛肉麵");
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.didLogMeal, true);
      assert.equal(body.affectedDate, "2026-03-25");
      assert.equal(body.dailySummary?.date, "2026-03-25");

      const extraChunk = await readOptionalSSEChunk(sseReader, 500);
      assert.ok(extraChunk, "historical mutation should emit a daily_summary frame");
      const payload = latestEventPayload(extraChunk, "daily_summary");
      assertMealMutationSummaryEnvelope(payload, "2026-03-25");
    } finally {
      clearTimeout(timeout);
      await sseReader?.cancel().catch(() => {});
      sseController.abort();
    }
  });

  it("POST /api/chat returns affectedDate for non-today summary queries", async () => {
    assert.ok(services, "expected app services");
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:00:00.000Z",
      items: [
        { foodName: "雞胸肉", calories: 220, protein: 32, carbs: 0, fat: 5 },
      ],
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

    const form = new FormData();
    form.append("message", "2026-03-25 吃了多少蛋白質？");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.didLogMeal, false);
    assert.equal(body.affectedDate, "2026-03-25");
    assert.equal(body.dailySummary?.date, "2026-03-25");
    assert.equal(body.dailySummary?.totalProtein, 32);
  });

  it("POST /api/chat JSON persists terminal historical log_food clarification without side effects or publish", async () => {
    assert.ok(services, "expected app services");
    const publishedPayloads: unknown[] = [];
    const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
    services.publisher.publishDailySummary = (publishDeviceId, payload) => {
      publishedPayloads.push({ publishDeviceId, payload });
      return originalPublishDailySummary(publishDeviceId, payload);
    };
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_historical_log_multiple_dates_json",
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
    mockLLM.queueChatResponse({ content: "已記錄牛肉麵。" });

    try {
      const form = new FormData();
      form.append("message", "幫我補記 2026-03-25 和 2026-03-26 吃牛肉麵");
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as {
        reply: string;
        didLogMeal: boolean;
        didMutateMeal?: boolean;
        loggedMeal?: unknown;
        dailySummary?: unknown;
        summaryOutcome?: unknown;
      };
      assertNoTerminalClarificationSideEffects(body);
      assert.equal(body.reply, "這次沒有記錄餐點。我還不能確定你要記錄哪一天，請一次告訴我一個日期。");
      assert.equal(mockLLM.chatCalls.length, 1, "terminal clarification must not consume a second model reply");
      assert.deepEqual(publishedPayloads, []);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      assert.equal(historyRes.status, 200);
      const historyBody = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const latestAssistant = historyBody.messages.filter((message) => message.role === "assistant").at(-1);
      assert.equal(latestAssistant?.content, body.reply);
    } finally {
      services.publisher.publishDailySummary = originalPublishDailySummary;
    }
  });

  it("POST /api/chat JSON persists get_daily_summary needs_clarification without summary or publish", async () => {
    assert.ok(services, "expected app services");
    const publishedPayloads: unknown[] = [];
    const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
    services.publisher.publishDailySummary = (publishDeviceId, payload) => {
      publishedPayloads.push({ publishDeviceId, payload });
      return originalPublishDailySummary(publishDeviceId, payload);
    };
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_summary_needs_clarification_json",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: JSON.stringify({ date_text: "前幾天" }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已查詢完成。" });

    try {
      const form = new FormData();
      form.append("message", "前幾天吃了多少？");
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as {
        reply: string;
        didLogMeal: boolean;
        didMutateMeal?: boolean;
        loggedMeal?: unknown;
        dailySummary?: unknown;
        summaryOutcome?: unknown;
      };
      assertNoTerminalClarificationSideEffects(body);
      assert.equal(body.reply, "我還不能確定是哪一天，請再說一次日期。");
      assert.equal(mockLLM.chatCalls.length, 1, "terminal clarification must not consume a second model reply");
      assert.deepEqual(publishedPayloads, []);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      assert.equal(historyRes.status, 200);
      const historyBody = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const latestAssistant = historyBody.messages.filter((message) => message.role === "assistant").at(-1);
      assert.equal(latestAssistant?.content, body.reply);
    } finally {
      services.publisher.publishDailySummary = originalPublishDailySummary;
    }
  });

  it("POST /api/chat JSON persists get_daily_summary multiple_targets without summary or publish", async () => {
    assert.ok(services, "expected app services");
    const publishedPayloads: unknown[] = [];
    const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
    services.publisher.publishDailySummary = (publishDeviceId, payload) => {
      publishedPayloads.push({ publishDeviceId, payload });
      return originalPublishDailySummary(publishDeviceId, payload);
    };
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_summary_multiple_targets_json",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: JSON.stringify({ date_text: "2026-03-25 和 2026-03-26" }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已查詢完成。" });

    try {
      const form = new FormData();
      form.append("message", "2026-03-25 和 2026-03-26 各吃了多少？");
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as {
        reply: string;
        didLogMeal: boolean;
        didMutateMeal?: boolean;
        loggedMeal?: unknown;
        dailySummary?: unknown;
        summaryOutcome?: unknown;
      };
      assertNoTerminalClarificationSideEffects(body);
      assert.match(body.reply, /我目前一次只能看一個日期/);
      assert.match(body.reply, /1\. 2026-03-25/);
      assert.match(body.reply, /2\. 2026-03-26/);
      assert.equal(mockLLM.chatCalls.length, 1, "terminal clarification must not consume a second model reply");
      assert.deepEqual(publishedPayloads, []);

      const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
        headers: { cookie: sessionCookieHeader },
      });
      assert.equal(historyRes.status, 200);
      const historyBody = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
      const latestAssistant = historyBody.messages.filter((message) => message.role === "assistant").at(-1);
      assert.equal(latestAssistant?.content, body.reply);
    } finally {
      services.publisher.publishDailySummary = originalPublishDailySummary;
    }
  });

  it("POST /api/chat JSON legacy single-item log_food shape + grouped retry logs exactly one meal", async () => {
    // SHIM-01 criterion 1 / D-02: the pre-collapse legacy single-item shape
    // (top-level snake_case aggregates, no items key) is a schema_validation
    // failure that feeds back to the model; a grouped items[] retry within
    // MAX_ROUNDS logs exactly one meal and the failed first attempt is invisible.
    assert.ok(services, "expected app services");
    const publishedPayloads: unknown[] = [];
    const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
    services.publisher.publishDailySummary = (publishDeviceId, payload) => {
      publishedPayloads.push({ publishDeviceId, payload });
      return originalPublishDailySummary(publishDeviceId, payload);
    };
    // Round 1: legacy single-item shape exactly as it existed pre-collapse.
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_legacy_shape_retry_json",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            food_name: "雞腿便當",
            calories: 620,
            protein: 30,
            carbs: 70,
            fat: 18,
          }),
        },
      }],
    });
    // Round 2: the model self-corrects with the grouped items[] shape.
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_grouped_retry_json",
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
    // No third round is queued: committed log_food replies are projected from
    // the receipt (renderer-owned), so the grouped success terminates the turn.

    try {
      const form = new FormData();
      form.append("message", "我吃了雞腿便當");
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as {
        reply: string;
        didLogMeal?: boolean;
        loggedMeal?: {
          mealId?: string;
          mealRevisionId?: string;
          foodName?: string;
          itemCount?: number;
        };
      };
      assert.equal(body.didLogMeal, true, "grouped retry must commit a normal meal log");
      assert.match(body.loggedMeal?.mealId ?? "", /^[0-9a-f-]{36}$/);
      assert.match(body.loggedMeal?.mealRevisionId ?? "", /^[0-9a-f-]{36}:r\d+$/);
      assert.equal(body.loggedMeal?.foodName, "雞腿便當");
      assert.equal(body.loggedMeal?.itemCount, 1);
      assert.notEqual(body.reply, "抱歉，我現在無法完成這個請求，請稍後再試。");
      assert.equal(
        mockLLM.chatCalls.length,
        2,
        "legacy failure must consume exactly one feedback round before the grouped success terminates the turn",
      );

      const sqlite = new Database(dbPath, { readonly: true });
      try {
        const mealCount = sqlite
          .prepare("SELECT COUNT(*) AS count FROM meal_transactions WHERE device_id = ?")
          .get(deviceId) as { count: number };
        assert.equal(mealCount.count, 1, "exactly one meal_transactions row after legacy-then-grouped rounds");
        const itemCount = sqlite
          .prepare("SELECT COUNT(*) AS count FROM meal_revision_items WHERE revision_id = ?")
          .get(body.loggedMeal?.mealRevisionId ?? "") as { count: number };
        assert.equal(itemCount.count, 1, "grouped retry persists its meal_revision_items rows");
      } finally {
        sqlite.close();
      }

      assert.equal(publishedPayloads.length, 1, "daily_summary must publish exactly once for the single committed meal");
    } finally {
      services.publisher.publishDailySummary = originalPublishDailySummary;
    }
  });

  it("POST /api/chat JSON legacy single-item log_food shape without recovery fails closed with FALLBACK copy and zero mutation", async () => {
    // SHIM-01 criterion 1 / D-03: when the model never self-corrects within
    // MAX_ROUNDS, the terminal reply is the canonical backend FALLBACK copy and
    // no meal, receipt, or daily-summary mutation exists. Every queued round is
    // a tool call (no logging-claim text), so NO_MUTATION_LOGGING_FALLBACK
    // cannot fire (83-RESEARCH OQ-3).
    assert.ok(services, "expected app services");
    const publishedPayloads: unknown[] = [];
    const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
    services.publisher.publishDailySummary = (publishDeviceId, payload) => {
      publishedPayloads.push({ publishDeviceId, payload });
      return originalPublishDailySummary(publishDeviceId, payload);
    };
    for (let i = 0; i < 3; i += 1) {
      mockLLM.queueChatResponse({
        toolCalls: [{
          id: `call_legacy_shape_exhaust_json_${i}`,
          type: "function",
          function: {
            name: "log_food",
            arguments: JSON.stringify({
              food_name: "雞腿便當",
              calories: 620,
              protein: 30,
              carbs: 70,
              fat: 18,
            }),
          },
        }],
      });
    }

    try {
      const form = new FormData();
      form.append("message", "我吃了雞腿便當");
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as {
        reply: string;
        didLogMeal?: boolean;
        didMutateMeal?: boolean;
      };
      assert.equal(body.reply, "抱歉，我現在無法完成這個請求，請稍後再試。");
      assert.equal(body.didLogMeal, false);
      assert.equal(Object.prototype.hasOwnProperty.call(body, "loggedMeal"), false, "no receipt may project on the fail-closed path");
      assert.equal(Object.prototype.hasOwnProperty.call(body, "dailySummary"), false);
      assert.equal(mockLLM.chatCalls.length, 3, "rounds-exhausted path must consume every retry round");

      const sqlite = new Database(dbPath, { readonly: true });
      try {
        const mealCount = sqlite
          .prepare("SELECT COUNT(*) AS count FROM meal_transactions WHERE device_id = ?")
          .get(deviceId) as { count: number };
        assert.equal(mealCount.count, 0, "legacy single-item shape must never create a meal_transactions row");
        const failedToolRows = sqlite
          .prepare("SELECT COUNT(*) AS count FROM chat_messages WHERE device_id = ? AND role = 'tool' AND tool_name = 'log_food'")
          .get(deviceId) as { count: number };
        assert.equal(failedToolRows.count, 3, "each failed validation round persists a tool row");
      } finally {
        sqlite.close();
      }

      assert.deepEqual(publishedPayloads, [], "no daily_summary publish may happen without a committed mutation");

      // Phase 72 contract: failed tool rows exist but compressed history carries
      // no committed-mutation marker, so future model context cannot treat the
      // failed legacy call as logged.
      const compressed = await services.chatService.getCompressedHistory(deviceId, 10);
      const compressedText = compressed.map((message) => message.content).join("\n");
      assert.doesNotMatch(compressedText, /系統已記錄餐點|系統已更新餐點|系統已刪除餐點|系統已完成餐點記錄/);
      assert.doesNotMatch(compressedText, /log_food/);
    } finally {
      services.publisher.publishDailySummary = originalPublishDailySummary;
    }
  });

  it("POST /api/chat does not include dailySummary when no food is logged", async () => {
    mockLLM.queueChatResponse({ content: "今天狀態不錯，記得多喝水。" });

    const form = new FormData();
    form.append("message", "今天天氣真好");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
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
      }],
    });
    const form = new FormData();
    form.append("message", "我吃了雞腿便當");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.didLogMeal, true, "meal was persisted; didLogMeal must survive LLM failure");
    assert.match(body.reply, /已記錄雞腿便當/);
    assert.match(body.reply, /蛋白質 24 g。/);
    assert.doesNotMatch(body.reply, /已完成記錄，但回覆生成失敗|headline/);
    assert.deepEqual(body.dailySummary, {
      totalCalories: 620,
      totalProtein: 24,
      totalCarbs: 70,
      totalFat: 18,
      mealCount: 1,
      date: formatLocalDate(new Date()),
    });
  });

  it("POST /api/chat image logging persists chat_meal_receipts for /api/chat/history", async () => {
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
    mockLLM.queueChatResponse({ content: "已幫你記錄蘋果！" });

    const form = new FormData();
    form.append("message", "午餐我吃了蘋果");
    form.append("image", new Blob([validPngBytes()], { type: "image/png" }), "apple.png");
    const chatRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });
    assert.equal(chatRes.status, 200);
    const chatBody = await chatRes.json() as {
      loggedMeal?: {
        mealId?: string;
        mealRevisionId?: string;
        mealPeriod?: string;
        imageAssetId?: string | null;
        imageUrl?: string | null;
        itemCount?: number;
      };
    };
    assert.match(chatBody.loggedMeal?.mealId ?? "", /^[0-9a-f-]{36}$/);
    assert.match(chatBody.loggedMeal?.mealRevisionId ?? "", /^[0-9a-f-]{36}:r\d+$/);
    assert.equal(chatBody.loggedMeal?.mealPeriod, "lunch");
    assert.ok(chatBody.loggedMeal?.imageAssetId);
    assert.equal(chatBody.loggedMeal?.imageUrl, `/api/assets/${chatBody.loggedMeal.imageAssetId}`);
    assert.equal(chatBody.loggedMeal?.itemCount, 1);

    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const receiptRows = sqlite
        .prepare("SELECT meal_transaction_id AS mealTransactionId, meal_revision_id AS mealRevisionId FROM chat_meal_receipts")
        .all() as Array<{ mealTransactionId: string; mealRevisionId: string }>;
      assert.equal(receiptRows.length, 1);
      assert.equal(receiptRows[0]!.mealTransactionId, chatBody.loggedMeal?.mealId);
      assert.equal(receiptRows[0]!.mealRevisionId, chatBody.loggedMeal?.mealRevisionId);
      assert.match(receiptRows[0]!.mealRevisionId, /^[0-9a-f-]{36}:r\d+$/);
    } finally {
      sqlite.close();
    }

    const historyRes = await app.inject({
      method: "GET",
      url: "/api/chat/history?limit=50",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(historyRes.statusCode, 200);
    const historyBody = historyRes.json();
    const assistantMessage = historyBody.messages.find((message: { role: string }) => message.role === "assistant");
    assert.equal(assistantMessage.didLogMeal, true);
    assert.match(assistantMessage.loggedMeal.mealId, /^[0-9a-f-]{36}$/);
    assert.match(assistantMessage.loggedMeal.dateKey, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(assistantMessage.loggedMeal.mealRevisionId, chatBody.loggedMeal.mealRevisionId);
    assert.match(assistantMessage.loggedMeal.loggedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(assistantMessage.loggedMeal, {
      receiptStatus: "active",
      mealId: assistantMessage.loggedMeal.mealId,
      dateKey: assistantMessage.loggedMeal.dateKey,
      mealRevisionId: chatBody.loggedMeal.mealRevisionId,
      loggedAt: assistantMessage.loggedMeal.loggedAt,
      mealPeriod: "lunch",
      imageAssetId: chatBody.loggedMeal.imageAssetId,
      imageUrl: chatBody.loggedMeal.imageUrl,
      foodName: "蘋果",
      itemCount: 1,
      calories: 95,
      protein: 0,
      carbs: 25,
      fat: 0.3,
      items: [
        { name: "蘋果", position: 0, calories: 95, protein: 0, carbs: 25, fat: 0.3 },
      ],
    });
    assert.equal("currentRevisionId" in assistantMessage.loggedMeal, false);
    assert.equal(Object.prototype.hasOwnProperty.call(assistantMessage.loggedMeal, "inferredMealPeriod"), false);
  });

  it("GET /api/chat/history keeps stale loggedMeal receipts display-only with explicit mealPeriod", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_stale_lunch_receipt",
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
      }],
    });
    mockLLM.queueChatResponse({ content: "已幫你記錄雞腿便當！" });

    const form = new FormData();
    form.append("message", "午餐我吃了雞腿便當");
    const chatRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });
    assert.equal(chatRes.status, 200);
    const chatBody = await chatRes.json() as {
      loggedMeal?: {
        mealId?: string;
        mealRevisionId?: string;
      };
    };
    assert.ok(chatBody.loggedMeal?.mealId);
    assert.ok(chatBody.loggedMeal?.mealRevisionId);

    const updateRes = await app.inject({
      method: "PATCH",
      url: `/api/meals/${chatBody.loggedMeal.mealId}`,
      headers: { cookie: sessionCookieHeader },
      payload: {
        foodName: "半份雞腿便當",
        calories: 360,
        protein: 18,
        carbs: 38,
        fat: 10,
        imageAssetId: null,
        expectedMealRevisionId: chatBody.loggedMeal.mealRevisionId,
      },
    });
    assert.equal(updateRes.statusCode, 200);

    const historyRes = await app.inject({
      method: "GET",
      url: "/api/chat/history?limit=50",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(historyRes.statusCode, 200);
    const historyBody = historyRes.json();
    const assistantMessage = historyBody.messages.find((message: { role: string }) => message.role === "assistant");
    assert.equal(assistantMessage.didLogMeal, true);
    assert.equal(assistantMessage.loggedMeal.mealId, undefined);
    assert.equal(assistantMessage.loggedMeal.dateKey, undefined);
    assert.equal(assistantMessage.loggedMeal.mealRevisionId, undefined);
    assert.equal(assistantMessage.loggedMeal.mealPeriod, "lunch");
    assert.equal(assistantMessage.loggedMeal.foodName, "雞腿便當");
    assert.equal(assistantMessage.loggedMeal.itemCount, 1);
    assert.deepEqual(assistantMessage.loggedMeal.items, [
      { name: "雞腿便當", position: 0, calories: 620, protein: 24, carbs: 70, fat: 18 },
    ]);
    assert.equal(Object.prototype.hasOwnProperty.call(assistantMessage.loggedMeal, "currentRevisionId"), false);
    assert.equal(Object.prototype.hasOwnProperty.call(assistantMessage.loggedMeal, "inferredMealPeriod"), false);
  });

  it("POST /api/chat JSON response returns grouped loggedMeal.itemCount", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_grouped_json",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              { food_name: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
              { food_name: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
              { food_name: "青菜", calories: 40, protein: 2, carbs: 8, fat: 1 },
            ],
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已幫你記錄雞腿、白飯、青菜。" });

    const form = new FormData();
    form.append("message", "我吃了雞腿、白飯和青菜");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      loggedMeal?: {
        mealId?: string;
        mealRevisionId?: string;
        dateKey?: string;
        loggedAt?: string;
        foodName?: string;
        itemCount?: number;
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
    assert.match(body.loggedMeal?.mealId ?? "", /^[0-9a-f-]{36}$/);
    assert.match(body.loggedMeal?.mealRevisionId ?? "", /^[0-9a-f-]{36}:r\d+$/);
    assert.match(body.loggedMeal?.dateKey ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.match(body.loggedMeal?.loggedAt ?? "", /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(body.loggedMeal?.foodName, "雞腿、白飯、青菜");
    assert.equal(body.loggedMeal?.itemCount, 3);
    assert.equal(body.loggedMeal?.calories, 580);
    assert.equal(body.loggedMeal?.protein, 24);
    assert.equal(body.loggedMeal?.carbs, 70);
    assert.equal(body.loggedMeal?.fat, 13.5);
    assert.deepEqual(body.loggedMeal?.items, [
      { name: "雞腿", position: 0, calories: 260, protein: 24, carbs: 0, fat: 12 },
      { name: "白飯", position: 1, calories: 280, protein: 0, carbs: 62, fat: 0.5 },
      { name: "青菜", position: 2, calories: 40, protein: 0, carbs: 8, fat: 1 },
    ]);
  });

  it("POST /api/chat JSON successful missing quantity reply hides internal metadata and keeps grouped name", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_grouped_missing_quantity_json",
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
    mockLLM.queueChatResponse({
      content: "已記錄雞腿、白飯、青菜，約 580 kcal，可信蛋白 99 g。log_food protein_sources usedConservativeAssumption quantityUncertaintyReason missing_quantity",
    });

    const form = new FormData();
    form.append("message", "我吃了雞腿、白飯和青菜");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      reply: string;
      loggedMeal?: { foodName?: string; itemCount?: number };
    };
    assert.match(body.reply, /580 kcal/);
    assert.match(body.reply, /蛋白質 24 g/);
    assert.doesNotMatch(body.reply, /份量是主要誤差|可再補份量修正|區間/);
    assert.doesNotMatch(body.reply, /約 580 kcal，可信蛋白 99 g/);
    assertNoSuccessfulLogInternalCopy(body.reply);
    assert.equal(body.loggedMeal?.foodName, "雞腿、白飯、青菜");
    assert.equal(body.loggedMeal?.itemCount, 3);
    assertNoSuccessfulLogInternalCopy(JSON.stringify(body.loggedMeal));
  });

  it("POST /api/chat JSON successful soy log ignores model filler when receipt has no protein explanation trigger", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_soy_json",
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
    mockLLM.queueChatResponse({
      content: "已記錄豆漿，約 120 kcal、可信蛋白 8 g。豆漿為主要蛋白來源。",
    });

    const form = new FormData();
    form.append("message", "一杯豆漿");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { reply: string; loggedMeal?: { protein?: number } };
    assert.match(body.reply, /已記錄豆漿/);
    assert.match(body.reply, /120 kcal/);
    assert.match(body.reply, /蛋白質 8 g/);
    assert.equal(body.loggedMeal?.protein, 8);
    assert.doesNotMatch(body.reply, /豆漿為主要蛋白來源|可信蛋白/);
  });

  it("POST /api/chat JSON repairs generic drink tool args from source text 豆漿", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_generic_soy_json",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "飲品",
                quantity_ml: 300,
                calories: 120,
                protein: 8,
                carbs: 10,
                fat: 4,
              },
            ],
            protein_sources: [
              { name: "植物性飲料", protein: 8, is_primary: true, certainty: "clear" },
            ],
          }),
        },
      }],
    });

    const form = new FormData();
    form.append("message", "一杯豆漿");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      reply: string;
      loggedMeal?: {
        foodName?: string;
        protein?: number;
      };
    };
    assert.equal(body.loggedMeal?.foodName, "豆漿");
    assert.equal(body.loggedMeal?.protein, 8);
    assert.match(body.reply, /已記錄豆漿/);
    assert.doesNotMatch(body.reply, /飲品|植物性飲料|無糖飲料/);

    const mealsRes = await fetch(`${address}/api/meals`, {
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(mealsRes.status, 200);
    const mealsBody = await mealsRes.json() as { meals: Array<{ foodName?: string; protein?: number }> };
    assert.equal(mealsBody.meals.length, 1);
    assert.equal(mealsBody.meals[0]?.foodName, "豆漿");
    assert.equal(mealsBody.meals[0]?.protein, 8);
  });

  it("POST /api/chat JSON update_meal reply is projected from normalized updatedMeal and strips progress", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "seed_meal_json",
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
                quantity: 1,
                unit: "碗",
              },
            ],
            protein_sources: [
              { name: "牛肉", protein: 24, is_primary: true, certainty: "clear" },
            ],
          }),
        },
      }],
    });
    const seedForm = new FormData();
    seedForm.append("message", "午餐我吃了牛肉麵");
    const seedRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: seedForm,
    });
    assert.equal(seedRes.status, 200);
    const seedBody = await seedRes.json() as { loggedMeal?: { mealId?: string } };
    const mealId = seedBody.loggedMeal?.mealId;
    assert.ok(mealId);

    mockLLM.queueChatResponse({
      toolCalls: [
        {
          id: "find_update_json",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({ action: "update", query: "牛肉麵" }),
          },
        },
        {
          id: "update_meal_json",
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
        },
      ],
    });
    mockLLM.queueChatResponse({ content: "已更新蛋餅，330 kcal，可信蛋白 14 g。（5/5）" });

    const updateForm = new FormData();
    updateForm.append("message", "把牛肉麵改成半碗，熱量 360 卡，蛋白質 20g，碳水 45g，脂肪 10g");
    const updateRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: updateForm,
    });

    assert.equal(updateRes.status, 200);
    const updateBody = await updateRes.json() as {
      reply: string;
      didMutateMeal?: boolean;
      loggedMeal?: {
        foodName?: string;
        calories?: number;
        protein?: number;
        carbs?: number;
        fat?: number;
        mealPeriod?: string;
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
    assert.equal(updateBody.didMutateMeal, true);
    assert.match(updateBody.reply, /已更新半碗牛肉麵，360 kcal，蛋白質 20 g/);
    assert.doesNotMatch(updateBody.reply, /蛋餅|330 kcal|14 g|5\/5|（5\/5）|可信蛋白/);
    assert.equal(updateBody.loggedMeal?.foodName, "半碗牛肉麵");
    assert.equal(updateBody.loggedMeal?.calories, 360);
    assert.equal(updateBody.loggedMeal?.protein, 20);
    assert.equal(updateBody.loggedMeal?.carbs, 45);
    assert.equal(updateBody.loggedMeal?.fat, 10);
    assert.equal(updateBody.loggedMeal?.mealPeriod, "lunch");
    assert.deepEqual(updateBody.loggedMeal?.items, [
      { name: "半碗牛肉麵", position: 0, calories: 360, protein: 20, carbs: 45, fat: 10 },
    ]);
  });

  it("POST /api/chat JSON projects unavailable summaryOutcome for committed update responses", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "seed_update_unavailable_json",
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
          }),
        },
      }],
    });
    const seedForm = new FormData();
    seedForm.append("message", "我吃了牛肉麵");
    const seedRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: seedForm,
    });
    assert.equal(seedRes.status, 200);
    const seedBody = await seedRes.json() as { loggedMeal?: { mealId?: string } };
    const mealId = seedBody.loggedMeal?.mealId;
    assert.ok(mealId);

    assert.ok(services, "expected app services");
    services.summaryService.getDailySummary = async () => {
      throw new Error("summary recomputation failed after update");
    };
    services.foodLoggingService.getMealsByDate = async () => {
      throw new Error("summary recovery failed after update");
    };
    mockLLM.queueChatResponse({
      toolCalls: [
        {
          id: "find_update_unavailable_json",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({ action: "update", query: "牛肉麵" }),
          },
        },
        {
          id: "update_unavailable_json",
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
        },
      ],
    });
    mockLLM.queueChatResponse({ content: "已更新半碗牛肉麵。" });

    const updateForm = new FormData();
    updateForm.append("message", "把牛肉麵改成半碗，熱量 360 卡，蛋白質 20g，碳水 45g，脂肪 10g");
    const updateRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: updateForm,
    });

    assert.equal(updateRes.status, 200);
    const body = await updateRes.json() as {
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      affectedDate?: string;
      loggedMeal?: { mealId?: string; foodName?: string };
      dailySummary?: unknown;
      summaryOutcome?: SummaryOutcome;
    };
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.match(body.affectedDate ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(body.loggedMeal?.mealId, mealId);
    assert.equal(body.loggedMeal?.foodName, "半碗牛肉麵");
    assertUnavailableSummaryOutcome(body.summaryOutcome);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "dailySummary"), false);
    assertNoPublishFailurePayload(body);
  });

  it("POST /api/chat JSON projects unavailable summaryOutcome for committed delete responses", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "seed_delete_unavailable_json",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "雞腿便當",
                calories: 620,
                protein: 24,
                carbs: 70,
                fat: 18,
              },
            ],
          }),
        },
      }],
    });
    const seedForm = new FormData();
    seedForm.append("message", "我吃了雞腿便當");
    const seedRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: seedForm,
    });
    assert.equal(seedRes.status, 200);
    const mealsBeforeRes = await fetch(`${address}/api/meals`, {
      headers: { cookie: sessionCookieHeader },
    });
    const mealsBeforeJson = await mealsBeforeRes.json() as { meals: Array<{ id: string }> };
    const mealId = mealsBeforeJson.meals[0]?.id;
    assert.ok(mealId);

    mockLLM.queueChatResponse({
      toolCalls: [
        {
          id: "find_delete_unavailable_json",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({ action: "delete", query: "雞腿便當" }),
          },
        },
        {
          id: "delete_unavailable_json",
          type: "function",
          function: {
            name: "delete_meal",
            arguments: JSON.stringify({ meal_id: mealId }),
          },
        },
      ],
    });

    const deleteForm = new FormData();
    deleteForm.append("message", "刪除雞腿便當");
    const setupRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: deleteForm,
    });

    assert.equal(setupRes.status, 200);
    const setupBody = await setupRes.json() as {
      reply: string;
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      deletedMealId?: unknown;
      summaryOutcome?: SummaryOutcome;
    };
    assert.equal(setupBody.didLogMeal, false);
    assert.equal(setupBody.didMutateMeal, false);
    assert.equal(setupBody.deletedMealId, undefined);
    assert.equal(setupBody.summaryOutcome, undefined);
    assert.match(setupBody.reply, /即將刪除：雞腿便當/);
    const mealsAfterSetupRes = await fetch(`${address}/api/meals`, {
      headers: { cookie: sessionCookieHeader },
    });
    const mealsAfterSetupJson = await mealsAfterSetupRes.json() as { meals: Array<{ id: string }> };
    assert.equal(mealsAfterSetupJson.meals.some((meal) => meal.id === mealId), true);

    assert.ok(services, "expected app services");
    services.summaryService.getDailySummary = async () => {
      throw new Error("summary recomputation failed after delete");
    };
    services.foodLoggingService.getMealsByDate = async () => {
      throw new Error("summary recovery failed after delete");
    };
    const confirmForm = new FormData();
    confirmForm.append("message", "好");
    const confirmRes = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: confirmForm,
    });

    assert.equal(confirmRes.status, 200);
    const body = await confirmRes.json() as {
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      deletedMealId?: string;
      affectedDate?: string;
      loggedMeal?: unknown;
      dailySummary?: unknown;
      summaryOutcome?: SummaryOutcome;
    };
    assert.equal(body.didLogMeal, false);
    assert.equal(body.didMutateMeal, true);
    assert.equal(body.deletedMealId, mealId);
    assert.match(body.affectedDate ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(body.loggedMeal, undefined);
    assertUnavailableSummaryOutcome(body.summaryOutcome);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "dailySummary"), false);
    assertNoPublishFailurePayload(body);
  });

  it("POST /api/chat JSON keeps publish failure out of summaryOutcome", async () => {
    assert.ok(services, "expected app services");
    services.publisher.publishDailySummary = () => {
      throw new Error("publish failed after committed log");
    };
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_publish_fail_after_log",
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
          }),
        },
      }],
    });

    const form = new FormData();
    form.append("message", "一杯豆漿");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      didLogMeal: boolean;
      didMutateMeal?: boolean;
      dailySummary?: unknown;
      summaryOutcome?: SummaryOutcome;
    };
    assert.equal(body.didLogMeal, true);
    assert.equal(body.didMutateMeal, true);
    assertFreshSummaryOutcome(body.summaryOutcome);
    assert.ok(body.dailySummary);
    assertNoPublishFailurePayload(body);
  });

  it("POST /api/chat JSON logs publish failure without thrown error text", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const logLLM = new MockLLMProvider();
    let logServices: AppServices | undefined;
    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: logLLM,
      logger: { level: "info", stream: logStream },
      onServicesReady: (readyServices) => {
        logServices = readyServices;
      },
    });
    assert.ok(logServices);
    const unsafeErrorMessage = "prompt 機密營養文字 provider body header tool payload assistant final text data:image guest_session";
    logServices.publisher.publishDailySummary = () => {
      throw new Error(unsafeErrorMessage);
    };
    logLLM.queueChatResponse({
      toolCalls: [{
        id: "call_publish_fail_redaction",
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
          }),
        },
      }],
    });
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const logAddress = await logApp.listen({ port: 0 });

    try {
      const form = new FormData();
      form.append("message", "一杯豆漿");
      const res = await fetch(`${logAddress}/api/chat`, {
        method: "POST",
        headers: { cookie: logCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as {
        didLogMeal: boolean;
        didMutateMeal?: boolean;
        dailySummary?: unknown;
        summaryOutcome?: SummaryOutcome;
      };
      assert.equal(body.didLogMeal, true);
      assert.equal(body.didMutateMeal, true);
      assertFreshSummaryOutcome(body.summaryOutcome);
      assert.ok(body.dailySummary);
      assertNoPublishFailurePayload(body);

      const publishFailures = observabilityEvents(logLines, "summary_publish_failed");
      assert.equal(publishFailures.length, 1);
      assert.equal(publishFailures[0]!.failureReason, "publisher_error");
      assert.equal("err" in publishFailures[0]!, false);
      assert.equal("errorMessage" in publishFailures[0]!, false);
      assert.doesNotMatch(JSON.stringify(parseLogLines(logLines)), /機密營養文字|provider body|header|tool payload|assistant final text|data:image|guest_session/);
    } finally {
      await logApp.close();
    }
  });

  it("POST /api/chat without SSE accept header still returns JSON", async () => {
    mockLLM.queueChatResponse({ content: "純文字回覆" });

    const form = new FormData();
    form.append("message", "你好");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
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
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(res.statusCode, 400);
  });

  it("GET /api/chat/history rejects limit above 200", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/history?limit=201",
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(res.statusCode, 400);
  });

  it("GET /api/chat/history returns 401 without a guest session", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/chat/history",
    });
    assert.equal(res.statusCode, 401);
  });

  it("POST /api/chat returns 401 with invalid guest-session cookies", async () => {
    const form = new FormData();
    form.append("message", "hello");
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: "guest_session=invalid; guest_session_resume=invalid" },
      body: form,
    });
    assert.equal(res.status, 401);
  });

  it("POST /api/chat returns 400 when message and image are both missing", async () => {
    const form = new FormData();
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
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
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { reply: string };
    assert.doesNotMatch(body.reply, /log_food/, "log_food must not appear in JSON reply");
    assert.doesNotMatch(body.reply, /get_daily_summary/, "get_daily_summary must not appear in JSON reply");

    const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
      headers: { cookie: sessionCookieHeader },
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
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as { reply: string; didLogMeal: boolean; dailySummary?: unknown };
    assert.equal(body.didLogMeal, false);
    assert.equal(Object.prototype.hasOwnProperty.call(body, "dailySummary"), false);
    assert.match(body.reply, /這次無法完成請求/);
    assert.doesNotMatch(body.reply, /log_food|FatalToolError|bad json/);

    const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
      headers: { cookie: sessionCookieHeader },
    });
    const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
    const assistantMsgs = historyJson.messages.filter((m) => m.role === "assistant");
    assert.equal(assistantMsgs.length, 1, "JSON fallback must persist exactly one assistant reply");
    assert.match(assistantMsgs[0]!.content, /這次無法完成請求/);
  });

  it("SSE path: fallback after image log persists receipt identity before done", async () => {
    // D-04 SSE branch: log_food persists meal, then final reply generation throws.
    // Invariant: done has didLogMeal:true and history has exactly one assistant message.
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_sse_fail",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "燕麥粥",
                calories: 150,
                protein: 5,
                carbs: 27,
                fat: 2.5,
              },
            ],
            protein_sources: [
              { name: "燕麥", protein: 5, is_primary: true, certainty: "clear" },
            ],
          }),
        },
      }],
    });
    mockLLM.queueChatError(new Error("stream generation failed"));

    const form = new FormData();
    form.append("message", "這是燕麥粥");
    form.append("image", new Blob([validPngBytes()], { type: "image/png" }), "oatmeal.png");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const res = await fetch(`${address}/api/chat`, {
        method: "POST",
        headers: { cookie: sessionCookieHeader, Accept: "text/event-stream" },
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
        loggedMeal?: { mealId?: string; imageAssetId?: string | null; imageUrl?: string | null };
        dailySummary?: { mealCount: number; totalCalories: number; date?: string };
      };
      assert.equal(donePayload.didLogMeal, true, "meal was persisted before LLM failure");
      assert.match(donePayload.loggedMeal?.mealId ?? "", /^[0-9a-f-]{36}$/);
      assert.ok(donePayload.loggedMeal?.imageAssetId);
      assert.equal(donePayload.loggedMeal?.imageUrl, `/api/assets/${donePayload.loggedMeal.imageAssetId}`);
      assert.equal(donePayload.dailySummary?.mealCount, 1);
      assert.equal(donePayload.dailySummary?.totalCalories, 150);
      assert.match(donePayload.dailySummary?.date ?? "", /^\d{4}-\d{2}-\d{2}$/);
    } finally {
      clearTimeout(timeout);
      await reader?.cancel().catch(() => {});
      controller.abort();
    }

    const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(historyRes.status, 200);

    const historyBody = await historyRes.json() as {
      messages: Array<{
        role: string;
        content: string;
        loggedMeal?: { mealId?: string; imageAssetId?: string | null; imageUrl?: string | null };
      }>;
    };
    const assistantMsgs = historyBody.messages.filter((message) => message.role === "assistant");
    assert.equal(assistantMsgs.length, 1);
    assert.match(assistantMsgs[0]?.content ?? "", /已記錄燕麥粥/);
    assert.match(assistantMsgs[0]?.loggedMeal?.mealId ?? "", /^[0-9a-f-]{36}$/);
    assert.ok(assistantMsgs[0]?.loggedMeal?.imageAssetId);
  });

  it("JSON path: fallback after image log persists receipt identity and cleans upload", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_json_fail",
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
      }],
    });
    const form = new FormData();
    form.append("message", "這是雞腿便當");
    form.append("image", new Blob([validPngBytes()], { type: "image/png" }), "meal.png");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { cookie: sessionCookieHeader },
      body: form,
    });

    assert.equal(res.status, 200);
    const body = await res.json() as {
      didLogMeal: boolean;
      loggedMeal?: { mealId?: string; imageAssetId?: string | null; imageUrl?: string | null };
      dailySummary?: { mealCount: number; date?: string };
    };
    assert.equal(body.didLogMeal, true);
    assert.match(body.loggedMeal?.mealId ?? "", /^[0-9a-f-]{36}$/);
    assert.ok(body.loggedMeal?.imageAssetId);
    assert.equal(body.loggedMeal?.imageUrl, `/api/assets/${body.loggedMeal.imageAssetId}`);
    assert.equal(body.dailySummary?.mealCount, 1);
    assert.match(body.dailySummary?.date ?? "", /^\d{4}-\d{2}-\d{2}$/);
    assert.deepEqual(await readdir(uploadsDir).catch(() => []), [], "staged uploads must be cleaned after fallback");

    const sqlite = new Database(dbPath, { readonly: true });
    try {
      const receiptRows = sqlite
        .prepare("SELECT meal_transaction_id AS mealTransactionId, meal_revision_id AS mealRevisionId FROM chat_meal_receipts")
        .all() as Array<{ mealTransactionId: string; mealRevisionId: string }>;
      assert.equal(receiptRows.length, 1);
      assert.equal(receiptRows[0]!.mealTransactionId, body.loggedMeal?.mealId);
      assert.match(receiptRows[0]!.mealRevisionId, /^[0-9a-f-]{36}:r\d+$/);
    } finally {
      sqlite.close();
    }

    const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(historyRes.status, 200);

    const historyBody = await historyRes.json() as {
      messages: Array<{
        role: string;
        content: string;
        loggedMeal?: { mealId?: string; imageAssetId?: string | null; imageUrl?: string | null };
      }>;
    };
    const assistantMsgs = historyBody.messages.filter((message) => message.role === "assistant");
    assert.equal(assistantMsgs.length, 1);
    assert.match(assistantMsgs[0]?.content ?? "", /已記錄雞腿便當/);
    assert.equal(assistantMsgs[0]?.loggedMeal?.mealId, body.loggedMeal?.mealId);
    assert.equal(assistantMsgs[0]?.loggedMeal?.imageAssetId, body.loggedMeal?.imageAssetId);
    assert.equal(assistantMsgs[0]?.loggedMeal?.imageUrl, body.loggedMeal?.imageUrl);
  });

  it("D-03: daily_summary SSE push arrives on /api/sse AFTER done event is emitted on chat stream", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_order",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ items: [{ food_name: "優格", calories: 120, protein: 8, carbs: 15, fat: 3 }] }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已記錄優格！" });

    const sseController = new AbortController();
    const timeout = setTimeout(() => sseController.abort(), 5000);
    let sseReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let chatReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const sseRes = await fetch(`${address}/api/sse`, {
        headers: { cookie: sessionCookieHeader },
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
        headers: { cookie: sessionCookieHeader, Accept: "text/event-stream" },
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
      const mutationSummaryPayload = latestEventPayload(dailySummaryEvent.raw, "daily_summary");
      assertMealMutationSummaryEnvelope(mutationSummaryPayload, formatLocalDate(new Date()));

      const doneFrame = parseSSEEvents(chatDoneEvent.raw).find((frame) => frame.event === "done");
      assert.ok(doneFrame);
      const donePayload = JSON.parse(doneFrame.data) as { didLogMeal: boolean; dailySummary?: { mealCount: number; date?: string } };
      assert.equal(donePayload.didLogMeal, true);
      assert.equal(donePayload.dailySummary?.mealCount, 1);
      assert.match(donePayload.dailySummary?.date ?? "", /^\d{4}-\d{2}-\d{2}$/);
    } finally {
      clearTimeout(timeout);
      await chatReader?.cancel().catch(() => {});
      await sseReader?.cancel().catch(() => {});
      sseController.abort();
    }
  });

  it("POST /api/chat JSON body returns 401 when the guest session is missing", async () => {
    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "test" }),
    });

    assert.equal(res.status, 401);
  });

  it("POST /api/chat multipart returns 401 when the guest session is missing", async () => {
    const form = new FormData();
    form.append("message", "test");

    const res = await fetch(`${address}/api/chat`, {
      method: "POST",
      body: form,
    });

    assert.equal(res.status, 401);
  });

  it("GET /api/chat/history returns 401 with invalid guest-session cookies", async () => {
    const res = await fetch(`${address}/api/chat/history?limit=10`, {
      headers: { cookie: "guest_session=invalid; guest_session_resume=invalid" },
    });

    assert.equal(res.status, 401);
  });

  it("GET /api/sse returns 401 with invalid guest-session cookies", async () => {
    const res = await fetch(`${address}/api/sse`, {
      headers: { cookie: "guest_session=invalid; guest_session_resume=invalid" },
    });

    assert.equal(res.status, 401);
  });

  it("OBS-04: production logs contain no raw deviceId or meal text (text path)", async () => {
    const { logLines, stream: logStream } = createLogCapture();

    const obs04LLM = new MockLLMProvider();
    obs04LLM.queueChatResponse({ content: "測試回覆" });

    const obs04App = await buildApp({
      dbPath: ":memory:",
      llmProvider: obs04LLM,
      logger: { level: "info", stream: logStream },
    });

    const deviceRes = await obs04App.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const obs04DeviceId = deviceRes.json().deviceId as string;
    const obs04CookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const obs04Address = await obs04App.listen({ port: 0 });

    const form = new FormData();
    form.append("message", "我吃了機密測試食物");
    await fetch(`${obs04Address}/api/chat`, {
      method: "POST",
      headers: { cookie: obs04CookieHeader },
      body: form,
    });

    await obs04App.close();

    // Assert: no log line (after JSON.parse) contains raw deviceId or meal text
    let parsedCount = 0;
    for (const line of logLines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue; // skip non-JSON lines (pino startup banners, etc.)
      }
      parsedCount++;
      const serialized = JSON.stringify(parsed);
      assert.ok(
        !serialized.includes(obs04DeviceId),
        `deviceId leaked in log line: ${line.slice(0, 300)}`,
      );
      assert.ok(
        !serialized.includes("機密測試食物"),
        `meal text leaked in log line: ${line.slice(0, 300)}`,
      );
    }
    // Sanity: ensure we actually captured log lines (not zero — would mean stream wiring failed)
    assert.ok(parsedCount > 0, `Expected at least 1 parsed log line, got ${parsedCount}. Total lines: ${logLines.length}`);
  });

  it("OBS-04: production logs contain no absolute upload path (image path)", async () => {
    const { logLines, stream: logStream } = createLogCapture();

    const obs04ImageLLM = new MockLLMProvider();
    obs04ImageLLM.queueChatResponse({ content: "圖片已記錄" });

    const obs04ImageApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: obs04ImageLLM,
      logger: { level: "info", stream: logStream },
    });

    const deviceRes = await obs04ImageApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const obs04ImageDeviceId = deviceRes.json().deviceId as string;
    const obs04ImageCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const obs04ImageAddress = await obs04ImageApp.listen({ port: 0 });

    const form = new FormData();
    form.append("message", "這是測試圖片");
    form.append("image", new Blob([validJpegBytes()], { type: "image/jpeg" }), "test.jpg");

    await fetch(`${obs04ImageAddress}/api/chat`, {
      method: "POST",
      headers: { cookie: obs04ImageCookieHeader },
      body: form,
    });

    await obs04ImageApp.close();

    // Assert: no log line contains an absolute path to the upload directory
    // Absolute upload paths look like /tmp/... or /var/folders/... or the OS temp dir
    let parsedCount = 0;
    for (const line of logLines) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      parsedCount++;
      const serialized = JSON.stringify(parsed);
      assert.ok(
        !serialized.includes(obs04ImageDeviceId),
        `deviceId leaked in image log line: ${line.slice(0, 300)}`,
      );
      // Check for common absolute path patterns that indicate upload path leakage
      assert.ok(
        !/\/tmp\/|\/var\/folders\/|\/private\/tmp\//.test(serialized),
        `absolute upload path leaked in image log line: ${line.slice(0, 300)}`,
      );
    }
    assert.ok(parsedCount > 0, `Expected at least 1 parsed log line for image path, got ${parsedCount}. Total lines: ${logLines.length}`);
  });

  it("logs redacted field diagnostics for controlled log_food validation failures", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const rawMealText = "我吃了機密豆漿";
    const logLLM = new MockLLMProvider();
    logLLM.queueChatResponse({
      toolCalls: [{
        id: "call_invalid_log_food_json",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "",
                calories: "not-a-number",
                protein: 8,
                carbs: 10,
                fat: 4,
              },
            ],
          }),
        },
      }],
    });
    // Phase 83 (D-02): schema_validation feeds back to the model instead of
    // throwing to the route catch; queue a terminal reply that does NOT claim
    // logging so the turn ends deterministically (83-RESEARCH OQ-3).
    logLLM.queueChatResponse({ content: "請再提供餐點內容和份量，我再幫你估算。" });

    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: logLLM,
      logger: { level: "info", stream: logStream },
    });
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logDeviceId = deviceRes.json().deviceId as string;
    const logCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const logAddress = await logApp.listen({ port: 0 });

    try {
      const form = new FormData();
      form.append("message", rawMealText);
      const res = await fetch(`${logAddress}/api/chat`, {
        method: "POST",
        headers: { cookie: logCookieHeader, Accept: "text/event-stream" },
        body: form,
      });
      // Consume the stream so all turn log lines are flushed before asserting.
      assert.ok(res.body);
      await readUntilEventCount(res.body.getReader(), "done", 1);

      const toolResults = observabilityEvents(logLines, "tool_result");
      const failedLogFood = toolResults.find((record) =>
        record.tool === "log_food" &&
        record.success === false &&
        record.executed === false,
      );
      assert.ok(failedLogFood, "expected failed log_food tool_result event");
      assert.equal(failedLogFood.failureReason, "validation");
      assert.equal(failedLogFood.reason, "schema_validation");
      assert.ok(Array.isArray(failedLogFood.fields), "validation fields must be logged");
      assert.ok((failedLogFood.fields as string[]).length > 0);

      const validationEvents = observabilityEvents(logLines, "log_food_validation_failed");
      assert.equal(validationEvents.length, 1);
      const validationEventMetadata = {
        event: validationEvents[0]!.event,
        tool: validationEvents[0]!.tool,
        failureReason: validationEvents[0]!.failureReason,
        fields: validationEvents[0]!.fields,
      };
      assert.deepEqual(validationEventMetadata, {
        event: "log_food_validation_failed",
        tool: "log_food",
        failureReason: "validation",
        fields: validationEvents[0]!.fields,
      });
      assert.ok(Array.isArray(validationEvents[0]!.fields));
      assert.ok((validationEvents[0]!.fields as string[]).every((field) =>
        ["calories", "protein", "carbs", "fat"].includes(field),
      ));
      assert.equal("reason" in validationEvents[0]!, false);
      assert.equal("summary" in validationEvents[0]!, false);
      assert.equal("executed" in validationEvents[0]!, false);
      assert.equal("success" in validationEvents[0]!, false);

      const dedicatedPayload = JSON.stringify(validationEventMetadata);
      assert.doesNotMatch(dedicatedPayload, /food_name|items|protein_sources|quantity|quantity_g|quantity_ml/);
      assert.doesNotMatch(dedicatedPayload, /not-a-number|call_invalid_log_food_json|imagePath|uploads/);

      const serializedLogs = JSON.stringify(parseLogLines(logLines));
      assert.ok(!serializedLogs.includes(rawMealText));
      assert.ok(!serializedLogs.includes(logDeviceId));
      assert.doesNotMatch(serializedLogs, /not-a-number|call_invalid_log_food_json|imagePath|uploads/);
    } finally {
      await logApp.close();
    }
  });

  it("logs one redacted chat_turn_completed event for JSON text requests", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const rawMealText = "我吃了祕密雞胸便當";
    const assistantReply = "已幫你記錄祕密雞胸便當！";
    const logLLM = new MockLLMProvider();
    logLLM.queueChatResponse({
      toolCalls: [{
        id: "call_redacted_json",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ items: [{ food_name: "祕密雞胸便當", calories: 520, protein: 36, carbs: 60, fat: 12 }] }),
        },
      }],
    });
    logLLM.queueChatResponse({ content: assistantReply });

    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: logLLM,
      logger: { level: "info", stream: logStream },
    });
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logDeviceId = deviceRes.json().deviceId as string;
    const logCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const logAddress = await logApp.listen({ port: 0 });

    try {
      const form = new FormData();
      form.append("message", rawMealText);
      const res = await fetch(`${logAddress}/api/chat`, {
        method: "POST",
        headers: { cookie: logCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const eventRecords = observabilityEvents(logLines, "chat_turn_completed");
      assert.equal(eventRecords.length, 1);
      assert.deepEqual(chatTurnCompletedMetadata(eventRecords[0]!), {
        event: "chat_turn_completed",
        source: "json",
        didLogMeal: true,
        didMutateMeal: true,
        hadImage: false,
        latencyMs: eventRecords[0]?.latencyMs,
      });
      assert.equal(typeof eventRecords[0]?.latencyMs, "number");

      const serializedLogs = JSON.stringify(parseLogLines(logLines));
      assert.doesNotMatch(serializedLogs, /祕密雞胸便當/);
      assert.ok(!serializedLogs.includes(rawMealText));
      assert.ok(!serializedLogs.includes(assistantReply));
      assert.ok(!serializedLogs.includes(logDeviceId));
    } finally {
      await logApp.close();
    }
  });

  it("POST /api/chat JSON returns a server turnId and correlates route plus orchestrator logs without raw content", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const clientSuppliedTurnId = "11111111-1111-4111-8111-111111111111";
    const rawMealText = "我吃了機密 turnId 測試餐點";
    const assistantReply = "這是一則不應進入結構化日誌的最終回覆";
    const logLLM = new MockLLMProvider();
    logLLM.queueChatResponse({ content: assistantReply });

    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: logLLM,
      logger: { level: "info", stream: logStream },
    });
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logDeviceId = deviceRes.json().deviceId as string;
    const logCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const logAddress = await logApp.listen({ port: 0 });

    try {
      const form = new FormData();
      form.append("message", rawMealText);
      form.append("turnId", clientSuppliedTurnId);
      form.append("metadata", JSON.stringify({ turnId: clientSuppliedTurnId }));

      const res = await fetch(`${logAddress}/api/chat`, {
        method: "POST",
        headers: { cookie: logCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as {
        turnId?: string;
        reply?: string;
        didLogMeal?: boolean;
      };
      assert.match(body.turnId ?? "", UUID_PATTERN);
      assert.notEqual(body.turnId, clientSuppliedTurnId, "client-supplied ids must be ignored");
      assert.equal(typeof body.reply, "string", "existing top-level reply field must remain");
      assert.equal(typeof body.didLogMeal, "boolean", "existing top-level didLogMeal field must remain");

      const records = parseLogLines(logLines);
      const completedRecords = records.filter((record) => record.event === "chat_turn_completed");
      assert.equal(completedRecords.length, 1);
      assert.equal(completedRecords[0]!.turnId, body.turnId);

      const llmRoundStarts = records.filter((record) => record.event === "llm_round_start");
      assert.ok(llmRoundStarts.length >= 1, "expected at least one orchestrator llm_round_start log");
      for (const record of llmRoundStarts) {
        assert.equal(record.turnId, body.turnId);
        assert.equal(record.component, "orchestrator");
      }
      const orchestratorRecords = records.filter((record) => record.component === "orchestrator");
      assert.ok(orchestratorRecords.length >= 1, "expected orchestrator child log records");
      for (const record of orchestratorRecords) {
        assert.equal(record.turnId, body.turnId);
      }

      const serializedLogs = JSON.stringify(records);
      assert.ok(!serializedLogs.includes(rawMealText));
      assert.ok(!serializedLogs.includes(assistantReply));
      assert.ok(!serializedLogs.includes(logDeviceId));
      assert.ok(!serializedLogs.includes(logCookieHeader));
      assert.ok(!serializedLogs.includes(clientSuppliedTurnId));
      assert.doesNotMatch(serializedLogs, /機密 turnId 測試餐點|messages|tools|imagePath|data:image|guest_session/);
    } finally {
      await logApp.close();
    }
  });

  it("JSON happy completion emits completion only and records route completion trace", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const logLLM = new MockLLMProvider();
    logLLM.queueChatResponse({ content: "一般回覆" });
    const traceRecorder = createLlmTraceRecorder();
    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: logLLM,
      logger: { level: "info", stream: logStream },
      llmTraceRecorderFactory: () => traceRecorder,
    });
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const logAddress = await logApp.listen({ port: 0 });

    try {
      const form = new FormData();
      form.append("message", "今天狀態如何");
      const res = await fetch(`${logAddress}/api/chat`, {
        method: "POST",
        headers: { cookie: logCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as { turnId?: string };
      assert.match(body.turnId ?? "", UUID_PATTERN);

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 1);
      assert.equal(fallbackEvents.length, 0);
      assert.equal(completedEvents[0]!.source, "json");
      assert.equal(completedEvents[0]!.turnId, body.turnId);

      const trace = traceRecorder.build({ scenario: "json-happy-completion", status: "passed" });
      assert.deepEqual(
        trace.timeline.filter((event) => event.type === "route_completion"),
        [{
          type: "route_completion",
          transport: "json",
          turnId: body.turnId,
          didLogMeal: false,
          didMutateMeal: false,
          completed: true,
        }],
      );
      assert.equal(trace.timeline.some((event) => event.type === "route_fallback"), false);
    } finally {
      await logApp.close();
    }
  });

  it("JSON provider llm_error fallback emits route fallback only with allowlisted provider metadata", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const logLLM = new MockLLMProvider();
    logLLM.queueChatError(new LLMProviderError(providerMetadataFixture));
    const traceRecorder = createLlmTraceRecorder();
    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: logLLM,
      logger: { level: "info", stream: logStream },
      llmTraceRecorderFactory: () => traceRecorder,
    });
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const logAddress = await logApp.listen({ port: 0 });

    try {
      const form = new FormData();
      form.append("message", "這段文字不應進 fallback event");
      const res = await fetch(`${logAddress}/api/chat`, {
        method: "POST",
        headers: { cookie: logCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as { turnId?: string; didLogMeal?: boolean };
      assert.match(body.turnId ?? "", UUID_PATTERN);
      assert.equal(body.didLogMeal, false);

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.deepEqual({
        event: fallbackEvents[0]!.event,
        source: fallbackEvents[0]!.source,
        turnId: fallbackEvents[0]!.turnId,
        fallbackSource: fallbackEvents[0]!.fallbackSource,
        reason: fallbackEvents[0]!.reason,
        didLogMeal: fallbackEvents[0]!.didLogMeal,
        didMutateMeal: fallbackEvents[0]!.didMutateMeal,
        hadImage: fallbackEvents[0]!.hadImage,
      }, {
        event: "chat_route_fallback",
        source: "json",
        turnId: body.turnId,
        fallbackSource: "orchestrator",
        reason: "llm_error",
        didLogMeal: false,
        didMutateMeal: false,
        hadImage: false,
      });
      assert.deepEqual(fallbackEvents[0]!.providerMetadata, providerMetadataFixture);
      const providerMetadataKeys = Object.keys(fallbackEvents[0]!.providerMetadata as unknown as Record<string, unknown>).sort();
      assert.deepEqual(providerMetadataKeys, PROVIDER_METADATA_KEYS);

      const trace = traceRecorder.build({ scenario: "json-provider-fallback", status: "passed" });
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.turnId, body.turnId);
      assert.equal(routeFallbacks[0]!.fallbackSource, "orchestrator");
      assert.equal(routeFallbacks[0]!.reason, "llm_error");
      assert.deepEqual(routeFallbacks[0]!.providerMetadata, providerMetadataFixture);
      assert.equal(trace.timeline.some((event) => event.type === "route_completion"), false);
    } finally {
      await logApp.close();
    }
  });

  it("JSON auth-style provider failure emits provider hook, route fallback, and correlated trace facts", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const rawMealText = "這段 auth 失敗文字不應進入結構化證據";
    const logLLM = new MockLLMProvider();
    logLLM.queueChatError(new LLMProviderError(authProviderMetadataFixture));
    const traceRecorder = createLlmTraceRecorder();
    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: logLLM,
      logger: { level: "info", stream: logStream },
      llmTraceRecorderFactory: () => traceRecorder,
    });
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logDeviceId = deviceRes.json().deviceId as string;
    const logCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const logAddress = await logApp.listen({ port: 0 });

    try {
      const form = new FormData();
      form.append("message", rawMealText);
      const res = await fetch(`${logAddress}/api/chat`, {
        method: "POST",
        headers: { cookie: logCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as { turnId?: string; didLogMeal?: boolean; reply?: string };
      assert.match(body.turnId ?? "", UUID_PATTERN);
      assert.equal(body.didLogMeal, false);
      assert.match(body.reply ?? "", /抱歉|無法|稍後/);
      assert.doesNotMatch(
        body.reply ?? "",
        /AuthenticationError|invalid_api_key|api[_ -]?key|Bearer|sk-|provider|OpenAI/i,
      );

      const providerErrorEvents = observabilityEvents(logLines, "llm_provider_error");
      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(providerErrorEvents.length, 1);
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.deepEqual(providerErrorEvents[0]!.providerMetadata, authProviderMetadataFixture);
      assert.deepEqual(
        Object.keys(providerErrorEvents[0]!.providerMetadata as unknown as Record<string, unknown>).sort(),
        PROVIDER_METADATA_KEYS,
      );
      assert.deepEqual({
        event: fallbackEvents[0]!.event,
        source: fallbackEvents[0]!.source,
        turnId: fallbackEvents[0]!.turnId,
        fallbackSource: fallbackEvents[0]!.fallbackSource,
        reason: fallbackEvents[0]!.reason,
        didLogMeal: fallbackEvents[0]!.didLogMeal,
        didMutateMeal: fallbackEvents[0]!.didMutateMeal,
        hadImage: fallbackEvents[0]!.hadImage,
      }, {
        event: "chat_route_fallback",
        source: "json",
        turnId: body.turnId,
        fallbackSource: "orchestrator",
        reason: "llm_error",
        didLogMeal: false,
        didMutateMeal: false,
        hadImage: false,
      });
      assert.deepEqual(fallbackEvents[0]!.providerMetadata, authProviderMetadataFixture);
      assert.deepEqual(
        Object.keys(fallbackEvents[0]!.providerMetadata as unknown as Record<string, unknown>).sort(),
        PROVIDER_METADATA_KEYS,
      );

      const trace = traceRecorder.build({ scenario: "json-auth-provider-fallback", status: "passed" });
      assert.equal(trace.schemaVersion, "llm-trace.v2");

      const llmErrors = trace.timeline.filter((event) => event.type === "llm_error");
      assert.equal(llmErrors.length, 1);
      assert.deepEqual(llmErrors[0]!.providerMetadata, authProviderMetadataFixture);

      const orchestratorFallbacks = trace.timeline.filter((event) => event.type === "orchestrator_fallback");
      assert.equal(orchestratorFallbacks.length, 1);
      assert.equal(orchestratorFallbacks[0]!.reason, "llm_error");
      assert.deepEqual(orchestratorFallbacks[0]!.providerMetadata, authProviderMetadataFixture);

      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.turnId, body.turnId);
      assert.equal(routeFallbacks[0]!.fallbackSource, "orchestrator");
      assert.equal(routeFallbacks[0]!.reason, "llm_error");
      assert.deepEqual(routeFallbacks[0]!.providerMetadata, authProviderMetadataFixture);
      assert.equal(trace.timeline.some((event) => event.type === "route_completion"), false);

      const serializedEvidence = JSON.stringify({
        logs: parseLogLines(logLines),
        trace,
      });
      assert.ok(!serializedEvidence.includes(rawMealText));
      assert.ok(!serializedEvidence.includes(logDeviceId));
      assert.ok(!serializedEvidence.includes(logCookieHeader));
      assert.doesNotMatch(
        serializedEvidence,
        /Authorization|Bearer|sk-|rawHeaders|headers|rawBody|"body"|"messages"|"content"|cookie|guest_session|upload|data:image|final assistant/i,
      );
    } finally {
      await logApp.close();
    }
  });

  it("JSON provider stream continuation llm_error fallback emits route fallback only with provider metadata", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const traceRecorder = createLlmTraceRecorder();
    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: new JsonProviderStreamErrorProvider(new LLMProviderError(providerMetadataFixture)),
      logger: { level: "info", stream: logStream },
      llmTraceRecorderFactory: () => traceRecorder,
    });
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const logAddress = await logApp.listen({ port: 0 });

    try {
      const form = new FormData();
      form.append("message", "這段文字不應進 stream fallback event");
      const res = await fetch(`${logAddress}/api/chat`, {
        method: "POST",
        headers: { cookie: logCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as { turnId?: string; reply?: string; didLogMeal?: boolean };
      assert.match(body.turnId ?? "", UUID_PATTERN);
      assert.match(body.reply ?? "", /抱歉|無法/);
      assert.equal(body.didLogMeal, false);

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.equal(fallbackEvents[0]!.source, "json");
      assert.equal(fallbackEvents[0]!.turnId, body.turnId);
      assert.equal(fallbackEvents[0]!.fallbackSource, "orchestrator");
      assert.equal(fallbackEvents[0]!.reason, "llm_error");
      assert.deepEqual(fallbackEvents[0]!.providerMetadata, providerMetadataFixture);
      assert.equal("catchSite" in fallbackEvents[0]!, false);

      const trace = traceRecorder.build({ scenario: "json-provider-stream-fallback", status: "passed" });
      const llmErrors = trace.timeline.filter((event) => event.type === "llm_error");
      const orchestratorFallbacks = trace.timeline.filter((event) => event.type === "orchestrator_fallback");
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.ok(llmErrors.length >= 1);
      assert.ok(orchestratorFallbacks.some((event) =>
        event.reason === "llm_error"
        && JSON.stringify(event.providerMetadata) === JSON.stringify(providerMetadataFixture)
      ));
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.turnId, body.turnId);
      assert.equal(routeFallbacks[0]!.fallbackSource, "orchestrator");
      assert.equal(routeFallbacks[0]!.reason, "llm_error");
      assert.deepEqual(routeFallbacks[0]!.providerMetadata, providerMetadataFixture);
      assert.equal("catchSite" in routeFallbacks[0]!, false);
      assert.equal(trace.timeline.some((event) => event.type === "route_completion"), false);
    } finally {
      await logApp.close();
    }
  });

  it("JSON partial_success fallback result emits route fallback only without provider metadata", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const traceRecorder = createLlmTraceRecorder();
    let logServices: AppServices | undefined;
    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      logger: { level: "info", stream: logStream },
      llmTraceRecorderFactory: () => traceRecorder,
      onServicesReady: (readyServices) => {
        logServices = readyServices;
      },
    });
    assert.ok(logServices);
    const originalHandleMessage = logServices.orchestrator.handleMessage.bind(logServices.orchestrator);
    logServices.orchestrator.handleMessage = async (requestDeviceId, userMessage, _imageBase64, _assetRef, opts) => {
      await logServices!.chatService.saveMessage(requestDeviceId, "user", userMessage);
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
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const logAddress = await logApp.listen({ port: 0 });

    try {
      const form = new FormData();
      form.append("message", "我吃了蘋果");
      const res = await fetch(`${logAddress}/api/chat`, {
        method: "POST",
        headers: { cookie: logCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as { turnId?: string; didLogMeal?: boolean; didMutateMeal?: boolean };
      assert.match(body.turnId ?? "", UUID_PATTERN);
      assert.equal(body.didLogMeal, true);
      assert.equal(body.didMutateMeal, true);

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.equal(fallbackEvents[0]!.source, "json");
      assert.equal(fallbackEvents[0]!.turnId, body.turnId);
      assert.equal(fallbackEvents[0]!.fallbackSource, "orchestrator");
      assert.equal(fallbackEvents[0]!.reason, "partial_success");
      assert.equal(fallbackEvents[0]!.didLogMeal, true);
      assert.equal(fallbackEvents[0]!.didMutateMeal, true);
      assert.equal(fallbackEvents[0]!.round, 2);
      assert.equal(fallbackEvents[0]!.lastTool, "log_food");
      assert.equal("providerMetadata" in fallbackEvents[0]!, false);

      const trace = traceRecorder.build({ scenario: "json-partial-success-fallback", status: "passed" });
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.transport, "json");
      assert.equal(routeFallbacks[0]!.turnId, body.turnId);
      assert.equal(routeFallbacks[0]!.fallbackSource, "orchestrator");
      assert.equal(routeFallbacks[0]!.reason, "partial_success");
      assert.equal(routeFallbacks[0]!.didLogMeal, true);
      assert.equal(routeFallbacks[0]!.didMutateMeal, true);
      assert.equal("providerMetadata" in routeFallbacks[0]!, false);
      assert.equal(trace.timeline.some((event) => event.type === "route_completion"), false);
    } finally {
      logServices.orchestrator.handleMessage = originalHandleMessage;
      await logApp.close();
    }
  });

  it("JSON non-provider orchestrator max_rounds fallback omits provider metadata and completion", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const logLLM = new MockLLMProvider();
    for (let i = 0; i < 3; i += 1) {
      logLLM.queueChatResponse({
        toolCalls: [{
          id: `max_round_json_${i}`,
          type: "function",
          function: { name: "get_daily_summary", arguments: "{}" },
        }],
      });
    }
    const traceRecorder = createLlmTraceRecorder();
    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: logLLM,
      logger: { level: "info", stream: logStream },
      llmTraceRecorderFactory: () => traceRecorder,
    });
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const logAddress = await logApp.listen({ port: 0 });

    try {
      const form = new FormData();
      form.append("message", "查一下摘要");
      const res = await fetch(`${logAddress}/api/chat`, {
        method: "POST",
        headers: { cookie: logCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as { turnId?: string };
      assert.match(body.turnId ?? "", UUID_PATTERN);

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.equal(fallbackEvents[0]!.source, "json");
      assert.equal(fallbackEvents[0]!.turnId, body.turnId);
      assert.equal(fallbackEvents[0]!.fallbackSource, "orchestrator");
      assert.equal(fallbackEvents[0]!.reason, "max_rounds");
      assert.equal("providerMetadata" in fallbackEvents[0]!, false);

      const trace = traceRecorder.build({ scenario: "json-max-rounds-fallback", status: "passed" });
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.fallbackSource, "orchestrator");
      assert.equal(routeFallbacks[0]!.reason, "max_rounds");
      assert.equal("providerMetadata" in routeFallbacks[0]!, false);
      assert.equal(trace.timeline.some((event) => event.type === "route_completion"), false);
    } finally {
      await logApp.close();
    }
  });

  it("JSON route-owned hallucination fallback emits route fallback only without provider metadata", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const traceRecorder = createLlmTraceRecorder();
    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: new JsonHallucinationStreamProvider(),
      logger: { level: "info", stream: logStream },
      llmTraceRecorderFactory: () => traceRecorder,
    });
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const logAddress = await logApp.listen({ port: 0 });

    try {
      const form = new FormData();
      form.append("message", "請記錄一餐");
      const res = await fetch(`${logAddress}/api/chat`, {
        method: "POST",
        headers: { cookie: logCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as { turnId?: string; reply?: string };
      assert.match(body.turnId ?? "", UUID_PATTERN);
      assert.match(body.reply ?? "", /無法辨識|補充文字/);

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.equal(fallbackEvents[0]!.source, "json");
      assert.equal(fallbackEvents[0]!.turnId, body.turnId);
      assert.equal(fallbackEvents[0]!.fallbackSource, "route_hallucination");
      assert.equal(fallbackEvents[0]!.reason, "hallucination_detected");
      assert.equal("providerMetadata" in fallbackEvents[0]!, false);

      const trace = traceRecorder.build({ scenario: "json-hallucination-fallback", status: "passed" });
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.fallbackSource, "route_hallucination");
      assert.equal(routeFallbacks[0]!.reason, "hallucination_detected");
      assert.equal("providerMetadata" in routeFallbacks[0]!, false);
      assert.equal(trace.timeline.some((event) => event.type === "route_completion"), false);
    } finally {
      await logApp.close();
    }
  });

  it("JSON outer catch emits sanitized route_catch fallback without completed turn", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const traceRecorder = createLlmTraceRecorder();
    let logServices: AppServices | undefined;
    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      logger: { level: "info", stream: logStream },
      llmTraceRecorderFactory: () => traceRecorder,
      onServicesReady: (readyServices) => {
        logServices = readyServices;
      },
    });
    assert.ok(logServices);
    const originalGetCompressedHistory = logServices.chatService.getCompressedHistory.bind(logServices.chatService);
    logServices.chatService.getCompressedHistory = async () => {
      throw new Error("RouteSafeFailure");
    };
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const logAddress = await logApp.listen({ port: 0 });

    try {
      const form = new FormData();
      form.append("message", "今天午餐是豆腐");
      const res = await fetch(`${logAddress}/api/chat`, {
        method: "POST",
        headers: { cookie: logCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as { turnId?: string; reply?: string; didLogMeal?: boolean };
      assert.match(body.turnId ?? "", UUID_PATTERN);
      assert.match(body.reply ?? "", /抱歉|無法/);
      assert.equal(body.didLogMeal, false);

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
        source: "json",
        turnId: body.turnId,
        fallbackSource: "route_catch",
        reason: "route_catch",
        catchSite: "json_outer",
        errorName: "Error",
        errorMessage: "RouteSafeFailure",
      });

      const trace = traceRecorder.build({ scenario: "json-route-catch", status: "passed" });
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.turnId, body.turnId);
      assert.equal(routeFallbacks[0]!.fallbackSource, "route_catch");
      assert.equal(routeFallbacks[0]!.reason, "route_catch");
      assert.equal(routeFallbacks[0]!.catchSite, "json_outer");
      assert.equal(routeFallbacks[0]!.errorName, "Error");
      assert.equal(routeFallbacks[0]!.errorMessage, "RouteSafeFailure");
      assert.equal(trace.timeline.some((event) => event.type === "route_completion"), false);
    } finally {
      logServices.chatService.getCompressedHistory = originalGetCompressedHistory;
      await logApp.close();
    }
  });

  it("JSON outer catch omits unsafe thrown material from route fallback logs and trace", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const traceRecorder = createLlmTraceRecorder();
    let logServices: AppServices | undefined;
    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      logger: { level: "info", stream: logStream },
      llmTraceRecorderFactory: () => traceRecorder,
      onServicesReady: (readyServices) => {
        logServices = readyServices;
      },
    });
    assert.ok(logServices);
    const originalGetCompressedHistory = logServices.chatService.getCompressedHistory.bind(logServices.chatService);
    const rawMealText = "機密營養文字";
    const unsafeErrorMessage = `prompt messages user ${rawMealText} provider body header tool payload assistant final text data:image guest_session session`;
    logServices.chatService.getCompressedHistory = async () => {
      const error = new Error(unsafeErrorMessage);
      (error as Error & { cause?: unknown }).cause = new Error("CAUSE_SECRET");
      throw error;
    };
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logDeviceId = deviceRes.json().deviceId as string;
    const logCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const logAddress = await logApp.listen({ port: 0 });

    try {
      const form = new FormData();
      form.append("message", rawMealText);
      const res = await fetch(`${logAddress}/api/chat`, {
        method: "POST",
        headers: { cookie: logCookieHeader },
        body: form,
      });

      assert.equal(res.status, 200);
      const body = await res.json() as { turnId?: string; reply?: string };
      assert.match(body.turnId ?? "", UUID_PATTERN);
      assert.match(body.reply ?? "", /抱歉|無法/);

      const completedEvents = observabilityEvents(logLines, "chat_turn_completed");
      const fallbackEvents = observabilityEvents(logLines, "chat_route_fallback");
      assert.equal(completedEvents.length, 0);
      assert.equal(fallbackEvents.length, 1);
      assert.equal(fallbackEvents[0]!.fallbackSource, "route_catch");
      assert.equal(fallbackEvents[0]!.catchSite, "json_outer");
      assert.equal("errorName" in fallbackEvents[0]!, false);
      assert.equal("errorMessage" in fallbackEvents[0]!, false);

      const trace = traceRecorder.build({ scenario: "json-route-catch-redaction", status: "passed" });
      const routeFallbacks = trace.timeline.filter((event) => event.type === "route_fallback");
      assert.equal(routeFallbacks.length, 1);
      assert.equal(routeFallbacks[0]!.fallbackSource, "route_catch");
      assert.equal(routeFallbacks[0]!.catchSite, "json_outer");
      assert.equal("errorName" in routeFallbacks[0]!, false);
      assert.equal("errorMessage" in routeFallbacks[0]!, false);

      const serializedLogs = JSON.stringify(parseLogLines(logLines));
      const serializedTrace = JSON.stringify(trace);
      for (const serialized of [serializedLogs, serializedTrace]) {
        assert.ok(!serialized.includes(rawMealText));
        assert.ok(!serialized.includes(logDeviceId));
        assert.ok(!serialized.includes(logCookieHeader));
        assert.doesNotMatch(
          serialized,
          /CAUSE_SECRET|prompt messages user 機密營養文字|provider body|header|tool payload|assistant final text|data:image|guest_session|session|stack/,
        );
      }
    } finally {
      logServices.chatService.getCompressedHistory = originalGetCompressedHistory;
      await logApp.close();
    }
  });

  it("logs one redacted chat_turn_completed event for SSE image requests", async () => {
    const { logLines, stream: logStream } = createLogCapture();
    const rawMealText = "這張圖是機密牛肉飯";
    const assistantReply = "看起來是機密牛肉飯，已記錄。";
    const logLLM = new MockLLMProvider();
    logLLM.queueChatResponse({ content: assistantReply });
    const logTempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-chat-log-"));
    const logUploadsDir = path.join(logTempRoot, "uploads");
    const logAssetsDir = path.join(logTempRoot, "assets");

    const logApp = await buildApp({
      dbPath: ":memory:",
      llmProvider: logLLM,
      uploadsDir: logUploadsDir,
      assetsDir: logAssetsDir,
      logger: { level: "info", stream: logStream },
    });
    const deviceRes = await logApp.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const logDeviceId = deviceRes.json().deviceId as string;
    const logCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
    const logAddress = await logApp.listen({ port: 0 });
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    try {
      const form = new FormData();
      form.append("message", rawMealText);
      form.append("image", new Blob([validPngBytes()], { type: "image/png" }), "secret-meal.png");
      const res = await fetch(`${logAddress}/api/chat`, {
        method: "POST",
        headers: { cookie: logCookieHeader, Accept: "text/event-stream" },
        body: form,
      });

      assert.equal(res.status, 200);
      reader = res.body?.getReader();
      assert.ok(reader);
      const { raw } = await readUntilEventCount(reader, "done", 1);
      assert.match(raw, /event: done/);

      const eventRecords = observabilityEvents(logLines, "chat_turn_completed");
      assert.equal(eventRecords.length, 1);
      assert.deepEqual(chatTurnCompletedMetadata(eventRecords[0]!), {
        event: "chat_turn_completed",
        source: "sse",
        didLogMeal: false,
        didMutateMeal: false,
        hadImage: true,
        latencyMs: eventRecords[0]?.latencyMs,
      });
      assert.equal(typeof eventRecords[0]?.latencyMs, "number");

      const serializedLogs = JSON.stringify(parseLogLines(logLines));
      assert.ok(!serializedLogs.includes(rawMealText));
      assert.ok(!serializedLogs.includes(assistantReply));
      assert.ok(!serializedLogs.includes(logDeviceId));
      assert.doesNotMatch(serializedLogs, /secret-meal|\/uploads\/|\/assets\//);
    } finally {
      await reader?.cancel().catch(() => {});
      await logApp.close();
      await rm(logTempRoot, { recursive: true, force: true });
    }
  });
});
