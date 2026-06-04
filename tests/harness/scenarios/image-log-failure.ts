/**
 * Failure scenario for image logging - IMG-03.
 *
 * Sub-scenarios:
 *   A: Image analysis (chatRound round 1) throws -> fallback in history, didLogMeal false, no meal
 *   B: log_food tool throws (FatalToolError via invalid args) -> fallback in history, no meal
 *   C: log_food succeeds -> meal kept, projected successful-log reply in history
 *   D/E: accepted failed-recognition images call log_food with placeholder/all-zero facts -> no meal saved
 */

import path from "node:path";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { mkdir, readdir, rm } from "node:fs/promises";
import { createScenarioApp } from "../app-fixture.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { assertSSETerminalProof, collectEventSequence, parseSSEEvents, readStreamThroughClose } from "../sse.js";
import { validJpegBytes, validPngBytes } from "../../fixtures/image-bytes.js";
import type { CollectedSSEStream } from "../sse.js";
import { LLMProviderError } from "../../../server/llm/errors.js";
import type { ProviderErrorMetadata } from "../../../server/llm/types.js";
import { createLlmTraceRecorder, type LlmTraceArtifact, type LlmTraceRecorder } from "../../../server/orchestrator/llm-trace.js";
import { FAILED_RECOGNITION_NO_SAVE_REPLY } from "../../../server/orchestrator/tools.js";
import type { createSummaryService, DailySummary } from "../../../server/services/summary.js";
import type { VerificationScenario, ScenarioContext, ScenarioResult, ScenarioStepResult } from "../scenario-types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, "..", "tmp", "image-log-failure", "uploads");
const UNIFIED_FALLBACK = "抱歉，這次無法完成請求，請稍後再試或補充描述。";
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const STEP_NAMES = [
  "sub_a_analysis_fail_post_chat",
  "sub_a_analysis_fail_sse_terminal_contract",
  "sub_a_analysis_fail_route_upload_cleanup",
  "sub_a_analysis_fail_assert",
  "verify_llm_trace",
  "sub_b_tool_fail_post_chat",
  "sub_b_tool_fail_sse_terminal_contract",
  "sub_b_tool_fail_route_upload_cleanup",
  "sub_b_tool_fail_assert",
  "sub_c_reply_fail_post_chat",
  "sub_c_reply_fail_sse_terminal_contract",
  "sub_c_reply_fail_route_upload_cleanup",
  "sub_c_reply_fail_assert",
  "sub_d_failed_recognition_small_post_chat",
  "sub_d_failed_recognition_small_sse_terminal_contract",
  "sub_d_failed_recognition_small_route_upload_cleanup",
  "sub_d_failed_recognition_small_assert",
  "sub_e_failed_recognition_large_post_chat",
  "sub_e_failed_recognition_large_sse_terminal_contract",
  "sub_e_failed_recognition_large_route_upload_cleanup",
  "sub_e_failed_recognition_large_assert",
] as const;
const PROVIDER_METADATA_FIXTURE: ProviderErrorMetadata = {
  provider: "openai",
  operation: "chat",
  model: "gpt-image-trace-fixture",
  aborted: false,
  status: 429,
  providerRequestId: "req_image_trace_fixture",
  errorName: "RateLimitError",
  errorType: "rate_limit_exceeded",
  errorCode: "rate_limit",
};

interface DailySummaryPayload {
  date: string;
}

interface MealPayload {
  foodName: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

interface DonePayload {
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  loggedMeal?: unknown;
  dailySummary?: DailySummaryPayload;
  summaryOutcome?: unknown;
  deletedMealId?: unknown;
}

function makeJpegBytes(): ArrayBuffer {
  return validJpegBytes();
}

function makePngBytes(size = 8): ArrayBuffer {
  return validPngBytes(size);
}

function stepOk(name: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: true, actual };
}

function stepFail(name: string, error: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: false, error, actual };
}

function createLogCapture() {
  const logLines: string[] = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      chunk.toString().split("\n").filter(Boolean).forEach((line: string) => logLines.push(line));
      callback();
    },
  });

  return { logLines, stream };
}

function hasRouteUploadCleanupLog(logLines: string[]): boolean {
  return logLines.some((line) => {
    try {
      return (JSON.parse(line) as { event?: unknown }).event === "upload_cleanup_success";
    } catch {
      return false;
    }
  });
}

async function readUploadFiles(uploadsDir: string): Promise<string[]> {
  try {
    return await readdir(uploadsDir);
  } catch {
    return [];
  }
}

