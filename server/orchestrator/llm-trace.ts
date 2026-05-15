import type { ProviderErrorMetadata } from "../llm/types.js";
import type {
  FallbackPayload,
  FallbackReason,
  LLMErrorPayload,
  OrchestratorHooks,
  ToolResultPayload,
} from "./hooks.js";
import {
  ACTIVE_SYSTEM_PROMPT_VERSION,
  SYSTEM_PROMPT_SECTION_IDS,
} from "./system-prompt.js";

export type LlmTraceTimelineEvent =
  | { type: "llm_round_start"; round: number }
  | { type: "llm_round_end"; round: number; hadToolCalls: boolean }
  | { type: "tool_received"; round?: number; tool: string }
  | {
      type: "tool_result";
      round?: number;
      tool: string;
      success: boolean;
      executed: boolean;
      failureReason?: string;
      reason?: string;
      fields?: string[];
      updatedFields?: string[];
      publishedEvents?: string[];
    }
  | {
      type: "llm_error";
      round: number;
      lastTool?: string;
      providerMetadata: ProviderErrorMetadata;
    }
  | {
      type: "orchestrator_fallback";
      reason: FallbackReason;
      round?: number;
      lastTool?: string;
      providerMetadata?: ProviderErrorMetadata;
    }
  | {
      type: "route_completion";
      transport: "json" | "sse";
      turnId?: string;
      didLogMeal: boolean;
      didMutateMeal: boolean;
      completed: true;
    }
  | {
      type: "route_fallback";
      transport: "json" | "sse";
      turnId: string;
      fallbackSource: "orchestrator" | "route_hallucination" | "route_catch";
      didLogMeal: boolean;
      didMutateMeal: boolean;
      reason?: string;
      catchSite?: string;
      providerMetadata?: ProviderErrorMetadata;
      round?: number;
      lastTool?: string;
    };

// Phase 53 migration inputs:
// orchestrator_projected_reply -> renderer
// model_response -> model
// stream -> model
// fallback_reply -> fallback
// tool_receipt is reserved for explicitly tool-owned receipt paths, not the
// default label for renderer-owned mutation receipts.
// mixed is a diagnostic final-reply source for combined ownership; it is not a
// MutationEffects ownership field.
export type LlmTraceFinalReplySource =
  | "renderer"
  | "model"
  | "fallback"
  | "tool_receipt"
  | "mixed";

export type LlmTraceFinalReplyShape =
  | "plain_text"
  | "streamed_text"
  | "fallback_text"
  | "empty_or_missing";

export interface LlmTraceFinalReply {
  source: LlmTraceFinalReplySource;
  shape: LlmTraceFinalReplyShape;
}

export interface LlmTraceSummary {
  roundCount: number;
  toolCount: number;
  fallbackCount: number;
  providerErrorCount: number;
  latencyMs?: number;
  prompt: {
    version: typeof ACTIVE_SYSTEM_PROMPT_VERSION;
    sectionIds: Array<(typeof SYSTEM_PROMPT_SECTION_IDS)[keyof typeof SYSTEM_PROMPT_SECTION_IDS]>;
  };
  finalReply: LlmTraceFinalReply;
}

export interface LlmTraceArtifact {
  schemaVersion: "llm-trace.v2";
  scenario: string;
  status: string;
  summary: LlmTraceSummary;
  timeline: LlmTraceTimelineEvent[];
}

interface RecordFinalReplyInput {
  source: LlmTraceFinalReplySource;
  shape: LlmTraceFinalReplyShape;
}

interface RecordRouteCompletionInput {
  transport: "json" | "sse";
  turnId?: string;
  didLogMeal: boolean;
  didMutateMeal: boolean;
  completed: true;
}

interface RecordRouteFallbackInput {
  transport: "json" | "sse";
  turnId: string;
  fallbackSource: "orchestrator" | "route_hallucination" | "route_catch";
  didLogMeal: boolean;
  didMutateMeal: boolean;
  reason?: string;
  catchSite?: string;
  providerMetadata?: ProviderErrorMetadata;
  round?: number;
  lastTool?: string;
}

interface RecordMetricsInput {
  latencyMs: number;
}

interface BuildInput {
  scenario: string;
  status: string;
}

