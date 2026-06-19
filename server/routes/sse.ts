import type { OutgoingHttpHeaders } from "node:http";
import type { FastifyInstance } from "fastify";
import type { RealtimePublisher } from "../realtime/publisher.js";
import type { createSummaryService } from "../services/summary.js";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import { currentAppDate } from "../lib/time.js";
import { logSseConnectionState } from "../observability/events.js";
import { getProtectedOwner, PROTECTED_ROUTE_META, registerProtectedRoute } from "./protected-route.js";

interface Deps {
  publisher: RealtimePublisher;
  summaryService: ReturnType<typeof createSummaryService>;
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
}

export function registerSSERoutes(app: FastifyInstance, deps: Deps) {
  const { publisher, summaryService, deviceService, guestSessionService } = deps;

  registerProtectedRoute(app, { deviceService, guestSessionService }, {
    method: "GET",
    url: "/api/sse",
    protectedMeta: PROTECTED_ROUTE_META.sse,
    onAuthFailure: (request) => {
      logSseConnectionState(request.log, { state: "rejected" });
    },
    handler: async (request, reply) => {
    const owner = getProtectedOwner(request);
    const { deviceId } = owner;
    // Tell Fastify we're handling the response manually
    reply.hijack();
    const headers: OutgoingHttpHeaders = {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    };
    if (owner.setCookies) {
      headers["set-cookie"] = [...owner.setCookies];
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

    if (closed || reply.raw.destroyed) {
      return;
    }

    // Keepalive every 30s
    keepalive = setInterval(() => {
      if (!reply.raw.destroyed) {
        reply.raw.write(": keepalive\n\n");
      }
    }, 30000);
    },
  });
}
