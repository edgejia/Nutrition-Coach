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
  MealPeriod,
  MealItemDetail,
  Message,
  CoachCTAIntentId,
  CoachCTAOptionId,
  DeleteMealOptions,
  DeleteMealResponse,
  SummaryOutcome,
  UpdateMealInput,
  UpdateMealResponse,
} from "./types.js";
import {
  isDailySummaryDto,
  isDailyTargetsDto,
  isFiniteNumber as isDtoFiniteNumber,
  isRecord as isDtoRecord,
  isSummaryOutcomeDto,
  isValidMealPeriod,
} from "./dto-guards.js";
import { isRealDateKey } from "./lib/history-week.js";
import { getEarliestValidationStep } from "./lib/onboarding-intake-validation.js";

export interface GuestSessionBootstrapResult {
  deviceId: string;
  goal: IntakeData["goal"];
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

export type MealRevisionConflictCode = "MEAL_REVISION_REQUIRED" | "MEAL_REVISION_STALE";

export class MealRevisionConflictError extends Error {
  readonly kind = "meal_revision_conflict";

  constructor(
    readonly code: MealRevisionConflictCode,
    readonly mealId: string,
    readonly affectedDate: string,
    readonly currentMealRevisionId?: string,
  ) {
    super(code);
    this.name = "MealRevisionConflictError";
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

function normalizeMealPeriod(value: unknown): MealPeriod | undefined {
  return isValidMealPeriod(value) ? value : undefined;
}

function normalizeMealItems(value: unknown): MealItemDetail[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const items = value
    .map((item): MealItemDetail | null => {
      if (!isRecord(item)) {
        return null;
      }

      const nutrition = isRecord(item.nutrition) ? item.nutrition : item;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const position = item.position;
      const calories = nutrition.calories;
      const protein = nutrition.protein;
      const carbs = nutrition.carbs;
      const fat = nutrition.fat;

      if (
        !name ||
        typeof position !== "number" ||
        !Number.isFinite(position) ||
        typeof calories !== "number" ||
        !Number.isFinite(calories) ||
        typeof protein !== "number" ||
        !Number.isFinite(protein) ||
        typeof carbs !== "number" ||
        !Number.isFinite(carbs) ||
        typeof fat !== "number" ||
        !Number.isFinite(fat)
      ) {
        return null;
      }

      return {
        name,
        position: Math.floor(position),
        calories,
        protein,
        carbs,
        fat,
      };
    })
    .filter((item): item is MealItemDetail => item !== null)
    .sort((a, b) => a.position - b.position);

  return items.length > 0 ? items : undefined;
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
      (value.mealRevisionId === undefined || typeof value.mealRevisionId === "string") &&
      (value.dateKey === undefined || typeof value.dateKey === "string") &&
      (value.loggedAt === undefined || typeof value.loggedAt === "string") &&
      (value.itemCount === undefined ||
        (typeof value.itemCount === "number" && Number.isFinite(value.itemCount) && value.itemCount > 0)) &&
      (value.items === undefined || Array.isArray(value.items)) &&
      (value.imageAssetId === undefined || value.imageAssetId === null || typeof value.imageAssetId === "string") &&
      (value.imageUrl === undefined || value.imageUrl === null || typeof value.imageUrl === "string")
    );
  }

