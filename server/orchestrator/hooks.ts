import type { FastifyBaseLogger } from "fastify";
import type { ProviderErrorMetadata } from "../llm/types.js";

export interface OrchestratorHooks {
  onLLMStart?(round: number): void;
  onLLMEnd?(round: number, hadToolCalls: boolean): void;
  onToolReceived?(tool: string, argsRedacted: string): void;
  onToolResult?(payload: ToolResultPayload): void;
  onLLMError?(payload: LLMErrorPayload): void;
  onFallback?(payload: FallbackPayload): void;
}

export interface LLMErrorPayload {
  round: number;
  providerMetadata: ProviderErrorMetadata;
  lastTool?: string;
}

export interface FallbackPayload {
  reason: FallbackReason;
  round?: number;
  lastTool?: string;
  providerMetadata?: ProviderErrorMetadata;
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

const LOG_FOOD_VALIDATION_FIELDS = ["calories", "protein", "carbs", "fat"] as const;
const LOG_FOOD_VALIDATION_FIELD_SET = new Set<string>(LOG_FOOD_VALIDATION_FIELDS);

function sanitizeLogFoodValidationFields(fields: readonly string[]): string[] {
  // Plan 83-03: the grouped-only logFoodSchema reports numeric violations as
  // item-level paths (e.g. "items.0.calories"). Map paths to their leaf name
  // before whitelisting so the event still identifies the failing macro field
  // while staying metadata-only (no indices, no raw values).
  const sanitized = fields
    .map((field) => field.split(".").at(-1) ?? field)
    .filter((field) => LOG_FOOD_VALIDATION_FIELD_SET.has(field));
  return [...new Set(sanitized)].sort();
}

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
      if (
        payload.tool === "log_food"
        && payload.success === false
        && payload.executed === false
        && payload.failureReason === "validation"
      ) {
        log.warn(
          {
            event: "log_food_validation_failed",
            tool: "log_food",
            failureReason: "validation",
            fields: sanitizeLogFoodValidationFields(payload.fields ?? []),
          },
          "Log food validation failed",
        );
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
    onLLMError(payload) {
      log.warn(
        {
          event: "llm_provider_error",
          round: payload.round,
          ...(payload.lastTool !== undefined ? { lastTool: payload.lastTool } : {}),
          providerMetadata: payload.providerMetadata,
        },
        "LLM provider error",
      );
    },
    onFallback(payload) {
      log.warn(
        {
          event: "orchestrator_fallback",
          reason: payload.reason,
          ...(payload.round !== undefined ? { round: payload.round } : {}),
          ...(payload.lastTool !== undefined ? { lastTool: payload.lastTool } : {}),
          ...(payload.providerMetadata !== undefined ? { providerMetadata: payload.providerMetadata } : {}),
        },
        "Orchestrator fallback",
      );
    },
  };
}
