import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_SYSTEM_PROMPT_VERSION,
  SYSTEM_PROMPT_SECTION_IDS,
} from "../../server/orchestrator/system-prompt.js";
import {
  createLlmTraceRecorder,
  type LlmTraceFinalReplyShape,
  type LlmTraceFinalReplySource,
} from "../../server/orchestrator/llm-trace.js";
import { createStructuredHooks } from "../../server/orchestrator/hooks.js";
import type { ProviderErrorMetadata } from "../../server/llm/types.js";

const providerMetadata: ProviderErrorMetadata = {
  provider: "openai",
  operation: "chat_round_initial",
  model: "gpt-test",
  aborted: false,
  status: 429,
  providerRequestId: "req_safe_123",
  errorName: "RateLimitError",
  errorType: "rate_limit_error",
  errorCode: "rate_limit_exceeded",
};

const providerMetadataKeys = [
  "provider",
  "operation",
  "model",
  "aborted",
  "status",
  "providerRequestId",
  "errorName",
  "errorType",
  "errorCode",
];

describe("createLlmTraceRecorder", () => {
  it("records orchestrator timeline entries in call order", () => {
    const recorder = createLlmTraceRecorder();
    const hooks = recorder.asOrchestratorHooks();

    hooks.onLLMStart?.(1);
    hooks.onToolReceived?.("log_food", "{\"meal\":\"redacted\"}");
    hooks.onToolResult?.({
      tool: "log_food",
      success: true,
      executed: true,
      updatedFields: ["calories"],
      publishedEvents: ["daily_summary"],
    });
    hooks.onLLMEnd?.(1, true);
    hooks.onFallback?.({ reason: "max_rounds" });

    const trace = recorder.build({ scenario: "unit-trace", status: "pass" });

    assert.deepEqual(trace.timeline, [
      { type: "llm_round_start", round: 1 },
      { type: "tool_received", round: 1, tool: "log_food" },
      {
        type: "tool_result",
        round: 1,
        tool: "log_food",
        success: true,
        executed: true,
        updatedFields: ["calories"],
        publishedEvents: ["daily_summary"],
      },
      { type: "llm_round_end", round: 1, hadToolCalls: true },
      { type: "orchestrator_fallback", reason: "max_rounds" },
    ]);
  });

  it("builds a timeline-plus-summary artifact without grouped primary schema", () => {
    const recorder = createLlmTraceRecorder();
    const hooks = recorder.asOrchestratorHooks();

    hooks.onLLMStart?.(1);
    hooks.onToolReceived?.("get_daily_summary", "{}");
    hooks.onToolResult?.({ tool: "get_daily_summary", success: true, executed: true });
    hooks.onLLMEnd?.(1, true);
    recorder.recordFinalReply({ source: "model", shape: "plain_text" });
    recorder.recordMetrics({ latencyMs: 42 });

    const trace = recorder.build({ scenario: "unit-trace", status: "pass" });

    assert.deepEqual(Object.keys(trace), ["schemaVersion", "scenario", "status", "summary", "timeline"]);
    assert.equal(trace.schemaVersion, "llm-trace.v2");
    assert.equal(trace.scenario, "unit-trace");
    assert.equal(trace.status, "pass");
    assert.equal(trace.summary.roundCount, 1);
    assert.equal(trace.summary.toolCount, 1);
    assert.equal(trace.summary.fallbackCount, 0);
    assert.equal(trace.summary.providerErrorCount, 0);
    assert.equal(trace.summary.latencyMs, 42);
    assert.deepEqual(trace.summary.finalReply, {
      source: "model",
      shape: "plain_text",
    });
    assert.equal("rounds" in trace, false);
    assert.equal("tools" in trace, false);
    assert.equal("fallbacks" in trace, false);
  });

  it("derives prompt metadata from Phase 50 prompt exports", () => {
    const recorder = createLlmTraceRecorder();

    const trace = recorder.build({ scenario: "unit-trace", status: "pass" });

    assert.equal(trace.summary.prompt.version, ACTIVE_SYSTEM_PROMPT_VERSION);
    assert.deepEqual(trace.summary.prompt.sectionIds, Object.values(SYSTEM_PROMPT_SECTION_IDS));
    assert.deepEqual(trace.summary.finalReply, {
      source: "model",
      shape: "empty_or_missing",
    });
  });

  it("accepts exactly the Phase 53 final reply source labels", () => {
    const sources: LlmTraceFinalReplySource[] = [
      "renderer",
      "model",
      "fallback",
      "tool_receipt",
      "mixed",
    ];

    for (const source of sources) {
      const recorder = createLlmTraceRecorder();

      recorder.recordFinalReply({ source, shape: "plain_text" });

      const trace = recorder.build({ scenario: `unit-${source}`, status: "pass" });
      assert.equal(trace.summary.finalReply.source, source);
    }
  });

  it("accepts all Phase 51 final reply shape labels", () => {
    const shapes: LlmTraceFinalReplyShape[] = [
      "plain_text",
      "streamed_text",
      "fallback_text",
      "empty_or_missing",
    ];

    for (const shape of shapes) {
      const recorder = createLlmTraceRecorder();

      recorder.recordFinalReply({ source: "model", shape });

      const trace = recorder.build({ scenario: `unit-${shape}`, status: "pass" });
      assert.equal(trace.summary.finalReply.shape, shape);
    }
  });

  it("excludes malicious or accidental raw payload values while keeping operational trace keys", () => {
    const recorder = createLlmTraceRecorder();
    const hooks = recorder.asOrchestratorHooks();
    const unsafeToolPayload = {
      tool: "log_food",
      success: false,
      executed: false,
      failureReason: "validation secret-device-51 sk-test-secret",
      reason: "raw prompt text",
      fields: ["/uploads/raw-secret.jpg", "messages"],
      updatedFields: ["provider payload"],
      publishedEvents: ["guest_session=secret"],
      rawMeal: "我吃了隱私測試餐點",
      image: "data:image/png;base64,SECRETIMAGE",
      authorization: "Bearer secret-token",
      toolArguments: "raw tool arguments",
      toolResponse: "raw tool results",
    };
    const unsafeFinalReply = {
      source: "fallback" as const,
      shape: "fallback_text" as const,
      text: "final assistant text",
    };
    const unsafeRouteCompletion = {
      transport: "sse" as const,
      didLogMeal: false,
      didMutateMeal: false,
      completed: true as const,
      cookie: "guest_session=secret",
      reply: "final assistant text",
    };
    const unsafeMetrics = {
      latencyMs: 17,
      apiKey: "sk-test-secret",
    };

    hooks.onLLMStart?.(1);
    hooks.onToolReceived?.("log_food", "我吃了隱私測試餐點 /uploads/raw-secret.jpg");
    hooks.onToolResult?.(unsafeToolPayload);
    hooks.onLLMEnd?.(1, true);
    hooks.onFallback?.({ reason: "llm_error" });
    recorder.recordFinalReply(unsafeFinalReply);
    recorder.recordRouteCompletion(unsafeRouteCompletion);
    recorder.recordMetrics(unsafeMetrics);

    const traceJson = JSON.stringify(recorder.build({ scenario: "unit-trace", status: "pass" }));
    const forbiddenValues = [
      "secret-device-51",
      "我吃了隱私測試餐點",
      "/uploads/raw-secret.jpg",
      "data:image/png;base64,SECRETIMAGE",
      "sk-test-secret",
      "guest_session=secret",
      "Bearer secret-token",
      "raw prompt text",
      "messages",
      "provider payload",
      "raw tool arguments",
      "raw tool results",
      "final assistant text",
    ];

    for (const value of forbiddenValues) {
      assert.equal(traceJson.includes(value), false, `trace should exclude ${value}`);
    }

    for (const key of [
      "tool",
      "success",
      "executed",
      "failureReason",
      "roundCount",
      "toolCount",
      "fallbackCount",
      "latencyMs",
      "finalReply",
      "source",
      "shape",
    ]) {
      assert.equal(traceJson.includes(key), true, `trace should include ${key}`);
    }
  });

  it("records route fallback as a dedicated terminal trace fact", () => {
    const recorder = createLlmTraceRecorder();
    const unsafeProviderMetadata: ProviderErrorMetadata = {
      ...providerMetadata,
      providerRequestId: "Authorization Bearer",
      errorName: "raw prompt",
    };

    recorder.recordRouteFallback({
      transport: "json",
      turnId: "t_safe_123",
      fallbackSource: "route_catch",
      didLogMeal: false,
      didMutateMeal: false,
      reason: "llm_error",
      catchSite: "json_outer",
      providerMetadata: unsafeProviderMetadata,
      providerPayload: { body: "raw provider body" },
      finalAssistantContent: "final assistant text",
    } as never);

    const trace = recorder.build({ scenario: "unit-route-fallback", status: "pass" });

    assert.deepEqual(trace.timeline.at(-1), {
      type: "route_fallback",
      transport: "json",
      turnId: "t_safe_123",
      fallbackSource: "route_catch",
      didLogMeal: false,
      didMutateMeal: false,
      reason: "llm_error",
      catchSite: "json_outer",
      providerMetadata: {
        ...providerMetadata,
        providerRequestId: "redacted",
        errorName: "redacted",
      },
    });
    assert.equal(
      trace.timeline.some((event) => event.type === "route_completion"),
      false,
    );

    const traceJson = JSON.stringify(trace);
    for (const forbidden of ["Authorization", "Bearer", "raw prompt", "raw provider body", "final assistant text"]) {
      assert.equal(traceJson.includes(forbidden), false, `trace should exclude ${forbidden}`);
    }
  });

  it("omits unsafe route fallback catch fields from trace facts", () => {
    const forbiddenValues = [
      "prompt: system says log the meal",
      "messages[0].content user nutrition text",
      "provider body raw payload",
      "tool payload {\"food\":\"secret\"}",
      "guest_session=signed-session",
      "image data:image/png;base64,abc123",
      "assistant final reply text",
      "stack: at route handler",
      "cause: nested raw error",
    ];

    for (const forbidden of forbiddenValues) {
      const recorder = createLlmTraceRecorder();

      recorder.recordRouteFallback({
        transport: "json",
        turnId: "t_safe_unsafe_catch",
        fallbackSource: "route_catch",
        didLogMeal: false,
        didMutateMeal: false,
        reason: "route_catch",
        catchSite: "json_outer",
        errorName: forbidden,
        errorMessage: forbidden,
      });

      const routeFallback = recorder.build({ scenario: "unit-route-fallback-catch", status: "pass" })
        .timeline.at(-1) as Record<string, unknown>;
      assert.equal("errorName" in routeFallback, false);
      assert.equal("errorMessage" in routeFallback, false);
      assert.equal(JSON.stringify(routeFallback).includes(forbidden), false, `trace should exclude ${forbidden}`);
    }
  });

  it("preserves safe route fallback catch fields in trace facts", () => {
    const recorder = createLlmTraceRecorder();

    recorder.recordRouteFallback({
      transport: "sse",
      turnId: "t_safe_route_catch",
      fallbackSource: "route_catch",
      didLogMeal: false,
      didMutateMeal: false,
      reason: "route_catch",
      catchSite: "sse_outer",
      errorName: "SseOuterSafeFailure",
      errorMessage: "Safe route error",
    });

    const routeFallback = recorder.build({ scenario: "unit-route-fallback-safe-catch", status: "pass" })
      .timeline.at(-1) as Record<string, unknown>;
    assert.equal(routeFallback.errorName, "SseOuterSafeFailure");
    assert.equal(routeFallback.errorMessage, "Safe route error");
  });

  it("records provider-caused fallback hook facts with metadata-only trace fields", () => {
    const recorder = createLlmTraceRecorder();
    const hooks = recorder.asOrchestratorHooks();

    hooks.onLLMStart?.(2);
    hooks.onLLMError?.({ round: 2, lastTool: "log_food", providerMetadata });
    hooks.onFallback?.({
      reason: "llm_error",
      round: 2,
      lastTool: "log_food",
      providerMetadata,
    });

    const trace = recorder.build({ scenario: "unit-provider-fallback", status: "pass" });

    assert.equal(trace.schemaVersion, "llm-trace.v2");
    assert.equal(trace.summary.providerErrorCount, 1);
    assert.deepEqual(trace.timeline.at(-2), {
      type: "llm_error",
      round: 2,
      lastTool: "log_food",
      providerMetadata,
    });
    assert.deepEqual(trace.timeline.at(-1), {
      type: "orchestrator_fallback",
      reason: "llm_error",
      round: 2,
      lastTool: "log_food",
      providerMetadata,
    });
    const fallbackEvent = trace.timeline.at(-1) as {
      providerMetadata?: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(fallbackEvent.providerMetadata ?? {}), providerMetadataKeys);
    const providerErrorEvent = trace.timeline.at(-2) as {
      providerMetadata?: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(providerErrorEvent.providerMetadata ?? {}), providerMetadataKeys);

    const traceJson = JSON.stringify(trace);
    for (const forbidden of [
      "Authorization",
      "Bearer",
      "raw provider body",
      "raw prompt",
      "raw user text",
      "raw tool arguments",
      "raw tool results",
      "final assistant text",
      "guest_session",
      "data:image",
    ]) {
      assert.equal(traceJson.includes(forbidden), false, `trace should exclude ${forbidden}`);
    }
  });

  it("sanitizes fallback trace fields without spreading extra payload properties", () => {
    const recorder = createLlmTraceRecorder();
    const hooks = recorder.asOrchestratorHooks();
    const unsafeProviderMetadata: ProviderErrorMetadata = {
      ...providerMetadata,
      model: "raw provider model",
      providerRequestId: "Authorization Bearer",
      errorName: "raw prompt",
      errorType: "guest_session",
      errorCode: "sk-secret",
    };

    hooks.onFallback?.({
      reason: "llm_error",
      round: 1,
      lastTool: "raw prompt",
      providerMetadata: unsafeProviderMetadata,
      rawProviderBody: "raw provider body",
      headers: "Authorization",
      finalReply: "final assistant text",
    } as never);

    const trace = recorder.build({ scenario: "unit-sanitized-fallback", status: "pass" });

    assert.deepEqual(trace.timeline.at(-1), {
      type: "orchestrator_fallback",
      reason: "llm_error",
      round: 1,
      lastTool: "redacted",
      providerMetadata: {
        provider: "openai",
        operation: "chat_round_initial",
        model: "redacted",
        aborted: false,
        status: 429,
        providerRequestId: "redacted",
        errorName: "redacted",
        errorType: "redacted",
        errorCode: "redacted",
      },
    });

    const traceJson = JSON.stringify(trace);
    for (const forbidden of [
      "Authorization",
      "Bearer",
      "raw provider body",
      "raw prompt",
      "raw provider model",
      "final assistant text",
      "guest_session",
      "sk-secret",
      "headers",
      "rawProviderBody",
    ]) {
      assert.equal(traceJson.includes(forbidden), false, `trace should exclude ${forbidden}`);
    }
  });

  it("sanitizes provider error trace fields without spreading extra payload properties", () => {
    const recorder = createLlmTraceRecorder();
    const hooks = recorder.asOrchestratorHooks();
    const unsafeProviderMetadata: ProviderErrorMetadata = {
      ...providerMetadata,
      model: "raw provider model",
      providerRequestId: "Authorization Bearer",
      errorName: "raw prompt",
      errorType: "guest_session",
      errorCode: "sk-secret",
    };

    hooks.onLLMError?.({
      round: 4,
      lastTool: "raw prompt",
      providerMetadata: unsafeProviderMetadata,
      rawProviderBody: "raw provider body",
      headers: "Authorization",
      finalReply: "final assistant text",
    } as never);

    const trace = recorder.build({ scenario: "unit-sanitized-provider-error", status: "pass" });

    assert.equal(trace.summary.providerErrorCount, 1);
    assert.deepEqual(trace.timeline.at(-1), {
      type: "llm_error",
      round: 4,
      lastTool: "redacted",
      providerMetadata: {
        provider: "openai",
        operation: "chat_round_initial",
        model: "redacted",
        aborted: false,
        status: 429,
        providerRequestId: "redacted",
        errorName: "redacted",
        errorType: "redacted",
        errorCode: "redacted",
      },
    });

    const traceJson = JSON.stringify(trace);
    for (const forbidden of [
      "Authorization",
      "Bearer",
      "raw provider body",
      "raw prompt",
      "raw provider model",
      "final assistant text",
      "guest_session",
      "sk-secret",
      "headers",
      "rawProviderBody",
    ]) {
      assert.equal(traceJson.includes(forbidden), false, `trace should exclude ${forbidden}`);
    }
  });

  it("structured hooks log exact metadata-only LLM error and fallback payloads", () => {
    const captured: Array<Record<string, unknown>> = [];
    const log = {
      info(payload: Record<string, unknown>) {
        captured.push(payload);
      },
      warn(payload: Record<string, unknown>) {
        captured.push(payload);
      },
    };
    const hooks = createStructuredHooks(log as never);

    hooks.onLLMError?.({ round: 3, lastTool: "get_daily_summary", providerMetadata });
    hooks.onFallback?.({
      reason: "llm_error",
      round: 3,
      lastTool: "get_daily_summary",
      providerMetadata,
    });

    assert.deepEqual(captured, [
      {
        event: "llm_provider_error",
        round: 3,
        lastTool: "get_daily_summary",
        providerMetadata,
      },
      {
        event: "orchestrator_fallback",
        reason: "llm_error",
        round: 3,
        lastTool: "get_daily_summary",
        providerMetadata,
      },
    ]);
    assert.deepEqual(Object.keys(captured[0]), ["event", "round", "lastTool", "providerMetadata"]);
    assert.deepEqual(Object.keys(captured[1]), ["event", "reason", "round", "lastTool", "providerMetadata"]);
    assert.deepEqual(
      Object.keys(captured[0]?.providerMetadata as unknown as Record<string, unknown>),
      providerMetadataKeys,
    );

    const logJson = JSON.stringify(captured);
    for (const forbidden of [
      "Authorization",
      "Bearer",
      "raw provider body",
      "raw prompt",
      "raw user text",
      "raw tool arguments",
      "raw tool results",
      "final assistant text",
      "guest_session",
      "data:image",
    ]) {
      assert.equal(logJson.includes(forbidden), false, `structured hook log should exclude ${forbidden}`);
    }
  });
});
