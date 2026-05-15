/**
 * Failure scenario for image logging - IMG-03.
 *
 * Sub-scenarios:
 *   A: Image analysis (chatRound round 1) throws -> fallback in history, didLogMeal false, no meal
 *   B: log_food tool throws (FatalToolError via invalid args) -> fallback in history, no meal
 *   C: log_food succeeds -> meal kept, projected successful-log reply in history
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm } from "node:fs/promises";
import { createScenarioApp } from "../app-fixture.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import { LLMProviderError } from "../../../server/llm/errors.js";
import type { ProviderErrorMetadata } from "../../../server/llm/types.js";
import { createLlmTraceRecorder, type LlmTraceArtifact, type LlmTraceRecorder } from "../../../server/orchestrator/llm-trace.js";
import type { VerificationScenario, ScenarioContext, ScenarioResult, ScenarioStepResult } from "../scenario-types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, "..", "tmp", "image-log-failure", "uploads");
const UNIFIED_FALLBACK = "抱歉，這次無法完成請求，請稍後再試或補充描述。";
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
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

function makeJpegBytes(): ArrayBuffer {
  const bytes = new Uint8Array([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    ...new Array(50).fill(0x00),
    0xFF, 0xD9,
  ]);
  return bytes.buffer as ArrayBuffer;
}

function stepOk(name: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: true, actual };
}

function stepFail(name: string, error: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: false, error, actual };
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

async function fetchMeals(address: string, cookieHeader: string): Promise<Array<{ foodName: string }>> {
  const mealsRes = await fetch(`${address}/api/meals`, {
    headers: { cookie: cookieHeader },
  });
  const mealsJson = await mealsRes.json() as { meals: Array<{ foodName: string }> };
  return mealsJson.meals;
}

function parseDonePayload(rawSSE: string): { didLogMeal?: boolean; dailySummary?: DailySummaryPayload } | undefined {
  const doneEvent = parseSSEEvents(rawSSE).find((e) => e.event === "done");
  if (!doneEvent) {
    return undefined;
  }
  try {
    return JSON.parse(doneEvent.data) as { didLogMeal?: boolean; dailySummary?: DailySummaryPayload };
  } catch {
    return {};
  }
}

function hasValidDailySummaryDate(summary: DailySummaryPayload | undefined): boolean {
  return typeof summary?.date === "string" && DATE_KEY_PATTERN.test(summary.date);
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
    address: string;
    deviceId: string;
    cookieHeader: string;
  }) => Promise<{ ok: boolean; error?: string; evidence: unknown }>,
  options: { message?: string; llmTraceRecorderFactory?: () => LlmTraceRecorder | undefined } = {},
): Promise<{ steps: ScenarioStepResult[]; artifacts: Record<string, unknown>; ok: boolean; failedStep?: string }> {
  const steps: ScenarioStepResult[] = [];
  const artifacts: Record<string, unknown> = {};

  const llm = new StreamingLLMProvider();
  setupLLM(llm);

  const uploadsDir = `${UPLOADS_DIR}-${label}`;
  await mkdir(uploadsDir, { recursive: true });
  const scenarioCtx = await createScenarioApp({
    llmProvider: llm,
    uploadsDir,
    ...(options.llmTraceRecorderFactory !== undefined ? { llmTraceRecorderFactory: options.llmTraceRecorderFactory } : {}),
  });

  try {
    const form = new FormData();
    form.append("message", options.message ?? "(圖片)");
    form.append("image", new Blob([makeJpegBytes()], { type: "image/jpeg" }), "meal.jpg");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let rawSSE = "";
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
      rawSSE = await readStreamUntilEvent(res.body.getReader(), "done", 60);
    } finally {
      clearTimeout(timeout);
    }

    const result = await assertions({
      rawSSE,
      address: scenarioCtx.address,
      deviceId: scenarioCtx.deviceId,
      cookieHeader: scenarioCtx.cookieHeader,
    });
    artifacts[label] = result.evidence;
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
        const assistantMsgs = (await fetchHistory(address, cookieHeader)).filter((m) => m.role === "assistant");
        const meals = await fetchMeals(address, cookieHeader);
        const fallbackContent = assistantMsgs[0]?.content ?? "";

        const evidence = {
          donePayload,
          assistantCount: assistantMsgs.length,
          fallbackContent,
          mealCount: meals.length,
        };

        if (!donePayload) return { ok: false, error: "missing done event", evidence };
        if (donePayload.didLogMeal) return { ok: false, error: "expected didLogMeal false on analysis failure", evidence };
        if (assistantMsgs.length !== 1) return { ok: false, error: `D-10: expected 1 assistant msg, got ${assistantMsgs.length}`, evidence };
        if (!/抱歉/.test(fallbackContent)) return { ok: false, error: "IMG-03: expected friendly fallback wording", evidence };
        if (/log_food|FatalToolError/.test(fallbackContent)) return { ok: false, error: "IMG-03: fallback must not expose internal names", evidence };
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
    const subATraceEvidence = subA.artifacts.sub_a_analysis_fail as { fallbackContent?: string } | undefined;
    const subATraceCheck = verifyFallbackTraceContract(subALlmTrace, [
      { label: "final reply content", value: subATraceEvidence?.fallbackContent },
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
        const assistantMsgs = (await fetchHistory(address, cookieHeader)).filter((m) => m.role === "assistant");
        const meals = await fetchMeals(address, cookieHeader);
        const fallbackContent = assistantMsgs[0]?.content ?? "";

        const evidence = {
          donePayload,
          assistantCount: assistantMsgs.length,
          fallbackContent,
          mealCount: meals.length,
        };

        if (!donePayload) return { ok: false, error: "missing done event", evidence };
        if (donePayload.didLogMeal) return { ok: false, error: "expected didLogMeal false when log_food fails", evidence };
        if (assistantMsgs.length !== 1) return { ok: false, error: `D-10: expected 1 assistant msg, got ${assistantMsgs.length}`, evidence };
        if (fallbackContent !== UNIFIED_FALLBACK) return { ok: false, error: "IMG-03: expected fallback wording when log_food fails", evidence };
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
          fallbackContent,
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

    return buildResult(true, undefined, allSteps, allArtifacts, subALlmTrace);
  },
};

export default scenario;
