import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { createGuestSessionService } from "../../server/services/guest-session.js";
import { buildApp } from "../../server/app.js";
import { DEFAULT_GUEST_SESSION_SECRET } from "../../server/config.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

const SERVICE_OPTIONS = {
  secret: "test-secret",
  activeCookieName: "guest_session",
  resumeCookieName: "guest_session_resume",
  activeTtlSeconds: 3600,
  resumeTtlSeconds: 7200,
  secure: false,
  now: () => new Date("2026-04-21T00:00:00.000Z"),
} as const;

function decodeTokenClaims(token: string) {
  const [encodedClaims] = token.split(".", 1);
  return JSON.parse(Buffer.from(encodedClaims, "base64url").toString("utf8")) as Record<string, unknown>;
}

function signClaims(secret: string, claims: Record<string, unknown>) {
  const encodedClaims = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(encodedClaims).digest("base64url");
  return `${encodedClaims}.${signature}`;
}

describe("GuestSessionService", () => {
  it("verifies signed active sessions and rejects tampered payloads or signatures", () => {
    const service = createGuestSessionService(SERVICE_OPTIONS);

    const issued = service.issue("device-1", 0);
    const verified = service.verifyActiveSession(issued.activeToken);
    assert.equal(verified.ok, true);
    if (verified.ok) {
      assert.equal(verified.deviceId, "device-1");
    }

    const [encodedClaims, signature] = issued.activeToken.split(".", 2);
    const tamperedClaims = Buffer.from(
      JSON.stringify({
        deviceId: "device-2",
        kind: "active",
        exp: Math.floor(new Date("2026-04-21T01:00:00.000Z").getTime() / 1000),
      }),
    ).toString("base64url");

    assert.deepEqual(service.verifyActiveSession(`${tamperedClaims}.${signature}`), { ok: false, reason: "invalid" });

    const tamperedSignature = `${encodedClaims}.${signature.slice(0, -1)}${signature.endsWith("a") ? "b" : "a"}`;
    assert.deepEqual(service.verifyActiveSession(tamperedSignature), { ok: false, reason: "invalid" });
  });

  it("rejects active tokens forged with the development default secret", () => {
    const now = () => new Date("2026-04-21T00:00:00.000Z");
    const runtimeService = createGuestSessionService({
      secret: "runtime-secret-value-at-least-32-chars",
      activeCookieName: "guest_session",
      resumeCookieName: "guest_session_resume",
      activeTtlSeconds: 3600,
      resumeTtlSeconds: 7200,
      secure: true,
      now,
    });
    const defaultSecretService = createGuestSessionService({
      secret: DEFAULT_GUEST_SESSION_SECRET,
      activeCookieName: "guest_session",
      resumeCookieName: "guest_session_resume",
      activeTtlSeconds: 3600,
      resumeTtlSeconds: 7200,
      secure: true,
      now,
    });

    const forged = defaultSecretService.issue("device-1", 0);

    assert.deepEqual(runtimeService.verifyActiveSession(forged.activeToken), { ok: false, reason: "invalid" });
  });

  it("checks signature length before timingSafeEqual in the token verifier", () => {
    const source = readFileSync("server/services/guest-session.ts", "utf8");
    const lengthPrecheckIndex = source.indexOf("expectedSignature.length !== signature.length");
    const timingSafeEqualIndex = source.indexOf("timingSafeEqual(");

    assert.notEqual(lengthPrecheckIndex, -1);
    assert.notEqual(timingSafeEqualIndex, -1);
    assert.ok(
      lengthPrecheckIndex < timingSafeEqualIndex,
      "expected signature-length precheck to appear before timingSafeEqual",
    );
  });

  it("verifies a still-valid resume token without issuing replacement cookies", () => {
    const currentTime = { value: new Date("2026-04-21T00:00:00.000Z") };
    const service = createGuestSessionService({
      secret: "test-secret",
      activeCookieName: "guest_session",
      resumeCookieName: "guest_session_resume",
      activeTtlSeconds: 1,
      resumeTtlSeconds: 600,
      secure: false,
      now: () => currentTime.value,
    });

    const issued = service.issue("device-1", 0);
    currentTime.value = new Date("2026-04-21T00:00:02.000Z");

    assert.deepEqual(service.verifyActiveSession(issued.activeToken), { ok: false, reason: "expired" });

    const resumed = service.verifyResumeSession(issued.resumeToken);
    assert.equal(resumed.ok, true);
    if (!resumed.ok) {
      return;
    }

    assert.equal(resumed.deviceId, "device-1");
    assert.equal(resumed.version, 0);
    assert.equal("cookies" in resumed, false);
    assert.equal("activeToken" in resumed, false);
    assert.equal("resumeToken" in resumed, false);

    const replacement = service.issue(resumed.deviceId, resumed.version);
    const verified = service.verifyActiveSession(replacement.activeToken);
    assert.equal(verified.ok, true);
    if (verified.ok) {
      assert.equal(verified.deviceId, "device-1");
    }
  });

  it("serializes deterministic same-origin cookie settings", () => {
    const service = createGuestSessionService({
      secret: "test-secret",
      activeCookieName: "guest_session",
      resumeCookieName: "guest_session_resume",
      activeTtlSeconds: 3600,
      resumeTtlSeconds: 7200,
      secure: true,
      now: () => new Date("2026-04-21T00:00:00.000Z"),
    });

    const issued = service.issue("device-1", 0);

    assert.match(issued.cookies[0], /^guest_session=/);
    assert.match(issued.cookies[0], /HttpOnly/);
    assert.match(issued.cookies[0], /Path=\//);
    assert.match(issued.cookies[0], /SameSite=Lax/);
    assert.match(issued.cookies[0], /Max-Age=3600/);
    assert.match(issued.cookies[0], /Secure/);
    assert.match(issued.cookies[1], /^guest_session_resume=/);
    assert.match(issued.cookies[1], /Max-Age=7200/);
  });

  it("wires the guest-session service through buildApp's DI-ready service registry", async () => {
    let issuedCookieCount = 0;
    const app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      onServicesReady: (readyServices) => {
        issuedCookieCount = readyServices.guestSessionService.issue("device-1", 0).cookies.length;
      },
    });

    try {
      assert.equal(issuedCookieCount, 2);
    } finally {
      await app.close();
    }
  });

  it("stamps the provided session version into active and resume tokens", () => {
    const service = createGuestSessionService(SERVICE_OPTIONS);

    const issued = service.issue("device-1", 3);

    assert.equal(decodeTokenClaims(issued.activeToken).ver, 3);
    assert.equal(decodeTokenClaims(issued.resumeToken).ver, 3);

    const active = service.verifyActiveSession(issued.activeToken);
    assert.equal(active.ok, true);
    if (active.ok) {
      assert.equal(active.version, 3);
    }

    const resume = service.verifyResumeSession(issued.resumeToken);
    assert.equal(resume.ok, true);
    if (resume.ok) {
      assert.equal(resume.version, 3);
    }
  });

  it("treats legacy tokens without ver as version 0", () => {
    const service = createGuestSessionService(SERVICE_OPTIONS);
    const exp = Math.floor(new Date("2026-04-21T01:00:00.000Z").getTime() / 1000);
    const activeToken = signClaims("test-secret", { deviceId: "legacy-device", kind: "active", exp });
    const resumeToken = signClaims("test-secret", { deviceId: "legacy-device", kind: "resume", exp });

    const active = service.verifyActiveSession(activeToken);
    assert.equal(active.ok, true);
    if (active.ok) {
      assert.equal(active.version, 0);
    }

    const resume = service.verifyResumeSession(resumeToken);
    assert.equal(resume.ok, true);
    if (resume.ok) {
      assert.equal(resume.version, 0);
    }
  });

  it("rejects malformed session versions", () => {
    const service = createGuestSessionService(SERVICE_OPTIONS);
    const exp = Math.floor(new Date("2026-04-21T01:00:00.000Z").getTime() / 1000);

    for (const ver of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "3", null]) {
      const token = signClaims("test-secret", { deviceId: "device-1", kind: "active", exp, ver });
      assert.deepEqual(service.verifyActiveSession(token), { ok: false, reason: "invalid" });
    }
  });
});
