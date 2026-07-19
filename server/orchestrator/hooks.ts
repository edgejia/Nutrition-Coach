import type { FastifyBaseLogger } from "fastify";
import type { ProviderErrorMetadata } from "../llm/types.js";
import { sanitizeProviderMetadata } from "../observability/events.js";
import type {
  SideEffectPolicyClass,
  ToolPolicyDecisionKind,
  ToolPolicyRuleId,
} from "./tool-contract.js";

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
  policyClass?: SideEffectPolicyClass;
  decision?: ToolPolicyDecisionKind;
  ruleId?: ToolPolicyRuleId;
  proposalId?: string;
  turnId?: string;
}

export type FallbackReason =
  | "max_rounds"
  | "llm_error"
  | "partial_success"
  | "hallucination_detected"; // fires from handleStreamingReply in chat.ts route helper, not the orchestrator

const LOG_FOOD_VALIDATION_FIELDS = ["calories", "protein", "carbs", "fat"] as const;
const LOG_FOOD_VALIDATION_FIELD_SET = new Set<string>(LOG_FOOD_VALIDATION_FIELDS);
const SAFE_TOOL_NAMES = new Set([
  "log_food",
  "get_daily_summary",
  "plan_next_meal",
  "find_meals",
  "propose_goals",
  "update_goals",
  "propose_meal_estimate",
  "propose_meal_numeric_correction",
  "update_meal",
  "delete_meal",
]);
const SAFE_FAILURE_REASONS = new Set(["validation", "guard", "execute"]);
const SAFE_REASONS = new Set([
  "schema_validation",
  "unexpected_error",
  "source_text_guard",
  "policy_gate",
  "goal_validation_failure",
  "goal_authority_failure",
  "failed_recognition_no_save",
  "text_non_food_no_save",
  "historical_date_clarification",
  "historical_summary_clarification",
  "meal_target_clarification",
  "meal_numeric_clarification",
  "meal_numeric_authority_failure",
  "meal_numeric_proposal",
  "meal_delete_proposal",
  "goal_proposal",
  "multiple_dates",
  "recent_correction_reestimate_proposal",
]);
const SAFE_EVENT_NAMES = new Set(["daily_summary", "goals_update"]);
const SAFE_POLICY_CLASSES = new Set(["direct-execute", "execute-and-report", "clarify-first", "confirm-first"]);
const SAFE_DECISIONS = new Set(["allowed", "blocked"]);
const SAFE_FIELD_SET = new Set([...LOG_FOOD_VALIDATION_FIELDS, "date_text", "meal_period", "meal_id", "estimated"]);

function sanitizeToolName(tool: string): string {
  return SAFE_TOOL_NAMES.has(tool) ? tool : "redacted";
}

function sanitizeHookArgs(args: string): string {
  if (/^<[a-z_]+ args>$/.test(args)) return args;
  if (/^(fields|updatedFields): (none|(?:calories|protein|carbs|fat)(?:,(?:calories|protein|carbs|fat))*)$/.test(args)) {
    return args;
  }
  if (/^itemCount: [0-9]{1,3}$/.test(args)) return args;
  if (/^action: (find|update|delete|unknown)$/.test(args)) return args;
  if (/^tool: (log_food|update_goals); status: (received|completed|failed); itemCount: [0-9]{1,3}; fields: (none|(?:calories|protein|carbs|fat)(?:,(?:calories|protein|carbs|fat))*); proteinSourceCount: [0-9]{1,3}; unit: kcal$/.test(args)) {
    return args;
  }
  return "<redacted tool args>";
}

function sanitizeFixedValue(value: string | undefined, allowed: Set<string>): string | undefined {
  return value !== undefined && allowed.has(value) ? value : undefined;
}

function sanitizeFields(fields: readonly string[] | undefined): string[] | undefined {
  if (!fields) return undefined;
  const values = fields
    .map((field) => field.split(".").at(-1) ?? field)
    .filter((field) => SAFE_FIELD_SET.has(field));
  const unique = [...new Set(values)].sort();
  return unique.length > 0 ? unique : undefined;
}

function sanitizeToolResultPayload(payload: ToolResultPayload): Record<string, unknown> {
  const result: Record<string, unknown> = {
    event: "tool_result",
    tool: sanitizeToolName(payload.tool),
    success: payload.success === true,
    executed: payload.executed === true,
  };
  const failureReason = sanitizeFixedValue(payload.failureReason, SAFE_FAILURE_REASONS);
  const reason = sanitizeFixedValue(payload.reason, SAFE_REASONS);
  const fields = sanitizeFields(payload.fields);
  const updatedFields = sanitizeFields(payload.updatedFields);
  const publishedEvents = payload.publishedEvents?.filter((event) => SAFE_EVENT_NAMES.has(event));
  const policyClass = sanitizeFixedValue(payload.policyClass, SAFE_POLICY_CLASSES);
  const decision = sanitizeFixedValue(payload.decision, SAFE_DECISIONS);
  if (failureReason) result.failureReason = failureReason;
  if (reason) result.reason = reason;
  if (fields) result.fields = fields;
  if (updatedFields) result.updatedFields = updatedFields;
  if (publishedEvents && publishedEvents.length > 0) result.publishedEvents = [...new Set(publishedEvents)].sort();
  if (policyClass) result.policyClass = policyClass;
  if (decision) result.decision = decision;
  if (payload.ruleId && /^[a-z0-9_]{1,80}$/.test(payload.ruleId)) result.ruleId = payload.ruleId;
  if (payload.proposalId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.proposalId)) {
    result.proposalId = payload.proposalId;
  }
  if (payload.turnId && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(payload.turnId)) {
    result.turnId = payload.turnId;
  }
  return result;
}

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
      log.info({ event: "tool_received", tool: sanitizeToolName(tool), args: sanitizeHookArgs(argsRedacted) }, "Tool received");
    },
    onToolResult(payload) {
      const projected = sanitizeToolResultPayload(payload);
      if (payload.success) {
        log.info(projected, "Tool result");
      } else {
        log.warn(projected, "Tool result (failed)");
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
          { event: "goal_update_success", updatedFields: sanitizeFields(payload.updatedFields) ?? [] },
          "Goal update success",
        );
        if (payload.publishedEvents?.includes("goals_update")) {
          log.info(
            { event: "goals_update_published", updatedFields: sanitizeFields(payload.updatedFields) ?? [] },
            "Goals update published",
          );
        }
      }
      if (payload.tool === "update_goals" && payload.success === false) {
        log.warn(
          { event: "goal_update_rejected", failureReason: sanitizeFixedValue(payload.failureReason, SAFE_FAILURE_REASONS) },
          "Goal update rejected",
        );
      }
    },
    onLLMError(payload) {
      log.warn(
        {
          event: "llm_provider_error",
          round: payload.round,
          ...(payload.lastTool !== undefined ? { lastTool: sanitizeToolName(payload.lastTool) } : {}),
          providerMetadata: sanitizeProviderMetadata(payload.providerMetadata),
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
          ...(payload.lastTool !== undefined ? { lastTool: sanitizeToolName(payload.lastTool) } : {}),
          ...(payload.providerMetadata !== undefined
            ? { providerMetadata: sanitizeProviderMetadata(payload.providerMetadata) }
            : {}),
        },
        "Orchestrator fallback",
      );
    },
  };
}
