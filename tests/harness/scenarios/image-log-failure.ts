/**
 * Failure scenario for image logging - IMG-03.
 *
 * Sub-scenarios:
 *   A: Image analysis (chatRound round 1) throws -> fallback in history, didLogMeal false, no meal
 *   B: log_food tool throws (FatalToolError via invalid args) -> fallback in history, no meal
 *   C: log_food succeeds, final reply (chatRound round 2) throws -> meal kept, partial-success fallback in history
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm } from "node:fs/promises";
import { createScenarioApp } from "../app-fixture.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import type { VerificationScenario, ScenarioContext, ScenarioResult, ScenarioStepResult } from "../scenario-types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, "..", "tmp", "image-log-failure", "uploads");
const UNIFIED_FALLBACK = "抱歉，這次無法完成請求，請稍後再試或補充描述。";
const PARTIAL_SUCCESS_FALLBACK = "已完成記錄，但回覆生成失敗，請稍後確認今日攝取摘要。";
const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
): ScenarioResult {
  const passed = steps.filter((s) => s.ok).length;
  const total = steps.length;
  const consoleSummary = ok
    ? `PASS image-log-failure ${passed}/${total}`
    : `FAIL image-log-failure ${failedStep ?? "unknown"}`;
  return { ok, failedStep, steps, artifacts, consoleSummary };
}

async function fetchHistory(address: string, deviceId: string): Promise<Array<{ role: string; content: string }>> {
  const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
    headers: { "x-device-id": deviceId },
  });
  const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
  return historyJson.messages;
}

async function fetchMeals(address: string, deviceId: string): Promise<Array<{ foodName: string }>> {
  const mealsRes = await fetch(`${address}/api/meals`, {
    headers: { "x-device-id": deviceId },
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

async function runSubScenario(
  label: string,
  setupLLM: (llm: StreamingLLMProvider) => void,
  assertions: (params: {
    rawSSE: string;
    address: string;
    deviceId: string;
  }) => Promise<{ ok: boolean; error?: string; evidence: unknown }>,
  options: { message?: string } = {},
): Promise<{ steps: ScenarioStepResult[]; artifacts: Record<string, unknown>; ok: boolean; failedStep?: string }> {
  const steps: ScenarioStepResult[] = [];
  const artifacts: Record<string, unknown> = {};

  const llm = new StreamingLLMProvider();
  setupLLM(llm);

  const uploadsDir = `${UPLOADS_DIR}-${label}`;
  await mkdir(uploadsDir, { recursive: true });
  const scenarioCtx = await createScenarioApp({ llmProvider: llm, uploadsDir });

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
          "x-device-id": scenarioCtx.deviceId,
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
    const subA = await runSubScenario(
      "sub_a_analysis_fail",
      (llm) => {
        llm.queueRoundError(new Error("Vision API timeout"));
      },
      async ({ rawSSE, address, deviceId }) => {
        const donePayload = parseDonePayload(rawSSE);
        const assistantMsgs = (await fetchHistory(address, deviceId)).filter((m) => m.role === "assistant");
        const meals = await fetchMeals(address, deviceId);
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
        if (meals.length !== 0) return { ok: false, error: `IMG-03: expected 0 meals on analysis failure, got ${meals.length}`, evidence };

        return { ok: true, evidence };
      },
    );
    allSteps.push(...subA.steps);
    Object.assign(allArtifacts, subA.artifacts);
    if (!subA.ok) return buildResult(false, subA.failedStep, allSteps, allArtifacts);

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
      async ({ rawSSE, address, deviceId }) => {
        const donePayload = parseDonePayload(rawSSE);
        const assistantMsgs = (await fetchHistory(address, deviceId)).filter((m) => m.role === "assistant");
        const meals = await fetchMeals(address, deviceId);
        const fallbackContent = assistantMsgs[0]?.content ?? "";

        const evidence = {
          donePayload,
          assistantCount: assistantMsgs.length,
          fallbackContent,
          mealCount: meals.length,
        };

        if (!donePayload) return { ok: false, error: "missing done event", evidence };
        if (assistantMsgs.length !== 1) return { ok: false, error: `D-10: expected 1 assistant msg, got ${assistantMsgs.length}`, evidence };
        if (fallbackContent !== UNIFIED_FALLBACK) return { ok: false, error: "IMG-03: expected fallback wording when log_food fails", evidence };
        if (meals.length !== 0) return { ok: false, error: `IMG-03: expected 0 meals when tool fails, got ${meals.length}`, evidence };

        return { ok: true, evidence };
      },
    );
    allSteps.push(...subB.steps);
    Object.assign(allArtifacts, subB.artifacts);
    if (!subB.ok) return buildResult(false, subB.failedStep, allSteps, allArtifacts);

    // ------------------------------------------------------------------
    // Sub-scenario C: log_food succeeds, final reply (chatRound round 2) throws.
    // The non-image-only message avoids the deterministic image-only shortcut.
    // Expected: meal remains in DB, done.didLogMeal true, partial-success fallback.
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
              }),
            },
          }],
        });
        llm.queueRoundError(new Error("LLM reply generation failed"));
      },
      async ({ rawSSE, address, deviceId }) => {
        const donePayload = parseDonePayload(rawSSE);
        const assistantMsgs = (await fetchHistory(address, deviceId)).filter((m) => m.role === "assistant");
        const fallbackContent = assistantMsgs[0]?.content ?? "";
        const meals = await fetchMeals(address, deviceId);
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
        if (fallbackContent !== PARTIAL_SUCCESS_FALLBACK) return { ok: false, error: "D-09: expected partial-success fallback wording", evidence };
        if (!mealKept) return { ok: false, error: "D-09: meal must be kept when log_food succeeded before reply failed", evidence };

        return { ok: true, evidence };
      },
      { message: "請依照片幫我記錄午餐" },
    );
    allSteps.push(...subC.steps);
    Object.assign(allArtifacts, subC.artifacts);
    if (!subC.ok) return buildResult(false, subC.failedStep, allSteps, allArtifacts);

    return buildResult(true, undefined, allSteps, allArtifacts);
  },
};

export default scenario;
