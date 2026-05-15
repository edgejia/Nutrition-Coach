/**
 * Text-only auth-style provider failure localization proof.
 *
 * Proves VERIFY-01 through generated harness artifacts without live provider
 * access, image upload noise, raw user text, or final assistant text.
 */

import { Writable } from "node:stream";
import { createScenarioApp } from "../app-fixture.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { LLMProviderError } from "../../../server/llm/errors.js";
import type { ProviderErrorMetadata } from "../../../server/llm/types.js";
import {
  createLlmTraceRecorder,
  type LlmTraceArtifact,
  type LlmTraceTimelineEvent,
} from "../../../server/orchestrator/llm-trace.js";
import type {
  ScenarioContext,
  ScenarioResult,
  ScenarioStepResult,
  VerificationScenario,
} from "../scenario-types.js";

const SCENARIO_NAME = "provider-auth-failure-localization";
const RAW_USER_TEXT = "這段 auth harness 文字不應進入證據";
const FINAL_ASSISTANT_TEXT = "抱歉，目前無法處理您的請求，請稍後再試。";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const LOCALIZED_FALLBACK_PATTERN = /抱歉|無法|稍後/;
const PROVIDER_AUTH_DETAIL_PATTERN = /AuthenticationError|invalid_api_key|api[_ -]?key|Bearer|sk-|provider|OpenAI/i;
const CHAT_STREAM_TIMEOUT_MS = 5000;

const AUTH_PROVIDER_METADATA_FIXTURE: ProviderErrorMetadata = {
  provider: "openai",
  operation: "chat",
  model: "gpt-auth-trace-fixture",
  aborted: false,
  status: 401,
  providerRequestId: "req_auth_trace_fixture",
  errorName: "AuthenticationError",
  errorType: "invalid_request_error",
  errorCode: "invalid_api_key",
};

const PROVIDER_METADATA_KEYS = [
  "aborted",
  "errorCode",
  "errorName",
  "errorType",
  "model",
  "operation",
  "provider",
  "providerRequestId",
  "status",
];

const STEP_NAMES = [
  "bootstrap",
  "post_chat",
  "collect_done",
  "verify_localized_chunk",
  "verify_terminal_turn_id",
  "verify_route_logs",
  "verify_trace_facts",
  "verify_turn_id_correlation",
  "verify_privacy",
] as const;

function pass(name: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: true, actual };
}

function fail(name: string, error: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: false, error, actual };
}

function failResult(
  steps: ScenarioStepResult[],
  failedStepName: string,
  artifacts: Record<string, unknown>,
  llmTrace?: LlmTraceArtifact,
): ScenarioResult {
  const result: ScenarioResult = {
    ok: false,
    failedStep: failedStepName,
    steps,
    artifacts,
    consoleSummary: `FAIL ${SCENARIO_NAME} ${failedStepName}`,
  };
  if (llmTrace !== undefined) {
    result.llmTrace = llmTrace as unknown as Record<string, unknown>;
  }
  return result;
}

function createLogCapture() {
  const logLines: string[] = [];
  const stream = new Writable({
    write(chunk, _, cb) {
      chunk.toString().split("\n").filter(Boolean).forEach((line: string) => logLines.push(line));
      cb();
    },
  });

  return { logLines, stream };
}

function parseLogLines(logLines: string[]) {
  const records: Record<string, unknown>[] = [];
  for (const line of logLines) {
    try {
      records.push(JSON.parse(line) as Record<string, unknown>);
    } catch {
      // Ignore non-JSON logger diagnostics.
    }
  }
  return records;
}

