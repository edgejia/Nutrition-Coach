import type { OutgoingHttpHeaders } from "node:http";
import type { FastifyInstance } from "fastify";
import type { RealtimePublisher } from "../realtime/publisher.js";
import type { createSummaryService } from "../services/summary.js";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import { currentAppDate } from "../lib/time.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";

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

    // Send initial daily summary
    const summary = await summaryService.getDailySummary(deviceId, currentAppDate());
    reply.raw.write(`event: daily_summary\ndata: ${JSON.stringify(summary)}\n\n`);

    // Subscribe for future updates
    publisher.subscribe(deviceId, reply);

    // Keepalive every 30s
    const keepalive = setInterval(() => {
      reply.raw.write(": keepalive\n\n");
    }, 30000);

    // Cleanup on disconnect
    request.raw.on("close", () => {
      clearInterval(keepalive);
      publisher.unsubscribe(deviceId, reply);
    });
  });
}
