import type { FastifyInstance } from "fastify";
import type { createDeviceService, Goal } from "../services/device.js";

interface Deps {
  deviceService: ReturnType<typeof createDeviceService>;
}

export function registerDeviceRoutes(app: FastifyInstance, { deviceService }: Deps) {
  app.post("/api/device", async (request, reply) => {
    const { goal } = request.body as { goal: string };
    if (!goal || !["fat_loss", "muscle_gain"].includes(goal)) {
      return reply.code(400).send({ error: "Invalid goal. Must be fat_loss or muscle_gain." });
    }
    const result = await deviceService.createDevice(goal as Goal);
    return result;
  });

  app.put("/api/device/goals", async (request, reply) => {
    const deviceId = request.headers["x-device-id"] as string;
    if (!deviceId) return reply.code(401).send({ error: "Missing X-Device-Id" });

    const device = await deviceService.getDevice(deviceId);
    if (!device) return reply.code(401).send({ error: "Invalid device ID" });

    const body = request.body as Record<string, unknown>;
    const validKeys = ["calories", "protein", "carbs", "fat"];
    const goals: Record<string, number> = {};
    for (const key of validKeys) {
      if (key in body) {
        const val = Number(body[key]);
        if (!Number.isFinite(val) || val < 0) {
          return reply.code(400).send({ error: `Invalid value for ${key}` });
        }
        goals[key] = val;
      }
    }
    const dailyTargets = await deviceService.updateGoals(deviceId, goals);
    return { dailyTargets };
  });
}