function logEvents(logLines: string[], eventName: string) {
  return parseLogLines(logLines).filter((record) => record.event === eventName);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function providerMetadataKeys(value: unknown): string[] {
  return isRecord(value) ? Object.keys(value).sort() : [];
}

function metadataMatchesFixture(value: unknown): boolean {
  return JSON.stringify(value) === JSON.stringify(AUTH_PROVIDER_METADATA_FIXTURE)
    && JSON.stringify(providerMetadataKeys(value)) === JSON.stringify(PROVIDER_METADATA_KEYS);
}

function parseJsonObject(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value) as unknown;
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function extractChunkText(events: Array<{ event: string; data: string }>): {
  chunkText: string;
  chunkCount: number;
  invalidChunkPayloadCount: number;
} {
  let invalidChunkPayloadCount = 0;
  const tokens = events
    .filter((event) => event.event === "chunk")
    .map((event) => {
      const token = parseJsonObject(event.data)?.token;
      if (typeof token !== "string") {
        invalidChunkPayloadCount += 1;
        return "";
      }
      return token;
    });

  return {
    chunkText: tokens.join(""),
    chunkCount: tokens.length,
    invalidChunkPayloadCount,
  };
}

function countTraceEvents(trace: LlmTraceArtifact, type: LlmTraceTimelineEvent["type"]): number {
  return trace.timeline.filter((event) => event.type === type).length;
}

function findTraceEvent<T extends LlmTraceTimelineEvent["type"]>(
  trace: LlmTraceArtifact,
  type: T,
): Extract<LlmTraceTimelineEvent, { type: T }> | undefined {
  return trace.timeline.find((event): event is Extract<LlmTraceTimelineEvent, { type: T }> => event.type === type);
}

function buildPrivacyEvidence(
  artifacts: Record<string, unknown>,
  steps: ScenarioStepResult[],
  trace: LlmTraceArtifact,
): { ok: boolean; leaked?: string; scannedBytes: number } {
  const evidence = JSON.stringify({ artifacts, steps, trace });
  const evidenceForSecretScan = evidence.replace(
    /"errorCode":"invalid_api_key"/g,
    "\"errorCode\":\"[SAFE_PROVIDER_ERROR_CODE]\"",
  );
  const forbidden = [
    RAW_USER_TEXT,
    FINAL_ASSISTANT_TEXT,
    "authorization",
    "api_key",
    "Bearer",
    "sk-",
    "headers",
    "body",
    "messages",
    "providerPayload",
    "rawProviderPayload",
    "cookie",
    "sessionToken",
    "guestSession",
    "guest_session",
    "/uploads/",
    "/upload-staging/",
    "data:image",
    "imageData",
    "imageBase64",
    "uploadStagingPath",
    "finalAssistantContent",
  ];
  const leaked = forbidden.find((snippet) => evidenceForSecretScan.includes(snippet));
  return { ok: leaked === undefined, leaked, scannedBytes: evidence.length };
}

const scenario: VerificationScenario = {
  name: SCENARIO_NAME,

  async run(_ctx: ScenarioContext): Promise<ScenarioResult> {
    const steps: ScenarioStepResult[] = [];
    const artifacts: Record<string, unknown> = {};
    const { logLines, stream: logStream } = createLogCapture();
    const provider = new StreamingLLMProvider();
    const recorder = createLlmTraceRecorder();
    provider.queueRoundError(new LLMProviderError(AUTH_PROVIDER_METADATA_FIXTURE));

    let trace: LlmTraceArtifact | undefined;
    let terminalTurnId: string | undefined;
    let routeFallbackTurnId: string | undefined;
    let traceRouteFallbackTurnId: string | undefined;
    let chatController: AbortController | undefined;
    let chatTimeout: ReturnType<typeof setTimeout> | undefined;
    let chatReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    const fixture = await createScenarioApp({
      llmProvider: provider,
      llmTraceRecorderFactory: () => recorder,
      logger: { level: "info", stream: logStream },
    });

    const failScenario = (failedStepName: string): ScenarioResult => {
      trace = recorder.build({ scenario: SCENARIO_NAME, status: "fail" });
      return failResult(steps, failedStepName, artifacts, trace);
    };

    try {
      try {
        const pingRes = await fetch(`${fixture.address}/api/meals`, {
          headers: { cookie: fixture.cookieHeader },
        });
        if (pingRes.status !== 200) {
          steps.push(fail("bootstrap", `Expected 200 from /api/meals, got ${pingRes.status}`, { status: pingRes.status }));
          return failScenario("bootstrap");
        }
        steps.push(pass("bootstrap", { status: pingRes.status }));
      } catch (error) {
        steps.push(fail("bootstrap", error instanceof Error ? error.message : String(error)));
        return failScenario("bootstrap");
      }

      let chatRes: Response | undefined;
      try {
        const form = new FormData();
        form.append("message", RAW_USER_TEXT);
        chatController = new AbortController();
        chatTimeout = setTimeout(() => chatController?.abort(), CHAT_STREAM_TIMEOUT_MS);
        chatRes = await fetch(`${fixture.address}/api/chat`, {
          method: "POST",
          headers: {
            cookie: fixture.cookieHeader,
            Accept: "text/event-stream",
          },
          signal: chatController.signal,
          body: form,
        });

        const contentType = chatRes.headers.get("content-type") ?? "";
        if (chatRes.status !== 200 || !contentType.includes("text/event-stream")) {
          steps.push(fail("post_chat", "Expected 200 text/event-stream response", {
            status: chatRes.status,
            contentType,
          }));
          return failScenario("post_chat");
        }
        steps.push(pass("post_chat", { status: chatRes.status, contentType }));
      } catch (error) {
        steps.push(fail("post_chat", error instanceof Error ? error.message : String(error)));
        return failScenario("post_chat");
      }

      let startTurnId: string | undefined;
      try {
        if (!chatRes.body) {
          steps.push(fail("collect_done", "Chat response has no body"));
          return failScenario("collect_done");
        }
        chatReader = chatRes.body.getReader();
        const rawStream = await readStreamUntilEvent(chatReader, "done", 60);
        const events = parseSSEEvents(rawStream);
        const startPayload = parseJsonObject(events.find((event) => event.event === "start")?.data ?? "");
        const donePayload = parseJsonObject(events.find((event) => event.event === "done")?.data ?? "");
        startTurnId = typeof startPayload?.turnId === "string" ? startPayload.turnId : undefined;
        terminalTurnId = typeof donePayload?.turnId === "string" ? donePayload.turnId : undefined;
        const eventNames = events.map((event) => event.event);
        const { chunkText, chunkCount, invalidChunkPayloadCount } = extractChunkText(events);
        const localizedFallbackProof = {
          chunkCount,
          chunkLength: chunkText.length,
          invalidChunkPayloadCount,
          hasLocalizedFallbackCopy: LOCALIZED_FALLBACK_PATTERN.test(chunkText),
          chunkExposesProviderAuthDetails: PROVIDER_AUTH_DETAIL_PATTERN.test(chunkText),
          streamExposesProviderAuthDetails: PROVIDER_AUTH_DETAIL_PATTERN.test(rawStream),
        };

        if (!terminalTurnId || !eventNames.includes("done")) {
          steps.push(fail("collect_done", "Expected terminal done event with turnId", {
            eventNames,
            donePayload,
          }));
          return failScenario("collect_done");
        }

        artifacts.terminalResponse = {
          eventNames,
          startTurnId,
          donePayload: {
            turnId: terminalTurnId,
            didLogMeal: donePayload?.didLogMeal,
            didMutateMeal: donePayload?.didMutateMeal,
          },
        };
        steps.push(pass("collect_done", {
          eventNames,
          donePayload: {
            turnId: terminalTurnId,
            didLogMeal: donePayload?.didLogMeal,
            didMutateMeal: donePayload?.didMutateMeal,
          },
        }));

        artifacts.localizedFallbackProof = localizedFallbackProof;
        if (
          invalidChunkPayloadCount !== 0
          || !localizedFallbackProof.hasLocalizedFallbackCopy
          || localizedFallbackProof.chunkExposesProviderAuthDetails
          || localizedFallbackProof.streamExposesProviderAuthDetails
        ) {
          steps.push(fail("verify_localized_chunk", "Expected localized generic fallback chunks without provider/auth details", localizedFallbackProof));
          return failScenario("verify_localized_chunk");
        }
        steps.push(pass("verify_localized_chunk", localizedFallbackProof));
      } catch (error) {
        steps.push(fail("collect_done", error instanceof Error ? error.message : String(error)));
        return failScenario("collect_done");
      }

      if (!terminalTurnId || !UUID_PATTERN.test(terminalTurnId) || startTurnId !== terminalTurnId) {
        steps.push(fail("verify_terminal_turn_id", "Expected matching UUID turnId in start and done events", {
          startTurnId,
          terminalTurnId,
        }));
        return failScenario("verify_terminal_turn_id");
      }
      steps.push(pass("verify_terminal_turn_id", { turnId: terminalTurnId }));

      try {
        const providerErrorEvents = logEvents(logLines, "llm_provider_error");
        const fallbackEvents = logEvents(logLines, "chat_route_fallback");
        const completionEvents = logEvents(logLines, "chat_turn_completed");
        const fallback = fallbackEvents[0];
        routeFallbackTurnId = typeof fallback?.turnId === "string" ? fallback.turnId : undefined;

        const routeProof = {
          providerErrorCount: providerErrorEvents.length,
          chatRouteFallbackCount: fallbackEvents.length,
          chatTurnCompletedCount: completionEvents.length,
          providerMetadata: providerErrorEvents[0]?.providerMetadata,
          routeFallback: fallback
            ? {
                source: fallback.source,
                turnId: fallback.turnId,
                fallbackSource: fallback.fallbackSource,
                reason: fallback.reason,
                didLogMeal: fallback.didLogMeal,
                didMutateMeal: fallback.didMutateMeal,
                hadImage: fallback.hadImage,
                providerMetadata: fallback.providerMetadata,
              }
            : undefined,
        };

        artifacts.routeLogProof = routeProof;

        if (
          providerErrorEvents.length !== 1
          || fallbackEvents.length !== 1
          || completionEvents.length !== 0
          || !metadataMatchesFixture(providerErrorEvents[0]?.providerMetadata)
          || !metadataMatchesFixture(fallback?.providerMetadata)
          || fallback?.source !== "sse"
          || fallback?.fallbackSource !== "orchestrator"
          || fallback?.reason !== "llm_error"
          || fallback?.didLogMeal !== false
          || fallback?.didMutateMeal !== false
          || fallback?.hadImage !== false
        ) {
          steps.push(fail("verify_route_logs", "Structured log proof did not match auth provider fallback contract", routeProof));
          return failScenario("verify_route_logs");
        }

        steps.push(pass("verify_route_logs", routeProof));
      } catch (error) {
        steps.push(fail("verify_route_logs", error instanceof Error ? error.message : String(error)));
        return failScenario("verify_route_logs");
      }

      try {
        trace = recorder.build({ scenario: SCENARIO_NAME, status: "pass" });
        const llmError = findTraceEvent(trace, "llm_error");
        const orchestratorFallback = findTraceEvent(trace, "orchestrator_fallback");
        const routeFallback = findTraceEvent(trace, "route_fallback");
        traceRouteFallbackTurnId = routeFallback?.turnId;
        const traceProof = {
          schemaVersion: trace.schemaVersion,
          providerErrorCount: trace.summary.providerErrorCount,
          llmErrorCount: countTraceEvents(trace, "llm_error"),
          orchestratorFallbackCount: countTraceEvents(trace, "orchestrator_fallback"),
          routeFallbackCount: countTraceEvents(trace, "route_fallback"),
          routeCompletionCount: countTraceEvents(trace, "route_completion"),
          llmErrorProviderMetadata: llmError?.providerMetadata,
          orchestratorFallback: orchestratorFallback
            ? {
                reason: orchestratorFallback.reason,
                providerMetadata: orchestratorFallback.providerMetadata,
              }
            : undefined,
          routeFallback: routeFallback
            ? {
                transport: routeFallback.transport,
                turnId: routeFallback.turnId,
                fallbackSource: routeFallback.fallbackSource,
                reason: routeFallback.reason,
                didLogMeal: routeFallback.didLogMeal,
                didMutateMeal: routeFallback.didMutateMeal,
                providerMetadata: routeFallback.providerMetadata,
              }
            : undefined,
        };

        artifacts.traceProof = traceProof;

        if (
          trace.schemaVersion !== "llm-trace.v2"
          || countTraceEvents(trace, "llm_error") !== 1
          || countTraceEvents(trace, "orchestrator_fallback") !== 1
          || countTraceEvents(trace, "route_fallback") !== 1
          || countTraceEvents(trace, "route_completion") !== 0
          || trace.summary.providerErrorCount !== 1
          || !metadataMatchesFixture(llmError?.providerMetadata)
          || orchestratorFallback?.reason !== "llm_error"
          || !metadataMatchesFixture(orchestratorFallback?.providerMetadata)
          || routeFallback?.transport !== "sse"
          || routeFallback?.fallbackSource !== "orchestrator"
          || routeFallback?.reason !== "llm_error"
          || routeFallback?.didLogMeal !== false
          || routeFallback?.didMutateMeal !== false
          || !metadataMatchesFixture(routeFallback?.providerMetadata)
        ) {
          steps.push(fail("verify_trace_facts", "Trace proof did not match llm-trace.v2 fallback contract", traceProof));
          return failScenario("verify_trace_facts");
        }

        steps.push(pass("verify_trace_facts", traceProof));
      } catch (error) {
        steps.push(fail("verify_trace_facts", error instanceof Error ? error.message : String(error)));
        return failScenario("verify_trace_facts");
      }

      if (!terminalTurnId || terminalTurnId !== routeFallbackTurnId || terminalTurnId !== traceRouteFallbackTurnId) {
        const correlationProof = {
          terminalTurnId,
          routeFallbackTurnId,
          traceRouteFallbackTurnId,
        };
        steps.push(fail("verify_turn_id_correlation", "Expected terminal, route fallback, and trace route_fallback turnId to match", correlationProof));
        return failScenario("verify_turn_id_correlation");
      }
      artifacts.turnIdCorrelation = {
        terminalTurnId,
        routeFallbackTurnId,
        traceRouteFallbackTurnId,
      };
      steps.push(pass("verify_turn_id_correlation", artifacts.turnIdCorrelation));

      if (!trace) {
        steps.push(fail("verify_privacy", "Trace was not built before privacy scan"));
        return failScenario("verify_privacy");
      }
      const privacyProof = buildPrivacyEvidence(artifacts, steps, trace);
      if (!privacyProof.ok) {
        steps.push(fail("verify_privacy", `Generated evidence contains forbidden marker: ${privacyProof.leaked}`, {
          leaked: privacyProof.leaked,
        }));
        return failScenario("verify_privacy");
      }
      artifacts.privacyProof = {
        forbiddenProbeCount: 22,
        scannedBytes: privacyProof.scannedBytes,
      };
      steps.push(pass("verify_privacy", artifacts.privacyProof));

      return {
        ok: true,
        steps,
        artifacts,
        llmTrace: trace as unknown as Record<string, unknown>,
        consoleSummary: `PASS ${SCENARIO_NAME} ${steps.filter((step) => step.ok).length}/${steps.length}`,
      };
    } finally {
      if (chatTimeout !== undefined) {
        clearTimeout(chatTimeout);
      }
      await chatReader?.cancel().catch(() => {});
      chatController?.abort();
      await fixture.close();
    }
  },
};

export default scenario;
