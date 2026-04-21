/**
 * Deterministic image logging verification scenario.
 *
 * Covers VERI-02: a maintainer can replay the image logging flow through the
 * real multipart `/api/chat` route, inspect analysis and logging status
 * transitions, verify the persisted meal output, and prove that upload residue
 * is cleaned up deterministically.
 *
 * The scenario:
 *   1. Boots the app with a scenario-local temp uploads directory.
 *   2. POSTs a minimal valid JPEG via multipart with `Accept: text/event-stream`.
 *   3. Collects SSE frames: expects `分析圖片中...` status, `記錄餐點中...` status,
 *      streamed chunks, and a final `done` payload with `didLogMeal: true`.
 *   4. Fetches `/api/chat/history` and `/api/meals` to verify persistence.
 *   5. Records the upload files created in the temp directory.
 *   6. Removes the temp directory and asserts no residual files remain.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rm, readdir, mkdir } from "node:fs/promises";
import { createScenarioApp } from "../app-fixture.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import type { VerificationScenario, ScenarioContext, ScenarioResult, ScenarioStepResult } from "../scenario-types.js";

// ---------------------------------------------------------------------------
// Scenario-local temp directory
// ---------------------------------------------------------------------------

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_UPLOADS_DIR = path.resolve(__dirname, "..", "tmp", "image-log", "uploads");
const SCENARIO_ASSETS_DIR = path.resolve(__dirname, "..", "tmp", "image-log", "assets");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid JPEG bytes (JFIF header + EOI marker). */
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

interface DailySummaryPayload {
  date: string;
}

interface ImageAssetDto {
  imagePath?: string | null;
  imageAssetId?: string | null;
  imageUrl?: string | null;
}

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function hasValidDailySummaryDate(summary: DailySummaryPayload | undefined): boolean {
  return typeof summary?.date === "string" && DATE_KEY_PATTERN.test(summary.date);
}

// ---------------------------------------------------------------------------
// Scenario definition
// ---------------------------------------------------------------------------

