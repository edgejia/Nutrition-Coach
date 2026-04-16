import type { FastifyBaseLogger } from "fastify";

export interface OrchestratorHooks {
  onLLMStart?(round: number): void;
  onLLMEnd?(round: number, hadToolCalls: boolean): void;
  onToolReceived?(tool: string, argsRedacted: string): void;
  onToolResult?(payload: ToolResultPayload): void;
  onFallback?(reason: FallbackReason): void;
}

export interface ToolResultPayload {
  tool: string;
  success: boolean;
  executed: boolean;      // false = validation failed before execution
  failureReason?: string; // redacted error summary; must NOT contain deviceId
  summary?: string;       // e.g. "成功" or "熱量 450kcal"
}

export type FallbackReason =
  | "max_rounds"
  | "llm_error"
  | "partial_success"
  | "hallucination_detected"; // fires from handleStreamingReply in chat.ts route helper, not the orchestrator

export function createStructuredHooks(log: FastifyBaseLogger): OrchestratorHooks {
  return {
    onLLMStart(round) {
      log.info({ event: "llm_round_start", round }, "LLM round start");
    },
    onLLMEnd(round, hadToolCalls) {
      log.info({ event: "llm_round_end", round, hadToolCalls }, "LLM round end");
    },
    onToolReceived(tool, argsRedacted) {
      log.info({ event: "tool_received", tool, args: argsRedacted }, "Tool received");
    },
    onToolResult(payload) {
      if (payload.success) {
        log.info({ event: "tool_result", ...payload }, "Tool result");
      } else {
        log.warn({ event: "tool_result", ...payload }, "Tool result (failed)");
      }
    },
    onFallback(reason) {
      log.warn({ event: "orchestrator_fallback", reason }, "Orchestrator fallback");
    },
  };
}
