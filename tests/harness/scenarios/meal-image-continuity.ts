/**
 * Deterministic meal image continuity scenario.
 *
 * Proves one uploaded meal image remains tied to the same meal transaction
 * identity across Chat receipt, Chat history, today's meals, History Day,
 * Meal Edit payload evidence, authorized asset fetch, and staged upload
 * cleanup.
 */

import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readdir, rm } from "node:fs/promises";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { validJpegBytes } from "../../fixtures/image-bytes.js";
import { buildHistoryMealEditPayload } from "../../../client/src/meal-edit-payload.js";
import { buildPositiveScenarioResult } from "../positive-metadata.js";
import type { MealEntry } from "../../../client/src/types.js";
import type {
  ScenarioContext,
  ScenarioResult,
  ScenarioStepResult,
  VerificationScenario,
} from "../scenario-types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_DIR = path.resolve(__dirname, "..", "tmp", "meal-image-continuity");
const UPLOADS_DIR = path.join(SCENARIO_DIR, "uploads");
const ASSETS_DIR = path.join(SCENARIO_DIR, "assets");

const STEP_NAMES = [
  "bootstrap",
  "upload_log_image",
  "capture_chat_receipt",
  "verify_chat_history",
  "verify_today_records",
  "verify_history_day",
  "verify_meal_edit_payload",
  "verify_asset_fetch",
  "verify_asset_identity_boundary",
  "verify_upload_cleanup",
] as const;

type StepName = (typeof STEP_NAMES)[number];

interface LoggedMealIdentity {
  mealId: string;
  imageAssetId: string;
  imageUrl: string;
  dateKey: string;
}

interface LoggedMealReceiptDto {
  mealId?: string;
  dateKey?: string;
  loggedAt?: string;
  imageAssetId?: string | null;
  imageUrl?: string | null;
  foodName?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

interface ChatHistoryResponse {
  messages: Array<{
    id?: string;
    role: string;
    content: string;
    loggedMeal?: LoggedMealReceiptDto;
    imageAssetId?: string | null;
    imageUrl?: string | null;
  }>;
}

interface MealRecordDto {
  id: string;
  mealRevisionId?: string;
  foodName?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  itemCount?: number;
  loggedAt?: string;
  imageAssetId?: string | null;
  imageUrl?: string | null;
  asset?: { imageAssetId?: string | null; imageUrl?: string | null };
  display?: { title?: string };
  nutrition?: { calories?: number; protein?: number; carbs?: number; fat?: number };
}

interface MealsResponse {
  meals: MealRecordDto[];
}

interface HistoryDayResponse {
  date: string;
  summary: unknown;
  meals: MealRecordDto[];
}

function pass(name: StepName, actual?: unknown): ScenarioStepResult {
  return { name, ok: true, actual };
}

function fail(name: StepName, error: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: false, error, actual };
}

function failResult(
  steps: ScenarioStepResult[],
  failedStepName: StepName,
  artifacts: Record<string, unknown>,
): ScenarioResult {
  return buildPositiveScenarioResult("meal-image-continuity", false, steps, failedStepName, {
    counts: { expectedStepCount: STEP_NAMES.length },
    assertions: { detailedChecksCompleted: Object.keys(artifacts).length > 0 },
  });
}

function passResult(steps: ScenarioStepResult[], artifacts: Record<string, unknown>): ScenarioResult {
  return buildPositiveScenarioResult("meal-image-continuity", true, steps, undefined, {
    counts: { expectedStepCount: STEP_NAMES.length },
    assertions: { detailedChecksCompleted: Object.keys(artifacts).length === STEP_NAMES.length },
  });
}

function makeJpegBytes(): ArrayBuffer {
  return validJpegBytes();
}

async function resetScenarioDirs(): Promise<void> {
  await rm(SCENARIO_DIR, { recursive: true, force: true });
  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(ASSETS_DIR, { recursive: true });
}

async function waitForRouteFinally(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
}

async function readUploadsDir(): Promise<string[]> {
  try {
    return await readdir(UPLOADS_DIR);
  } catch {
    return [];
  }
}

function parseDonePayload(rawSSE: string): {
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  loggedMeal?: LoggedMealReceiptDto;
} {
  const doneEvent = parseSSEEvents(rawSSE).find((event) => event.event === "done");
  if (!doneEvent) {
    return {};
  }
  return JSON.parse(doneEvent.data) as {
    didLogMeal?: boolean;
    didMutateMeal?: boolean;
    loggedMeal?: LoggedMealReceiptDto;
  };
}

