import { isRealDateKey } from "./lib/history-week.js";
import type {
  DailySummary,
  DailySummarySSEPayload,
  DailySummarySSESource,
  DailyTargets,
  GoalsUpdatePayload,
} from "./types.js";

let eventSource: EventSource | null = null;

export interface SSEHandlers {
  onSummary?: (summary: DailySummary) => void;
  onDailySummaryEnvelope?: (payload: DailySummarySSEPayload) => void;
  onGoalsUpdate: (targets: DailyTargets) => void;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

// Shape-check guard for `goals_update` payloads: the SSE boundary is untrusted
// (T-10-14). We reject anything that does not match `{ targets: { calories,
// protein, carbs, fat } }` with finite numbers so malformed JSON or malicious
// partial payloads never mutate `dailyTargets` state.
function isValidTargets(value: unknown): value is DailyTargets {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    isFiniteNumber(obj.calories) &&
    isFiniteNumber(obj.protein) &&
    isFiniteNumber(obj.carbs) &&
    isFiniteNumber(obj.fat)
  );
}

function isDailySummarySSESource(value: unknown): value is DailySummarySSESource {
  return value === "initial" || value === "meal_mutation";
}

function isDailySummary(value: unknown): value is DailySummary {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.date === "string" &&
    isRealDateKey(obj.date) &&
    isFiniteNumber(obj.totalCalories) &&
    isFiniteNumber(obj.totalProtein) &&
    isFiniteNumber(obj.totalCarbs) &&
    isFiniteNumber(obj.totalFat) &&
    isFiniteNumber(obj.mealCount)
  );
}

function isDailySummarySSEPayload(value: unknown): value is DailySummarySSEPayload {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    isDailySummary(obj.summary) &&
    typeof obj.affectedDate === "string" &&
    isRealDateKey(obj.affectedDate) &&
    isDailySummarySSESource(obj.source) &&
    obj.summary.date === obj.affectedDate
  );
}

export function connectSSE(_deviceId: string, handlers: SSEHandlers) {
  disconnectSSE();
  eventSource = new EventSource("/api/sse");

  eventSource.addEventListener("daily_summary", (event) => {
    try {
      const raw = (event as MessageEvent<string>).data;
      const parsed = JSON.parse(raw) as unknown;
      if (!isDailySummarySSEPayload(parsed)) return;
      if (handlers.onDailySummaryEnvelope) {
        handlers.onDailySummaryEnvelope(parsed);
        return;
      }
      handlers.onSummary?.(parsed.summary);
    } catch {
      // Malformed JSON or invalid shapes are ignored without propagating into
      // the EventSource dispatcher, matching the goals_update precedent.
    }
  });

  // `goals_update` event: Plan 10-04 wires the payload through the same
  // `setDailyTargets` action already used by Settings / Onboarding so that
  // every goal-driven surface re-renders without a new UI affordance (D-25,
  // D-26). Malformed payloads are swallowed — never thrown — to protect the
  // chat UI and SSE loop from a spoofed server event (T-10-14).
  eventSource.addEventListener("goals_update", (event) => {
    try {
      const raw = (event as MessageEvent<string>).data;
      const parsed = JSON.parse(raw) as GoalsUpdatePayload;
      if (parsed && typeof parsed === "object" && isValidTargets(parsed.targets)) {
        handlers.onGoalsUpdate(parsed.targets);
      }
    } catch {
      // Malformed JSON from server or a spoofed frame: ignore without
      // propagating into the EventSource dispatcher.
    }
  });

  eventSource.onerror = () => {
    // EventSource auto-reconnects
  };
}

export function disconnectSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}
