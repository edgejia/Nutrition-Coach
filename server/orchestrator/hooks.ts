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
  reason?: string;        // controlled diagnostic reason, e.g. schema_validation
  fields?: string[];      // redacted validation field paths only
  summary?: string;       // e.g. "成功" or "熱量 450kcal"
  updatedFields?: string[];
  publishedEvents?: string[];
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
      if (payload.tool === "update_goals" && payload.success === true) {
        log.info(
          { event: "goal_update_success", updatedFields: payload.updatedFields ?? [] },
          "Goal update success",
        );
        if (payload.publishedEvents?.includes("goals_update")) {
          log.info(
            { event: "goals_update_published", updatedFields: payload.updatedFields ?? [] },
            "Goals update published",
          );
        }
      }
      if (payload.tool === "update_goals" && payload.success === false) {
        log.warn(
          { event: "goal_update_rejected", failureReason: payload.failureReason },
          "Goal update rejected",
        );
      }
    },
    onFallback(reason) {
      log.warn({ event: "orchestrator_fallback", reason }, "Orchestrator fallback");
    },
  };
}