function requireReceiptIdentity(receipt: LoggedMealReceiptDto | undefined): LoggedMealIdentity | null {
  if (
    typeof receipt?.mealId !== "string" ||
    typeof receipt.imageAssetId !== "string" ||
    typeof receipt.imageUrl !== "string" ||
    typeof receipt.dateKey !== "string"
  ) {
    return null;
  }

  return {
    mealId: receipt.mealId,
    imageAssetId: receipt.imageAssetId,
    imageUrl: receipt.imageUrl,
    dateKey: receipt.dateKey,
  };
}

function getMealImageAssetId(meal: MealRecordDto): string | null {
  return meal.imageAssetId ?? meal.asset?.imageAssetId ?? null;
}

function getMealImageUrl(meal: MealRecordDto): string | null {
  return meal.imageUrl ?? meal.asset?.imageUrl ?? null;
}

function toClientMealEntry(meal: MealRecordDto): MealEntry {
  return {
    id: meal.id,
    mealRevisionId: meal.mealRevisionId,
    foodName: meal.display?.title ?? meal.foodName ?? "未命名餐點",
    calories: meal.nutrition?.calories ?? meal.calories ?? 0,
    protein: meal.nutrition?.protein ?? meal.protein ?? 0,
    carbs: meal.nutrition?.carbs ?? meal.carbs ?? 0,
    fat: meal.nutrition?.fat ?? meal.fat ?? 0,
    itemCount: typeof meal.itemCount === "number" && Number.isFinite(meal.itemCount) && meal.itemCount > 0
      ? Math.floor(meal.itemCount)
      : 1,
    imageAssetId: getMealImageAssetId(meal),
    imageUrl: getMealImageUrl(meal),
    loggedAt: meal.loggedAt ?? "",
  };
}

function findMealByIdentity(meals: MealRecordDto[], identity: LoggedMealIdentity): MealRecordDto | undefined {
  return meals.find((meal) => meal.id === identity.mealId);
}

function assertMealIdentity(meal: MealRecordDto | undefined, identity: LoggedMealIdentity): {
  ok: boolean;
  reason?: string;
  actual?: unknown;
} {
  if (!meal) {
    return { ok: false, reason: `missing meal id ${identity.mealId}` };
  }
  if (getMealImageAssetId(meal) !== identity.imageAssetId) {
    return {
      ok: false,
      reason: "imageAssetId mismatch",
      actual: { expected: identity.imageAssetId, actual: getMealImageAssetId(meal), meal },
    };
  }
  if (getMealImageUrl(meal) !== identity.imageUrl) {
    return {
      ok: false,
      reason: "imageUrl mismatch",
      actual: { expected: identity.imageUrl, actual: getMealImageUrl(meal), meal },
    };
  }
  return { ok: true, actual: meal };
}

function toCookieHeader(rawHeader: string | string[] | undefined) {
  const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

async function createFreshDevice(app: ScenarioContext["app"]): Promise<{ deviceId: string; cookieHeader: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/device",
    payload: { goal: "muscle_gain" },
  });

  if (res.statusCode !== 200 && res.statusCode !== 201) {
    throw new Error(`createFreshDevice failed with ${res.statusCode}: ${res.body}`);
  }

  return {
    deviceId: (res.json() as { deviceId: string }).deviceId,
    cookieHeader: toCookieHeader(res.headers["set-cookie"]),
  };
}

