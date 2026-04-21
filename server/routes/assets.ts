import type { FastifyInstance } from "fastify";
import type { createAssetService } from "../services/assets.js";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";

interface Deps {
  assetService: ReturnType<typeof createAssetService>;
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
}

export function registerAssetRoutes(app: FastifyInstance, deps: Deps) {
  const { assetService, deviceService, guestSessionService } = deps;

  app.get("/api/assets/:id", async (request, reply) => {
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
    const asset = await assetService.readOwnedAsset(deviceId, id);
    if (!asset) {
      return reply.code(404).send({ error: "Asset not found" });
    }

    reply.type(asset.mimeType);
    return reply.send(asset.bytes);
  });
}
