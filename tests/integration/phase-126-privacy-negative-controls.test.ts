process.env.TZ = "Asia/Taipei";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { buildApp, type AppServices } from "../../server/app.js";
import { LLMProviderError } from "../../server/llm/errors.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { ProviderErrorMetadata } from "../../server/llm/types.js";

function createLogCapture() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of chunk.toString().split("\n")) {
        if (line.trim()) lines.push(line);
      }
      callback();
    },
  });
  return { lines, stream };
}

function parseLogRecords(lines: readonly string[]) {
  return lines.flatMap((line) => {
    try {
      return [JSON.parse(line) as Record<string, unknown>];
    } catch {
      return [];
    }
  });
}

function cookieHeader(raw: string | string[] | undefined) {
  const values = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

function sseEvents(raw: string) {
  return raw
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      return {
        event: lines.find((line) => line.startsWith("event: "))?.slice(7) ?? "",
        data: lines.find((line) => line.startsWith("data: "))?.slice(6) ?? "",
      };
    });
}

function hasSentinelValue(value: unknown, sentinel: string): boolean {
  const numericSentinel = sentinel.trim() === "" ? undefined : Number(sentinel);
  if (typeof value === "string") return value.includes(sentinel);
  if (typeof value === "number") {
    return numericSentinel !== undefined && Number.isFinite(numericSentinel) && value === numericSentinel;
  }
  if (Array.isArray(value)) return value.some((item) => hasSentinelValue(item, sentinel));
  if (value !== null && typeof value === "object") {
    return Object.values(value as Record<string, unknown>).some((item) => hasSentinelValue(item, sentinel));
  }
  return false;
}

function assertSentinelAbsent(channel: string, key: string, value: unknown, sentinel: string) {
  const found = hasSentinelValue(value, sentinel);
  assert.equal(found, false, `channel=${channel} key=${key} found=${found}`);
}

async function createHarness(mockLLM: MockLLMProvider) {
  const capture = createLogCapture();
  let services: AppServices | undefined;
  const app = await buildApp({
    dbPath: ":memory:",
    llmProvider: mockLLM,
    logger: { level: "info", stream: capture.stream },
    onServicesReady: (readyServices) => { services = readyServices; },
  });
  const deviceResponse = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
  const address = await app.listen({ port: 0 });
  return {
    app,
    address,
    capture,
    services,
    cookie: cookieHeader(deviceResponse.headers["set-cookie"]),
    deviceId: deviceResponse.json().deviceId as string,
  };
}

