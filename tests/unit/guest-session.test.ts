import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createGuestSessionService } from "../../server/services/guest-session.js";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

describe("GuestSessionService", () => {
  it("verifies signed active sessions and rejects tampered payloads or signatures", () => {
    const service = createGuestSessionService({
      secret: "test-secret",
      activeCookieName: "guest_session",
      resumeCookieName: "guest_session_resume",
      activeTtlSeconds: 3600,
      resumeTtlSeconds: 7200,
      secure: false,
      now: () => new Date("2026-04-21T00:00:00.000Z"),
    });

    const issued = service.issue("device-1");
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

  it("reissues a fresh active session from a still-valid resume token", () => {
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

    const issued = service.issue("device-1");
    currentTime.value = new Date("2026-04-21T00:00:02.000Z");

    assert.deepEqual(service.verifyActiveSession(issued.activeToken), { ok: false, reason: "expired" });

    const resumed = service.resumeSession(issued.resumeToken);
    assert.equal(resumed.ok, true);
    if (!resumed.ok) {
      return;
    }

    assert.equal(resumed.deviceId, "device-1");
    const verified = service.verifyActiveSession(resumed.activeToken);
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

    const issued = service.issue("device-1");

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
        issuedCookieCount = readyServices.guestSessionService.issue("device-1").cookies.length;
      },
    });

    try {
      assert.equal(issuedCookieCount, 2);
    } finally {
      await app.close();
    }
  });
});
