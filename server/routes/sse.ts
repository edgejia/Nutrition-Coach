import type { OutgoingHttpHeaders } from "node:http";
import type { FastifyInstance } from "fastify";
import type { RealtimePublisher } from "../realtime/publisher.js";
import type { createSummaryService } from "../services/summary.js";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import { currentAppDate } from "../lib/time.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";
import { logSseConnectionState } from "../observability/events.js";

interface Deps {
  publisher: RealtimePublisher;
  summaryService: ReturnType<typeof createSummaryService>;
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
}

export function registerSSERoutes(app: FastifyInstance, deps: Deps) {
  const { publisher, summaryService, deviceService, guestSessionService } = deps;

  app.get("/api/sse", async (request, reply) => {
    const session = await resolveGuestSession(request, { deviceService, guestSessionService });
    if (!session.ok) {
      if (session.clearCookies) {
        reply.header("set-cookie", guestSessionService.clearSessionCookies());
      }
      logSseConnectionState(request.log, { state: "rejected" });
      return reply.code(401).send({ error: session.error });
    }
    const { deviceId } = session;

    // Tell Fastify we're handling the response manually
    reply.hijack();
    const headers: OutgoingHttpHeaders = {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    };
    if (session.setCookies) {
      headers["set-cookie"] = [...session.setCookies];
    }
    reply.raw.writeHead(200, headers);

    let closed = false;
    let keepalive: ReturnType<typeof setInterval> | undefined;
    const cleanup = () => {
      if (closed) return;
      closed = true;
      if (keepalive) {
        clearInterval(keepalive);
      }
      publisher.unsubscribe(deviceId, reply);
      logSseConnectionState(request.log, { state: "closed" });
    };

    request.raw.on("close", cleanup);
    publisher.subscribe(deviceId, reply);
    logSseConnectionState(request.log, { state: "opened" });

    try {
      const summary = await summaryService.getDailySummary(deviceId, currentAppDate());
      if (!closed && !reply.raw.destroyed) {
        reply.raw.write(`event: daily_summary\ndata: ${JSON.stringify({
          summary,
          affectedDate: summary.date,
          source: "initial",
        })}\n\n`);
      }
    } catch (error) {
      cleanup();
      request.log.error({ event: "sse_initial_summary_failed", error }, "SSE initial summary failed");
      if (!reply.raw.destroyed) {
        reply.raw.end();
      }
      return;
    }

    // Keepalive every 30s
    keepalive = setInterval(() => {
      if (!reply.raw.destroyed) {
        reply.raw.write(": keepalive\n\n");
      }
    }, 30000);
  });
}