describe("Phase 126 routine observability privacy negative controls", () => {
  it("does not confuse a numeric substring collision with real string or numeric leaks", () => {
    const sentinel = "396";
    const latencyRecord = [{ event: "chat_turn_completed", latencyMs: 1396 }];
    const legacySubstringCount = JSON.stringify(latencyRecord).split(sentinel).length - 1;

    assert.equal(legacySubstringCount, 1, "the old matcher must reproduce the latencyMs collision");
    assert.doesNotThrow(() => assertSentinelAbsent("json", "routine_metadata", latencyRecord, sentinel));
    assert.doesNotThrow(() => assertSentinelAbsent(
      "json",
      "routine_metadata",
      [{ metadata: { latencyMs: 13960 } }],
      sentinel,
    ));
    assert.throws(
      () => assertSentinelAbsent("json", "routine_metadata", [{ metadata: { note: "prefix-396-suffix" } }], sentinel),
      /found=true/,
    );
    assert.throws(
      () => assertSentinelAbsent("json", "routine_metadata", [{ metadata: { calories: 396 } }], sentinel),
      /found=true/,
    );
  });

  it("keeps JSON provider failures metadata-only without changing the fallback contract", async () => {
    const mockLLM = new MockLLMProvider();
    const providerMetadata: ProviderErrorMetadata = {
      provider: "openai",
      operation: "chat",
      model: "raw-provider-model-sentinel-41e7",
      aborted: false,
      status: 502,
      providerRequestId: "privacy-sentinel-header-63b2",
      errorName: "raw-provider-body-sentinel-0d9a",
      errorType: "raw-provider-type-sentinel-5e11",
      errorCode: "raw-provider-code-sentinel-8c04",
    };
    mockLLM.queueChatError(new LLMProviderError(providerMetadata));
    const harness = await createHarness(mockLLM);

    try {
      const form = new FormData();
      form.append("message", "請查看今日摘要");
      const response = await fetch(`${harness.address}/api/chat`, {
        method: "POST",
        headers: { cookie: harness.cookie },
        body: form,
      });
      const body = await response.json() as Record<string, unknown>;
      assert.equal(response.status, 200);
      assert.equal(body.didLogMeal, false);
      assert.equal(typeof body.reply, "string");

      const records = parseLogRecords(harness.capture.lines);
      const routineRecords = records.filter((record) => [
        "llm_provider_error",
        "orchestrator_fallback",
        "chat_route_fallback",
      ].includes(String(record.event)));
      assert.ok(routineRecords.length >= 2);
      for (const sentinel of [
        "raw-provider-model-sentinel-41e7",
        "privacy-sentinel-header-63b2",
        "raw-provider-body-sentinel-0d9a",
        "raw-provider-type-sentinel-5e11",
        "raw-provider-code-sentinel-8c04",
      ]) {
        assertSentinelAbsent("json", "routine_metadata", routineRecords, sentinel);
        assertSentinelAbsent("json", "response", body, sentinel);
      }

      const providerError = routineRecords.find((record) => record.event === "llm_provider_error");
      assert.ok(providerError);
      assert.deepEqual(Object.keys(providerError.providerMetadata as Record<string, unknown>).sort(), [
        "aborted",
        "errorCode",
        "errorName",
        "errorType",
        "model",
        "operation",
        "provider",
        "status",
        "providerRequestId",
      ].sort());
    } finally {
      await harness.app.close();
    }
  });

  it("keeps SSE receipts and provider tool context factual while routine metadata excludes sentinels", async () => {
    const mockLLM = new MockLLMProvider();
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "privacy-log-food-call",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [{
              food_name: "雞胸肉",
              calories: 3901,
              protein: 397,
              carbs: 799,
              fat: 299,
              amount: "privacy-sentinel-tool-payload-7a20",
            }],
            protein_sources: [{
              name: "雞胸肉",
              protein: 396,
              is_primary: true,
              certainty: "clear",
            }],
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "assistant-final-sentinel-5f92" });
    const harness = await createHarness(mockLLM);

    try {
      const form = new FormData();
      form.append("message", "請幫我記錄這餐");
      const response = await fetch(`${harness.address}/api/chat`, {
        method: "POST",
        headers: { cookie: harness.cookie, accept: "text/event-stream" },
        body: form,
      });
      const raw = await response.text();
      const done = sseEvents(raw).find((event) => event.event === "done");
      assert.equal(response.status, 200);
      assert.ok(done);
      const donePayload = JSON.parse(done.data) as Record<string, any>;
      assert.equal(donePayload.didLogMeal, true);
      assert.equal(donePayload.didMutateMeal, true);
      assert.equal(donePayload.loggedMeal.foodName, "雞胸肉");
      assert.equal(donePayload.loggedMeal.calories, 3901);
      assert.equal(donePayload.dailySummary.totalCalories, 3901);

      const toolContext = mockLLM.chatCalls
        .flatMap((call) => call.messages)
        .filter((message) => message.role === "tool")
        .map((message) => String(message.content))
        .join("\n");
      assert.ok(toolContext.includes("成功"));

      const routineRecords = parseLogRecords(harness.capture.lines).filter((record) => [
        "tool_received",
        "tool_result",
        "chat_turn_completed",
      ].includes(String(record.event)));
      for (const [label, sentinel] of [
        ["tool_payload", "privacy-sentinel-tool-payload-7a20"],
        ["calories", "3901"],
        ["protein", "397"],
        ["carbs", "799"],
        ["fat", "299"],
        ["protein_source", "396"],
        ["assistant_text", "assistant-final-sentinel-5f92"],
      ] as const) {
        assertSentinelAbsent("sse", `routine_metadata.${label}`, routineRecords, sentinel);
      }

      const history = await harness.services?.chatService.getHistory(harness.deviceId, 20);
      assert.ok(history?.some((message) => message.role === "assistant"));
      assert.ok(history?.some((message) => String(message.content).includes("雞胸肉")));
    } finally {
      await harness.app.close();
    }
  });

  it("keeps JSON get_daily_summary facts in the user contract while excluding its exact totals from routine metadata", async () => {
    const mockLLM = new MockLLMProvider();
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "privacy-summary-call",
        type: "function",
        function: { name: "get_daily_summary", arguments: "{}" },
      }],
    });
    mockLLM.queueChatResponse({ content: "assistant-summary-sentinel-2a11" });
    const harness = await createHarness(mockLLM);

    try {
      await harness.services?.foodLoggingService.logGroupedMeal(harness.deviceId, {
        items: [{ foodName: "雞胸肉", calories: 3901, protein: 397, carbs: 799, fat: 299 }],
      });
      const form = new FormData();
      form.append("message", "今天吃了多少？");
      const response = await fetch(`${harness.address}/api/chat`, {
        method: "POST",
        headers: { cookie: harness.cookie },
        body: form,
      });
      const body = await response.json() as Record<string, any>;
      assert.equal(response.status, 200);
      assert.equal(body.dailySummary.totalCalories, 3901);
      assert.equal(body.dailySummary.totalProtein, 397);
      assert.equal(body.dailySummary.totalCarbs, 799);
      assert.equal(body.dailySummary.totalFat, 299);

      const toolContext = mockLLM.chatCalls
        .flatMap((call) => call.messages)
        .filter((message) => message.role === "tool")
        .map((message) => String(message.content))
        .join("\n");
      assert.ok(toolContext.includes("\"totalCalories\":3901"));
      assert.ok(toolContext.includes("\"totalProtein\":397"));

      const routineRecords = parseLogRecords(harness.capture.lines).filter((record) => [
        "tool_received",
        "tool_result",
        "chat_turn_completed",
      ].includes(String(record.event)));
      for (const sentinel of [
        "3901",
        "397",
        "799",
        "299",
        "assistant-summary-sentinel-2a11",
      ]) {
        assertSentinelAbsent("json", "routine_metadata", routineRecords, sentinel);
      }

      const history = await harness.services?.chatService.getHistory(harness.deviceId, 20);
      assert.ok(history?.some((message) => message.role === "assistant"));
    } finally {
      await harness.app.close();
    }
  });
});
