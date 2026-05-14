import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fanOutOrchestratorHooks } from "../../server/routes/chat.js";
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
