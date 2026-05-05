import type {
  ChatReply,
  DailySummary,
  DailyTargets,
  HistoryDaySnapshot,
  HistoryTrendResponse,
  IntakeData,
  IntakeResult,
  IntakeValidationIssue,
  LoggedMealReceipt,
  MealEntry,
  Message,
  CoachCTAIntentId,
  CoachCTAOptionId,
  UpdateMealInput,
  UpdateMealResponse,
} from "./types.js";
import { getEarliestValidationStep } from "./lib/onboarding-intake-validation.js";

export interface GuestSessionBootstrapResult {
  deviceId: string;
  goal: "fat_loss" | "muscle_gain";
  dailyTargets: DailyTargets;
  establishedBy: "active" | "resume" | "legacy_migration";
}

export class IntakeValidationError extends Error {
  readonly kind = "validation";

  constructor(
    readonly errors: IntakeValidationIssue[],
    readonly step: ReturnType<typeof getEarliestValidationStep>,
  ) {
    super("Failed to submit intake");
    this.name = "IntakeValidationError";
  }
}

const MOCK_NEXT_INTAKE_VALIDATION_ERROR_KEY = "nutritionCoach:mockNextIntakeValidationError";
const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
const CHAT_IMAGE_MAX_DIMENSION = 1600;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeItemCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 1;
}

function isIntakeValidationIssue(value: unknown): value is IntakeValidationIssue {
  return (
    isRecord(value) &&
    typeof value.field === "string" &&
    typeof value.code === "string" &&
    typeof value.step === "number" &&
    typeof value.message === "string"
  );
}

function isLoggedMealReceipt(value: unknown): value is LoggedMealReceipt {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.foodName === "string" &&
    value.foodName.trim().length > 0 &&
    typeof value.calories === "number" &&
    Number.isFinite(value.calories) &&
    typeof value.protein === "number" &&
    Number.isFinite(value.protein) &&
    typeof value.carbs === "number" &&
    Number.isFinite(value.carbs) &&
    typeof value.fat === "number" &&
    Number.isFinite(value.fat)
  ) {
    return (
      (value.mealId === undefined || typeof value.mealId === "string") &&
      (value.dateKey === undefined || typeof value.dateKey === "string") &&
      (value.loggedAt === undefined || typeof value.loggedAt === "string") &&
      (value.itemCount === undefined ||
        (typeof value.itemCount === "number" && Number.isFinite(value.itemCount) && value.itemCount > 0)) &&
      (value.imageAssetId === undefined || value.imageAssetId === null || typeof value.imageAssetId === "string") &&
      (value.imageUrl === undefined || value.imageUrl === null || typeof value.imageUrl === "string")
    );
  }

  return false;
}

function isDailySummary(value: unknown): value is DailySummary {
  return (
    isRecord(value) &&
    typeof value.date === "string" &&
    typeof value.totalCalories === "number" &&
    Number.isFinite(value.totalCalories) &&
    typeof value.totalProtein === "number" &&
    Number.isFinite(value.totalProtein) &&
    typeof value.totalCarbs === "number" &&
    Number.isFinite(value.totalCarbs) &&
    typeof value.totalFat === "number" &&
    Number.isFinite(value.totalFat) &&
    typeof value.mealCount === "number" &&
    Number.isFinite(value.mealCount)
  );
}

function isDailyTargets(value: unknown): value is DailyTargets {
  return (
    isRecord(value) &&
    typeof value.calories === "number" &&
    Number.isFinite(value.calories) &&
    typeof value.protein === "number" &&
    Number.isFinite(value.protein) &&
    typeof value.carbs === "number" &&
    Number.isFinite(value.carbs) &&
    typeof value.fat === "number" &&
    Number.isFinite(value.fat)
  );
}

async function readJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function getResponseErrorMessage(body: unknown): string | null {
  if (!isRecord(body) || typeof body.error !== "string" || !body.error.trim()) {
    return null;
  }

  return body.error;
}

function getImageExtension(filename: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(filename.trim());
  return match?.[1]?.toLowerCase() ?? "";
}

function getSupportedImageMimeType(file: File): "image/jpeg" | "image/png" | "image/webp" | null {
  if (file.type === "image/jpeg" || file.type === "image/png" || file.type === "image/webp") {
    return file.type;
  }

  const extension = getImageExtension(file.name);
  if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
  if (extension === "png") return "image/png";
  if (extension === "webp") return "image/webp";
  return null;
}