export interface LlmTraceRecorder {
  asOrchestratorHooks(): OrchestratorHooks;
  recordFinalReply(input: RecordFinalReplyInput): void;
  recordRouteCompletion(input: RecordRouteCompletionInput): void;
  recordRouteFallback(input: RecordRouteFallbackInput): void;
  recordMetrics(input: RecordMetricsInput): void;
  build(input: BuildInput): LlmTraceArtifact;
}

const UNSAFE_TRACE_LABEL_FRAGMENTS = [
  "authorization",
  "bearer",
  "cookie",
  "data:image",
  "device",
  "guest_session",
  "message",
  "prompt",
  "provider",
  "raw",
  "secret",
  "sk-",
  "token",
  "upload",
] as const;

function isSafeTraceLabel(value: string): boolean {
  const normalized = value.toLowerCase();

  return (
    /^[A-Za-z0-9_.:-]+$/.test(value)
    && UNSAFE_TRACE_LABEL_FRAGMENTS.every((fragment) => !normalized.includes(fragment))
  );
}

function sanitizeTraceLabel(value: string): string {
  return isSafeTraceLabel(value) ? value : "redacted";
}

function sanitizeTraceLabels(values: string[]): string[] {
  return [...new Set(values.map(sanitizeTraceLabel))];
}

const SAFE_PROVIDER_OPERATIONS = new Set<ProviderErrorMetadata["operation"]>([
  "chat",
  "chat_round_initial",
  "chat_round_stream_continuation",
  "chat_stream_initial",
  "chat_stream_continuation",
]);

function sanitizeProviderOperation(operation: ProviderErrorMetadata["operation"]): ProviderErrorMetadata["operation"] {
  return SAFE_PROVIDER_OPERATIONS.has(operation) ? operation : "chat";
}

function sanitizeProviderMetadata(metadata: ProviderErrorMetadata): ProviderErrorMetadata {
  const sanitized: ProviderErrorMetadata = {
    provider: "openai",
    operation: sanitizeProviderOperation(metadata.operation),
    model: sanitizeTraceLabel(metadata.model),
    aborted: metadata.aborted,
  };

  if (typeof metadata.status === "number") {
    sanitized.status = metadata.status;
  }
  if (metadata.providerRequestId !== undefined) {
    sanitized.providerRequestId = sanitizeTraceLabel(metadata.providerRequestId);
  }
  if (metadata.errorName !== undefined) {
    sanitized.errorName = sanitizeTraceLabel(metadata.errorName);
  }
  if (metadata.errorType !== undefined) {
    sanitized.errorType = sanitizeTraceLabel(metadata.errorType);
  }
  if (metadata.errorCode !== undefined) {
    sanitized.errorCode = sanitizeTraceLabel(metadata.errorCode);
  }

  return sanitized;
}

function buildFallbackEvent(payload: FallbackPayload): Extract<LlmTraceTimelineEvent, { type: "orchestrator_fallback" }> {
  const event: Extract<LlmTraceTimelineEvent, { type: "orchestrator_fallback" }> = {
    type: "orchestrator_fallback",
    reason: payload.reason,
  };

  if (payload.round !== undefined) {
    event.round = payload.round;
  }
  if (payload.lastTool !== undefined) {
    event.lastTool = sanitizeTraceLabel(payload.lastTool);
  }
  if (payload.providerMetadata !== undefined) {
    event.providerMetadata = sanitizeProviderMetadata(payload.providerMetadata);
  }

  return event;
}

function buildLLMErrorEvent(payload: LLMErrorPayload): Extract<LlmTraceTimelineEvent, { type: "llm_error" }> {
  const event: Extract<LlmTraceTimelineEvent, { type: "llm_error" }> = {
    type: "llm_error",
    round: payload.round,
    providerMetadata: sanitizeProviderMetadata(payload.providerMetadata),
  };

  if (payload.lastTool !== undefined) {
    event.lastTool = sanitizeTraceLabel(payload.lastTool);
  }

  return event;
}

function buildRouteFallbackEvent(
  input: RecordRouteFallbackInput,
): Extract<LlmTraceTimelineEvent, { type: "route_fallback" }> {
  const event: Extract<LlmTraceTimelineEvent, { type: "route_fallback" }> = {
    type: "route_fallback",
    transport: input.transport,
    turnId: sanitizeTraceLabel(input.turnId),
    fallbackSource: input.fallbackSource,
    didLogMeal: input.didLogMeal,
    didMutateMeal: input.didMutateMeal,
  };

  if (input.reason !== undefined) {
    event.reason = sanitizeTraceLabel(input.reason);
  }
  if (input.catchSite !== undefined) {
    event.catchSite = sanitizeTraceLabel(input.catchSite);
  }
  if (input.providerMetadata !== undefined) {
    event.providerMetadata = sanitizeProviderMetadata(input.providerMetadata);
  }
  if (input.round !== undefined) {
    event.round = Math.max(0, Math.round(input.round));
  }
  if (input.lastTool !== undefined) {
    event.lastTool = sanitizeTraceLabel(input.lastTool);
  }

  return event;
}