const scenario: VerificationScenario = {
  name: "image-log",

  async run(_ctx: ScenarioContext): Promise<ScenarioResult> {
    const steps: ScenarioStepResult[] = [];
    const artifacts: Record<string, unknown> = {};
    let failedStep: string | undefined;
    let uploadFilesBeforeCleanup: string[] = [];

    // Boot our own app instance with the scenario-local uploads directory so
    // uploads never land in `server/uploads/`.
    await mkdir(SCENARIO_UPLOADS_DIR, { recursive: true });
    await mkdir(SCENARIO_ASSETS_DIR, { recursive: true });

    const llm = new StreamingLLMProvider();
    // Round 1: tool call — log_food for 豬肉燒烤飯盒
    llm.queueRoundResponse({
      toolCalls: [
        {
          id: "call_img_1",
          type: "function",
          function: {
            name: "log_food",
            arguments: JSON.stringify({
              food_name: "豬肉燒烤飯盒",
              calories: 680,
              protein: 35,
              carbs: 86,
              fat: 22,
            }),
          },
        },
      ],
    });
    // Round 2: streamed final reply
    llm.queueChatStream([
      "已先依照片做保守估算並完成記錄：",
      "豬肉燒烤飯盒，約 680 kcal。",
    ]);

    const scenarioCtx = await createScenarioApp({
      llmProvider: llm,
      uploadsDir: SCENARIO_UPLOADS_DIR,
      assetsDir: SCENARIO_ASSETS_DIR,
    });

    try {
      // ------------------------------------------------------------------
      // Step: post_chat
      // ------------------------------------------------------------------
      const form = new FormData();
      form.append("message", "這是我的午餐");
      form.append(
        "image",
        new Blob([makeJpegBytes()], { type: "image/jpeg" }),
        "lunch.jpg",
      );

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
          steps.push(stepFail("post_chat", `HTTP ${res.status}`, { status: res.status }));
          failedStep = "post_chat";
          artifacts.post_chat = { status: res.status };
          return buildResult(false, failedStep, steps, artifacts);
        }

        steps.push(stepOk("post_chat", { status: res.status }));
        artifacts.post_chat = { status: res.status };

        // ------------------------------------------------------------------
        // Step: collect_stream
        // ------------------------------------------------------------------
        const reader = res.body.getReader();
        rawSSE = await readStreamUntilEvent(reader, "done", 60);
      } finally {
        clearTimeout(timeout);
      }

      const sseEvents = parseSSEEvents(rawSSE);
      const statusLabels = sseEvents
        .filter((e) => e.event === "status")
        .map((e) => {
          try {
            return (JSON.parse(e.data) as { label: string }).label;
          } catch {
            return e.data;
          }
        });
      const doneEvent = sseEvents.find((e) => e.event === "done");
      let donePayload: { didLogMeal?: boolean; dailySummary?: DailySummaryPayload } = {};
      if (doneEvent) {
        try {
          donePayload = JSON.parse(doneEvent.data) as typeof donePayload;
        } catch {
          // leave empty
        }
      }

      const hasAnalysisStatus = statusLabels.some((l) => l.includes("分析圖片中"));
      const hasLoggingStatus = statusLabels.some((l) => l.includes("記錄餐點中"));
      const hasDone = Boolean(doneEvent);

      if (!hasAnalysisStatus || !hasLoggingStatus || !hasDone) {
        const err = [
          !hasAnalysisStatus ? "missing 分析圖片中 status" : "",
          !hasLoggingStatus ? "missing 記錄餐點中 status" : "",
          !hasDone ? "missing done event" : "",
        ]
          .filter(Boolean)
          .join("; ");
        steps.push(stepFail("collect_stream", err, { statusLabels, hasDone }));
        failedStep = "collect_stream";
        artifacts.stream = { statusLabels, donePayload, rawLength: rawSSE.length };
        return buildResult(false, failedStep, steps, artifacts);
      }

      // ------------------------------------------------------------------
      // D-12.1: status event ordering - 分析圖片中 must come before 記錄餐點中
      // ------------------------------------------------------------------
      const statusEvents = sseEvents.filter((e) => e.event === "status");
      const analysisIdx = statusEvents.findIndex((e) => {
        try {
          return (JSON.parse(e.data) as { label: string }).label.includes("分析圖片中");
        } catch {
          return false;
        }
      });
      const loggingIdx = statusEvents.findIndex((e) => {
        try {
          return (JSON.parse(e.data) as { label: string }).label.includes("記錄餐點中");
        } catch {
          return false;
        }
      });

      if (analysisIdx === -1 || loggingIdx === -1 || analysisIdx >= loggingIdx) {
        steps.push(stepFail(
          "collect_stream_order",
          `D-12.1 failed: analysisIdx=${analysisIdx} loggingIdx=${loggingIdx}`,
          { analysisIdx, loggingIdx },
        ));
        failedStep = "collect_stream_order";
        artifacts.stream = { statusLabels, donePayload, rawLength: rawSSE.length, analysisIdx, loggingIdx };
        return buildResult(false, failedStep, steps, artifacts);
      }

      // ------------------------------------------------------------------
      // D-12.2: done.didLogMeal === true; verify_meals cross-checks the row.
      // ------------------------------------------------------------------
      if (donePayload.didLogMeal !== true) {
        steps.push(stepFail("collect_stream_didlogmeal", "D-12.2 failed: done.didLogMeal is not true", { donePayload }));
        failedStep = "collect_stream_didlogmeal";
        artifacts.stream = { statusLabels, donePayload, rawLength: rawSSE.length, analysisIdx, loggingIdx };
        return buildResult(false, failedStep, steps, artifacts);
      }

      if (!hasValidDailySummaryDate(donePayload.dailySummary)) {
        steps.push(stepFail(
          "collect_stream_summary_date",
          `Expected done.dailySummary.date to match YYYY-MM-DD, got ${String(donePayload.dailySummary?.date)}`,
          { donePayload },
        ));
        failedStep = "collect_stream_summary_date";
        artifacts.stream = { statusLabels, donePayload, rawLength: rawSSE.length, analysisIdx, loggingIdx };
        return buildResult(false, failedStep, steps, artifacts);
      }

      steps.push(
        stepOk("collect_stream", { statusLabels, donePayload, d12_order_ok: true, analysisIdx, loggingIdx }),
      );
      artifacts.stream = { statusLabels, donePayload, rawLength: rawSSE.length, analysisIdx, loggingIdx };

      // ------------------------------------------------------------------
      // Step: verify_history
      // ------------------------------------------------------------------
      const historyRes = await fetch(
        `${scenarioCtx.address}/api/chat/history?limit=10`,
        { headers: { cookie: scenarioCtx.cookieHeader } },
      );
      if (historyRes.status !== 200) {
        steps.push(stepFail("verify_history", `HTTP ${historyRes.status}`));
        failedStep = "verify_history";
        return buildResult(false, failedStep, steps, artifacts);
      }
      const historyJson = await historyRes.json() as {
        messages: Array<{ role: string; content: string } & ImageAssetDto>;
      };
      const persistedHistory = await scenarioCtx.services.chatService.getHistory(
        scenarioCtx.deviceId,
        10,
      );
      const assistantMsgs = historyJson.messages.filter((m) => m.role === "assistant");
      if (assistantMsgs.length === 0) {
        steps.push(stepFail("verify_history", "no assistant message persisted", historyJson));
        failedStep = "verify_history";
        artifacts.history = historyJson;
        return buildResult(false, failedStep, steps, artifacts);
      }
      const userMessage = historyJson.messages.find((m) => m.role === "user");
      const persistedUserMessage = persistedHistory.find((m) => m.role === "user");
      if (!userMessage) {
        steps.push(stepFail("verify_history", "no user image message persisted", historyJson));
        failedStep = "verify_history";
        artifacts.history = historyJson;
        return buildResult(false, failedStep, steps, artifacts);
      }
      if (!/^asset:/.test(userMessage.imagePath ?? "")) {
        steps.push(stepFail("verify_history", "expected user imagePath to use asset:<id>", userMessage));
        failedStep = "verify_history";
        artifacts.history = historyJson;
        return buildResult(false, failedStep, steps, artifacts);
      }
      if (!/^asset:/.test(persistedUserMessage?.imagePath ?? "")) {
        steps.push(stepFail(
          "verify_history",
          "expected persisted user imagePath to use asset:<id>",
          persistedUserMessage,
        ));
        failedStep = "verify_history";
        artifacts.history = { ...historyJson, persistedMessages: persistedHistory };
        return buildResult(false, failedStep, steps, artifacts);
      }
      steps.push(stepOk("verify_history", {
        messageCount: historyJson.messages.length,
        d12_3_done_before_history_check: true,
      }));
      artifacts.history = {
        ...historyJson,
        persistedMessages: persistedHistory,
        messageCount: historyJson.messages.length,
        d12_3_verified: true,
      };

      // ------------------------------------------------------------------
      // Step: verify_meals
      // ------------------------------------------------------------------
      const mealsRes = await fetch(`${scenarioCtx.address}/api/meals`, {
        headers: { cookie: scenarioCtx.cookieHeader },
      });
      if (mealsRes.status !== 200) {
        steps.push(stepFail("verify_meals", `HTTP ${mealsRes.status}`));
        failedStep = "verify_meals";
        return buildResult(false, failedStep, steps, artifacts);
      }
      const mealsJson = await mealsRes.json() as {
        meals: Array<{ foodName: string } & ImageAssetDto>;
      };
      const persistedMeals = await scenarioCtx.services.foodLoggingService.getMealsByDate(
        scenarioCtx.deviceId,
        new Date(),
      );
      const loggedMeal = mealsJson.meals.find((m) => m.foodName === "豬肉燒烤飯盒");
      const persistedMeal = persistedMeals.find((m) => m.foodName === "豬肉燒烤飯盒");
      if (!loggedMeal) {
        steps.push(stepFail("verify_meals", "豬肉燒烤飯盒 not found in meals", mealsJson));
        failedStep = "verify_meals";
        artifacts.meals = mealsJson;
        return buildResult(false, failedStep, steps, artifacts);
      }
      if (!/^asset:/.test(loggedMeal.imageAssetId ? `asset:${loggedMeal.imageAssetId}` : "")) {
        steps.push(stepFail("verify_meals", "expected meal imageAssetId to be populated", loggedMeal));
        failedStep = "verify_meals";
        artifacts.meals = mealsJson;
        return buildResult(false, failedStep, steps, artifacts);
      }
      if (!/^asset:/.test(persistedMeal?.imagePath ?? "")) {
        steps.push(stepFail(
          "verify_meals",
          "expected persisted meal imagePath to use asset:<id>",
          persistedMeal,
        ));
        failedStep = "verify_meals";
        artifacts.meals = { ...mealsJson, persistedMeals };
        return buildResult(false, failedStep, steps, artifacts);
      }
      steps.push(stepOk("verify_meals", { mealCount: mealsJson.meals.length, d12_2_verified: true }));
      artifacts.meals = {
        ...mealsJson,
        persistedMeals,
        mealCount: mealsJson.meals.length,
        loggedMeal,
        d12_2_verified: true,
      };

      // ------------------------------------------------------------------
      // Step: verify_asset_fetch
      // ------------------------------------------------------------------
      const assetUrl = userMessage.imageUrl ?? loggedMeal.imageUrl;
      if (!assetUrl) {
        steps.push(stepFail("verify_asset_fetch", "missing imageUrl on asset-backed row", { userMessage, loggedMeal }));
        failedStep = "verify_asset_fetch";
        return buildResult(false, failedStep, steps, artifacts);
      }

      const assetRes = await fetch(`${scenarioCtx.address}${assetUrl}`, {
        headers: { cookie: scenarioCtx.cookieHeader },
      });
      if (assetRes.status !== 200) {
        steps.push(stepFail("verify_asset_fetch", `HTTP ${assetRes.status}`, { assetUrl }));
        failedStep = "verify_asset_fetch";
        artifacts.asset_fetch = { assetUrl, status: assetRes.status };
        return buildResult(false, failedStep, steps, artifacts);
      }
      steps.push(stepOk("verify_asset_fetch", {
        assetUrl,
        status: assetRes.status,
        contentType: assetRes.headers.get("content-type"),
      }));
      artifacts.asset_fetch = {
        assetUrl,
        status: assetRes.status,
        contentType: assetRes.headers.get("content-type"),
      };
    } finally {
      await scenarioCtx.close();
      try {
        uploadFilesBeforeCleanup = await readdir(SCENARIO_UPLOADS_DIR);
      } catch {
        uploadFilesBeforeCleanup = [];
      }
      await rm(SCENARIO_UPLOADS_DIR, { recursive: true, force: true });
      await rm(SCENARIO_ASSETS_DIR, { recursive: true, force: true });
    }

    // ------------------------------------------------------------------
    // Step: cleanup_uploads
    // ------------------------------------------------------------------
    artifacts.uploads_before_cleanup = { files: uploadFilesBeforeCleanup };

    // Verify the directory is gone (no residual files).
    let residualFiles: string[] = [];
    try {
      residualFiles = await readdir(SCENARIO_UPLOADS_DIR);
    } catch {
      // Expected: directory no longer exists
      residualFiles = [];
    }

    const cleanupOk = residualFiles.length === 0;
    const cleanupEvidence = {
      removedDir: SCENARIO_UPLOADS_DIR,
      filesBeforeCleanup: uploadFilesBeforeCleanup.length,
      residualFiles: residualFiles.length,
      directoryRemoved: cleanupOk,
    };
    artifacts.cleanup_uploads = cleanupEvidence;

    if (!cleanupOk) {
      steps.push(stepFail("cleanup_uploads", `${residualFiles.length} residual files remain`, cleanupEvidence));
      failedStep = "cleanup_uploads";
      return buildResult(false, failedStep, steps, artifacts);
    }

    steps.push(stepOk("cleanup_uploads", cleanupEvidence));

    return buildResult(true, undefined, steps, artifacts);
  },
};

function buildResult(
  ok: boolean,
  failedStep: string | undefined,
  steps: ScenarioStepResult[],
  artifacts: Record<string, unknown>,
): ScenarioResult {
  const passed = steps.filter((s) => s.ok).length;
  const total = steps.length;
  const consoleSummary = ok
    ? `PASS image-log ${passed}/${total}`
    : `FAIL image-log ${failedStep ?? "unknown"}`;
  return { ok, failedStep, steps, artifacts, consoleSummary };
}

export default scenario;
