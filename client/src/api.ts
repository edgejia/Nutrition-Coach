import type {
  ChatReply,
  DailySummary,
  DailyTargets,
  IntakeData,
  IntakeResult,
  IntakeValidationIssue,
  LoggedMealReceipt,
  MealEntry,
  Message,
  CoachCTAIntentId,
  CoachCTAOptionId,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return (
    isRecord(value) &&
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
  );
}

async function readJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
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
    form.append("image", image);
  }
  const res = await fetch("/api/chat", {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to send message");
  return res.json();
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
    })),
  };
}

export interface StreamCallbacks {
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
  onError: (message: string) => void;
}

export async function sendMessageStream(
  message: string,
  callbacks: StreamCallbacks,
  image?: File,
): Promise<void> {
  const form = new FormData();
  form.append("message", message);
  if (image) {
    form.append("image", image);
  }

  const res = await fetch("/api/chat", {
    method: "POST",
    credentials: "same-origin",
    headers: { Accept: "text/event-stream" },
    body: form,
  });

  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to send message");

  const reader = res.body?.getReader();
  if (!reader) {
    throw new Error("Missing response body");
  }

  const decoder = new TextDecoder();
  let buffer = "";
  let sawTerminalEvent = false;

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
          callbacks.onStatus((parsed.label as string) ?? "");
        } else if (eventType === "chunk") {
          callbacks.onToken((parsed.token as string) ?? "");
        } else if (eventType === "done") {
          sawTerminalEvent = true;
          callbacks.onDone({
            didLogMeal: Boolean(parsed.didLogMeal),
            ...(parsed.didMutateMeal !== undefined ? { didMutateMeal: Boolean(parsed.didMutateMeal) } : {}),
            ...(isLoggedMealReceipt(parsed.loggedMeal) ? { loggedMeal: parsed.loggedMeal } : {}),
            ...(parsed.dailySummary ? { dailySummary: parsed.dailySummary as DailySummary } : {}),
            ...(parsed.dailyTargets ? { dailyTargets: parsed.dailyTargets as DailyTargets } : {}),
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

export async function getMeals(options?: { refreshReason?: "day_rollover" }): Promise<{ meals: MealEntry[] }> {
  const headers: Record<string, string> = {};
  if (options?.refreshReason === "day_rollover") {
    headers["X-Refresh-Reason"] = "day_rollover";
  }

  const res = await fetch("/api/meals", { credentials: "same-origin", headers });
  if (res.status === 401) throw new Error("UNAUTHORIZED");
  if (!res.ok) throw new Error("Failed to load meals");
  const body = await res.json() as { meals: MealEntry[] };
  return {
    meals: body.meals.map((meal) => ({
      ...meal,
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
      imageUrl: withAuthorizedAssetUrl(meal.imageUrl),
    })),
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
