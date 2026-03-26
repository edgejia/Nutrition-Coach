import type { DailySummary } from "./types.js";

let eventSource: EventSource | null = null;

export function connectSSE(deviceId: string, onSummary: (summary: DailySummary) => void) {
  disconnectSSE();
  // Spec uses X-Device-Id for authenticated APIs, but EventSource cannot send custom headers.
  // The backend therefore exposes an SSE-specific query-param fallback implemented in Plan 4.
  eventSource = new EventSource(`/api/sse?deviceId=${deviceId}`);

  eventSource.addEventListener("daily_summary", (event) => {
    const summary = JSON.parse((event as MessageEvent<string>).data) as DailySummary;
    onSummary(summary);
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
