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
