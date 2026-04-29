import { redact } from "./artifacts.js";

export interface InsightTraceAssertion {
  name: string;
  ok: boolean;
  message?: string;
}

export interface InsightTraceInput {
  scenario: string;
  status: "pass" | "fail";
  inputSummary: Record<string, unknown>;
  llmRounds: Array<Record<string, unknown>>;
  toolCalls: Array<Record<string, unknown>>;
  deterministicMetrics: Record<string, unknown>;
  finalAnswer: string;
  assertions: InsightTraceAssertion[];
}

const UNSAFE_KEYS = new Set([
  "authorization",
  "apikey",
  "api_key",
  "stack",
  "rawprompt",
  "prompt",
  "messages",
  "schema",
  "deviceid",
  "x-device-id",
]);

function unsafeKey(key: string): boolean {
  return UNSAFE_KEYS.has(key.toLowerCase().replaceAll("_", ""));
}

function stripUnsafeTraceFields(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stripUnsafeTraceFields);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (unsafeKey(key)) {
        continue;
      }
      result[key] = stripUnsafeTraceFields(entry);
    }
    return result;
  }
  return value;
}

function summarizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    return value.length > 32 ? `${value.slice(0, 32)}...` : value;
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value;
  }
  if (Array.isArray(value)) {
    return { type: "array", length: value.length };
  }
  if (typeof value === "object") {
    return { type: "object", keys: Object.keys(value as Record<string, unknown>).sort() };
  }
  return typeof value;
}

export function summarizeToolCallArgs(args: unknown): Record<string, unknown> {
  const stripped = stripUnsafeTraceFields(args);
  if (stripped === null || typeof stripped !== "object" || Array.isArray(stripped)) {
    return { type: typeof stripped };
  }

  const input = stripped as Record<string, unknown>;
  const stringFields: Record<string, string> = {};
  const numberFields: Record<string, number> = {};
  const otherFields: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (typeof value === "string") {
      stringFields[key] = value.length > 32 ? `${value.slice(0, 32)}...` : value;
    } else if (typeof value === "number") {
      numberFields[key] = value;
    } else {
      otherFields[key] = summarizeValue(value);
    }
  }
  return redact({
    keys: Object.keys(input).sort(),
    stringFields,
    numberFields,
    otherFields,
  }) as Record<string, unknown>;
}

function summarizeMetrics(metrics: Record<string, unknown>): Record<string, unknown> {
  return redact(stripUnsafeTraceFields({
    from: metrics.from,
    to: metrics.to,
    completeness: metrics.completeness,
    totals: metrics.totals,
    averages: metrics.averages,
  })) as Record<string, unknown>;
}

function summarizeToolCall(call: Record<string, unknown>): Record<string, unknown> {
  const name =
    typeof call.name === "string"
      ? call.name
      : typeof call.toolName === "string"
        ? call.toolName
        : typeof call.function === "object" &&
            call.function !== null &&
            typeof (call.function as { name?: unknown }).name === "string"
          ? (call.function as { name: string }).name
          : "unknown";
  const args =
    "args" in call
      ? call.args
      : typeof call.function === "object" && call.function !== null
        ? (call.function as { arguments?: unknown }).arguments
        : undefined;
  let parsedArgs: unknown = args;
  if (typeof args === "string") {
    try {
      parsedArgs = JSON.parse(args) as unknown;
    } catch {
      parsedArgs = { value: args };
    }
  }
  return {
    name,
    argsSummary: summarizeToolCallArgs(parsedArgs),
  };
}

export function buildInsightTraceArtifact(input: InsightTraceInput): Record<string, unknown> {
  const base = {
    scenario: input.scenario,
    status: input.status,
    inputSummary: stripUnsafeTraceFields(input.inputSummary),
    deterministicMetrics: summarizeMetrics(input.deterministicMetrics),
    finalAnswer: input.finalAnswer,
    assertions: input.assertions,
  };
  const trace =
    input.status === "pass"
      ? {
          ...base,
          llmRoundCount: input.llmRounds.length,
          toolCalls: input.toolCalls.map(summarizeToolCall),
        }
      : {
          ...base,
          llmRounds: stripUnsafeTraceFields(input.llmRounds),
          toolCalls: input.toolCalls.map((call) => {
            const stripped = stripUnsafeTraceFields(call) as Record<string, unknown>;
            return {
              ...stripped,
              argsSummary: summarizeToolCall(call).argsSummary,
            };
          }),
        };

  return redact(trace) as Record<string, unknown>;
}

export const __testOnly = { stripUnsafeTraceFields };
