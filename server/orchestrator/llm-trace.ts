import type { FallbackPayload, OrchestratorHooks, ToolResultPayload } from "./hooks.js";
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
  | ({ type: "orchestrator_fallback" } & FallbackPayload)
  | {
      type: "route_completion";
      transport: "sse";
      didLogMeal: boolean;
      didMutateMeal: boolean;
      completed: boolean;
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
  latencyMs?: number;
  prompt: {
    version: typeof ACTIVE_SYSTEM_PROMPT_VERSION;
    sectionIds: Array<(typeof SYSTEM_PROMPT_SECTION_IDS)[keyof typeof SYSTEM_PROMPT_SECTION_IDS]>;
  };
  finalReply: LlmTraceFinalReply;
}

export interface LlmTraceArtifact {
  schemaVersion: "llm-trace.v1";
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
  transport: "sse";
  didLogMeal: boolean;
  didMutateMeal: boolean;
  completed: boolean;
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
        onLLMError() {
          // Trace v1 accepts provider-error hook facts for contract parity but
          // does not persist a dedicated llm_error timeline event until trace v2.
        },
        onFallback(payload) {
          timeline.push({ type: "orchestrator_fallback", ...payload });
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
      timeline.push({
        type: "route_completion",
        transport: input.transport,
        didLogMeal: input.didLogMeal,
        didMutateMeal: input.didMutateMeal,
        completed: input.completed,
      });
    },
    recordMetrics(input) {
      latencyMs = input.latencyMs;
    },
    build(input) {
      const summary: LlmTraceSummary = {
        roundCount: countTimelineEvents(timeline, "llm_round_start"),
        toolCount: countTimelineEvents(timeline, "tool_received"),
        fallbackCount: countTimelineEvents(timeline, "orchestrator_fallback"),
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
        schemaVersion: "llm-trace.v1",
        scenario: input.scenario,
        status: input.status,
        summary,
        timeline: [...timeline],
      };
    },
  };
}