function buildToolResultEvent(
  payload: ToolResultPayload,
  round?: number,
): Extract<LlmTraceTimelineEvent, { type: "tool_result" }> {
  const event: Extract<LlmTraceTimelineEvent, { type: "tool_result" }> = {
    type: "tool_result",
    round,
    tool: sanitizeTraceLabel(payload.tool),
    success: payload.success,
    executed: payload.executed,
  };

  if (payload.failureReason !== undefined) {
    event.failureReason = sanitizeTraceLabel(payload.failureReason);
  }
  if (payload.reason !== undefined) {
    event.reason = sanitizeTraceLabel(payload.reason);
  }
  if (payload.fields !== undefined) {
    event.fields = sanitizeTraceLabels(payload.fields);
  }
  if (payload.updatedFields !== undefined) {
    event.updatedFields = sanitizeTraceLabels(payload.updatedFields);
  }
  if (payload.publishedEvents !== undefined) {
    event.publishedEvents = sanitizeTraceLabels(payload.publishedEvents);
  }

  return event;
}

function countTimelineEvents(timeline: LlmTraceTimelineEvent[], type: LlmTraceTimelineEvent["type"]): number {
  return timeline.filter((event) => event.type === type).length;
}

export function createLlmTraceRecorder(): LlmTraceRecorder {
  const timeline: LlmTraceTimelineEvent[] = [];
  let currentRound: number | undefined;
  let latencyMs: number | undefined;
  let finalReply: LlmTraceFinalReply = {
    source: "model",
    shape: "empty_or_missing",
  };

  return {
    asOrchestratorHooks() {
      return {
        onLLMStart(round) {
          currentRound = round;
          timeline.push({ type: "llm_round_start", round });
        },
        onLLMEnd(round, hadToolCalls) {
          timeline.push({ type: "llm_round_end", round, hadToolCalls });
        },
        onToolReceived(tool) {
          timeline.push({ type: "tool_received", round: currentRound, tool: sanitizeTraceLabel(tool) });
        },
        onToolResult(payload) {
          timeline.push(buildToolResultEvent(payload, currentRound));
        },
        onLLMError(payload) {
          timeline.push(buildLLMErrorEvent(payload));
        },
        onFallback(payload) {
          timeline.push(buildFallbackEvent(payload));
        },
      };
    },
    recordFinalReply(input) {
      finalReply = {
        source: input.source,
        shape: input.shape,
      };
    },
    recordRouteCompletion(input) {
      const event: Extract<LlmTraceTimelineEvent, { type: "route_completion" }> = {
        type: "route_completion",
        transport: input.transport,
        didLogMeal: input.didLogMeal,
        didMutateMeal: input.didMutateMeal,
        completed: input.completed,
      };
      if (input.turnId !== undefined) {
        event.turnId = sanitizeTraceLabel(input.turnId);
      }
      timeline.push(event);
    },
    recordRouteFallback(input) {
      timeline.push(buildRouteFallbackEvent(input));
    },
    recordMetrics(input) {
      latencyMs = input.latencyMs;
    },
    build(input) {
      const summary: LlmTraceSummary = {
        roundCount: countTimelineEvents(timeline, "llm_round_start"),
        toolCount: countTimelineEvents(timeline, "tool_received"),
        fallbackCount: countTimelineEvents(timeline, "orchestrator_fallback"),
        providerErrorCount: countTimelineEvents(timeline, "llm_error"),
        prompt: {
          version: ACTIVE_SYSTEM_PROMPT_VERSION,
          sectionIds: Object.values(SYSTEM_PROMPT_SECTION_IDS),
        },
        finalReply,
      };

      if (latencyMs !== undefined) {
        summary.latencyMs = latencyMs;
      }

      return {
        schemaVersion: "llm-trace.v2",
        scenario: input.scenario,
        status: input.status,
        summary,
        timeline: [...timeline],
      };
    },
  };
}
