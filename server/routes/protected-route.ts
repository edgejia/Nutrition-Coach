import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";
import {
  logOwnershipBypassBlocked,
  type OwnershipBypassBlockedOperation,
  type OwnershipBypassBlockedRoute,
} from "../observability/events.js";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";

type DeviceRecord = Awaited<ReturnType<ReturnType<typeof createDeviceService>["getDevice"]>>;
type FastifyRouteOptions = Parameters<FastifyInstance["route"]>[0];
type FastifyPreHandler = NonNullable<FastifyRouteOptions["preHandler"]>;

export interface ProtectedRouteMetadata {
  route: OwnershipBypassBlockedRoute;
  operation: OwnershipBypassBlockedOperation;
}

export interface ProtectedRouteDeps {
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
}

export interface ProtectedOwner {
  deviceId: string;
  device: DeviceRecord;
  setCookies?: readonly string[];
}

export type ProtectedRouteKey =
  | "chatMessage"
  | "chatStop"
  | "chatHistory"
  | "mealsList"
  | "mealUpdate"
  | "mealDelete"
  | "historyMeals"
  | "historySearch"
  | "historyTrends"
  | "historyDay"
  | "assetRead"
  | "daySnapshot"
  | "proposalAction"
  | "observabilityClientEvent"
  | "sse"
  | "deviceGoalsPatch"
  | "deviceGoalsPut";

type ProtectedRouteOptions = Omit<FastifyRouteOptions, "preHandler"> & {
  protectedMeta: ProtectedRouteMetadata;
  onAuthFailure?: (request: FastifyRequest) => void;
  preHandler?: FastifyRouteOptions["preHandler"];
};

declare module "fastify" {
  interface FastifyRequest {
    protectedOwner?: ProtectedOwner;
  }
}

export const PROTECTED_ROUTE_META = {
  chatMessage: { route: "api_chat", operation: "chat_message" },
  chatStop: { route: "api_chat_stop", operation: "chat_stop" },
  chatHistory: { route: "api_chat_history", operation: "chat_history_list" },
  mealsList: { route: "api_meals", operation: "meals_list" },
  mealUpdate: { route: "api_meal", operation: "meal_update" },
  mealDelete: { route: "api_meal", operation: "meal_delete" },
  historyMeals: { route: "api_history_meals", operation: "history_meals_list" },
  historySearch: { route: "api_history_search", operation: "history_search" },
  historyTrends: { route: "api_history_trends", operation: "history_trends" },
  historyDay: { route: "api_history_day", operation: "history_day_detail" },
  assetRead: { route: "api_assets", operation: "asset_read" },
  daySnapshot: { route: "api_day_snapshot", operation: "day_snapshot_read" },
  proposalAction: { route: "api_proposals_actions", operation: "proposal_action" },
  observabilityClientEvent: {
    route: "api_observability_client_event",
    operation: "client_event_record",
  },
  sse: { route: "api_sse", operation: "sse_subscribe" },
  deviceGoalsPatch: { route: "api_device_goals", operation: "device_goals_update" },
  deviceGoalsPut: { route: "api_device_goals", operation: "device_goals_update" },
} as const satisfies Record<ProtectedRouteKey, ProtectedRouteMetadata>;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value.join("; ") : value;
}

function isMultipartRequest(request: FastifyRequest) {
  const contentType = normalizeHeaderValue(request.headers["content-type"]);
  return contentType?.toLowerCase().includes("multipart/form-data") ?? false;
}

export function registerProtectedRouteSupport(app: FastifyInstance) {
  app.decorateRequest("protectedOwner");
}

export function hasRawHeaderOrQueryDeviceIdSelector(request: FastifyRequest) {
  return (
    request.headers["x-device-id"] !== undefined
    || (isPlainRecord(request.query) && "deviceId" in request.query)
  );
}

/**
 * Detects forbidden raw ownership selectors in already-parsed non-multipart
 * request bodies. Multipart field ownership checks stay parser-owned because
 * upload cleanup depends on the route's staged-file lifecycle.
 */
export function hasRawBodyDeviceIdSelector(request: FastifyRequest) {
  return !isMultipartRequest(request) && isPlainRecord(request.body) && "deviceId" in request.body;
}

export function getProtectedOwner(request: FastifyRequest) {
  const owner = request.protectedOwner;
  if (!owner) {
    throw new Error("Protected route owner was not resolved");
  }
  return owner;
}

export function buildProtectedPreHandler(
  deps: ProtectedRouteDeps,
  meta: ProtectedRouteMetadata,
  onAuthFailure?: (request: FastifyRequest) => void,
) {
  return async function protectedPreHandler(request: FastifyRequest, reply: FastifyReply) {
    const session = await resolveGuestSession(request, deps);
    if (!session.ok) {
      if (session.clearCookies) {
        reply.header("set-cookie", deps.guestSessionService.clearSessionCookies());
      }
      onAuthFailure?.(request);
      return reply.code(401).send({ error: session.error });
    }

    request.protectedOwner = {
      deviceId: session.deviceId,
      device: session.device,
      ...(session.setCookies ? { setCookies: session.setCookies } : {}),
    };
    if (session.setCookies) {
      reply.header("set-cookie", session.setCookies);
    }

    if (hasRawHeaderOrQueryDeviceIdSelector(request) || hasRawBodyDeviceIdSelector(request)) {
      logOwnershipBypassBlocked(request.log, {
        reason: "raw_device_id_param",
        route: meta.route,
        operation: meta.operation,
        requestId: request.id,
      });
      return reply.code(400).send({ error: "Raw device selector is not allowed" });
    }
  };
}

function chainPreHandlers(
  protectedPreHandler: ReturnType<typeof buildProtectedPreHandler>,
  existingPreHandler: FastifyRouteOptions["preHandler"],
): FastifyPreHandler {
  if (!existingPreHandler) {
    return protectedPreHandler;
  }
  return Array.isArray(existingPreHandler)
    ? [protectedPreHandler, ...existingPreHandler] as FastifyPreHandler
    : [protectedPreHandler, existingPreHandler] as FastifyPreHandler;
}

export function registerProtectedRoute(
  app: FastifyInstance,
  deps: ProtectedRouteDeps,
  routeOptions: ProtectedRouteOptions,
) {
  const { protectedMeta, onAuthFailure, preHandler, ...fastifyRouteOptions } = routeOptions;
  app.route({
    ...fastifyRouteOptions,
    preHandler: chainPreHandlers(buildProtectedPreHandler(deps, protectedMeta, onAuthFailure), preHandler),
  });
}