async function waitForRouteUploadCleanup(logLines: string[], uploadsDir: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const files = await readUploadFiles(uploadsDir);
    const cleanupLogSeen = hasRouteUploadCleanupLog(logLines);
    if (files.length === 0 && cleanupLogSeen) {
      return { files, cleanupLogSeen, attempts: attempt + 1 };
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const files = await readUploadFiles(uploadsDir);
  return {
    files,
    cleanupLogSeen: hasRouteUploadCleanupLog(logLines),
    attempts: 20,
  };
}

function buildResult(
  ok: boolean,
  failedStep: string | undefined,
  steps: ScenarioStepResult[],
  artifacts: Record<string, unknown>,
  llmTrace?: LlmTraceArtifact,
): ScenarioResult {
  const passed = steps.filter((s) => s.ok).length;
  const total = steps.length;
  const consoleSummary = ok
    ? `PASS image-log-failure ${passed}/${total}`
    : `FAIL image-log-failure ${failedStep ?? "unknown"}`;
  const result: ScenarioResult = { ok, failedStep, steps, artifacts, consoleSummary };
  if (llmTrace !== undefined) {
    result.llmTrace = llmTrace as unknown as Record<string, unknown>;
  }
  return result;
}

async function fetchHistory(address: string, cookieHeader: string): Promise<Array<{ role: string; content: string }>> {
  const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
    headers: { cookie: cookieHeader },
  });
  const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
  return historyJson.messages;
}

async function fetchMeals(address: string, cookieHeader: string): Promise<MealPayload[]> {
  const mealsRes = await fetch(`${address}/api/meals`, {
    headers: { cookie: cookieHeader },
  });
  const mealsJson = await mealsRes.json() as { meals: MealPayload[] };
  return mealsJson.meals;
}

function parseDonePayload(rawSSE: string): DonePayload | undefined {
  const doneEvent = parseSSEEvents(rawSSE).find((e) => e.event === "done");
  if (!doneEvent) {
    return undefined;
  }
  try {
    return JSON.parse(doneEvent.data) as DonePayload;
  } catch {
    return {};
  }
}

