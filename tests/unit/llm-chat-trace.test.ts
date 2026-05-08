import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_SYSTEM_PROMPT_VERSION,
  SYSTEM_PROMPT_SECTION_IDS,
} from "../../server/orchestrator/system-prompt.js";
import { createLlmTraceRecorder } from "../../server/orchestrator/llm-trace.js";

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
    hooks.onFallback?.("max_rounds");

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
    recorder.recordFinalReply({ source: "model_response", shape: "plain_text" });
    recorder.recordMetrics({ latencyMs: 42 });

    const trace = recorder.build({ scenario: "unit-trace", status: "pass" });

    assert.deepEqual(Object.keys(trace), ["schemaVersion", "scenario", "status", "summary", "timeline"]);
    assert.equal(trace.schemaVersion, "llm-trace.v1");
    assert.equal(trace.scenario, "unit-trace");
    assert.equal(trace.status, "pass");
    assert.equal(trace.summary.roundCount, 1);
    assert.equal(trace.summary.toolCount, 1);
    assert.equal(trace.summary.fallbackCount, 0);
    assert.equal(trace.summary.latencyMs, 42);
    assert.deepEqual(trace.summary.finalReply, {
      source: "model_response",
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
  });
});
