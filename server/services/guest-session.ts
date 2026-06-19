import { createHmac, timingSafeEqual } from "node:crypto";

type GuestSessionKind = "active" | "resume";
type GuestSessionFailureReason = "missing" | "invalid" | "expired";

interface GuestSessionClaims {
  deviceId: string;
  kind: GuestSessionKind;
  exp: number;
  ver: number;
}

interface GuestSessionOptions {
  secret: string;
  activeCookieName: string;
  resumeCookieName: string;
  activeTtlSeconds: number;
  resumeTtlSeconds: number;
  secure: boolean;
  now?: () => Date;
}

export interface IssuedGuestSession {
  deviceId: string;
  activeToken: string;
  resumeToken: string;
  activeExpiresAt: string;
  resumeExpiresAt: string;
  cookies: [string, string];
}

export type GuestSessionVerificationResult =
  | {
      ok: true;
      deviceId: string;
      version: number;
      expiresAt: string;
    }
  | {
      ok: false;
      reason: GuestSessionFailureReason;
    };

function base64urlEncodeJson(value: GuestSessionClaims) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function createSignature(secret: string, encodedClaims: string) {
  return createHmac("sha256", secret).update(encodedClaims).digest("base64url");
}

function serializeCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
  secure: boolean,
) {
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) {
    attributes.push("Secure");
  }
  return attributes.join("; ");
}

function decodeClaims(token: string): GuestSessionClaims | null {
  try {
    const decoded = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Record<string, unknown>;
    if (
      typeof decoded.deviceId !== "string"
      || (decoded.kind !== "active" && decoded.kind !== "resume")
      || typeof decoded.exp !== "number"
      || !Number.isFinite(decoded.exp)
    ) {
      return null;
    }
    const version = Object.hasOwn(decoded, "ver") ? decoded.ver : 0;
    if (
      typeof version !== "number"
      || !Number.isSafeInteger(version)
      || version < 0
    ) {
      return null;
    }
    return {
      deviceId: decoded.deviceId,
      kind: decoded.kind,
      exp: decoded.exp,
      ver: version,
    };
  } catch {
    return null;
  }
}

function parseCookieHeader(cookieHeader: string | undefined) {
  const cookies = new Map<string, string>();
  if (!cookieHeader) {
    return cookies;
  }

  for (const part of cookieHeader.split(";")) {
    const trimmedPart = part.trim();
    if (!trimmedPart) {
      continue;
    }

    const separatorIndex = trimmedPart.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const name = trimmedPart.slice(0, separatorIndex);
    const value = trimmedPart.slice(separatorIndex + 1);
    cookies.set(name, decodeURIComponent(value));
  }

  return cookies;
}

export function createGuestSessionService(options: GuestSessionOptions) {
  const now = options.now ?? (() => new Date());

  function issueToken(deviceId: string, sessionVersion: number, kind: GuestSessionKind, ttlSeconds: number) {
    if (!Number.isSafeInteger(sessionVersion) || sessionVersion < 0) {
      throw new Error("Guest session version must be a non-negative safe integer");
    }
    const expiresAt = new Date(now().getTime() + ttlSeconds * 1000);
    const claims: GuestSessionClaims = {
      deviceId,
      kind,
      exp: Math.floor(expiresAt.getTime() / 1000),
      ver: sessionVersion,
    };
    const encodedClaims = base64urlEncodeJson(claims);
    const signature = createSignature(options.secret, encodedClaims);
    return {
      token: `${encodedClaims}.${signature}`,
      expiresAt,
    };
  }

  function verifyToken(token: string | undefined, expectedKind: GuestSessionKind): GuestSessionVerificationResult {
    if (!token) {
      return { ok: false, reason: "missing" };
    }

    const [encodedClaims, signature] = token.split(".", 2);
    if (!encodedClaims || !signature) {
      return { ok: false, reason: "invalid" };
    }

    const expectedSignature = createSignature(options.secret, encodedClaims);
    if (expectedSignature.length !== signature.length) {
      return { ok: false, reason: "invalid" };
    }

    if (
      !timingSafeEqual(Buffer.from(expectedSignature, "utf8"), Buffer.from(signature, "utf8"))
    ) {
      return { ok: false, reason: "invalid" };
    }

    const claims = decodeClaims(encodedClaims);
    if (!claims || claims.kind !== expectedKind) {
      return { ok: false, reason: "invalid" };
    }

    if (claims.exp <= Math.floor(now().getTime() / 1000)) {
      return { ok: false, reason: "expired" };
    }

    return {
      ok: true,
      deviceId: claims.deviceId,
      version: claims.ver,
      expiresAt: new Date(claims.exp * 1000).toISOString(),
    };
  }

  return {
    settings: {
      activeCookieName: options.activeCookieName,
      resumeCookieName: options.resumeCookieName,
      activeTtlSeconds: options.activeTtlSeconds,
      resumeTtlSeconds: options.resumeTtlSeconds,
      secure: options.secure,
    },

    issue(deviceId: string, sessionVersion: number): IssuedGuestSession {
      const active = issueToken(deviceId, sessionVersion, "active", options.activeTtlSeconds);
      const resume = issueToken(deviceId, sessionVersion, "resume", options.resumeTtlSeconds);
      return {
        deviceId,
        activeToken: active.token,
        resumeToken: resume.token,
        activeExpiresAt: active.expiresAt.toISOString(),
        resumeExpiresAt: resume.expiresAt.toISOString(),
        cookies: [
          serializeCookie(options.activeCookieName, active.token, options.activeTtlSeconds, options.secure),
          serializeCookie(options.resumeCookieName, resume.token, options.resumeTtlSeconds, options.secure),
        ],
      };
    },

    verifyActiveSession(token: string | undefined) {
      return verifyToken(token, "active");
    },

    verifyResumeSession(token: string | undefined) {
      return verifyToken(token, "resume");
    },

    clearSessionCookies() {
      return [
        serializeCookie(options.activeCookieName, "", 0, options.secure),
        serializeCookie(options.resumeCookieName, "", 0, options.secure),
      ] as const;
    },

    readTokens(cookieHeader: string | undefined) {
      const cookies = parseCookieHeader(cookieHeader);
      return {
        activeToken: cookies.get(options.activeCookieName),
        resumeToken: cookies.get(options.resumeCookieName),
      };
    },
  };
}
