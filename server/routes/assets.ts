import type { FastifyInstance } from "fastify";
import type { createAssetService } from "../services/assets.js";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import { getProtectedOwner, PROTECTED_ROUTE_META, registerProtectedRoute } from "./protected-route.js";

interface Deps {
  assetService: ReturnType<typeof createAssetService>;
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
}

export function registerAssetRoutes(app: FastifyInstance, deps: Deps) {
  const { assetService, deviceService, guestSessionService } = deps;

  registerProtectedRoute(app, { deviceService, guestSessionService }, {
    method: "GET",
    url: "/api/assets/:id",
    protectedMeta: PROTECTED_ROUTE_META.assetRead,
    handler: async (request, reply) => {
      const { deviceId } = getProtectedOwner(request);

      const { id } = request.params as { id: string };
      const asset = await assetService.readOwnedAsset(deviceId, id);
      if (!asset) {
        return reply.code(404).send({ error: "Asset not found" });
      }

      reply.type(asset.mimeType);
      return reply.send(asset.bytes);
    },
  });
}