function normalizeSupportedImageFile(file: File): File {
  const mimeType = getSupportedImageMimeType(file);
  if (!mimeType) {
    throw new Error("目前只支援 JPG、PNG、WebP 照片。若是 iPhone HEIC，請先轉成 JPG 後再上傳。");
  }

  if (file.type === mimeType) {
    return file;
  }

  return new File([file], file.name, { type: mimeType, lastModified: file.lastModified });
}

function getUploadImageFilename(filename: string): string {
  const baseName = filename.replace(/\.[^.]+$/, "").trim() || "meal-photo";
  return `${baseName}.jpg`;
}

function canvasToBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }
        reject(new Error("圖片壓縮失敗，請先縮小照片後再上傳。"));
      },
      "image/jpeg",
      quality,
    );
  });
}

async function compressImageForUpload(file: File): Promise<File> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") {
    throw new Error("圖片超過 5MB，且目前環境無法自動壓縮。請先縮小照片後再上傳。");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("圖片壓縮失敗，請先縮小照片後再上傳。");
    }

    const initialScale = Math.min(1, CHAT_IMAGE_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
    let width = Math.max(1, Math.round(bitmap.width * initialScale));
    let height = Math.max(1, Math.round(bitmap.height * initialScale));
    const qualities = [0.82, 0.72, 0.62, 0.52, 0.44];

    for (let resizeAttempt = 0; resizeAttempt < 4; resizeAttempt += 1) {
      canvas.width = width;
      canvas.height = height;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, width, height);
      context.drawImage(bitmap, 0, 0, width, height);

      for (const quality of qualities) {
        const blob = await canvasToBlob(canvas, quality);
        if (blob.size <= MAX_CHAT_IMAGE_BYTES) {
          return new File([blob], getUploadImageFilename(file.name), {
            type: "image/jpeg",
            lastModified: file.lastModified,
          });
        }
      }

      width = Math.max(1, Math.round(width * 0.82));
      height = Math.max(1, Math.round(height * 0.82));
    }
  } finally {
    bitmap.close();
  }

  throw new Error("圖片仍超過 5MB，請先縮小照片後再上傳。");
}

async function prepareImageForUpload(file: File): Promise<File> {
  const normalized = normalizeSupportedImageFile(file);
  if (normalized.size <= MAX_CHAT_IMAGE_BYTES) {
    return normalized;
  }

  return compressImageForUpload(normalized);
}

type HomeCtaClientEventPayload =
  | { event: "home_cta_intent_selected"; intent: CoachCTAIntentId }
  | { event: "home_cta_option_sent"; intent: CoachCTAIntentId; promptKey: CoachCTAOptionId };

async function recordClientEvent(payload: HomeCtaClientEventPayload): Promise<void> {
  try {
    await fetch("/api/observability/client-event", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Observability is best-effort and must never block the CTA flow.
  }
}

export function recordHomeCtaIntentSelected(intent: CoachCTAIntentId): Promise<void> {
  return recordClientEvent({ event: "home_cta_intent_selected", intent });
}

export function recordHomeCtaOptionSent(intent: CoachCTAIntentId, promptKey: CoachCTAOptionId): Promise<void> {
  return recordClientEvent({ event: "home_cta_option_sent", intent, promptKey });
}

function isLocalDevelopmentRuntime(): boolean {
  const viteEnv = (import.meta as ImportMeta & { env?: { DEV?: boolean } }).env;
  if (viteEnv?.DEV === true) return true;

  return ["localhost", "127.0.0.1", "::1"].includes(globalThis.location?.hostname ?? "");
}

function consumeMockIntakeValidationError(): IntakeValidationIssue[] | null {
  if (!isLocalDevelopmentRuntime()) return null;

  const nextMock = globalThis.localStorage?.getItem(MOCK_NEXT_INTAKE_VALIDATION_ERROR_KEY);
  if (nextMock !== "goal") return null;

  globalThis.localStorage?.removeItem(MOCK_NEXT_INTAKE_VALIDATION_ERROR_KEY);
  return [
    {
      field: "goal",
      code: "INVALID_GOAL",
      step: 1,
      message: "請選擇有效的目標",
    },
  ];
}

export function withAuthorizedAssetUrl(
  assetUrl: string | null | undefined,
): string | null | undefined {
  if (!assetUrl || !assetUrl.startsWith("/api/assets/")) {
    return assetUrl;
  }

  const [pathname, queryString = ""] = assetUrl.split("?", 2);
  const params = new URLSearchParams(queryString);
  params.delete("deviceId");

  const nextQuery = params.toString();
  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}

function normalizeLoggedMealReceipt(receipt: LoggedMealReceipt): LoggedMealReceipt {
  return {
    ...receipt,
    itemCount: normalizeItemCount(receipt.itemCount),
    ...(receipt.imageUrl === undefined
      ? {}
      : { imageUrl: withAuthorizedAssetUrl(receipt.imageUrl) ?? null }),
  };
}

function normalizeChatReply<T extends { loggedMeal?: LoggedMealReceipt }>(reply: T): T {
  if (!reply.loggedMeal) {
    return reply;
  }

  return {
    ...reply,
    loggedMeal: normalizeLoggedMealReceipt(reply.loggedMeal),
  };
}

export async function registerDevice(goal: string): Promise<{ deviceId: string; dailyTargets: DailyTargets }> {
  const res = await fetch("/api/device", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ goal }),
  });
  if (!res.ok) throw new Error("Failed to register device");
  return res.json();
}

