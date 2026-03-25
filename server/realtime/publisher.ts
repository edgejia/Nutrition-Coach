import type { DailySummary } from "../services/summary.js";
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

  publishDailySummary(deviceId: string, summary: DailySummary) {
    const replies = this.connections.get(deviceId) ?? [];
    const data = JSON.stringify(summary);
    const stale: FastifyReply[] = [];
    for (const reply of replies) {
      if (reply.raw.destroyed) {
        stale.push(reply);
        continue;
      }
      try {
        reply.raw.write(`event: daily_summary\ndata: ${data}\n\n`);
      } catch {
        stale.push(reply);
      }
    }
    for (const reply of stale) {
      this.unsubscribe(deviceId, reply);
    }
  }
}
