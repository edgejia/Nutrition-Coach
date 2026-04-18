import type { DailySummary, DailyTargets, GoalsUpdatePayload } from "./types.js";

let eventSource: EventSource | null = null;

export interface SSEHandlers {
  onSummary: (summary: DailySummary) => void;
  onGoalsUpdate: (targets: DailyTargets) => void;
}

// Shape-check guard for `goals_update` payloads: the SSE boundary is untrusted
// (T-10-14). We reject anything that does not match `{ targets: { calories,
// protein, carbs, fat } }` with finite numbers so malformed JSON or malicious
// partial payloads never mutate `dailyTargets` state.
function isValidTargets(value: unknown): value is DailyTargets {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.calories === "number" && Number.isFinite(obj.calories) &&
    typeof obj.protein === "number" && Number.isFinite(obj.protein) &&
    typeof obj.carbs === "number" && Number.isFinite(obj.carbs) &&
    typeof obj.fat === "number" && Number.isFinite(obj.fat)
  );
}

export function connectSSE(deviceId: string, handlers: SSEHandlers) {
  disconnectSSE();
  // Spec uses X-Device-Id for authenticated APIs, but EventSource cannot send custom headers.
  // The backend therefore exposes an SSE-specific query-param fallback implemented in Plan 4.
  eventSource = new EventSource(`/api/sse?deviceId=${deviceId}`);

  eventSource.addEventListener("daily_summary", (event) => {
    const summary = JSON.parse((event as MessageEvent<string>).data) as DailySummary;
    handlers.onSummary(summary);
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