export async function submitIntake(data: IntakeData): Promise<IntakeResult> {
  const mockErrors = consumeMockIntakeValidationError();
  if (mockErrors) {
    throw new IntakeValidationError(mockErrors, getEarliestValidationStep(mockErrors));
  }

  const res = await fetch("/api/device", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

  if (!res.ok) {
    const body = await readJsonSafe(res);
    if (
      res.status === 400 &&
      isRecord(body) &&
      body.error === "VALIDATION_ERROR" &&
      Array.isArray(body.errors) &&
      body.errors.every(isIntakeValidationIssue)
    ) {
      throw new IntakeValidationError(body.errors, getEarliestValidationStep(body.errors));
    }

    throw new Error("Failed to submit intake");
  }

  return res.json();
}

export async function establishGuestSession(
  options?: { legacyDeviceId?: string | null },
): Promise<GuestSessionBootstrapResult> {
  const payload = options?.legacyDeviceId ? { legacyDeviceId: options.legacyDeviceId } : {};
  const res = await fetch("/api/device/session", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to establish guest session");
  return res.json() as Promise<GuestSessionBootstrapResult>;
}

export async function clearGuestSession(): Promise<void> {
  const res = await fetch("/api/device/session", {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (!res.ok) throw new Error("Failed to clear guest session");
}

export async function updateGoals(goals: Partial<DailyTargets>): Promise<{ dailyTargets: DailyTargets }> {
  const res = await fetch("/api/device/goals", {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(goals),
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to update goals");
  return res.json();
}

export async function sendMessage(message: string, image?: File): Promise<ChatReply> {
  const form = new FormData();
  form.append("message", message);
  if (image) {
    form.append("image", await prepareImageForUpload(image));
  }
  const res = await fetch("/api/chat", {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const errorMessage = getResponseErrorMessage(await readJsonSafe(res));
    throw new Error(errorMessage ?? "Failed to send message");
  }
  const body = await res.json() as ChatReply;
  return normalizeChatReply(body);
}

export async function loadHistory(limit = 50): Promise<{ messages: Message[] }> {
  const res = await fetch(`/api/chat/history?limit=${limit}`, { credentials: "same-origin" });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to load history");
  const body = await res.json() as { messages: Message[] };
  return {
    messages: body.messages.map((message) => ({
      ...message,
      imageUrl: withAuthorizedAssetUrl(message.imageUrl),
      loggedMeal: message.loggedMeal
        ? normalizeLoggedMealReceipt(message.loggedMeal)
        : message.loggedMeal,
    })),
  };
}

export interface StreamCallbacks {
  onTurnStart?: (turnId: string) => void;
  onStatus: (label: string) => void;
  onToken: (token: string) => void;
  onDone: (data: {
    didLogMeal: boolean;
    didMutateMeal?: boolean;
    loggedMeal?: LoggedMealReceipt;
    dailySummary?: DailySummary;
    dailyTargets?: DailyTargets;
    affectedDate?: string;
  }) => void;
  onStopped?: (data: {
    stopped: true;
    turnId?: string;
    tokensStreamed: number;
    didLogMeal?: boolean;
    didMutateMeal?: boolean;
    loggedMeal?: LoggedMealReceipt;
    dailySummary?: DailySummary;
    dailyTargets?: DailyTargets;
    affectedDate?: string;
  }) => void;
  onError: (message: string) => void;
}

export interface SendMessageStreamOptions {
  signal?: AbortSignal;
  turnId?: string;
}

export async function sendMessageStream(
  message: string,
  callbacks: StreamCallbacks,
  image?: File,
  options?: SendMessageStreamOptions,
): Promise<void> {
  const form = new FormData();
  form.append("message", message);
  if (options?.turnId) {
    form.append("turnId", options.turnId);
  }
  if (image) {
    form.append("image", await prepareImageForUpload(image));
  }

  const res = await fetch("/api/chat", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "text/event-stream" },
    body: form,
    signal: options?.signal,
  });

  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const errorMessage = getResponseErrorMessage(await readJsonSafe(res));
    throw new Error(errorMessage ?? "Failed to send message");
  }

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("Missing response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let sawTerminalEvent = false;
  let activeTurnId: string | null = null;

  function maybeEmitTurnStart(turnId: unknown) {
    if (typeof turnId !== "string" || turnId.trim().length === 0 || turnId === activeTurnId) {
      return;
    }
    activeTurnId = turnId;
    callbacks.onTurnStart?.(turnId);
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    for (const eventBlock of events) {
      if (!eventBlock.trim()) {
        continue;
      }

      const lines = eventBlock.split("\n");
      let eventType = "message";
      let data = "";

      for (const line of lines) {
        if (line.startsWith("event: ")) {
          eventType = line.slice(7).trim();
        }
        if (line.startsWith("data: ")) {
          data = line.slice(6).trim();
        }
      }

      if (!data) {
        continue;
      }

      try {
        const parsed = JSON.parse(data) as Record<string, unknown>;

        if (eventType === "status") {
          maybeEmitTurnStart(parsed.turnId);
          callbacks.onStatus((parsed.label as string) ?? "");
        } else if (eventType === "start") {
          maybeEmitTurnStart(parsed.turnId);
        } else if (eventType === "chunk") {
          callbacks.onToken((parsed.token as string) ?? "");
        } else if (eventType === "done") {
          maybeEmitTurnStart(parsed.turnId);
          sawTerminalEvent = true;
          callbacks.onDone({
            didLogMeal: Boolean(parsed.didLogMeal),
            ...(parsed.didMutateMeal !== undefined ? { didMutateMeal: Boolean(parsed.didMutateMeal) } : {}),
            ...(isLoggedMealReceipt(parsed.loggedMeal)
              ? { loggedMeal: normalizeLoggedMealReceipt(parsed.loggedMeal) }
              : {}),
            ...(isDailySummary(parsed.dailySummary) ? { dailySummary: parsed.dailySummary } : {}),
            ...(isDailyTargets(parsed.dailyTargets) ? { dailyTargets: parsed.dailyTargets } : {}),
            ...(typeof parsed.affectedDate === "string" ? { affectedDate: parsed.affectedDate } : {}),
          });
        } else if (eventType === "stopped") {
          maybeEmitTurnStart(parsed.turnId);
          sawTerminalEvent = true;
          callbacks.onStopped?.({
            stopped: true,
            ...(typeof parsed.turnId === "string" ? { turnId: parsed.turnId } : {}),
            tokensStreamed: typeof parsed.tokensStreamed === "number" && Number.isFinite(parsed.tokensStreamed)
              ? parsed.tokensStreamed
              : 0,
            ...(parsed.didLogMeal !== undefined ? { didLogMeal: Boolean(parsed.didLogMeal) } : {}),
            ...(parsed.didMutateMeal !== undefined ? { didMutateMeal: Boolean(parsed.didMutateMeal) } : {}),
            ...(isLoggedMealReceipt(parsed.loggedMeal)
              ? { loggedMeal: normalizeLoggedMealReceipt(parsed.loggedMeal) }
              : {}),
            ...(isDailySummary(parsed.dailySummary) ? { dailySummary: parsed.dailySummary } : {}),
            ...(isDailyTargets(parsed.dailyTargets) ? { dailyTargets: parsed.dailyTargets } : {}),
            ...(typeof parsed.affectedDate === "string" ? { affectedDate: parsed.affectedDate } : {}),
          });
        } else if (eventType === "error") {
          sawTerminalEvent = true;
          callbacks.onError((parsed.message as string) ?? "Stream error");
        }
      } catch {
        // Ignore malformed SSE payloads and continue parsing subsequent events.
      }
    }
  }

  if (!sawTerminalEvent) {
    callbacks.onError("Stream interrupted");
  }
}

export async function stopChatTurn(options: { turnId: string }): Promise<{ stopped: boolean; turnId: string }> {
  const res = await fetch("/api/chat/stop", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ turnId: options.turnId }),
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const errorMessage = getResponseErrorMessage(await readJsonSafe(res));
    throw new Error(errorMessage ?? "Failed to stop chat turn");
  }
  return res.json() as Promise<{ stopped: boolean; turnId: string }>;
}

export async function getMeals(options?: { refreshReason?: "day_rollover" | "meal_mutation" }): Promise<{ meals: MealEntry[] }> {
  const headers: Record<string, string> = {};
  if (options?.refreshReason) {
    headers["X-Refresh-Reason"] = options.refreshReason;
  }

  const res = await fetch("/api/meals", { credentials: "same-origin", headers });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to load meals");
  const body = await res.json() as { meals: MealEntry[] };
  return {
    meals: body.meals.map((meal) => ({
      ...meal,
      itemCount: normalizeItemCount(meal.itemCount),
      imageUrl: withAuthorizedAssetUrl(meal.imageUrl),
    })),
  };
}

export async function getDaySnapshot(
  dateKey: string,
): Promise<{ date: string; summary: DailySummary; meals: MealEntry[] }> {
  const res = await fetch(`/api/day-snapshot?date=${encodeURIComponent(dateKey)}`, { credentials: "same-origin" });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to load day snapshot");
  const body = await res.json() as { date: string; summary: DailySummary; meals: MealEntry[] };
  return {
    ...body,
    meals: body.meals.map((meal) => ({
      ...meal,
      itemCount: normalizeItemCount(meal.itemCount),
      imageUrl: withAuthorizedAssetUrl(meal.imageUrl),
    })),
  };
}

interface HistoryMealDto {
  id: string;
  loggedAt: string;
  display?: { title?: string };
  nutrition?: { calories?: number; protein?: number; carbs?: number; fat?: number };
  asset?: { imageAssetId?: string | null; imageUrl?: string | null };
  foodName?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  itemCount?: number;
  imageAssetId?: string | null;
  imageUrl?: string | null;
}

function normalizeHistoryMeal(meal: HistoryMealDto): MealEntry {
  return {
    id: meal.id,
    foodName: meal.display?.title ?? meal.foodName ?? "未命名餐點",
    calories: meal.nutrition?.calories ?? meal.calories ?? 0,
    protein: meal.nutrition?.protein ?? meal.protein ?? 0,
    carbs: meal.nutrition?.carbs ?? meal.carbs ?? 0,
    fat: meal.nutrition?.fat ?? meal.fat ?? 0,
    itemCount: normalizeItemCount(meal.itemCount),
    imageAssetId: meal.asset?.imageAssetId ?? meal.imageAssetId ?? null,
    imageUrl: withAuthorizedAssetUrl(meal.asset?.imageUrl ?? meal.imageUrl ?? null) ?? null,
    loggedAt: meal.loggedAt,
  };
}

export async function getHistoryTrends(from: string, to: string): Promise<HistoryTrendResponse> {
  const params = new URLSearchParams({ from, to });
  const res = await fetch(`/api/history/trends?${params.toString()}`, { credentials: "same-origin" });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to load history trends");
  return res.json() as Promise<HistoryTrendResponse>;
}

export async function getHistoryDaySnapshot(dateKey: string): Promise<HistoryDaySnapshot> {
  const res = await fetch(`/api/history/days/${encodeURIComponent(dateKey)}`, { credentials: "same-origin" });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to load history day snapshot");
  const body = await res.json() as { date: string; summary: DailySummary; meals: HistoryMealDto[] };
  return {
    date: body.date,
    summary: body.summary,
    meals: body.meals.map(normalizeHistoryMeal),
  };
}

export interface DeleteMealResponse {
  affectedDate: string;
  dailySummary: DailySummary;
}

export async function deleteMeal(mealId: string): Promise<DeleteMealResponse> {
  const res = await fetch(`/api/meals/${mealId}`, {
    method: "DELETE",
    credentials: "same-origin",
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to delete meal");
  return res.json() as Promise<DeleteMealResponse>;
}

export async function updateMeal(mealId: string, input: UpdateMealInput): Promise<UpdateMealResponse> {
  const res = await fetch(`/api/meals/${encodeURIComponent(mealId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to update meal");
  const body = await res.json() as UpdateMealResponse;
  return {
    ...body,
    meal: {
      ...body.meal,
      itemCount: normalizeItemCount(body.meal.itemCount),
      imageUrl: withAuthorizedAssetUrl(body.meal.imageUrl) ?? null,
    },
  };
}