  return false;
}

function isDailySummary(value: unknown): value is DailySummary {
  return isDailySummaryDto(value);
}

export function isSummaryOutcome(value: unknown): value is SummaryOutcome {
  return isSummaryOutcomeDto(value);
}

function isDailyTargets(value: unknown): value is DailyTargets {
  return isDailyTargetsDto(value);
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

function getMealRevisionConflictError(status: number, body: unknown): MealRevisionConflictError | null {
  if (status !== 409 || !isRecord(body)) {
    return null;
  }

  const code = body.error;
  if (code !== "MEAL_REVISION_REQUIRED" && code !== "MEAL_REVISION_STALE") {
    return null;
  }

  if (typeof body.mealId !== "string" || typeof body.affectedDate !== "string") {
    return null;
  }

  const currentMealRevisionId =
    typeof body.currentMealRevisionId === "string" ? body.currentMealRevisionId : undefined;

  return new MealRevisionConflictError(code, body.mealId, body.affectedDate, currentMealRevisionId);
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

export function normalizeLoggedMealReceipt(receipt: LoggedMealReceipt): LoggedMealReceipt {
  const { mealPeriod: rawMealPeriod, items: _items, imageUrl: rawImageUrl, ...rest } = receipt as LoggedMealReceipt & {
    mealPeriod?: unknown;
    items?: unknown;
    imageUrl?: string | null;
  };
  const items = normalizeMealItems((receipt as { items?: unknown }).items);
  const mealPeriod = normalizeMealPeriod(rawMealPeriod);

  return {
    ...rest,
    itemCount: normalizeItemCount(receipt.itemCount),
    ...(items ? { items } : {}),
    ...(mealPeriod ? { mealPeriod } : {}),
    ...(rawImageUrl === undefined
      ? {}
      : { imageUrl: withAuthorizedAssetUrl(rawImageUrl) ?? null }),
  };
}

export function formatTurnReference(turnId: string) {
  return `t-${turnId.slice(0, 8)}`;
}

function normalizeSummaryOutcomeFields<T extends { dailySummary?: unknown; summaryOutcome?: unknown }>(
  body: T,
): Omit<T, "dailySummary" | "summaryOutcome"> & {
  dailySummary?: DailySummary;
  summaryOutcome?: SummaryOutcome;
} {
  const { dailySummary, summaryOutcome, ...rest } = body;
  return {
    ...rest,
    ...(isDailySummary(dailySummary) ? { dailySummary } : {}),
    ...(isSummaryOutcome(summaryOutcome) ? { summaryOutcome } : {}),
  };
}

function normalizeChatReply<T extends {
  loggedMeal?: LoggedMealReceipt;
  dailySummary?: unknown;
  summaryOutcome?: unknown;
  deletedMealId?: unknown;
}>(
  reply: T,
): T {
  const { loggedMeal, deletedMealId, ...rest } = reply;
  return {
    ...normalizeSummaryOutcomeFields(rest),
    ...(loggedMeal ? { loggedMeal: normalizeLoggedMealReceipt(loggedMeal) } : {}),
    ...(typeof deletedMealId === "string" ? { deletedMealId } : {}),
  } as T;
}

function isOptionalNullableString(value: unknown): value is string | null | undefined {
  return value === undefined || value === null || typeof value === "string";
}

function isAuthoritativeMealCoreDto(value: unknown): value is MealEntry {
  return (
    isDtoRecord(value) &&
    typeof value.id === "string" &&
    value.id.trim().length > 0 &&
    typeof value.mealRevisionId === "string" &&
    value.mealRevisionId.trim().length > 0 &&
    typeof value.foodName === "string" &&
    value.foodName.trim().length > 0 &&
    isDtoFiniteNumber(value.calories) &&
    isDtoFiniteNumber(value.protein) &&
    isDtoFiniteNumber(value.carbs) &&
    isDtoFiniteNumber(value.fat) &&
    isDtoFiniteNumber(value.itemCount) &&
    value.itemCount > 0 &&
    typeof value.loggedAt === "string" &&
    value.loggedAt.trim().length > 0 &&
    isOptionalNullableString(value.imageAssetId) &&
    isOptionalNullableString(value.imageUrl)
  );
}

function assertUpdateGoalsResponse(value: unknown): asserts value is { dailyTargets: DailyTargets } {
  if (!isDtoRecord(value) || !isDailyTargetsDto(value.dailyTargets)) {
    throw new Error("Invalid update goals payload");
  }
}

function assertMealsResponse(value: unknown): asserts value is { meals: MealEntry[] } {
  if (!isDtoRecord(value) || !Array.isArray(value.meals) || !value.meals.every(isAuthoritativeMealCoreDto)) {
    throw new Error("Invalid meals payload");
  }
}

function assertDaySnapshotResponse(
  value: unknown,
): asserts value is { date: string; summary: DailySummary; meals: MealEntry[] } {
  if (
    !isDtoRecord(value) ||
    typeof value.date !== "string" ||
    !isRealDateKey(value.date) ||
    !isDailySummaryDto(value.summary) ||
    value.summary.date !== value.date ||
    !Array.isArray(value.meals) ||
    !value.meals.every(isAuthoritativeMealCoreDto)
  ) {
    throw new Error("Invalid day snapshot payload");
  }
}

type HistoryTrendBucketDto = HistoryTrendResponse["daily"][number];

function isHistoryTrendBucketDto(value: unknown): value is HistoryTrendBucketDto {
  return (
    isDtoRecord(value) &&
    typeof value.date === "string" &&
    isRealDateKey(value.date) &&
    isDtoFiniteNumber(value.calories) &&
    isDtoFiniteNumber(value.protein) &&
    isDtoFiniteNumber(value.carbs) &&
    isDtoFiniteNumber(value.fat) &&
    isDtoFiniteNumber(value.mealCount)
  );
}

function isHistoryTrendTotalsDto(value: unknown): value is HistoryTrendResponse["totals"] {
  return (
    isDtoRecord(value) &&
    isDtoFiniteNumber(value.calories) &&
    isDtoFiniteNumber(value.protein) &&
    isDtoFiniteNumber(value.carbs) &&
    isDtoFiniteNumber(value.fat) &&
    isDtoFiniteNumber(value.mealCount)
  );
}

function isHistoryTrendAveragesDto(value: unknown): value is HistoryTrendResponse["averages"] {
  return (
    isDtoRecord(value) &&
    isDtoFiniteNumber(value.calories) &&
    isDtoFiniteNumber(value.protein) &&
    isDtoFiniteNumber(value.carbs) &&
    isDtoFiniteNumber(value.fat) &&
    isDtoFiniteNumber(value.mealsPerDay)
  );
}

function assertHistoryTrendResponse(value: unknown): asserts value is HistoryTrendResponse {
  if (
    !isDtoRecord(value) ||
    typeof value.from !== "string" ||
    !isRealDateKey(value.from) ||
    typeof value.to !== "string" ||
    !isRealDateKey(value.to) ||
    (value.completeness !== "empty" && value.completeness !== "sparse" && value.completeness !== "complete") ||
    !Array.isArray(value.daily) ||
    !value.daily.every(isHistoryTrendBucketDto) ||
    !isHistoryTrendTotalsDto(value.totals) ||
    !isHistoryTrendAveragesDto(value.averages)
  ) {
    throw new Error("Invalid history trends payload");
  }
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
  const body = await res.json() as unknown;
  assertUpdateGoalsResponse(body);
  return body;
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
    summaryOutcome?: SummaryOutcome;
    dailyTargets?: DailyTargets;
    affectedDate?: string;
    deletedMealId?: string;
    turnId?: string;
  }) => void;
  onStopped?: (data: {
    stopped: true;
    turnId?: string;
    tokensStreamed: number;
    didLogMeal?: boolean;
    didMutateMeal?: boolean;
    loggedMeal?: LoggedMealReceipt;
    dailySummary?: DailySummary;
    summaryOutcome?: SummaryOutcome;
    dailyTargets?: DailyTargets;
    affectedDate?: string;
    deletedMealId?: string;
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

  function getValidTurnId(turnId: unknown): string | undefined {
    return typeof turnId === "string" && turnId.trim().length > 0 ? turnId : undefined;
  }

  function maybeEmitTurnStart(turnId: unknown) {
    const validTurnId = getValidTurnId(turnId);
    if (!validTurnId || validTurnId === activeTurnId) {
      return;
    }
    activeTurnId = validTurnId;
    callbacks.onTurnStart?.(validTurnId);
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
        const parsed = JSON.parse(data) as unknown;
        if (!isRecord(parsed)) {
          continue;
        }

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
            ...(isSummaryOutcome(parsed.summaryOutcome) ? { summaryOutcome: parsed.summaryOutcome } : {}),
            ...(isDailyTargets(parsed.dailyTargets) ? { dailyTargets: parsed.dailyTargets } : {}),
            ...(typeof parsed.affectedDate === "string" ? { affectedDate: parsed.affectedDate } : {}),
            ...(typeof parsed.deletedMealId === "string" ? { deletedMealId: parsed.deletedMealId } : {}),
            ...(getValidTurnId(parsed.turnId) ? { turnId: getValidTurnId(parsed.turnId) } : {}),
          });
        } else if (eventType === "stopped") {
          maybeEmitTurnStart(parsed.turnId);
          sawTerminalEvent = true;
          callbacks.onStopped?.({
            stopped: true,
            ...(getValidTurnId(parsed.turnId) ? { turnId: getValidTurnId(parsed.turnId) } : {}),
            tokensStreamed: typeof parsed.tokensStreamed === "number" && Number.isFinite(parsed.tokensStreamed)
              ? parsed.tokensStreamed
              : 0,
            ...(parsed.didLogMeal !== undefined ? { didLogMeal: Boolean(parsed.didLogMeal) } : {}),
            ...(parsed.didMutateMeal !== undefined ? { didMutateMeal: Boolean(parsed.didMutateMeal) } : {}),
            ...(isLoggedMealReceipt(parsed.loggedMeal)
              ? { loggedMeal: normalizeLoggedMealReceipt(parsed.loggedMeal) }
              : {}),
            ...(isDailySummary(parsed.dailySummary) ? { dailySummary: parsed.dailySummary } : {}),
            ...(isSummaryOutcome(parsed.summaryOutcome) ? { summaryOutcome: parsed.summaryOutcome } : {}),
            ...(isDailyTargets(parsed.dailyTargets) ? { dailyTargets: parsed.dailyTargets } : {}),
            ...(typeof parsed.affectedDate === "string" ? { affectedDate: parsed.affectedDate } : {}),
            ...(typeof parsed.deletedMealId === "string" ? { deletedMealId: parsed.deletedMealId } : {}),
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
  const body = await res.json() as unknown;
  assertMealsResponse(body);
  return {
    meals: body.meals.map(normalizeMealEntry),
  };
}

export async function getDaySnapshot(
  dateKey: string,
): Promise<{ date: string; summary: DailySummary; meals: MealEntry[] }> {
  const res = await fetch(`/api/day-snapshot?date=${encodeURIComponent(dateKey)}`, { credentials: "same-origin" });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to load day snapshot");
  const body = await res.json() as unknown;
  assertDaySnapshotResponse(body);
  return {
    ...body,
    meals: body.meals.map(normalizeMealEntry),
  };
}

interface HistoryMealDto {
  id: string;
  mealRevisionId?: string;
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
  items?: unknown;
  imageAssetId?: string | null;
  imageUrl?: string | null;
  mealPeriod?: unknown;
}

function getHistoryMealTitle(meal: HistoryMealDto): string | null {
  const title = meal.display?.title ?? meal.foodName;
  return typeof title === "string" && title.trim().length > 0 ? title : null;
}

function getHistoryMealNutrition(meal: HistoryMealDto): {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
} | null {
  const calories = meal.nutrition?.calories ?? meal.calories;
  const protein = meal.nutrition?.protein ?? meal.protein;
  const carbs = meal.nutrition?.carbs ?? meal.carbs;
  const fat = meal.nutrition?.fat ?? meal.fat;

  if (
    !isDtoFiniteNumber(calories) ||
    !isDtoFiniteNumber(protein) ||
    !isDtoFiniteNumber(carbs) ||
    !isDtoFiniteNumber(fat)
  ) {
    return null;
  }

  return { calories, protein, carbs, fat };
}

function isHistoryMealDtoComplete(value: unknown): value is HistoryMealDto {
  if (!isDtoRecord(value)) {
    return false;
  }

  const meal = value as unknown as HistoryMealDto;
  return (
    typeof meal.id === "string" &&
    meal.id.trim().length > 0 &&
    typeof meal.mealRevisionId === "string" &&
    meal.mealRevisionId.trim().length > 0 &&
    typeof meal.loggedAt === "string" &&
    meal.loggedAt.trim().length > 0 &&
    getHistoryMealTitle(meal) !== null &&
    getHistoryMealNutrition(meal) !== null &&
    isDtoFiniteNumber(meal.itemCount) &&
    meal.itemCount > 0
  );
}

function normalizeAuthoritativeHistoryMeal(meal: HistoryMealDto): MealEntry {
  if (!isHistoryMealDtoComplete(meal)) {
    throw new Error("Invalid history meal payload");
  }

  return normalizeHistoryMeal(meal);
}

function assertHistoryDaySnapshotResponse(value: unknown): asserts value is {
  date: string;
  summary: DailySummary;
  meals: HistoryMealDto[];
} {
  if (
    !isDtoRecord(value) ||
    typeof value.date !== "string" ||
    !isRealDateKey(value.date) ||
    !isDailySummaryDto(value.summary) ||
    value.summary.date !== value.date ||
    !Array.isArray(value.meals) ||
    !value.meals.every(isHistoryMealDtoComplete)
  ) {
    throw new Error("Invalid history day snapshot payload");
  }
}

function normalizeMealEntry(meal: MealEntry): MealEntry {
  const {
    mealPeriod: rawMealPeriod,
    items: rawItems,
    imageUrl: rawImageUrl,
    ...rest
  } = meal as MealEntry & {
    mealPeriod?: unknown;
    items?: unknown;
    imageUrl?: string | null;
  };
  const items = normalizeMealItems(rawItems);
  const mealPeriod = normalizeMealPeriod(rawMealPeriod);

  return {
    ...rest,
    itemCount: normalizeItemCount(meal.itemCount),
    ...(items ? { items } : {}),
    imageUrl: withAuthorizedAssetUrl(rawImageUrl),
    ...(mealPeriod ? { mealPeriod } : {}),
  };
}

export function normalizeHistoryMeal(meal: HistoryMealDto): MealEntry {
  const items = normalizeMealItems(meal.items);
  const mealPeriod = normalizeMealPeriod(meal.mealPeriod);
  const foodName = getHistoryMealTitle(meal);
  const nutrition = getHistoryMealNutrition(meal);

  if (
    typeof meal.mealRevisionId !== "string" ||
    meal.mealRevisionId.trim().length === 0 ||
    !foodName ||
    !nutrition ||
    !isDtoFiniteNumber(meal.itemCount) ||
    meal.itemCount <= 0
  ) {
    throw new Error("Invalid history meal payload");
  }

  return {
    id: meal.id,
    mealRevisionId: meal.mealRevisionId,
    foodName,
    calories: nutrition.calories,
    protein: nutrition.protein,
    carbs: nutrition.carbs,
    fat: nutrition.fat,
    itemCount: Math.floor(meal.itemCount),
    ...(items ? { items } : {}),
    imageAssetId: meal.asset?.imageAssetId ?? meal.imageAssetId ?? null,
    imageUrl: withAuthorizedAssetUrl(meal.asset?.imageUrl ?? meal.imageUrl ?? null) ?? null,
    loggedAt: meal.loggedAt,
    ...(mealPeriod ? { mealPeriod } : {}),
  };
}

export async function getHistoryTrends(from: string, to: string): Promise<HistoryTrendResponse> {
  const params = new URLSearchParams({ from, to });
  const res = await fetch(`/api/history/trends?${params.toString()}`, { credentials: "same-origin" });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to load history trends");
  const body = await res.json() as unknown;
  assertHistoryTrendResponse(body);
  return body;
}

export async function getHistoryDaySnapshot(dateKey: string): Promise<HistoryDaySnapshot> {
  const res = await fetch(`/api/history/days/${encodeURIComponent(dateKey)}`, { credentials: "same-origin" });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to load history day snapshot");
  const body = await res.json() as unknown;
  assertHistoryDaySnapshotResponse(body);
  return {
    date: body.date,
    summary: body.summary,
    meals: body.meals.map(normalizeAuthoritativeHistoryMeal),
  };
}

export async function deleteMeal(mealId: string, options: DeleteMealOptions): Promise<DeleteMealResponse> {
  const res = await fetch(`/api/meals/${encodeURIComponent(mealId)}`, {
    method: "DELETE",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedMealRevisionId: options.expectedMealRevisionId }),
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const body = await readJsonSafe(res);
    const conflict = getMealRevisionConflictError(res.status, body);
    if (conflict) {
      throw conflict;
    }
    throw new Error("Failed to delete meal");
  }
  const body = await res.json() as DeleteMealResponse;
  return normalizeSummaryOutcomeFields(body);
}

export async function updateMeal(mealId: string, input: UpdateMealInput): Promise<UpdateMealResponse> {
  const res = await fetch(`/api/meals/${encodeURIComponent(mealId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) {
    const body = await readJsonSafe(res);
    const conflict = getMealRevisionConflictError(res.status, body);
    if (conflict) {
      throw conflict;
    }
    const errorMessage = getResponseErrorMessage(body);
    throw new Error(errorMessage ?? "Failed to update meal");
  }
  const body = await res.json() as UpdateMealResponse;
  const normalizedBody = normalizeSummaryOutcomeFields(body);
  return {
    ...normalizedBody,
    meal: normalizeMealEntry(normalizedBody.meal),
  };
}
