import type { FastifyInstance } from "fastify";
import { buildAssetUrl, parseAssetRef } from "../services/assets.js";
import type { createDaySnapshotService } from "../services/day-snapshot.js";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";

interface Deps {
  daySnapshotService: ReturnType<typeof createDaySnapshotService>;
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
}

export function registerDaySnapshotRoutes(app: FastifyInstance, deps: Deps) {
  const { daySnapshotService, deviceService, guestSessionService } = deps;

  app.get("/api/day-snapshot", async (request, reply) => {
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
          };
        }),
      };
    } catch (error) {
      if (error instanceof Error && error.message === "INVALID_DATE_KEY") {
        return reply.code(400).send({ error: "Invalid date query" });
      }
      throw error;
    }
  });
}
