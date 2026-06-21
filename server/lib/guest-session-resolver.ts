import type { FastifyRequest } from "fastify";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";

type DeviceRecord = Awaited<ReturnType<ReturnType<typeof createDeviceService>["getDevice"]>>;

export type GuestSessionResolution =
  | {
      ok: true;
      deviceId: string;
      device: DeviceRecord;
      setCookies?: readonly string[];
    }
  | {
      ok: false;
      error: string;
      clearCookies: boolean;
    };

interface Deps {
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
}

function normalizeCookieHeader(header: FastifyRequest["headers"]["cookie"]) {
  if (Array.isArray(header)) {
    return header.join("; ");
  }
  return header;
}

export async function resolveGuestSession(
  request: FastifyRequest,
  { deviceService, guestSessionService }: Deps,
): Promise<GuestSessionResolution> {
  const { activeToken, resumeToken } = guestSessionService.readTokens(normalizeCookieHeader(request.headers.cookie));

  const activeSession = guestSessionService.verifyActiveSession(activeToken);
  if (activeSession.ok) {
    const device = await deviceService.getDevice(activeSession.deviceId);
    if (!device || activeSession.version !== device.sessionVersion) {
      return { ok: false, error: "Invalid guest session", clearCookies: true };
    }
    return { ok: true, deviceId: activeSession.deviceId, device };
  }

  const resumedSession = guestSessionService.verifyResumeSession(resumeToken);
  if (resumedSession.ok) {
    const device = await deviceService.getDevice(resumedSession.deviceId);
    if (!device || resumedSession.version !== device.sessionVersion) {
      return { ok: false, error: "Invalid guest session", clearCookies: true };
    }
    const issued = guestSessionService.issue(resumedSession.deviceId, device.sessionVersion);
    return {
      ok: true,
      deviceId: resumedSession.deviceId,
      device,
      setCookies: issued.cookies,
    };
  }

  return {
    ok: false,
    error: activeToken || resumeToken ? "Invalid guest session" : "Guest session required",
    clearCookies: Boolean(activeToken || resumeToken),
  };
}
