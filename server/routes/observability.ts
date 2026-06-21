import type { FastifyInstance } from "fastify";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import {
  logHomeCtaIntentSelected,
  logHomeCtaOptionSent,
  parseHomeCtaClientEvent,
} from "../observability/events.js";
import { PROTECTED_ROUTE_META, registerProtectedRoute } from "./protected-route.js";

interface Deps {
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
}

export function registerObservabilityRoutes(app: FastifyInstance, deps: Deps) {
  const { deviceService, guestSessionService } = deps;

  registerProtectedRoute(app, { deviceService, guestSessionService }, {
    method: "POST",
    url: "/api/observability/client-event",
    protectedMeta: PROTECTED_ROUTE_META.observabilityClientEvent,
    handler: async (request, reply) => {
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
    },
  });
}
