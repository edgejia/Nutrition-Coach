import type { FastifyInstance } from "fastify";
import type { createAssetService } from "../services/assets.js";
import type { createDeviceService } from "../services/device.js";

interface Deps {
  assetService: ReturnType<typeof createAssetService>;
  deviceService: ReturnType<typeof createDeviceService>;
}

export function registerAssetRoutes(app: FastifyInstance, deps: Deps) {
  const { assetService, deviceService } = deps;

  app.get("/api/assets/:id", async (request, reply) => {
    const deviceId = request.headers["x-device-id"] as string;
    if (!deviceId) {
      return reply.code(401).send({ error: "Missing X-Device-Id" });
    }

    const device = await deviceService.getDevice(deviceId);
    if (!device) {
      return reply.code(401).send({ error: "Invalid device ID" });
    }

    const { id } = request.params as { id: string };
    const asset = await assetService.readOwnedAsset(deviceId, id);
    if (!asset) {
      return reply.code(404).send({ error: "Asset not found" });
    }

    reply.type(asset.mimeType);
    return reply.send(asset.bytes);
  });
}
