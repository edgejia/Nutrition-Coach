process.env.TZ = "Asia/Taipei";

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createScenarioApp } from "../harness/app-fixture.js";
import { parseSSEEvents, collectEventSequence, readStreamThroughClose, readStreamUntilEvent } from "../harness/sse.js";
import { StreamingLLMProvider } from "../harness/streaming-llm.js";
import type { VerificationScenario, ScenarioContext, ScenarioResult, ScenarioStepResult } from "../harness/scenario-types.js";

function assertRunnerManagedScenarioSource(source: string): void {
  assert.match(source, /\bprepareApp\s*\(/, "scenario must define prepareApp");
  assert.match(source, /async\s+run\(ctx: ScenarioContext\)/, "scenario must consume the runner context in run(ctx)");
  assert.match(source, /\bctx\.prepared\b/, "scenario must consume prepared runner state from ctx");
  assert.doesNotMatch(source, /\bcreateScenarioApp\b/, "scenario must not call createScenarioApp");
}

describe("harness-foundation", () => {
  test("scenario types have correct shape", () => {
    // Verify the interfaces are importable and have the expected contract shape.
    // We check this by constructing objects that satisfy the interfaces.
    const stepResult: ScenarioStepResult = {
      name: "check-reply",
      ok: true,
      actual: { reply: "hello" },
    };
    assert.equal(stepResult.ok, true);
    assert.equal(stepResult.name, "check-reply");

    const scenarioResult: ScenarioResult = {
      ok: true,
      steps: [stepResult],
      artifacts: { requestHeaders: {} },
      consoleSummary: "PASS test-scenario 1/1",
    };
    assert.equal(scenarioResult.ok, true);
    assert.equal(scenarioResult.steps.length, 1);
    assert.ok("artifacts" in scenarioResult);
    assert.ok("consoleSummary" in scenarioResult);

    // Verify VerificationScenario shape can be constructed
    const scenario: VerificationScenario = {
      name: "test-scenario",
      run: async (_ctx: ScenarioContext): Promise<ScenarioResult> => scenarioResult,
    };
    assert.equal(scenario.name, "test-scenario");
    assert.equal(typeof scenario.run, "function");
  });

  test("parseSSEEvents decodes representative SSE transcript", () => {
    const raw = [
      "event: status",
      "data: 分析圖片中...",
      "",
      "event: chunk",
      'data: {"token":"hello"}',
      "",
      "event: chunk",
      'data: {"token":" world"}',
      "",
      "event: done",
      'data: {"reply":"hello world","didLogMeal":false}',
      "",
    ].join("\n");

    const events = parseSSEEvents(raw);
    assert.equal(events.length, 4);
    assert.equal(events[0].event, "status");
    assert.equal(events[0].data, "分析圖片中...");
    assert.equal(events[1].event, "chunk");
    assert.equal(events[2].event, "chunk");
    assert.equal(events[3].event, "done");
  });

  test("collectEventSequence returns ordered event names", () => {
    const raw = [
      "event: status",
      "data: 記錄餐點中...",
      "",
      "event: chunk",
      'data: {"token":"test"}',
      "",
      "event: done",
      'data: {"reply":"test"}',
      "",
    ].join("\n");

    const sequence = collectEventSequence(raw);
    assert.deepEqual(sequence, ["status", "chunk", "done"]);
  });

  test("readStreamUntilEvent stops at target event", async () => {
    const sseFrames = [
      "event: status\ndata: 記錄中\n\n",
      "event: chunk\ndata: {\"token\":\"hello\"}\n\n",
      "event: done\ndata: {\"reply\":\"hello\"}\n\n",
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of sseFrames) {
          controller.enqueue(encoder.encode(frame));
        }
        controller.close();
      },
    });

    const reader = stream.getReader();
    const result = await readStreamUntilEvent(reader, "done", 40);
    assert.match(result, /event: done/);
    assert.match(result, /event: chunk/);
    assert.match(result, /event: status/);
  });

  test("readStreamThroughClose reports terminal done contract evidence", async () => {
    const sseFrames = [
      "event: status\ndata: 記錄中\n\n",
      "event: chunk\ndata: {\"token\":\"hello\"}\n\n",
      "event: done\ndata: {\"reply\":\"hello\"}\n\n",
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of sseFrames) {
          controller.enqueue(encoder.encode(frame));
        }
        controller.close();
      },
    });

    const result = await readStreamThroughClose(stream.getReader(), { maxReads: 10, readTimeoutMs: 1000 });
    assert.equal(result.closed, true);
    assert.equal(result.firstDoneIndex, 2);
    assert.equal(result.nonEmptyChunkBeforeDone, true);
    assert.deepEqual(result.eventsAfterFirstDone, []);
    assert.deepEqual(result.events.map((event) => event.event), ["status", "chunk", "done"]);
  });

  test("readStreamThroughClose exposes chunk and status events after first done", async () => {
    const sseFrames = [
      "event: chunk\ndata: {\"token\":\"hello\"}\n\n",
      "event: done\ndata: {\"reply\":\"hello\"}\n\n",
      "event: status\ndata: late\n\n",
      "event: chunk\ndata: {\"token\":\"late\"}\n\n",
    ];

    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const frame of sseFrames) {
          controller.enqueue(encoder.encode(frame));
        }
        controller.close();
      },
    });

    const result = await readStreamThroughClose(stream.getReader(), { maxReads: 10, readTimeoutMs: 1000 });
    assert.equal(result.closed, true);
    assert.equal(result.firstDoneIndex, 1);
    assert.equal(result.nonEmptyChunkBeforeDone, true);
    assert.deepEqual(result.eventsAfterFirstDone.map((event) => event.event), ["status", "chunk"]);
  });

  test("StreamingLLMProvider returns queued round data", async () => {
    const provider = new StreamingLLMProvider();
    provider.queueRoundResponse({ content: "hello" });

    const result = await provider.chatRound!([], []);
    assert.equal(result.kind, "response");
    if (result.kind === "response") {
      assert.equal(result.response.content, "hello");
    }
  });

  test("StreamingLLMProvider returns queued chat response", async () => {
    const provider = new StreamingLLMProvider();
    provider.queueChatResponse({ content: "queued reply" });

    const result = await provider.chat([], []);
    assert.equal(result.content, "queued reply");
  });

  test("StreamingLLMProvider returns queued stream tokens", async () => {
    const provider = new StreamingLLMProvider();
    provider.queueChatStream(["token1", " token2"]);

    const result = await provider.chatRound!([], []);
    assert.equal(result.kind, "stream");
    if (result.kind === "stream") {
      const tokens: string[] = [];
      for await (const token of result.streamGenerator) {
        tokens.push(token);
      }
      assert.deepEqual(tokens, ["token1", " token2"]);
    }
  });

  test("StreamingLLMProvider throws queued error", async () => {
    const provider = new StreamingLLMProvider();
    provider.queueChatError(new Error("provider-error"));

    await assert.rejects(() => provider.chat([], []), { message: "provider-error" });
  });

  test("StreamingLLMProvider reset clears all queues", async () => {
    const provider = new StreamingLLMProvider();
    provider.queueChatResponse({ content: "will be cleared" });
    provider.queueRoundResponse({ content: "will be cleared" });
    provider.reset();

    // After reset, should return default fallback
    const result = await provider.chat([], []);
    assert.equal(result.content, "Mock: 已記錄您的飲食！");
  });

  test("createScenarioApp boots with :memory: and TZ=Asia/Taipei", async () => {
    const ctx = await createScenarioApp({});
    try {
      assert.ok(ctx.app, "app must be defined");
      assert.ok(ctx.address, "address must be a listening URL");
      assert.ok(ctx.deviceId, "deviceId must be seeded");
      assert.match(ctx.address, /^http:\/\/127\.0\.0\.1:\d+$/);
      assert.equal(process.env.TZ, "Asia/Taipei");

      // Verify device is usable
      const res = await fetch(`${ctx.address}/api/chat/history?limit=5`, {
        headers: { cookie: ctx.cookieHeader },
      });
      assert.equal(res.status, 200);
    } finally {
      await ctx.close();
    }
  });

  test("meal-image-continuity scenario is registered as an identity-backed harness proof", () => {
    const source = readFileSync("tests/harness/scenarios/meal-image-continuity.ts", "utf-8");

    for (const marker of [
      'name: "meal-image-continuity"',
      "STEP_NAMES",
      "capture_chat_receipt",
      "verify_today_records",
      "verify_history_day",
      "verify_meal_edit_payload",
      "verify_asset_identity_boundary",
      "verify_upload_cleanup",
      "prepareApp",
      "async run(ctx: ScenarioContext)",
      "ctx.prepared",
      "StreamingLLMProvider",
    ]) {
      assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    assertRunnerManagedScenarioSource(source);
    assert.doesNotMatch(source, /foodName.*find|calories.*find|protein.*find|loggedAt.*find/);
  });

  test("grouped-meal-canonical scenario is registered as a grouped logging proof", () => {
    const source = readFileSync("tests/harness/scenarios/grouped-meal-canonical.ts", "utf-8");

    for (const marker of [
      'name: "grouped-meal-canonical"',
      "STEP_NAMES",
      "image_grouped_log",
      "text_single_log",
      "chat_grouped_edit",
      "direct_edit_block",
      "verify_history",
      "replyCopy",
      "securityNotes",
      "prepareApp",
      "async run(ctx: ScenarioContext)",
      "ctx.prepared",
      "StreamingLLMProvider",
    ]) {
      assert.match(source, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }

    assertRunnerManagedScenarioSource(source);
    assert.doesNotMatch(source, /OpenAIProvider|OPENAI_API_KEY|process\.env\.OPENAI/);
  });

  test("scenario source contract rejects nested createScenarioApp lifecycle ownership", () => {
    const staleSource = [
      'const scenario: VerificationScenario = {',
      '  prepareApp() { return {}; },',
      '  async run(ctx: ScenarioContext) {',
      '    const prepared = ctx.prepared;',
      '    const fixture = await createScenarioApp({});',
      '    return useRunnerContext(ctx, fixture, prepared);',
      '  },',
      '};',
    ].join("\n");

    assert.throws(
      () => assertRunnerManagedScenarioSource(staleSource),
      /scenario must not call createScenarioApp/,
    );
  });
});
