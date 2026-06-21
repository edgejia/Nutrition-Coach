import type { FastifyInstance } from "fastify";
import { buildAssetUrl, parseAssetRef } from "../services/assets.js";
import type { createDaySnapshotService } from "../services/day-snapshot.js";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import { getProtectedOwner, PROTECTED_ROUTE_META, registerProtectedRoute } from "./protected-route.js";

interface Deps {
  daySnapshotService: ReturnType<typeof createDaySnapshotService>;
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
}

export function registerDaySnapshotRoutes(app: FastifyInstance, deps: Deps) {
  const { daySnapshotService, deviceService, guestSessionService } = deps;

  registerProtectedRoute(app, { deviceService, guestSessionService }, {
    method: "GET",
    url: "/api/day-snapshot",
    protectedMeta: PROTECTED_ROUTE_META.daySnapshot,
    handler: async (request, reply) => {
      const { deviceId } = getProtectedOwner(request);

      const { date } = request.query as { date?: string };
      if (!date) {
        return reply.code(400).send({ error: "Missing date query" });
      }

      try {
        const snapshot = await daySnapshotService.getDaySnapshot(deviceId, date);
        return {
          date: snapshot.date,
          summary: snapshot.summary,
          meals: snapshot.meals.map((meal) => {
            const imageAssetId = parseAssetRef(meal.imagePath);
            return {
              id: meal.id,
              mealRevisionId: meal.mealRevisionId,
              foodName: meal.foodName,
              itemCount: meal.itemCount ?? 1,
              calories: meal.calories,
              protein: meal.protein,
              carbs: meal.carbs,
              fat: meal.fat,
              imageAssetId,
              imageUrl: imageAssetId ? buildAssetUrl(imageAssetId) : null,
              loggedAt: meal.loggedAt,
              ...(meal.mealPeriod ? { mealPeriod: meal.mealPeriod } : {}),
            };
          }),
        };
      } catch (error) {
        if (error instanceof Error && error.message === "INVALID_DATE_KEY") {
          return reply.code(400).send({ error: "Invalid date query" });
        }
        throw error;
      }
    },
  });
}
