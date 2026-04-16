import { mock } from "node:test";
import type { OrchestratorHooks } from "../../server/orchestrator/hooks.js";

/**
 * Creates a fresh set of typed spy hooks for each test.
 * Call inside beforeEach — never at module scope (mock.fn does not auto-reset between tests).
 *
 * Usage:
 *   const spyHooks = createSpyHooks();
 *   await orchestrator.handleMessage(deviceId, "msg", undefined, undefined, { hooks: spyHooks });
 *   assert.equal(spyHooks.onLLMStart.mock.callCount(), 1);
 *   assert.equal(spyHooks.onLLMStart.mock.calls[0].arguments[0], 1); // round 1
 */
export function createSpyHooks(): OrchestratorHooks & {
  onLLMStart: ReturnType<typeof mock.fn<NonNullable<OrchestratorHooks["onLLMStart"]>>>;
  onLLMEnd: ReturnType<typeof mock.fn<NonNullable<OrchestratorHooks["onLLMEnd"]>>>;
  onToolReceived: ReturnType<typeof mock.fn<NonNullable<OrchestratorHooks["onToolReceived"]>>>;
  onToolResult: ReturnType<typeof mock.fn<NonNullable<OrchestratorHooks["onToolResult"]>>>;
  onFallback: ReturnType<typeof mock.fn<NonNullable<OrchestratorHooks["onFallback"]>>>;
} {
  return {
    onLLMStart: mock.fn<NonNullable<OrchestratorHooks["onLLMStart"]>>(),
    onLLMEnd: mock.fn<NonNullable<OrchestratorHooks["onLLMEnd"]>>(),
    onToolReceived: mock.fn<NonNullable<OrchestratorHooks["onToolReceived"]>>(),
    onToolResult: mock.fn<NonNullable<OrchestratorHooks["onToolResult"]>>(),
    onFallback: mock.fn<NonNullable<OrchestratorHooks["onFallback"]>>(),
  };
}
