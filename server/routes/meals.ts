import type { FastifyInstance } from "fastify";
import { buildAssetUrl, parseAssetRef } from "../services/assets.js";
import type { createFoodLoggingService } from "../services/food-logging.js";
import type { createSummaryService } from "../services/summary.js";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";

interface Deps {
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  summaryService: ReturnType<typeof createSummaryService>;
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
  publisher: RealtimePublisher;
}

interface MealUpdateBody {
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  imageAssetId?: string | null;
}

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parseMealUpdateBody(body: unknown): MealUpdateBody | null {
  if (!body || typeof body !== "object") {
    return null;
  }

  const input = body as Record<string, unknown>;
  const foodName = typeof input.foodName === "string" ? input.foodName.trim() : "";
  const imageAssetId =
    typeof input.imageAssetId === "string" && input.imageAssetId.trim()
      ? input.imageAssetId.trim()
      : null;

  if (!foodName) {
    return null;
  }

  if (
    !isFiniteNonNegativeNumber(input.calories) ||
    !isFiniteNonNegativeNumber(input.protein) ||
    !isFiniteNonNegativeNumber(input.carbs) ||
    !isFiniteNonNegativeNumber(input.fat)
  ) {
    return null;
  }

  return {
    foodName,
    calories: input.calories,
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    imageAssetId,
  };
}

export function registerMealRoutes(app: FastifyInstance, deps: Deps) {
  const { foodLoggingService, summaryService, deviceService, guestSessionService, publisher } = deps;

  app.get("/api/meals", async (request, reply) => {
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

    if (request.headers["x-refresh-reason"] === "day_rollover") {
      request.log.info({ event: "day_rollover" }, "Day rollover meals refresh");
    }

    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    return {
      meals: meals.map((meal) => {
        const imageAssetId = parseAssetRef(meal.imagePath);
        return {
          id: meal.id,
          foodName: meal.foodName,
          calories: meal.calories,
          protein: meal.protein,
          carbs: meal.carbs,
          fat: meal.fat,
          imageAssetId,
          imageUrl: imageAssetId ? buildAssetUrl(imageAssetId) : null,
          loggedAt: meal.loggedAt,
        };
      }),
    };
  });

  app.patch("/api/meals/:id", async (request, reply) => {
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

    const update = parseMealUpdateBody(request.body);
    if (!update) {
      return reply.code(400).send({ error: "Invalid meal update" });
    }

    const { id } = request.params as { id: string };
    let affectedDateKey: string;
    let updatedMeal: Awaited<ReturnType<typeof foodLoggingService.updateMeal>>;
    try {
      updatedMeal = await foodLoggingService.updateMeal(deviceId, id, {
        imagePath: update.imageAssetId ? `asset:${update.imageAssetId}` : null,
        items: [
          {
            foodName: update.foodName,
            calories: update.calories,
            protein: update.protein,
            carbs: update.carbs,
            fat: update.fat,
          },
        ],
      });
      affectedDateKey = formatLocalDate(new Date(updatedMeal.loggedAt));
    } catch (error) {
      if (error instanceof Error && error.message === "MEAL_NOT_FOUND") {
        return reply.code(404).send({ error: "Meal not found" });
      }
      throw error;
    }

    const dailySummary = await summaryService.getDailySummary(
      deviceId,
      new Date(`${affectedDateKey}T12:00:00`),
    );
    if (dailySummary.date === formatLocalDate(currentAppDate())) {
      publisher.publishDailySummary(deviceId, dailySummary);
    }

    const imageAssetId = parseAssetRef(updatedMeal.imagePath);
    return {
      affectedDate: affectedDateKey,
      dailySummary,
      meal: {
        id: updatedMeal.id,
        foodName: updatedMeal.foodName,
        calories: updatedMeal.calories,
        protein: updatedMeal.protein,
        carbs: updatedMeal.carbs,
        fat: updatedMeal.fat,
        imageAssetId,
        imageUrl: imageAssetId ? buildAssetUrl(imageAssetId) : null,
        loggedAt: updatedMeal.loggedAt,
      },
    };
  });

  app.delete("/api/meals/:id", async (request, reply) => {
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

    const { id } = request.params as { id: string };
    let affectedDateKey: string;
    try {
      ({ affectedDateKey } = await foodLoggingService.deleteMeal(deviceId, id));
    } catch (error) {
      if (error instanceof Error && error.message === "MEAL_NOT_FOUND") {
        return reply.code(404).send({ error: "Meal not found" });
      }
      throw error;
    }

    const dailySummary = await summaryService.getDailySummary(
      deviceId,
      new Date(`${affectedDateKey}T12:00:00`),
    );
    if (dailySummary.date === formatLocalDate(currentAppDate())) {
      publisher.publishDailySummary(deviceId, dailySummary);
    }
    return {
      affectedDate: affectedDateKey,
      dailySummary,
    };
  });
}