const scenario: VerificationScenario = {
  name: "meal-image-continuity",

  async prepareApp() {
    const llm = new StreamingLLMProvider();
    await mkdir(UPLOADS_DIR, { recursive: true });
    await mkdir(ASSETS_DIR, { recursive: true });
    return {
      appOptions: { llmProvider: llm, uploadsDir: UPLOADS_DIR, assetsDir: ASSETS_DIR },
      state: { llm },
    };
  },

  async run(ctx: ScenarioContext): Promise<ScenarioResult> {
    const steps: ScenarioStepResult[] = [];
    const artifacts: Record<string, unknown> = {};
    let streamReader: ReadableStreamDefaultReader<Uint8Array> | undefined;

    await resetScenarioDirs();

    const { llm } = ctx.prepared as { llm: StreamingLLMProvider };
    llm.queueRoundResponse({
      toolCalls: [
        {
          id: "call_meal_image_continuity_log",
          type: "function",
          function: {
            name: "log_food",
            arguments: JSON.stringify({
              items: [
                {
                  food_name: "雞腿便當",
                  calories: 720,
                  protein: 42,
                  carbs: 88,
                  fat: 24,
                },
              ],
            }),
          },
        },
      ],
    });
    llm.queueChatStream(["已依照片完成記錄：", "雞腿便當約 720 kcal。"]);

    const fixture = ctx;

    try {
      const bootstrapRes = await fetch(`${fixture.address}/api/meals`, {
        headers: { cookie: fixture.cookieHeader },
      });
      if (bootstrapRes.status !== 200) {
        steps.push(fail("bootstrap", `Expected 200 from /api/meals, got ${bootstrapRes.status}`));
        return failResult(steps, "bootstrap", artifacts);
      }
      steps.push(pass("bootstrap", { status: bootstrapRes.status }));

      const form = new FormData();
      form.append("message", "請幫我記錄這張午餐照片");
      form.append(
        "image",
        new Blob([makeJpegBytes()], { type: "image/jpeg" }),
        "continuity-lunch.jpg",
      );

      const chatRes = await fetch(`${fixture.address}/api/chat`, {
        method: "POST",
        headers: {
          cookie: fixture.cookieHeader,
          Accept: "text/event-stream",
        },
        body: form,
      });

      if (chatRes.status !== 200 || !chatRes.body) {
        artifacts.upload_log_image = { status: chatRes.status };
        steps.push(fail("upload_log_image", `Expected 200 with SSE body, got ${chatRes.status}`));
        return failResult(steps, "upload_log_image", artifacts);
      }
      steps.push(pass("upload_log_image", { status: chatRes.status }));
      artifacts.upload_log_image = {
        request: { method: "POST", url: "/api/chat", accept: "text/event-stream", fileName: "continuity-lunch.jpg" },
        response: { status: chatRes.status, contentType: chatRes.headers.get("content-type") },
      };

      streamReader = chatRes.body.getReader();
      const rawSSE = await readStreamUntilEvent(streamReader, "done", 60);
      const sseEvents = parseSSEEvents(rawSSE);
      const donePayload = parseDonePayload(rawSSE);
      const identity = requireReceiptIdentity(donePayload.loggedMeal);
      artifacts.capture_chat_receipt = {
        rawSSE,
        sseEvents,
        donePayload,
        parsedIdentity: identity,
      };

      if (donePayload.didLogMeal !== true || !identity) {
        steps.push(fail("capture_chat_receipt", "SSE done payload did not include complete loggedMeal identity", {
          didLogMeal: donePayload.didLogMeal,
          loggedMeal: donePayload.loggedMeal,
        }));
        return failResult(steps, "capture_chat_receipt", artifacts);
      }
      steps.push(pass("capture_chat_receipt", {
        receiptMealId: identity.mealId,
        receiptImageAssetId: identity.imageAssetId,
        receiptImageUrl: identity.imageUrl,
        receiptDateKey: identity.dateKey,
      }));

      const historyRes = await fetch(`${fixture.address}/api/chat/history?limit=10`, {
        headers: { cookie: fixture.cookieHeader },
      });
      const historyJson = await historyRes.json() as ChatHistoryResponse;
      const assistantReceipt = historyJson.messages.find(
        (message) => message.loggedMeal?.mealId === identity.mealId,
      );
      artifacts.verify_chat_history = { status: historyRes.status, historyJson, assistantReceipt };
      if (historyRes.status !== 200 || assistantReceipt?.loggedMeal?.imageAssetId !== identity.imageAssetId) {
        steps.push(fail("verify_chat_history", "Chat history receipt did not preserve the SSE identity", {
          status: historyRes.status,
          assistantReceipt,
          identity,
        }));
        return failResult(steps, "verify_chat_history", artifacts);
      }
      steps.push(pass("verify_chat_history", {
        mealId: assistantReceipt.loggedMeal.mealId,
        imageAssetId: assistantReceipt.loggedMeal.imageAssetId,
        imageUrl: assistantReceipt.loggedMeal.imageUrl,
      }));

      const mealsRes = await fetch(`${fixture.address}/api/meals`, {
        headers: { cookie: fixture.cookieHeader },
      });
      const mealsJson = await mealsRes.json() as MealsResponse;
      const todayMeal = findMealByIdentity(mealsJson.meals, identity);
      const todayIdentity = assertMealIdentity(todayMeal, identity);
      artifacts.verify_today_records = { status: mealsRes.status, mealsJson, matchedMeal: todayMeal };
      if (mealsRes.status !== 200 || !todayIdentity.ok) {
        steps.push(fail("verify_today_records", todayIdentity.reason ?? `HTTP ${mealsRes.status}`, todayIdentity.actual));
        return failResult(steps, "verify_today_records", artifacts);
      }
      steps.push(pass("verify_today_records", todayIdentity.actual));

      const historyDayRes = await fetch(`${fixture.address}/api/history/days/${identity.dateKey}`, {
        headers: { cookie: fixture.cookieHeader },
      });
      const historyDayJson = await historyDayRes.json() as HistoryDayResponse;
      const historyDayMeal = findMealByIdentity(historyDayJson.meals, identity);
      const historyIdentity = assertMealIdentity(historyDayMeal, identity);
      artifacts.verify_history_day = { status: historyDayRes.status, historyDayJson, matchedMeal: historyDayMeal };
      if (historyDayRes.status !== 200 || !historyIdentity.ok) {
        steps.push(fail("verify_history_day", historyIdentity.reason ?? `HTTP ${historyDayRes.status}`, historyIdentity.actual));
        return failResult(steps, "verify_history_day", artifacts);
      }
      steps.push(pass("verify_history_day", historyIdentity.actual));

      const clientMealEntry = historyDayMeal ? toClientMealEntry(historyDayMeal) : null;
      const mealEditPayload = clientMealEntry ? buildHistoryMealEditPayload(clientMealEntry, identity.dateKey) : null;
      artifacts.verify_meal_edit_payload = {
        source: "client.buildHistoryMealEditPayload",
        clientMealEntry,
        mealEditPayload,
        chatReceiptPayload: assistantReceipt.loggedMeal,
      };
      if (
        !mealEditPayload ||
        mealEditPayload.mealId !== identity.mealId ||
        mealEditPayload.imageAssetId !== identity.imageAssetId ||
        mealEditPayload.imageUrl !== identity.imageUrl
      ) {
        steps.push(fail("verify_meal_edit_payload", "Meal Edit payload evidence did not preserve identity", {
          identity,
          mealEditPayload,
        }));
        return failResult(steps, "verify_meal_edit_payload", artifacts);
      }
      steps.push(pass("verify_meal_edit_payload", {
        mealId: mealEditPayload.mealId,
        imageAssetId: mealEditPayload.imageAssetId,
        imageUrl: mealEditPayload.imageUrl,
      }));

      const assetRes = await fetch(`${fixture.address}${identity.imageUrl}`, {
        headers: { cookie: fixture.cookieHeader },
      });
      const assetEvidence = {
        assetUrl: identity.imageUrl,
        status: assetRes.status,
        contentType: assetRes.headers.get("content-type"),
      };
      artifacts.verify_asset_fetch = assetEvidence;
      if (assetRes.status !== 200) {
        steps.push(fail("verify_asset_fetch", `Expected owning cookie asset fetch 200, got ${assetRes.status}`, assetEvidence));
        return failResult(steps, "verify_asset_fetch", artifacts);
      }
      steps.push(pass("verify_asset_fetch", assetEvidence));

      const foreignDevice = await createFreshDevice(fixture.app);
      const anonymousAssetRes = await fetch(`${fixture.address}${identity.imageUrl}`);
      const foreignAssetRes = await fetch(`${fixture.address}${identity.imageUrl}`, {
        headers: { cookie: foreignDevice.cookieHeader },
      });
      const spoofedForeignAssetRes = await fetch(
        `${fixture.address}${identity.imageUrl}?deviceId=${fixture.deviceId}`,
        {
          headers: {
            cookie: foreignDevice.cookieHeader,
            "x-device-id": fixture.deviceId,
          },
        },
      );
      const boundaryEvidence = {
        assetUrl: identity.imageUrl,
        ownerDeviceId: fixture.deviceId,
        foreignDeviceId: foreignDevice.deviceId,
        anonymousStatus: anonymousAssetRes.status,
        foreignCookieStatus: foreignAssetRes.status,
        spoofedForeignCookieStatus: spoofedForeignAssetRes.status,
      };
      artifacts.verify_asset_identity_boundary = boundaryEvidence;
      if (
        anonymousAssetRes.status !== 401 ||
        foreignAssetRes.status !== 404 ||
        spoofedForeignAssetRes.status !== 400
      ) {
        steps.push(fail(
          "verify_asset_identity_boundary",
          "Asset boundary must reject anonymous, foreign-cookie, and spoofed foreign-cookie reads",
          boundaryEvidence,
        ));
        return failResult(steps, "verify_asset_identity_boundary", artifacts);
      }
      steps.push(pass("verify_asset_identity_boundary", boundaryEvidence));

      await waitForRouteFinally();
      const residualUploads = await readUploadsDir();
      const cleanupEvidence = {
        residualUploads,
        residualCount: residualUploads.length,
      };
      artifacts.verify_upload_cleanup = cleanupEvidence;
      if (residualUploads.length !== 0) {
        steps.push(fail("verify_upload_cleanup", `Expected 0 staged upload files, found ${residualUploads.length}`, cleanupEvidence));
        return failResult(steps, "verify_upload_cleanup", artifacts);
      }
      steps.push(pass("verify_upload_cleanup", cleanupEvidence));

      return passResult(steps, artifacts);
    } finally {
      await streamReader?.cancel().catch(() => {});
      await rm(SCENARIO_DIR, { recursive: true, force: true });
    }
  },
};

export default scenario;
