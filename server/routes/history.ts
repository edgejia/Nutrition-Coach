import type { FastifyInstance } from "fastify";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import {
  HistoryQueryValidationError,
  type HistoryQueryIssue,
  type createHistoryQueryService,
} from "../services/history-query.js";

interface Deps {
  historyQueryService: ReturnType<typeof createHistoryQueryService>;
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
}

function invalidQuery(issues: HistoryQueryIssue[]) {
  return { error: "Invalid query", code: "INVALID_QUERY", issues };
}

function singleQueryValue(value: unknown): string | undefined {
  if (typeof value === "undefined") {
    return undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  return value;
}

function parseLimit(value: unknown): { ok: true; limit: number } | { ok: false; issue: HistoryQueryIssue } {
  const rawValue = singleQueryValue(value);
  if (typeof rawValue === "undefined") {
    return { ok: true, limit: 25 };
  }

  if (!/^\d+$/.test(rawValue)) {
    return { ok: false, issue: { field: "limit", message: "limit must be an integer" } };
  }

  const limit = Number(rawValue);
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    return { ok: false, issue: { field: "limit", message: "limit must be between 1 and 100" } };
  }

  return { ok: true, limit };
}

export function registerHistoryRoutes(app: FastifyInstance, deps: Deps) {
  const { historyQueryService, deviceService, guestSessionService } = deps;

  app.get("/api/history/meals", async (request, reply) => {
    const session = await resolveGuestSession(request, { deviceService, guestSessionService });
    if (!session.ok) {
      if (session.clearCookies) {
        reply.header("set-cookie", guestSessionService.clearSessionCookies());
      }
      return reply.code(401).send({ error: session.error });
    }
    const { deviceId } = session;
    if (session.setCookies) {
      reply.header("set-cookie", session.setCookies);
    }

    const query = request.query as Record<string, unknown>;
    const from = singleQueryValue(query.from);
    if (!from) {
      return reply.code(400).send(invalidQuery([{ field: "from", message: "from is required" }]));
    }

    const to = singleQueryValue(query.to);
    if (!to) {
      return reply.code(400).send(invalidQuery([{ field: "to", message: "to is required" }]));
    }

    const parsedLimit = parseLimit(query.limit);
    if (!parsedLimit.ok) {
      return reply.code(400).send(invalidQuery([parsedLimit.issue]));
    }

    const cursor = singleQueryValue(query.cursor);
    if (typeof query.cursor !== "undefined" && typeof cursor === "undefined") {
      return reply.code(400).send(invalidQuery([{ field: "cursor", message: "cursor is invalid" }]));
    }

    try {
      return await historyQueryService.getMeals({
        deviceId,
        from,
        to,
        limit: parsedLimit.limit,
        cursor,
      });
    } catch (error) {
      if (error instanceof HistoryQueryValidationError) {
        return reply.code(400).send(invalidQuery(error.issues));
      }
      throw error;
    }
  });

  app.get("/api/history/days/:date", async (request, reply) => {
    const session = await resolveGuestSession(request, { deviceService, guestSessionService });
    if (!session.ok) {
      if (session.clearCookies) {
        reply.header("set-cookie", guestSessionService.clearSessionCookies());
      }
      return reply.code(401).send({ error: session.error });
    }
    const { deviceId } = session;
    if (session.setCookies) {
      reply.header("set-cookie", session.setCookies);
    }

    const { date } = request.params as { date: string };
    try {
      return await historyQueryService.getDaySnapshot({ deviceId, date });
    } catch (error) {
      if (error instanceof HistoryQueryValidationError) {
        return reply.code(400).send(invalidQuery(error.issues));
      }
      throw error;
    }
  });
}
