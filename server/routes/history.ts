import type { FastifyInstance } from "fastify";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import {
  HistoryQueryValidationError,
  type HistoryNutritionBounds,
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

function invalidRepeatedQueryField(field: string): HistoryQueryIssue {
  return { field, message: `${field} is invalid` };
}

function queryStringValue(
  query: Record<string, unknown>,
  field: string,
): { ok: true; value: string | undefined } | { ok: false; issue: HistoryQueryIssue } {
  const value = singleQueryValue(query[field]);
  if (typeof query[field] !== "undefined" && typeof value === "undefined") {
    return { ok: false, issue: invalidRepeatedQueryField(field) };
  }

  return { ok: true, value };
}

function parseNutritionBound(
  query: Record<string, unknown>,
  field: string,
): { ok: true; value: number | undefined } | { ok: false; issue: HistoryQueryIssue } {
  const rawValue = singleQueryValue(query[field]);
  if (typeof query[field] === "undefined") {
    return { ok: true, value: undefined };
  }

  if (typeof rawValue === "undefined") {
    return { ok: false, issue: invalidRepeatedQueryField(field) };
  }

  const value = Number(rawValue);
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, issue: { field, message: `${field} must be a non-negative number` } };
  }

  return { ok: true, value };
}

function parseNutritionBounds(
  query: Record<string, unknown>,
): { ok: true; bounds: HistoryNutritionBounds | undefined } | { ok: false; issue: HistoryQueryIssue } {
  if (typeof query.filters !== "undefined") {
    return { ok: false, issue: { field: "filters", message: "filters is not supported" } };
  }

  const nestedNutritionField = Object.keys(query).find((field) => field === "nutrition" || field.startsWith("nutrition["));
  if (nestedNutritionField) {
    return { ok: false, issue: { field: nestedNutritionField, message: `${nestedNutritionField} is not supported` } };
  }

  const nutrients = [
    ["calories", "caloriesMin", "caloriesMax"],
    ["protein", "proteinMin", "proteinMax"],
    ["carbs", "carbsMin", "carbsMax"],
    ["fat", "fatMin", "fatMax"],
  ] as const;
  const bounds: HistoryNutritionBounds = {};

  for (const [nutrient, minField, maxField] of nutrients) {
    const minResult = parseNutritionBound(query, minField);
    if (!minResult.ok) {
      return { ok: false, issue: minResult.issue };
    }

    const maxResult = parseNutritionBound(query, maxField);
    if (!maxResult.ok) {
      return { ok: false, issue: maxResult.issue };
    }

    if (
      typeof minResult.value !== "undefined" &&
      typeof maxResult.value !== "undefined" &&
      minResult.value > maxResult.value
    ) {
      return {
        ok: false,
        issue: {
          field: minField,
          message: `${minField} must be less than or equal to ${maxField}`,
        },
      };
    }

    if (typeof minResult.value !== "undefined" || typeof maxResult.value !== "undefined") {
      bounds[nutrient] = { min: minResult.value, max: maxResult.value };
    }
  }

  return { ok: true, bounds: Object.keys(bounds).length > 0 ? bounds : undefined };
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

  app.get("/api/history/search", async (request, reply) => {
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
    const qResult = queryStringValue(query, "q");
    if (!qResult.ok) {
      return reply.code(400).send(invalidQuery([qResult.issue]));
    }
    if (!qResult.value || qResult.value.trim().length === 0) {
      return reply.code(400).send(invalidQuery([{ field: "q", message: "q is required" }]));
    }

    const fromResult = queryStringValue(query, "from");
    if (!fromResult.ok) {
      return reply.code(400).send(invalidQuery([fromResult.issue]));
    }
    if (!fromResult.value) {
      return reply.code(400).send(invalidQuery([{ field: "from", message: "from is required" }]));
    }

    const toResult = queryStringValue(query, "to");
    if (!toResult.ok) {
      return reply.code(400).send(invalidQuery([toResult.issue]));
    }
    if (!toResult.value) {
      return reply.code(400).send(invalidQuery([{ field: "to", message: "to is required" }]));
    }

    const parsedLimit = parseLimit(query.limit);
    if (!parsedLimit.ok) {
      return reply.code(400).send(invalidQuery([parsedLimit.issue]));
    }

    const cursorResult = queryStringValue(query, "cursor");
    if (!cursorResult.ok) {
      return reply.code(400).send(invalidQuery([{ field: "cursor", message: "cursor is invalid" }]));
    }

    const boundsResult = parseNutritionBounds(query);
    if (!boundsResult.ok) {
      return reply.code(400).send(invalidQuery([boundsResult.issue]));
    }

    try {
      return await historyQueryService.searchMeals({
        deviceId,
        q: qResult.value,
        from: fromResult.value,
        to: toResult.value,
        limit: parsedLimit.limit,
        cursor: cursorResult.value,
        nutritionBounds: boundsResult.bounds,
      });
    } catch (error) {
      if (error instanceof HistoryQueryValidationError) {
        return reply.code(400).send(invalidQuery(error.issues));
      }
      throw error;
    }
  });

  app.get("/api/history/trends", async (request, reply) => {
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
    const fromResult = queryStringValue(query, "from");
    if (!fromResult.ok) {
      return reply.code(400).send(invalidQuery([fromResult.issue]));
    }
    if (!fromResult.value) {
      return reply.code(400).send(invalidQuery([{ field: "from", message: "from is required" }]));
    }

    const toResult = queryStringValue(query, "to");
    if (!toResult.ok) {
      return reply.code(400).send(invalidQuery([toResult.issue]));
    }
    if (!toResult.value) {
      return reply.code(400).send(invalidQuery([{ field: "to", message: "to is required" }]));
    }

    try {
      return await historyQueryService.getTrends({
        deviceId,
        from: fromResult.value,
        to: toResult.value,
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
