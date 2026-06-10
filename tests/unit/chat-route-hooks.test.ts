import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fanOutOrchestratorHooks } from "../../server/routes/chat.js";
import { createStructuredHooks } from "../../server/orchestrator/hooks.js";
import { createOrchestrator } from "../../server/orchestrator/index.js";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createSummaryService } from "../../server/services/summary.js";
import { createChatService } from "../../server/services/chat.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { OrchestratorHooks, ToolResultPayload } from "../../server/orchestrator/hooks.js";
import type { ProviderErrorMetadata } from "../../server/llm/types.js";

const providerMetadata: ProviderErrorMetadata = {
  provider: "openai",
  operation: "chat_round_initial",
  model: "gpt-test",
  aborted: false,
  status: 500,
  providerRequestId: "req_safe_fanout",
  errorName: "InternalServerError",
  errorType: "server_error",
  errorCode: "internal_error",
};

describe("fanOutOrchestratorHooks", () => {
  it("isolates throwing consumers while forwarding every hook payload unchanged", () => {
    const calls: string[] = [];
    const throwingHook: OrchestratorHooks = {
      onLLMStart() {
        throw new Error("raw hook start failure");
      },
      onLLMEnd() {
        throw new Error("raw hook end failure");
      },
      onToolReceived() {
        throw new Error("raw hook tool failure");
      },
      onToolResult() {
        throw new Error("raw hook tool result failure");
      },
      onLLMError() {
        throw new Error("raw hook llm error failure");
      },
      onFallback() {
        throw new Error("raw hook fallback failure");
      },
    };
    const spyHook: OrchestratorHooks = {
      onLLMStart(round) {
        calls.push(`start:${round}`);
      },
      onLLMEnd(round, hadToolCalls) {
        calls.push(`end:${round}:${hadToolCalls}`);
      },
      onToolReceived(tool, argsRedacted) {
        calls.push(`tool:${tool}:${argsRedacted}`);
      },
      onToolResult(payload) {
        assert.strictEqual(payload, toolResultPayload);
        calls.push(`tool-result:${payload.tool}`);
      },
      onLLMError(payload) {
        assert.strictEqual(payload, llmErrorPayload);
        calls.push(`llm-error:${payload.round}`);
      },
      onFallback(payload) {
        assert.strictEqual(payload, fallbackPayload);
        calls.push(`fallback:${payload.reason}`);
      },
    };
    const toolResultPayload: ToolResultPayload = {
      tool: "log_food",
      success: false,
      executed: false,
      failureReason: "validation",
      fields: ["calories"],
    };
    const llmErrorPayload = {
      round: 2,
      lastTool: "log_food",
      providerMetadata,
    };
    const fallbackPayload = {
      reason: "llm_error" as const,
      round: 2,
      lastTool: "log_food",
      providerMetadata,
    };

    const hooks = fanOutOrchestratorHooks(throwingHook, spyHook);

    assert.ok(hooks);
    assert.doesNotThrow(() => hooks.onLLMStart?.(1));
    assert.doesNotThrow(() => hooks.onLLMEnd?.(1, true));
    assert.doesNotThrow(() => hooks.onToolReceived?.("log_food", "<log_food args>"));
    assert.doesNotThrow(() => hooks.onToolResult?.(toolResultPayload));
    assert.doesNotThrow(() => hooks.onLLMError?.(llmErrorPayload));
    assert.doesNotThrow(() => hooks.onFallback?.(fallbackPayload));

    assert.deepEqual(calls, [
      "start:1",
      "end:1:true",
      "tool:log_food:<log_food args>",
      "tool-result:log_food",
      "llm-error:2",
      "fallback:llm_error",
    ]);
  });
});

describe("log_food_validation_failed on the Phase 83 controlled feedback path", () => {
  it("emits the metadata-only event with sanitized fields when executeTool returns a controlled schema_validation failure", async () => {
    const db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    const foodLoggingService = createFoodLoggingService(db);
    const summaryService = createSummaryService(db);
    const chatService = createChatService(db);
    const mockLLM = new MockLLMProvider();
    const deviceId = (await deviceService.createDevice("fat_loss")).deviceId;

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

    const orchestrator = createOrchestrator({
      llmProvider: mockLLM,
      chatService,
      summaryService,
      foodLoggingService,
      deviceService,
    } as Parameters<typeof createOrchestrator>[0]);

    const rawMealText = "我吃了機密雞胸肉";
    // Negative calories on the single-shape branch yields the whitelisted
    // top-level "calories" field path from schema validation.
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "feedback_event_call",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ food_name: "雞胸肉", calories: -100, protein: 8, carbs: 10, fat: 4 }),
        },
      }],
    });
    // Terminal text must not claim logging (83-RESEARCH OQ-3).
    mockLLM.queueChatResponse({ content: "請再提供餐點內容和份量，我再幫你估算。" });

    // handleMessage resolves — the onToolResult feedback path (not the
    // FatalToolError catch) is now the event emitter for schema_validation.
    const result = await orchestrator.handleMessage(deviceId, rawMealText, undefined, undefined, { hooks });
    assert.ok("reply" in result);
    assert.equal(result.didLogMeal, false);

    const validationEvents = captured.filter((payload) => payload.event === "log_food_validation_failed");
    assert.equal(validationEvents.length, 1, "log_food_validation_failed must fire exactly once on the feedback path");
    const event = validationEvents[0]!;
    assert.equal(event.tool, "log_food");
    assert.equal(event.failureReason, "validation");
    assert.ok(Array.isArray(event.fields), "sanitized fields array must be present");
    assert.ok((event.fields as string[]).length > 0, "sanitized fields must identify the failing whitelisted field");
    assert.ok(
      (event.fields as string[]).every((field) => ["calories", "protein", "carbs", "fat"].includes(field)),
      "fields must stay within the sanitized whitelist",
    );

    // Metadata-only contract (T-83-03): no raw args or payload keys on the event.
    assert.equal("reason" in event, false);
    assert.equal("summary" in event, false);
    assert.equal("args" in event, false);
    assert.equal("result" in event, false);
    const serialized = JSON.stringify(event);
    assert.doesNotMatch(serialized, /-100|機密雞胸肉|food_name|items|protein_sources|feedback_event_call/);
  });
});
