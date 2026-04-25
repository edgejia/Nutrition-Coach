import type { FastifyInstance } from "fastify";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";
import {
  logHomeCtaIntentSelected,
  logHomeCtaOptionSent,
  parseHomeCtaClientEvent,
} from "../observability/events.js";

interface Deps {
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
}

export function registerObservabilityRoutes(app: FastifyInstance, deps: Deps) {
  const { deviceService, guestSessionService } = deps;

  app.post("/api/observability/client-event", async (request, reply) => {
    const session = await resolveGuestSession(request, { deviceService, guestSessionService });
    if (!session.ok) {
      if (session.clearCookies) {
        reply.header("set-cookie", guestSessionService.clearSessionCookies());
      }
      return reply.code(401).send({ error: session.error });
    }
    if (session.setCookies) {
      reply.header("set-cookie", session.setCookies);
    }

    const parsed = parseHomeCtaClientEvent(request.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: parsed.error });
    }

    if (parsed.event.event === "home_cta_intent_selected") {
      logHomeCtaIntentSelected(request.log, { intent: parsed.event.intent });
    } else {
      logHomeCtaOptionSent(request.log, {
        intent: parsed.event.intent,
        promptKey: parsed.event.promptKey,
      });
    }

    return { ok: true };
  });
}
