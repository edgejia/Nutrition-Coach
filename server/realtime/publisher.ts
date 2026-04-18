import type { DailySummary } from "../services/summary.js";
import type { DailyTargets } from "../services/device.js";
import type { FastifyReply } from "fastify";

export class RealtimePublisher {
  private connections = new Map<string, FastifyReply[]>();

  subscribe(deviceId: string, reply: FastifyReply) {
    const existing = this.connections.get(deviceId) ?? [];
    existing.push(reply);
    this.connections.set(deviceId, existing);
  }

  unsubscribe(deviceId: string, reply: FastifyReply) {
    const existing = this.connections.get(deviceId) ?? [];
    this.connections.set(
      deviceId,
      existing.filter((r) => r !== reply)
    );
  }

  // Private helper: owns stale-reply cleanup for every event type so that new
  // publishers (daily_summary, goals_update, future events) never duplicate the
  // subscriber cleanup logic. Returns only non-sensitive publish metadata
  // (`{ sent }`) so downstream structured logging / hook paths can report on
  // delivery without leaking deviceId, raw text, or target numbers (D-30).
  private publish(deviceId: string, event: string, payload: unknown): { sent: number } {
    const replies = this.connections.get(deviceId) ?? [];
    const data = JSON.stringify(payload);
    const stale: FastifyReply[] = [];
    let sent = 0;
    for (const reply of replies) {
      if (reply.raw.destroyed) {
        stale.push(reply);
        continue;
      }
      try {
        reply.raw.write(`event: ${event}\ndata: ${data}\n\n`);
        sent += 1;
      } catch {
        stale.push(reply);
      }
    }
    for (const reply of stale) {
      this.unsubscribe(deviceId, reply);
    }
    return { sent };
  }

  publishDailySummary(deviceId: string, summary: DailySummary) {
    return this.publish(deviceId, "daily_summary", summary);
  }

  // Emits a `goals_update` SSE event carrying the freshly persisted daily
  // targets. Payload is intentionally `{ targets }` only — no deviceId, no raw
  // user text, no historical values — so that the downstream structured log
  // hook (`goals_update_published` in Plan 10-03) can reference this publish
  // success without leaking the actual numeric deltas (D-23, T-10-15).
  publishGoalsUpdate(deviceId: string, targets: DailyTargets): { sent: number } {
    return this.publish(deviceId, "goals_update", { targets });
  }
}
