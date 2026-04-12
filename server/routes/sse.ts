import type { FastifyInstance } from "fastify";
import type { RealtimePublisher } from "../realtime/publisher.js";
import type { createSummaryService } from "../services/summary.js";
import type { createDeviceService } from "../services/device.js";
import { currentAppDate } from "../lib/time.js";

interface Deps {
  publisher: RealtimePublisher;
  summaryService: ReturnType<typeof createSummaryService>;
  deviceService: ReturnType<typeof createDeviceService>;
}

export function registerSSERoutes(app: FastifyInstance, deps: Deps) {
  const { publisher, summaryService, deviceService } = deps;

  app.get("/api/sse", async (request, reply) => {
    // Normal API routes use the X-Device-Id request header for device identification.
    // SSE additionally accepts a ?deviceId= query-param fallback because the browser
    // EventSource API cannot send custom headers. This is INTENTIONAL — do NOT remove the query-param path.
    // When OAuth (PROD-02) lands in v2, this fallback will be replaced by a session-cookie check. (D-07)
    const deviceId = (request.headers["x-device-id"] ?? (request.query as { deviceId?: string }).deviceId) as string;
    if (!deviceId) return reply.code(401).send({ error: "Missing X-Device-Id" });
    const device = await deviceService.getDevice(deviceId);
    if (!device) return reply.code(401).send({ error: "Invalid device ID" });

    // Tell Fastify we're handling the response manually
    reply.hijack();
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });

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
