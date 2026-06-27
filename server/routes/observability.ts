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

const ONBOARDING_DEBUG_EVENTS = new Set([
  "onboarding_back_diagnostic",
  "onboarding_refresh_fired",
]);
const ONBOARDING_BACK_DIAGNOSTIC_EVENTS = new Set([
  "popstate",
  "go_back_handled",
  "go_back_unhandled",
  "rearm_attempted",
  "rearm_confirmed",
  "browser_back_delegated",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseStep(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6
    ? value
    : undefined;
}

function parseBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function parseOnboardingDebugEvent(body: unknown) {
  if (!isRecord(body) || typeof body.event !== "string" || !ONBOARDING_DEBUG_EVENTS.has(body.event)) {
    return null;
  }

  const diagnosticEvent = typeof body.diagnosticEvent === "string" && ONBOARDING_BACK_DIAGNOSTIC_EVENTS.has(body.diagnosticEvent)
    ? body.diagnosticEvent
    : undefined;

  return {
    onboardingEvent: body.event,
    ...(diagnosticEvent ? { diagnosticEvent } : {}),
    ...(parseStep(body.currentStep) !== undefined ? { currentStep: parseStep(body.currentStep) } : {}),
    ...(parseStep(body.nextStep) !== undefined ? { nextStep: parseStep(body.nextStep) } : {}),
    ...(parseBoolean(body.handled) !== undefined ? { handled: parseBoolean(body.handled) } : {}),
    ...(parseBoolean(body.repaired) !== undefined ? { repaired: parseBoolean(body.repaired) } : {}),
  };
}

export function registerObservabilityRoutes(app: FastifyInstance, deps: Deps) {
  const { deviceService, guestSessionService } = deps;

  app.post("/api/observability/onboarding-debug", async (request, reply) => {
    if (process.env.LOG_LEVEL !== "debug") {
      return reply.code(404).send({ error: "Not Found" });
    }

    const parsed = parseOnboardingDebugEvent(request.body);
    if (!parsed) {
      return reply.code(400).send({ error: "Invalid onboarding debug event" });
    }

    request.log.info({ event: "onboarding_debug_event", ...parsed }, "Onboarding debug event");
    return { ok: true };
  });

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