function parseLiveChunkText(rawSSE: string): {
  text: string;
  chunkCount: number;
  nonEmptyChunkCount: number;
  eventSequence: string[];
  firstNonEmptyChunkIndex: number;
  firstDoneIndex: number;
  nonEmptyChunkBeforeDone: boolean;
} {
  const events = parseSSEEvents(rawSSE);
  const eventSequence = collectEventSequence(rawSSE);
  const firstDoneIndex = events.findIndex((event) => event.event === "done");
  let firstNonEmptyChunkIndex = -1;
  const tokens = events
    .filter((event) => event.event === "chunk")
    .map((event) => {
      const originalIndex = events.indexOf(event);
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch (error) {
        throw new Error(`Malformed chunk JSON at index ${originalIndex}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const token = (parsed as { token?: unknown }).token;
      if (typeof token !== "string") {
        throw new Error(`Malformed chunk payload at index ${originalIndex}: missing token`);
      }
      if (token.trim().length === 0) {
        throw new Error(`Malformed chunk payload at index ${originalIndex}: empty token`);
      }
      if (firstNonEmptyChunkIndex === -1) {
        firstNonEmptyChunkIndex = originalIndex;
      }
      return token;
    });
  if (tokens.length === 0) {
    throw new Error("Expected at least one non-empty chunk before done");
  }
  if (firstDoneIndex === -1) {
    throw new Error("Expected done event in SSE transcript");
  }
  if (firstNonEmptyChunkIndex >= firstDoneIndex) {
    throw new Error("Expected at least one non-empty chunk before first done");
  }
  return {
    text: tokens.join(""),
    chunkCount: tokens.length,
    nonEmptyChunkCount: tokens.filter((token) => token.trim().length > 0).length,
    eventSequence,
    firstNonEmptyChunkIndex,
    firstDoneIndex,
    nonEmptyChunkBeforeDone: true,
  };
}

function summarizeSummary(summary: DailySummary) {
  return {
    mealCount: summary.mealCount,
    totalCalories: summary.totalCalories,
    totalProtein: summary.totalProtein,
    totalCarbs: summary.totalCarbs,
    totalFat: summary.totalFat,
  };
}

function hasValidDailySummaryDate(summary: DailySummaryPayload | undefined): boolean {
  return typeof summary?.date === "string" && DATE_KEY_PATTERN.test(summary.date);
}

async function loadTodaySummary(
  summaryService: ReturnType<typeof createSummaryService>,
  deviceId: string,
) {
  return summaryService.getDailySummary(deviceId, new Date());
}

function verifyFallbackTraceContract(
  trace: LlmTraceArtifact | undefined,
  forbiddenProbes: Array<{ label: string; value: string | undefined }>,
): { ok: boolean; error?: string; evidence: unknown } {
  const evidence = trace ?? null;

  if (!trace) return { ok: false, error: "expected sub-A llm trace", evidence };
  const topLevelKeys = Object.keys(trace).sort();
  if (topLevelKeys.join(",") !== "scenario,schemaVersion,status,summary,timeline") {
    return { ok: false, error: "expected five-key llm-trace.v2 top-level shape", evidence };
  }
  if (trace.schemaVersion !== "llm-trace.v2") return { ok: false, error: "expected llm-trace.v2 schema version", evidence };
  if (trace.scenario !== "image-log-failure") return { ok: false, error: "expected image-log-failure trace scenario", evidence };
  const llmErrorEvents = trace.timeline.filter((event) => event.type === "llm_error");
  if (llmErrorEvents.length < 1) {
    return { ok: false, error: "expected llm_error trace event", evidence };
  }
  if (!trace.timeline.some((event) => event.type === "orchestrator_fallback" && event.reason === "llm_error")) {
    return { ok: false, error: "expected llm_error orchestrator_fallback trace event", evidence };
  }
  if (!trace.timeline.some((event) => event.type === "route_fallback" && event.reason === "llm_error" && event.fallbackSource === "orchestrator")) {
    return { ok: false, error: "expected llm_error route_fallback trace event", evidence };
  }
  if (trace.summary.roundCount !== 1) return { ok: false, error: "expected one LLM round before fallback diagnosis", evidence };
  if (trace.summary.toolCount !== 0) return { ok: false, error: "expected no tools before sub-A analysis fallback", evidence };
  if (trace.summary.fallbackCount < 1) return { ok: false, error: "expected fallbackCount >= 1", evidence };
  if (trace.summary.providerErrorCount !== llmErrorEvents.length) {
    return { ok: false, error: "expected providerErrorCount to equal llm_error event count", evidence };
  }
  if (typeof trace.summary.latencyMs !== "number" || trace.summary.latencyMs < 0) {
    return { ok: false, error: "expected non-negative latencyMs", evidence };
  }
  if (trace.summary.finalReply.source !== "fallback") return { ok: false, error: "expected fallback final reply source", evidence };
  if (trace.summary.finalReply.shape !== "fallback_text") return { ok: false, error: "expected fallback_text final reply shape", evidence };

  let providerMetadataEventCount = 0;
  for (const event of trace.timeline) {
    const providerMetadata =
      event.type === "llm_error"
        ? event.providerMetadata
        : event.type === "orchestrator_fallback" || event.type === "route_fallback"
          ? event.providerMetadata
          : undefined;
    if (providerMetadata === undefined) {
      continue;
    }
    providerMetadataEventCount += 1;
    if (JSON.stringify(providerMetadata) !== JSON.stringify(PROVIDER_METADATA_FIXTURE)) {
      return { ok: false, error: "expected allowlisted provider metadata to survive trace recording", evidence };
    }
  }
  if (providerMetadataEventCount < 3) {
    return { ok: false, error: "expected provider metadata on llm_error, orchestrator_fallback, and route_fallback", evidence };
  }

  const serialized = JSON.stringify(trace);
  for (const probe of forbiddenProbes) {
    if (probe.value && serialized.includes(probe.value)) {
      return { ok: false, error: `serialized trace contains ${probe.label}`, evidence };
    }
  }
  if (/data:image|\/uploads\/|providerPayload|rawProviderPayload|finalAssistantContent|toolArguments|toolResult|streamFrames/.test(serialized)) {
    return {
      ok: false,
      error: "serialized trace contains forbidden provider payload, data:image, /uploads/, stream, raw tool, or final reply content marker",
      evidence,
    };
  }

  return { ok: true, evidence };
}

async function runSubScenario(
  label: string,
  setupLLM: (llm: StreamingLLMProvider) => void,
  assertions: (params: {
    rawSSE: string;
    sseCollection: CollectedSSEStream;
    address: string;
    deviceId: string;
    cookieHeader: string;
    summaryService: ReturnType<typeof createSummaryService>;
    llm: StreamingLLMProvider;
  }) => Promise<{ ok: boolean; error?: string; evidence: unknown }>,
  options: {
    message?: string;
    imageBytes?: ArrayBuffer;
    imageType?: string;
    imageFilename?: string;
    llmTraceRecorderFactory?: () => LlmTraceRecorder | undefined;
  } = {},
): Promise<{ steps: ScenarioStepResult[]; artifacts: Record<string, unknown>; ok: boolean; failedStep?: string }> {
  const steps: ScenarioStepResult[] = [];
  const artifacts: Record<string, unknown> = {};

  const llm = new StreamingLLMProvider();
  setupLLM(llm);
  const { logLines, stream: logStream } = createLogCapture();

  const uploadsDir = `${UPLOADS_DIR}-${label}`;
  await mkdir(uploadsDir, { recursive: true });
  const scenarioCtx = await createScenarioApp({
    llmProvider: llm,
    uploadsDir,
    logger: { level: "info", stream: logStream },
    ...(options.llmTraceRecorderFactory !== undefined ? { llmTraceRecorderFactory: options.llmTraceRecorderFactory } : {}),
  });

  try {
    const form = new FormData();
    form.append("message", options.message ?? "(圖片)");
    form.append(
      "image",
      new Blob([options.imageBytes ?? makeJpegBytes()], { type: options.imageType ?? "image/jpeg" }),
      options.imageFilename ?? "meal.jpg",
    );

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let rawSSE = "";
    let sseCollection: CollectedSSEStream | undefined;
    try {
      const res = await fetch(`${scenarioCtx.address}/api/chat`, {
        method: "POST",
        headers: {
          cookie: scenarioCtx.cookieHeader,
          "Accept": "text/event-stream",
        },
        signal: controller.signal,
        body: form,
      });
      if (!res.ok || !res.body) {
        steps.push(stepFail(`${label}_post_chat`, `HTTP ${res.status}`, { status: res.status }));
        return { steps, artifacts, ok: false, failedStep: `${label}_post_chat` };
      }
      steps.push(stepOk(`${label}_post_chat`, { status: res.status }));
      sseCollection = await readStreamThroughClose(res.body.getReader(), { maxReads: 60, readTimeoutMs: 5000 });
      rawSSE = sseCollection.raw;
    } finally {
      clearTimeout(timeout);
    }

    if (!sseCollection) {
      steps.push(stepFail(`${label}_sse_terminal_contract`, "missing SSE collection", {}));
      return { steps, artifacts, ok: false, failedStep: `${label}_sse_terminal_contract` };
    }
    const terminalProof = assertSSETerminalProof(sseCollection);
    artifacts[`${label}_sse_terminal_contract`] = terminalProof.evidence;
    if (!terminalProof.ok) {
      steps.push(stepFail(`${label}_sse_terminal_contract`, terminalProof.error, terminalProof.evidence));
      return { steps, artifacts, ok: false, failedStep: `${label}_sse_terminal_contract` };
    }
    if (!sseCollection.nonEmptyChunkBeforeDone) {
      steps.push(stepFail(`${label}_sse_terminal_contract`, "SSE transcript lacked a non-empty chunk before first done", terminalProof.evidence));
      return { steps, artifacts, ok: false, failedStep: `${label}_sse_terminal_contract` };
    }
    steps.push(stepOk(`${label}_sse_terminal_contract`, terminalProof.evidence));

    const result = await assertions({
      rawSSE,
      sseCollection,
      address: scenarioCtx.address,
      deviceId: scenarioCtx.deviceId,
      cookieHeader: scenarioCtx.cookieHeader,
      summaryService: scenarioCtx.services.summaryService,
      llm,
    });
    artifacts[label] = result.evidence;
    const routeCleanupEvidence = await waitForRouteUploadCleanup(logLines, uploadsDir);
    artifacts[`${label}_route_upload_cleanup`] = {
      filesAfterRouteCleanup: routeCleanupEvidence.files,
      cleanupLogSeen: routeCleanupEvidence.cleanupLogSeen,
      attempts: routeCleanupEvidence.attempts,
      checkedBeforeScenarioClose: true,
    };
    if (routeCleanupEvidence.files.length > 0 || !routeCleanupEvidence.cleanupLogSeen) {
      steps.push(stepFail(
        `${label}_route_upload_cleanup`,
        "route-level staged upload cleanup did not complete before scenario close",
        artifacts[`${label}_route_upload_cleanup`],
      ));
      return { steps, artifacts, ok: false, failedStep: `${label}_route_upload_cleanup` };
    }
    steps.push(stepOk(`${label}_route_upload_cleanup`, artifacts[`${label}_route_upload_cleanup`]));
    if (!result.ok) {
      steps.push(stepFail(`${label}_assert`, result.error ?? "assertion failed", result.evidence));
      return { steps, artifacts, ok: false, failedStep: `${label}_assert` };
    }
    steps.push(stepOk(`${label}_assert`, result.evidence));
    return { steps, artifacts, ok: true };
  } finally {
    await scenarioCtx.close();
    await rm(uploadsDir, { recursive: true, force: true });
  }
}

const scenario: VerificationScenario = {
  name: "image-log-failure",

  async run(_ctx: ScenarioContext): Promise<ScenarioResult> {
    const allSteps: ScenarioStepResult[] = [];
    const allArtifacts: Record<string, unknown> = {};

    // ------------------------------------------------------------------
    // Sub-scenario A: chatRound round 1 throws (image analysis failure)
    // Expected: fallback in history, done.didLogMeal false, no meal.
    // ------------------------------------------------------------------
    const subARecorder = createLlmTraceRecorder();
    const subAUserMealText = "(圖片)";
    const subA = await runSubScenario(
      "sub_a_analysis_fail",
      (llm) => {
        llm.queueRoundError(new LLMProviderError(PROVIDER_METADATA_FIXTURE));
      },
      async ({ rawSSE, address, cookieHeader }) => {
        const donePayload = parseDonePayload(rawSSE);
        let liveChunkText = "";
        let liveChunkEvidence: Omit<ReturnType<typeof parseLiveChunkText>, "text"> = {
          chunkCount: 0,
          nonEmptyChunkCount: 0,
          eventSequence: [],
          firstNonEmptyChunkIndex: -1,
          firstDoneIndex: -1,
          nonEmptyChunkBeforeDone: false,
        };
        try {
          const parsedLiveChunks = parseLiveChunkText(rawSSE);
          liveChunkText = parsedLiveChunks.text;
          liveChunkEvidence = {
            chunkCount: parsedLiveChunks.chunkCount,
            nonEmptyChunkCount: parsedLiveChunks.nonEmptyChunkCount,
            eventSequence: parsedLiveChunks.eventSequence,
            firstNonEmptyChunkIndex: parsedLiveChunks.firstNonEmptyChunkIndex,
            firstDoneIndex: parsedLiveChunks.firstDoneIndex,
            nonEmptyChunkBeforeDone: parsedLiveChunks.nonEmptyChunkBeforeDone,
          };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            evidence: { donePayload, rawLength: rawSSE.length },
          };
        }
        const assistantMsgs = (await fetchHistory(address, cookieHeader)).filter((m) => m.role === "assistant");
        const meals = await fetchMeals(address, cookieHeader);
        const fallbackContent = assistantMsgs[0]?.content ?? "";
        const falseLogChunkClaim = /已記錄|完成記錄/.test(liveChunkText);

        const evidence = {
          donePayload,
          liveChunkEvidence,
          falseLogChunkClaim,
          assistantCount: assistantMsgs.length,
          fallbackMatchedFriendly: /抱歉/.test(fallbackContent),
          fallbackTextLength: fallbackContent.length,
          liveChunkTextLength: liveChunkText.length,
          mealCount: meals.length,
        };

        if (!donePayload) return { ok: false, error: "missing done event", evidence };
        if (donePayload.didLogMeal) return { ok: false, error: "expected didLogMeal false on analysis failure", evidence };
        if (assistantMsgs.length !== 1) return { ok: false, error: `D-10: expected 1 assistant msg, got ${assistantMsgs.length}`, evidence };
        if (!/抱歉/.test(fallbackContent)) return { ok: false, error: "IMG-03: expected friendly fallback wording", evidence };
        if (/log_food|FatalToolError/.test(fallbackContent)) return { ok: false, error: "IMG-03: fallback must not expose internal names", evidence };
        if (falseLogChunkClaim) return { ok: false, error: "IMG-03: failed image analysis chunk must not claim a meal was logged", evidence };
        if (/已記錄|完成記錄/.test(fallbackContent)) return { ok: false, error: "IMG-03: failed image analysis must not claim a meal was logged", evidence };
        if (meals.length !== 0) return { ok: false, error: `IMG-03: expected 0 meals on analysis failure, got ${meals.length}`, evidence };

        return { ok: true, evidence };
      },
      {
        message: subAUserMealText,
        llmTraceRecorderFactory: () => subARecorder,
      },
    );
    allSteps.push(...subA.steps);
    Object.assign(allArtifacts, subA.artifacts);
    if (!subA.ok) return buildResult(false, subA.failedStep, allSteps, allArtifacts);
    const subALlmTrace = subARecorder.build({ scenario: "image-log-failure", status: "pass" });
    const subATraceCheck = verifyFallbackTraceContract(subALlmTrace, [
      { label: "final reply content", value: "抱歉，目前無法處理您的請求，請稍後再試。" },
      { label: "raw provider error message", value: "LLM provider request failed" },
      { label: "raw provider payload", value: "providerPayload" },
      { label: "raw provider payload", value: "rawProviderPayload" },
      { label: "raw provider headers", value: "headers" },
      { label: "raw provider body", value: "body" },
      { label: "raw image data/data URI", value: "data:image" },
      { label: "upload path", value: "/uploads/" },
      { label: "raw device ID", value: "device_" },
      { label: "meal text", value: subAUserMealText },
      { label: "cookies/session values", value: "guest_session" },
      { label: "authorization/API keys", value: "authorization" },
      { label: "authorization/API keys", value: "api_key" },
      { label: "prompt/messages", value: "messages" },
      { label: "prompt/messages", value: "rawPrompt" },
      { label: "prompt/messages", value: "promptText" },
      { label: "raw tool args/results", value: "toolArguments" },
      { label: "raw tool args/results", value: "toolResult" },
      { label: "stream frames", value: "streamFrames" },
      { label: "token text", value: "token" },
    ]);
    if (!subATraceCheck.ok) {
      allSteps.push(stepFail("verify_llm_trace", subATraceCheck.error ?? "trace assertion failed", subATraceCheck.evidence));
      return buildResult(false, "verify_llm_trace", allSteps, allArtifacts);
    }
    allSteps.push(stepOk("verify_llm_trace", subATraceCheck.evidence));

    // ------------------------------------------------------------------
    // Sub-scenario B: invalid log_food JSON is classified as FatalToolError.
    // Expected: fallback wording in history, no meal, done event emitted.
    // ------------------------------------------------------------------
    const subB = await runSubScenario(
      "sub_b_tool_fail",
      (llm) => {
        llm.queueRoundResponse({
          toolCalls: [{
            id: "call_fail_b",
            type: "function",
            function: {
              name: "log_food",
              arguments: "INVALID_JSON_ARGS",
            },
          }],
        });
      },
      async ({ rawSSE, address, cookieHeader }) => {
        const donePayload = parseDonePayload(rawSSE);
        let liveChunkText = "";
        let liveChunkEvidence: Omit<ReturnType<typeof parseLiveChunkText>, "text"> = {
          chunkCount: 0,
          nonEmptyChunkCount: 0,
          eventSequence: [],
          firstNonEmptyChunkIndex: -1,
          firstDoneIndex: -1,
          nonEmptyChunkBeforeDone: false,
        };
        try {
          const parsedLiveChunks = parseLiveChunkText(rawSSE);
          liveChunkText = parsedLiveChunks.text;
          liveChunkEvidence = {
            chunkCount: parsedLiveChunks.chunkCount,
            nonEmptyChunkCount: parsedLiveChunks.nonEmptyChunkCount,
            eventSequence: parsedLiveChunks.eventSequence,
            firstNonEmptyChunkIndex: parsedLiveChunks.firstNonEmptyChunkIndex,
            firstDoneIndex: parsedLiveChunks.firstDoneIndex,
            nonEmptyChunkBeforeDone: parsedLiveChunks.nonEmptyChunkBeforeDone,
          };
        } catch (error) {
          return {
            ok: false,
            error: error instanceof Error ? error.message : String(error),
            evidence: { donePayload, rawLength: rawSSE.length },
          };
        }
        const assistantMsgs = (await fetchHistory(address, cookieHeader)).filter((m) => m.role === "assistant");
        const meals = await fetchMeals(address, cookieHeader);
        const fallbackContent = assistantMsgs[0]?.content ?? "";
        const falseLogChunkClaim = /已記錄|完成記錄/.test(liveChunkText);

        const evidence = {
          donePayload,
          liveChunkEvidence,
          falseLogChunkClaim,
          assistantCount: assistantMsgs.length,
          fallbackMatchedUnified: fallbackContent === UNIFIED_FALLBACK,
          fallbackTextLength: fallbackContent.length,
          liveChunkTextLength: liveChunkText.length,
          mealCount: meals.length,
        };

        if (!donePayload) return { ok: false, error: "missing done event", evidence };
        if (donePayload.didLogMeal) return { ok: false, error: "expected didLogMeal false when log_food fails", evidence };
        if (assistantMsgs.length !== 1) return { ok: false, error: `D-10: expected 1 assistant msg, got ${assistantMsgs.length}`, evidence };
        if (fallbackContent !== UNIFIED_FALLBACK) return { ok: false, error: "IMG-03: expected fallback wording when log_food fails", evidence };
        if (falseLogChunkClaim) return { ok: false, error: "IMG-03: failed tool chunk must not claim a meal was logged", evidence };
        if (/已記錄|完成記錄/.test(fallbackContent)) return { ok: false, error: "IMG-03: failed tool path must not claim a meal was logged", evidence };
        if (meals.length !== 0) return { ok: false, error: `IMG-03: expected 0 meals when tool fails, got ${meals.length}`, evidence };

        return { ok: true, evidence };
      },
    );
    allSteps.push(...subB.steps);
    Object.assign(allArtifacts, subB.artifacts);
    if (!subB.ok) return buildResult(false, subB.failedStep, allSteps, allArtifacts);

    // ------------------------------------------------------------------
    // Sub-scenario C: log_food succeeds and route returns projected successful-log wording.
    // The non-image-only message avoids the deterministic image-only shortcut.
    // Expected: meal remains in DB and done.didLogMeal true.
    // ------------------------------------------------------------------
    const subC = await runSubScenario(
      "sub_c_reply_fail",
      (llm) => {
        llm.queueRoundResponse({
          toolCalls: [{
            id: "call_c_1",
            type: "function",
            function: {
              name: "log_food",
              arguments: JSON.stringify({
                food_name: "測試餐點C",
                calories: 300,
                protein: 10,
                carbs: 40,
                fat: 8,
                protein_sources: [
                  { name: "雞腿", protein: 10, is_primary: true, certainty: "clear" },
                  { name: "白飯", protein: 2, is_primary: false, certainty: "clear" },
                ],
              }),
            },
          }],
        });
      },
      async ({ rawSSE, address, cookieHeader }) => {
        const donePayload = parseDonePayload(rawSSE);
        const assistantMsgs = (await fetchHistory(address, cookieHeader)).filter((m) => m.role === "assistant");
        const fallbackContent = assistantMsgs[0]?.content ?? "";
        const meals = await fetchMeals(address, cookieHeader);
        const mealKept = meals.some((m) => m.foodName === "測試餐點C");

        const evidence = {
          donePayload,
          assistantCount: assistantMsgs.length,
          projectedReplyMatched: /已記錄測試餐點C/.test(fallbackContent),
          projectedReplyTextLength: fallbackContent.length,
          mealKept,
          mealCount: meals.length,
        };

        if (!donePayload) return { ok: false, error: "missing done event", evidence };
        if (donePayload.didLogMeal !== true) return { ok: false, error: "D-09: expected done.didLogMeal true after log_food succeeded", evidence };
        if (!donePayload.dailySummary) return { ok: false, error: "D-09: expected dailySummary after log_food succeeded", evidence };
        if (!hasValidDailySummaryDate(donePayload.dailySummary)) {
          return {
            ok: false,
            error: `D-09: expected dailySummary.date to match YYYY-MM-DD, got ${String(donePayload.dailySummary.date)}`,
            evidence,
          };
        }
        if (assistantMsgs.length !== 1) return { ok: false, error: `D-10: expected 1 assistant msg, got ${assistantMsgs.length}`, evidence };
        if (!/已記錄測試餐點C/.test(fallbackContent)) {
          return { ok: false, error: "D-09: expected projected successful log wording", evidence };
        }
        if (!/蛋白質 0 g/.test(fallbackContent)) {
          return { ok: false, error: "D-09: expected normalized projected protein in successful log wording", evidence };
        }
        if (!mealKept) return { ok: false, error: "D-09: meal must be kept when log_food succeeded", evidence };

        return { ok: true, evidence };
      },
      { message: "請依照片幫我記錄午餐" },
    );
    allSteps.push(...subC.steps);
    Object.assign(allArtifacts, subC.artifacts);
    if (!subC.ok) return buildResult(false, subC.failedStep, allSteps, allArtifacts);

    const runFailedRecognitionNoSave = async (
      label: "sub_d_failed_recognition_small" | "sub_e_failed_recognition_large",
      imageBytes: ArrayBuffer,
      imageFilename: string,
    ) => runSubScenario(
      label,
      (llm) => {
        llm.queueRoundResponse({
          toolCalls: [{
            id: `call_${label}`,
            type: "function",
            function: {
              name: "log_food",
              arguments: JSON.stringify({
                food_name: "無法辨識內容",
                calories: 0,
                protein: 0,
                carbs: 0,
                fat: 0,
              }),
            },
          }],
        });
      },
      async ({ rawSSE, address, cookieHeader, deviceId, summaryService, llm }) => {
        const donePayload = parseDonePayload(rawSSE);
        const events = parseSSEEvents(rawSSE);
        const doneEvents = events.filter((event) => event.event === "done");
        const chunkEvents = events.filter((event) => event.event === "chunk");
        const parsedLiveChunks = parseLiveChunkText(rawSSE);
        const liveChunkText = parsedLiveChunks.text;
        const assistantMsgs = (await fetchHistory(address, cookieHeader)).filter((m) => m.role === "assistant");
        const meals = await fetchMeals(address, cookieHeader);
        const afterSummary = await loadTodaySummary(summaryService, deviceId);
        const falseLogChunkClaim = /已記錄|完成記錄/.test(liveChunkText);
        const assistantContent = assistantMsgs[0]?.content ?? "";
        const evidence = {
          donePayload: {
            didLogMeal: donePayload?.didLogMeal,
            didMutateMeal: donePayload?.didMutateMeal,
            hasLoggedMeal: donePayload ? Object.prototype.hasOwnProperty.call(donePayload, "loggedMeal") : false,
            hasDailySummary: donePayload ? Object.prototype.hasOwnProperty.call(donePayload, "dailySummary") : false,
            hasSummaryOutcome: donePayload ? Object.prototype.hasOwnProperty.call(donePayload, "summaryOutcome") : false,
            hasDeletedMealId: donePayload ? Object.prototype.hasOwnProperty.call(donePayload, "deletedMealId") : false,
          },
          sse: {
            eventSequence: collectEventSequence(rawSSE),
            doneEventCount: doneEvents.length,
            chunkEventCount: chunkEvents.length,
            replyMatchedCanonical: liveChunkText === FAILED_RECOGNITION_NO_SAVE_REPLY,
            replyLength: liveChunkText.length,
            falseLogChunkClaim,
          },
          history: {
            assistantCount: assistantMsgs.length,
            assistantMatchedCanonical: assistantContent === FAILED_RECOGNITION_NO_SAVE_REPLY,
            assistantTextLength: assistantContent.length,
          },
          persistence: {
            mealCount: meals.length,
            summary: summarizeSummary(afterSummary),
          },
          modelCalls: {
            chatRoundCalls: llm.chatCalls.length,
          },
        };

        if (!donePayload) return { ok: false, error: "missing done event", evidence };
        if (doneEvents.length !== 1) return { ok: false, error: `expected exactly one done event, got ${doneEvents.length}`, evidence };
        if (chunkEvents.length !== 1) return { ok: false, error: `expected exactly one chunk event, got ${chunkEvents.length}`, evidence };
        if (liveChunkText !== FAILED_RECOGNITION_NO_SAVE_REPLY) {
          return { ok: false, error: "expected canonical failed-recognition no-save copy", evidence };
        }
        if (falseLogChunkClaim) return { ok: false, error: "no-save chunk must not claim a meal was logged", evidence };
        if (donePayload.didLogMeal !== false) return { ok: false, error: "expected didLogMeal false", evidence };
        if (donePayload.didMutateMeal !== false) return { ok: false, error: "expected didMutateMeal false", evidence };
        if (Object.prototype.hasOwnProperty.call(donePayload, "loggedMeal")) {
          return { ok: false, error: "expected done payload to omit loggedMeal", evidence };
        }
        if (Object.prototype.hasOwnProperty.call(donePayload, "dailySummary")) {
          return { ok: false, error: "expected done payload to omit dailySummary", evidence };
        }
        if (Object.prototype.hasOwnProperty.call(donePayload, "summaryOutcome")) {
          return { ok: false, error: "expected done payload to omit summaryOutcome", evidence };
        }
        if (assistantMsgs.length !== 1) return { ok: false, error: `expected 1 assistant msg, got ${assistantMsgs.length}`, evidence };
        if (assistantContent !== FAILED_RECOGNITION_NO_SAVE_REPLY) {
          return { ok: false, error: "expected persisted assistant copy to match canonical no-save copy", evidence };
        }
        if (meals.length !== 0) return { ok: false, error: `expected 0 meals after no-save path, got ${meals.length}`, evidence };
        if (
          afterSummary.mealCount !== 0 ||
          afterSummary.totalCalories !== 0 ||
          afterSummary.totalProtein !== 0 ||
          afterSummary.totalCarbs !== 0 ||
          afterSummary.totalFat !== 0
        ) {
          return { ok: false, error: "expected unchanged zero daily summary totals after no-save path", evidence };
        }
        if (llm.chatCalls.length !== 1) {
          return { ok: false, error: `expected one model round and no recovery call, got ${llm.chatCalls.length}`, evidence };
        }

        return { ok: true, evidence };
      },
      {
        message: "",
        imageBytes,
        imageType: "image/png",
        imageFilename,
      },
    );

    const subD = await runFailedRecognitionNoSave(
      "sub_d_failed_recognition_small",
      makePngBytes(),
      "failed-recognition-small.png",
    );
    allSteps.push(...subD.steps);
    Object.assign(allArtifacts, subD.artifacts);
    if (!subD.ok) return buildResult(false, subD.failedStep, allSteps, allArtifacts);

    const subE = await runFailedRecognitionNoSave(
      "sub_e_failed_recognition_large",
      makePngBytes(64 * 1024),
      "failed-recognition-large.png",
    );
    allSteps.push(...subE.steps);
    Object.assign(allArtifacts, subE.artifacts);
    if (!subE.ok) return buildResult(false, subE.failedStep, allSteps, allArtifacts);

    allArtifacts.stepContract = { stepNames: [...STEP_NAMES] };

    return buildResult(true, undefined, allSteps, allArtifacts, subALlmTrace);
  },
};

export default scenario;
