/**
 * Boundary contracts harness scenarios.
 *
 * Sub-scenario A: upload-cleanup (success path)
 *   After a successful image-log round, uploaded file is deleted.
 *
 * Sub-scenario B: upload-cleanup-failure (failure path)
 *   When the orchestrator throws after multer writes the file, the finally
 *   block still deletes the file.
 *
 * Sub-scenario C: stale-publisher
 *   RealtimePublisher skips destroyed SSE connections and removes stale entries.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readdir, rm } from "node:fs/promises";
import type { FastifyReply } from "fastify";
import { createScenarioApp } from "../app-fixture.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import { RealtimePublisher } from "../../../server/realtime/publisher.js";
import type { createScenarioApp as createScenarioAppFn } from "../app-fixture.js";
import type {
  VerificationScenario,
  ScenarioContext,
  ScenarioResult,
  ScenarioStepResult,
} from "../scenario-types.js";

type ScenarioAppContext = Awaited<ReturnType<typeof createScenarioAppFn>>;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOADS_DIR = path.resolve(__dirname, "..", "tmp", "boundary-contracts", "uploads");
const ASSETS_DIR = path.resolve(__dirname, "..", "tmp", "boundary-contracts", "assets");
const ASSET_REF_PATTERN = /^asset:/;

interface ImageAssetDto {
  imagePath?: string | null;
  imageAssetId?: string | null;
  imageUrl?: string | null;
}

function pass(name: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: true, actual };
}

function fail(name: string, error: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: false, error, actual };
}

function failResult(
  scenarioName: string,
  steps: ScenarioStepResult[],
  failedStepName: string,
  artifacts: Record<string, unknown>,
): ScenarioResult {
  return {
    ok: false,
    failedStep: failedStepName,
    steps,
    artifacts,
    consoleSummary: `FAIL ${scenarioName} ${failedStepName}`,
  };
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

async function waitForFinally(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function assertUploadsEmpty(
  stepName: string,
  steps: ScenarioStepResult[],
  artifacts: Record<string, unknown>,
): Promise<boolean> {
  await waitForFinally();
  const remaining = await readdir(UPLOADS_DIR);
  artifacts[stepName] = { remaining };
  if (remaining.length !== 0) {
    steps.push(fail(stepName, `Expected 0 files in uploadsDir, found ${remaining.length}`, { remaining }));
    return false;
  }
  steps.push(pass(stepName, { remaining }));
  return true;
}

async function collectAssetEvidence(params: {
  address: string;
  cookieHeader: string;
  deviceId: string;
  assetService: ScenarioAppContext["services"]["assetService"];
  chatService: ScenarioAppContext["services"]["chatService"];
  foodLoggingService: ScenarioAppContext["services"]["foodLoggingService"];
  assetsDir: string;
}): Promise<{
  historyJson: { messages: Array<{ role: string; content: string } & ImageAssetDto> };
  mealsJson: { meals: Array<{ foodName: string } & ImageAssetDto> };
  persistedHistory: Array<{ role: string; content: string; imagePath?: string | null }>;
  persistedMeals: Array<{ foodName: string; imagePath?: string | null }>;
  assetRef: string | null;
  assetUrl: string | null;
  fetchStatus: number | null;
  fetchContentType: string | null;
  assetFilePath: string | null;
  assetRefReferenced: boolean | null;
  assetsDirEntries: string[];
}> {
  const historyRes = await fetch(`${params.address}/api/chat/history?limit=10`, {
    headers: { cookie: params.cookieHeader },
  });
  const historyJson = await historyRes.json() as {
    messages: Array<{ role: string; content: string } & ImageAssetDto>;
  };

  const mealsRes = await fetch(`${params.address}/api/meals`, {
    headers: { cookie: params.cookieHeader },
  });
  const mealsJson = await mealsRes.json() as {
    meals: Array<{ foodName: string } & ImageAssetDto>;
  };

  const persistedHistory = await params.chatService.getHistory(params.deviceId, 10);
  const persistedMeals = await params.foodLoggingService.getMealsByDate(params.deviceId, new Date());

  const userMessage = historyJson.messages.find((message) => message.role === "user" && message.imageAssetId);
  const meal = mealsJson.meals.find((entry) => entry.imageAssetId);
  const persistedUserMessage = persistedHistory.find((message) => message.role === "user" && ASSET_REF_PATTERN.test(message.imagePath ?? ""));
  const persistedMeal = persistedMeals.find((entry) => ASSET_REF_PATTERN.test(entry.imagePath ?? ""));
  const assetRow = persistedUserMessage ?? persistedMeal;

  const assetRef = assetRow?.imagePath ?? null;
  const assetUrl = userMessage?.imageUrl ?? meal?.imageUrl ?? null;
  let fetchStatus: number | null = null;
  let fetchContentType: string | null = null;
  let assetFilePath: string | null = null;
  let assetRefReferenced: boolean | null = null;

  if (assetRef) {
    const assetId = assetRef.slice("asset:".length);
    assetRefReferenced = await params.assetService.isAssetRefReferenced(assetRef);
    const ownedAsset = await params.assetService.getOwnedAsset(params.deviceId, assetId);
    assetFilePath = ownedAsset?.filePath ?? null;
  }

  if (assetUrl) {
    const assetRes = await fetch(`${params.address}${assetUrl}`, {
      headers: { cookie: params.cookieHeader },
    });
    fetchStatus = assetRes.status;
    fetchContentType = assetRes.headers.get("content-type");
  }

  const assetsDirEntries = await readdir(params.assetsDir);

  return {
    historyJson,
    mealsJson,
    persistedHistory,
    persistedMeals,
    assetRef,
    assetUrl,
    fetchStatus,
    fetchContentType,
    assetFilePath,
    assetRefReferenced,
    assetsDirEntries,
  };
}

async function runUploadCleanup(): Promise<ScenarioResult> {
  const scenarioName = "upload-cleanup";
  const steps: ScenarioStepResult[] = [];
  const artifacts: Record<string, unknown> = {};

  await rm(UPLOADS_DIR, { recursive: true, force: true });
  await mkdir(UPLOADS_DIR, { recursive: true });
  const assetsDir = `${ASSETS_DIR}-upload-cleanup`;
  await rm(assetsDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });

  const llm = new StreamingLLMProvider();
  llm.queueRoundResponse({
    toolCalls: [{
      id: "call_bc_img",
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify({ food_name: "蛋炒飯", calories: 450, protein: 12, carbs: 65, fat: 14 }),
      },
    }],
  });
  llm.queueChatStream(["已記錄", "蛋炒飯！"]);

  const fixture = await createScenarioApp({ llmProvider: llm, uploadsDir: UPLOADS_DIR, assetsDir });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    const pingRes = await fetch(`${fixture.address}/api/meals`, {
      headers: { cookie: fixture.cookieHeader },
    });
    if (pingRes.status !== 200) {
      steps.push(fail("bootstrap", `Expected 200, got ${pingRes.status}`));
      return failResult(scenarioName, steps, "bootstrap", artifacts);
    }
    steps.push(pass("bootstrap", { status: pingRes.status }));

    const form = new FormData();
    form.append("message", "");
    form.append("image", new Blob([makeJpegBytes()], { type: "image/jpeg" }), "meal.jpg");

    const chatRes = await fetch(`${fixture.address}/api/chat`, {
      method: "POST",
      headers: { cookie: fixture.cookieHeader, Accept: "text/event-stream" },
      body: form,
    });
    if (chatRes.status !== 200 || !chatRes.body) {
      steps.push(fail("post_image_chat", `Expected 200 with body, got ${chatRes.status}`));
      return failResult(scenarioName, steps, "post_image_chat", artifacts);
    }
    steps.push(pass("post_image_chat", { status: chatRes.status }));

    reader = chatRes.body.getReader();
    const rawSSE = await readStreamUntilEvent(reader, "done", 60);
    const doneEvent = parseSSEEvents(rawSSE).find((event) => event.event === "done");
    if (!doneEvent) {
      steps.push(fail("collect_stream", "No event: done in stream", { rawSSE }));
      return failResult(scenarioName, steps, "collect_stream", artifacts);
    }
    const donePayload = JSON.parse(doneEvent.data) as { didLogMeal?: boolean };
    if (donePayload.didLogMeal !== true) {
      steps.push(fail("collect_stream", "Expected didLogMeal true", { donePayload }));
      return failResult(scenarioName, steps, "collect_stream", artifacts);
    }
    steps.push(pass("collect_stream", { donePayload }));
    artifacts.stream = { events: parseSSEEvents(rawSSE) };

    const assetEvidence = await collectAssetEvidence({
      address: fixture.address,
      cookieHeader: fixture.cookieHeader,
      deviceId: fixture.deviceId,
      assetService: fixture.services.assetService,
      chatService: fixture.services.chatService,
      foodLoggingService: fixture.services.foodLoggingService,
      assetsDir,
    });
    if (!assetEvidence.assetRef || !ASSET_REF_PATTERN.test(assetEvidence.assetRef)) {
      steps.push(fail("verify_durable_asset", "Expected durable asset ref in persisted rows", assetEvidence));
      return failResult(scenarioName, steps, "verify_durable_asset", artifacts);
    }
    if (assetEvidence.fetchStatus !== 200) {
      steps.push(fail("verify_durable_asset", `Expected asset fetch 200, got ${assetEvidence.fetchStatus}`, assetEvidence));
      return failResult(scenarioName, steps, "verify_durable_asset", artifacts);
    }
    if (!assetEvidence.assetRefReferenced) {
      steps.push(fail("verify_durable_asset", "Expected durable asset ref to remain referenced", assetEvidence));
      return failResult(scenarioName, steps, "verify_durable_asset", artifacts);
    }
    const rawPaths = [
      ...assetEvidence.persistedHistory,
      ...assetEvidence.persistedMeals,
    ]
      .map((row) => row.imagePath ?? "")
      .filter((imagePath) => /\/uploads\//.test(imagePath));
    if (rawPaths.length > 0) {
      steps.push(fail("verify_durable_asset", "Expected no persisted raw /uploads/ paths", { rawPaths, assetEvidence }));
      return failResult(scenarioName, steps, "verify_durable_asset", artifacts);
    }
    if (assetEvidence.assetsDirEntries.length === 0) {
      steps.push(fail("verify_durable_asset", "Expected durable asset files to exist", assetEvidence));
      return failResult(scenarioName, steps, "verify_durable_asset", artifacts);
    }
    steps.push(pass("verify_durable_asset", assetEvidence));
    artifacts.durable_asset = assetEvidence;

    if (!(await assertUploadsEmpty("verify_upload_cleanup", steps, artifacts))) {
      return failResult(scenarioName, steps, "verify_upload_cleanup", artifacts);
    }

    return {
      ok: true,
      steps,
      artifacts,
      consoleSummary: `PASS ${scenarioName} ${steps.filter((step) => step.ok).length}/${steps.length}`,
    };
  } finally {
    await reader?.cancel().catch(() => {});
    await fixture.close();
    await rm(UPLOADS_DIR, { recursive: true, force: true });
    await rm(assetsDir, { recursive: true, force: true });
  }
}

async function runUploadCleanupFailure(): Promise<ScenarioResult> {
  const scenarioName = "upload-cleanup-failure";
  const steps: ScenarioStepResult[] = [];
  const artifacts: Record<string, unknown> = {};

  await rm(UPLOADS_DIR, { recursive: true, force: true });
  await mkdir(UPLOADS_DIR, { recursive: true });
  const assetsDir = `${ASSETS_DIR}-upload-cleanup-failure`;
  await rm(assetsDir, { recursive: true, force: true });
  await mkdir(assetsDir, { recursive: true });

  const llm = new StreamingLLMProvider();
  llm.queueRoundError(new Error("forced orchestrator failure for C4"));

  const fixture = await createScenarioApp({ llmProvider: llm, uploadsDir: UPLOADS_DIR, assetsDir });
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;

  try {
    const pingRes = await fetch(`${fixture.address}/api/meals`, {
      headers: { cookie: fixture.cookieHeader },
    });
    if (pingRes.status !== 200) {
      steps.push(fail("bootstrap", `Expected 200, got ${pingRes.status}`));
      return failResult(scenarioName, steps, "bootstrap", artifacts);
    }
    steps.push(pass("bootstrap", { status: pingRes.status }));

    const form = new FormData();
    form.append("message", "");
    form.append("image", new Blob([makeJpegBytes()], { type: "image/jpeg" }), "meal-failure.jpg");

    const chatRes = await fetch(`${fixture.address}/api/chat`, {
      method: "POST",
      headers: { cookie: fixture.cookieHeader, Accept: "text/event-stream" },
      body: form,
    });
    if (!chatRes.body) {
      steps.push(fail("post_image_chat_failure", `Expected response body, got status ${chatRes.status}`));
      return failResult(scenarioName, steps, "post_image_chat_failure", artifacts);
    }
    steps.push(pass("post_image_chat_failure", { status: chatRes.status }));

    reader = chatRes.body.getReader();
    const rawSSE = await readStreamUntilEvent(reader, "done", 60);
    const doneEvent = parseSSEEvents(rawSSE).find((event) => event.event === "done");
    if (!doneEvent) {
      steps.push(fail("collect_stream_or_error", "No terminal event: done in stream", { rawSSE }));
      return failResult(scenarioName, steps, "collect_stream_or_error", artifacts);
    }
    steps.push(pass("collect_stream_or_error", { events: parseSSEEvents(rawSSE) }));
    artifacts.stream = { events: parseSSEEvents(rawSSE) };

    const assetEvidence = await collectAssetEvidence({
      address: fixture.address,
      cookieHeader: fixture.cookieHeader,
      deviceId: fixture.deviceId,
      assetService: fixture.services.assetService,
      chatService: fixture.services.chatService,
      foodLoggingService: fixture.services.foodLoggingService,
      assetsDir,
    });
    if (assetEvidence.assetRef) {
      if (!ASSET_REF_PATTERN.test(assetEvidence.assetRef)) {
        steps.push(fail("verify_durable_asset_on_failure", "Expected durable asset ref on failure path", assetEvidence));
        return failResult(scenarioName, steps, "verify_durable_asset_on_failure", artifacts);
      }
      if (!assetEvidence.assetRefReferenced) {
        steps.push(fail("verify_durable_asset_on_failure", "Expected failure path asset ref to remain referenced", assetEvidence));
        return failResult(scenarioName, steps, "verify_durable_asset_on_failure", artifacts);
      }
      const rawPaths = [
        ...assetEvidence.persistedHistory,
        ...assetEvidence.persistedMeals,
      ]
        .map((row) => row.imagePath ?? "")
        .filter((imagePath) => /\/uploads\//.test(imagePath));
      if (rawPaths.length > 0) {
        steps.push(fail("verify_durable_asset_on_failure", "Expected no persisted raw /uploads/ paths", { rawPaths, assetEvidence }));
        return failResult(scenarioName, steps, "verify_durable_asset_on_failure", artifacts);
      }
      if (assetEvidence.fetchStatus !== 200) {
        steps.push(fail("verify_durable_asset_on_failure", `Expected asset fetch 200, got ${assetEvidence.fetchStatus}`, assetEvidence));
        return failResult(scenarioName, steps, "verify_durable_asset_on_failure", artifacts);
      }
    } else if (assetEvidence.fetchStatus !== null) {
      steps.push(fail("verify_durable_asset_on_failure", "Unexpected asset fetch without asset ref", assetEvidence));
      return failResult(scenarioName, steps, "verify_durable_asset_on_failure", artifacts);
    }
    if (assetEvidence.assetRef && assetEvidence.assetsDirEntries.length === 0) {
      steps.push(fail("verify_durable_asset_on_failure", "Expected durable asset files to remain for referenced asset", assetEvidence));
      return failResult(scenarioName, steps, "verify_durable_asset_on_failure", artifacts);
    }
    steps.push(pass("verify_durable_asset_on_failure", assetEvidence));
    artifacts.durable_asset = assetEvidence;

    if (!(await assertUploadsEmpty("verify_upload_cleanup_on_failure", steps, artifacts))) {
      return failResult(scenarioName, steps, "verify_upload_cleanup_on_failure", artifacts);
    }

    return {
      ok: true,
      steps,
      artifacts,
      consoleSummary: `PASS ${scenarioName} ${steps.filter((step) => step.ok).length}/${steps.length}`,
    };
  } finally {
    await reader?.cancel().catch(() => {});
    await fixture.close();
    await rm(UPLOADS_DIR, { recursive: true, force: true });
    await rm(assetsDir, { recursive: true, force: true });
  }
}

async function runStalePublisher(): Promise<ScenarioResult> {
  const scenarioName = "stale-publisher";
  const steps: ScenarioStepResult[] = [];
  const artifacts: Record<string, unknown> = {};
  const deviceId = "test-device-stale-bc";
  const summary = {
    totalCalories: 0,
    totalProtein: 0,
    totalCarbs: 0,
    totalFat: 0,
    mealCount: 0,
    date: "2026-03-25",
  };
  const summaryPayload = {
    summary,
    affectedDate: summary.date,
    source: "meal_mutation" as const,
  };

  const publisher = new RealtimePublisher();
  steps.push(pass("create_publisher"));

  const writeLog: string[] = [];
  const mockDestroyed = {
    raw: {
      destroyed: true,
      write(_data: string): boolean {
        throw new Error("must not write to destroyed connection");
      },
    },
  } as unknown as FastifyReply;
  const mockLive = {
    raw: {
      destroyed: false,
      write(data: string): boolean {
        writeLog.push(data);
        return true;
      },
    },
  } as unknown as FastifyReply;

  publisher.subscribe(deviceId, mockDestroyed);
  publisher.subscribe(deviceId, mockLive);
  steps.push(pass("subscribe_connections", { subscribed: 2 }));

  try {
    publisher.publishDailySummary(deviceId, summaryPayload);
  } catch (err) {
    steps.push(fail("publish_with_stale", `publishDailySummary threw: ${err instanceof Error ? err.message : String(err)}`));
    return failResult(scenarioName, steps, "publish_with_stale", artifacts);
  }
  if (writeLog.length !== 1) {
    steps.push(fail("publish_with_stale", `Expected 1 live write, got ${writeLog.length}`, { writeLog }));
    return failResult(scenarioName, steps, "publish_with_stale", artifacts);
  }
  steps.push(pass("publish_with_stale", { writesAfterFirst: writeLog.length }));

  try {
    publisher.publishDailySummary(deviceId, summaryPayload);
  } catch (err) {
    steps.push(fail("verify_stale_removed", `Second publishDailySummary threw: ${err instanceof Error ? err.message : String(err)}`));
    return failResult(scenarioName, steps, "verify_stale_removed", artifacts);
  }
  const totalWrites = writeLog.length as number;
  if (totalWrites !== 2) {
    steps.push(fail("verify_stale_removed", `Expected 2 total live writes, got ${totalWrites}`, { writeLog }));
    return failResult(scenarioName, steps, "verify_stale_removed", artifacts);
  }

  artifacts.writeLog = writeLog;
  steps.push(pass("verify_stale_removed", { totalWrites }));

  return {
    ok: true,
    steps,
    artifacts,
    consoleSummary: `PASS ${scenarioName} ${steps.filter((step) => step.ok).length}/${steps.length}`,
  };
}

const scenario: VerificationScenario = {
  name: "boundary-contracts",

  async run(_ctx: ScenarioContext): Promise<ScenarioResult> {
    const steps: ScenarioStepResult[] = [];
    const artifacts: Record<string, unknown> = {};

    const uploadResult = await runUploadCleanup();
    steps.push(...uploadResult.steps.map((step) => ({ ...step, name: `upload-cleanup:${step.name}` })));
    artifacts.uploadCleanup = uploadResult.artifacts;
    if (!uploadResult.ok) {
      return failResult("boundary-contracts", steps, `upload-cleanup:${uploadResult.failedStep ?? "unknown"}`, artifacts);
    }

    const uploadFailureResult = await runUploadCleanupFailure();
    steps.push(...uploadFailureResult.steps.map((step) => ({ ...step, name: `upload-cleanup-failure:${step.name}` })));
    artifacts.uploadCleanupFailure = uploadFailureResult.artifacts;
    if (!uploadFailureResult.ok) {
      return failResult("boundary-contracts", steps, `upload-cleanup-failure:${uploadFailureResult.failedStep ?? "unknown"}`, artifacts);
    }

    const stalePublisherResult = await runStalePublisher();
    steps.push(...stalePublisherResult.steps.map((step) => ({ ...step, name: `stale-publisher:${step.name}` })));
    artifacts.stalePublisher = stalePublisherResult.artifacts;
    if (!stalePublisherResult.ok) {
      return failResult("boundary-contracts", steps, `stale-publisher:${stalePublisherResult.failedStep ?? "unknown"}`, artifacts);
    }

    return {
      ok: true,
      steps,
      artifacts,
      consoleSummary: `PASS boundary-contracts ${steps.filter((step) => step.ok).length}/${steps.length}`,
    };
  },
};

export default scenario;
