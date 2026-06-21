import {
  isDailySummarySSEPayloadDto,
  isGoalsUpdatePayloadDto,
} from "./dto-guards.js";
import { useStore } from "./store.js";
import type {
  DailySummary,
  DailySummarySSEPayload,
  DailyTargets,
} from "./types.js";

let eventSource: EventSource | null = null;
let currentConnection: { deviceId: string; handlers: SSEHandlers } | null = null;

export interface SSEHandlers {
  onSummary?: (summary: DailySummary) => void;
  onDailySummaryEnvelope?: (payload: DailySummarySSEPayload) => void;
  onGoalsUpdate: (targets: DailyTargets) => void;
}

export function connectSSE(_deviceId: string, handlers: SSEHandlers) {
  disconnectSSE();
  currentConnection = { deviceId: _deviceId, handlers };
  eventSource = new EventSource("/api/sse");
  const source = eventSource;

  source.addEventListener("daily_summary", (event) => {
    try {
      const raw = (event as MessageEvent<string>).data;
      const parsed = JSON.parse(raw) as unknown;
      if (!isDailySummarySSEPayloadDto(parsed)) return;
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
  source.addEventListener("goals_update", (event) => {
    try {
      const raw = (event as MessageEvent<string>).data;
      const parsed = JSON.parse(raw) as unknown;
      if (isGoalsUpdatePayloadDto(parsed)) {
        handlers.onGoalsUpdate(parsed.targets);
      }
    } catch {
      // Malformed JSON from server or a spoofed frame: ignore without
      // propagating into the EventSource dispatcher.
    }
  });

  source.onerror = () => {
    void recoverClosedSource(source);
  };
}

export function disconnectSSE() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  currentConnection = null;
}

function reconnectSSE() {
  if (!currentConnection) return;
  connectSSE(currentConnection.deviceId, currentConnection.handlers);
}

async function recoverClosedSource(failedSource: EventSource) {
  if (failedSource.readyState !== EventSource.CLOSED) {
    return;
  }

  const recovered = await useStore.getState().recoverGuestSession();
  if (!recovered || eventSource !== failedSource) {
    return;
  }

  reconnectSSE();
}
