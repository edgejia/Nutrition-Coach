import type { FastifyInstance } from "fastify";
import { buildAssetUrl, parseAssetRef } from "../services/assets.js";
import type { createFoodLoggingService } from "../services/food-logging.js";
import type { createSummaryService } from "../services/summary.js";
import type { createDeviceService } from "../services/device.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";

interface Deps {
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  summaryService: ReturnType<typeof createSummaryService>;
  deviceService: ReturnType<typeof createDeviceService>;
  publisher: RealtimePublisher;
}

export function registerMealRoutes(app: FastifyInstance, deps: Deps) {
  const { foodLoggingService, summaryService, deviceService, publisher } = deps;

  app.get("/api/meals", async (request, reply) => {
    const deviceId = request.headers["x-device-id"] as string;
    if (!deviceId) return reply.code(401).send({ error: "Missing X-Device-Id" });

    const device = await deviceService.getDevice(deviceId);
    if (!device) return reply.code(401).send({ error: "Invalid device ID" });

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
    const deviceId = request.headers["x-device-id"] as string;
    if (!deviceId) return reply.code(401).send({ error: "Missing X-Device-Id" });

    const device = await deviceService.getDevice(deviceId);
    if (!device) return reply.code(401).send({ error: "Invalid device ID" });

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
