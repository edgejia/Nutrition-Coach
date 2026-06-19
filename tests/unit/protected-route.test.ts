import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import {
  buildProtectedPreHandler,
  getProtectedOwner,
  hasRawBodyDeviceIdSelector,
  hasRawHeaderOrQueryDeviceIdSelector,
  registerProtectedRoute,
  registerProtectedRouteSupport,
  type ProtectedRouteDeps,
} from "../../server/routes/protected-route.js";

function createDeps(overrides: {
  device?: unknown;
  activeSession?: { ok: true; deviceId: string } | { ok: false };
  resumedSession?: { ok: true; deviceId: string; cookies: readonly string[] } | { ok: false };
} = {}): ProtectedRouteDeps {
  const device = overrides.device ?? { id: "device-owned", goal: "maintain" };
  return {
    deviceService: {
      async getDevice(deviceId: string) {
        return deviceId === "device-owned" ? device : undefined;
      },
    },
    guestSessionService: {
      readTokens(cookieHeader: string | undefined) {
        return cookieHeader
          ? { activeToken: "active-token", resumeToken: "resume-token" }
          : { activeToken: undefined, resumeToken: undefined };
      },
      verifyActiveSession() {
        return overrides.activeSession ?? { ok: true, deviceId: "device-owned" };
      },
      resumeSession() {
        return overrides.resumedSession ?? { ok: false };
      },
      clearSessionCookies() {
        return ["guest_session=; Max-Age=0", "guest_session_resume=; Max-Age=0"];
      },
    },
  } as unknown as ProtectedRouteDeps;
}

describe("protected route boundary helper", () => {
  it("detects raw header/query selectors and parsed non-multipart body selectors", () => {
    assert.equal(hasRawHeaderOrQueryDeviceIdSelector({
      headers: { "x-device-id": "raw-device" },
      query: {},
    } as unknown as FastifyRequest), true);
    assert.equal(hasRawHeaderOrQueryDeviceIdSelector({
      headers: {},
      query: { deviceId: "raw-device" },
    } as unknown as FastifyRequest), true);
    assert.equal(hasRawHeaderOrQueryDeviceIdSelector({
      headers: {},
      query: { other: "value" },
    } as unknown as FastifyRequest), false);

    assert.equal(hasRawBodyDeviceIdSelector({
      headers: { "content-type": "application/json" },
      body: { deviceId: "raw-device" },
    } as unknown as FastifyRequest), true);
    assert.equal(hasRawBodyDeviceIdSelector({
      headers: { "content-type": "multipart/form-data; boundary=abc" },
      body: { deviceId: "raw-device" },
    } as unknown as FastifyRequest), false);
    assert.equal(hasRawBodyDeviceIdSelector({
      headers: { "content-type": "application/json" },
      body: ["deviceId"],
    } as unknown as FastifyRequest), false);
  });

  it("attaches a resolved owner and refresh cookies before the handler runs", async () => {
    const app = Fastify({ logger: false });
    const deps = createDeps({
      activeSession: { ok: false },
      resumedSession: {
        ok: true,
        deviceId: "device-owned",
        cookies: ["guest_session=fresh", "guest_session_resume=fresh"],
      },
    });
    registerProtectedRouteSupport(app);
    registerProtectedRoute(app, deps, {
      method: "GET",
      url: "/protected",
      protectedMeta: { route: "api_meals", operation: "meals_list" },
      handler(request) {
        const owner = getProtectedOwner(request);
        return {
          deviceId: owner.deviceId,
          hasDevice: Boolean(owner.device),
          setCookies: owner.setCookies,
        };
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { cookie: "guest_session_resume=resume-token" },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), {
      deviceId: "device-owned",
      hasDevice: true,
      setCookies: ["guest_session=fresh", "guest_session_resume=fresh"],
    });
    assert.deepEqual(response.headers["set-cookie"], ["guest_session=fresh", "guest_session_resume=fresh"]);
  });

  it("preserves route options and chains the route preHandler after the protected preHandler", async () => {
    const app = Fastify({ logger: false });
    const deps = createDeps();
    const calls: string[] = [];
    registerProtectedRouteSupport(app);
    registerProtectedRoute(app, deps, {
      method: "POST",
      url: "/with-schema",
      protectedMeta: { route: "api_proposals_actions", operation: "proposal_action" },
      schema: {
        body: {
          type: "object",
          required: ["value"],
          additionalProperties: false,
          properties: { value: { type: "string" } },
        },
      },
      preHandler(request, _reply, done) {
        calls.push(getProtectedOwner(request).deviceId);
        done();
      },
      handler() {
        return { ok: true };
      },
    });

    const invalid = await app.inject({
      method: "POST",
      url: "/with-schema",
      headers: { cookie: "guest_session=active-token" },
      payload: {},
    });
    assert.equal(invalid.statusCode, 400);
    assert.deepEqual(calls, []);

    const valid = await app.inject({
      method: "POST",
      url: "/with-schema",
      headers: { cookie: "guest_session=active-token" },
      payload: { value: "ok" },
    });
    assert.equal(valid.statusCode, 200);
    assert.deepEqual(valid.json(), { ok: true });
    assert.deepEqual(calls, ["device-owned"]);
  });

  it("keeps invalid cookies at 401 and rejects raw selectors with metadata-only 400 after valid cookies", async () => {
    const invalidApp = Fastify({ logger: false });
    registerProtectedRouteSupport(invalidApp);
    registerProtectedRoute(invalidApp, createDeps({
      activeSession: { ok: false },
      resumedSession: { ok: false },
    }), {
      method: "GET",
      url: "/invalid",
      protectedMeta: { route: "api_meals", operation: "meals_list" },
      handler() {
        return { ok: true };
      },
    });

    const invalid = await invalidApp.inject({
      method: "GET",
      url: "/invalid?deviceId=raw-device",
      headers: { cookie: "guest_session=invalid" },
    });
    assert.equal(invalid.statusCode, 401);
    assert.deepEqual(invalid.headers["set-cookie"], ["guest_session=; Max-Age=0", "guest_session_resume=; Max-Age=0"]);

    const logLines: string[] = [];
    const validApp = Fastify({
      logger: {
        level: "info",
        stream: { write: (line: string) => logLines.push(line) },
      },
    });
    registerProtectedRouteSupport(validApp);
    registerProtectedRoute(validApp, createDeps(), {
      method: "POST",
      url: "/valid",
      protectedMeta: { route: "api_meals", operation: "meals_list" },
      handler() {
        return { ok: true };
      },
    });

    const valid = await validApp.inject({
      method: "POST",
      url: "/valid?deviceId=raw-device",
      headers: { cookie: "guest_session=active-token" },
      payload: { value: "ok" },
    });
    assert.equal(valid.statusCode, 400);

    const ownershipEvent = logLines
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .find((line) => line.event === "ownership_bypass_blocked");
    assert.equal(ownershipEvent?.event, "ownership_bypass_blocked");
    assert.equal(ownershipEvent?.reason, "raw_device_id_param");
    assert.equal(ownershipEvent?.route, "api_meals");
    assert.equal(ownershipEvent?.operation, "meals_list");
    assert.equal(ownershipEvent?.msg, "Ownership bypass blocked");
    assert.equal(typeof ownershipEvent?.requestId, "string");
    assert.doesNotMatch(JSON.stringify(ownershipEvent), /raw-device|deviceId|guest_session|cookie|active-token/);
  });

  it("does not refresh resume cookies when raw selectors are rejected", async () => {
    const app = Fastify({ logger: false });
    registerProtectedRouteSupport(app);
    registerProtectedRoute(app, createDeps({
      activeSession: { ok: false },
      resumedSession: {
        ok: true,
        deviceId: "device-owned",
        cookies: ["guest_session=fresh", "guest_session_resume=fresh"],
      },
    }), {
      method: "GET",
      url: "/resume",
      protectedMeta: { route: "api_meals", operation: "meals_list" },
      handler() {
        return { ok: true };
      },
    });

    const response = await app.inject({
      method: "GET",
      url: "/resume?deviceId=raw-device",
      headers: { cookie: "guest_session_resume=resume-token" },
    });

    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), { error: "Raw device selector is not allowed" });
    assert.equal(response.headers["set-cookie"], undefined);
  });

  it("rejects unsupported multipart bodies at the boundary unless the route parser owns them", async () => {
    const events: Array<Record<string, unknown>> = [];
    const createRequest = (id: string) => ({
      headers: {
        cookie: "guest_session=active-token",
        "content-type": "multipart/form-data; boundary=abc",
      },
      query: {},
      id,
      log: {
        info(payload: Record<string, unknown>, msg: string) {
          events.push({ ...payload, msg });
        },
      },
    } as unknown as FastifyRequest);
    const createReply = () => {
      const captured: { statusCode?: number; payload?: unknown; headers: Record<string, unknown> } = { headers: {} };
      const reply = {
        header(name: string, value: unknown) {
          captured.headers[name] = value;
          return this;
        },
        code(statusCode: number) {
          captured.statusCode = statusCode;
          return this;
        },
        send(payload: unknown) {
          captured.payload = payload;
          return payload;
        },
      } as FastifyReply;
      return { captured, reply };
    };

    const rejectedReply = createReply();
    await buildProtectedPreHandler(createDeps(), { route: "api_device_goals", operation: "device_goals_update" })(
      createRequest("req-rejected"),
      rejectedReply.reply,
    );
    assert.equal(rejectedReply.captured.statusCode, 400);
    assert.deepEqual(rejectedReply.captured.payload, { error: "Raw device selector is not allowed" });

    const ownershipEvent = events.find((line) => line.event === "ownership_bypass_blocked");
    assert.equal(ownershipEvent?.route, "api_device_goals");
    assert.equal(ownershipEvent?.operation, "device_goals_update");
    assert.doesNotMatch(JSON.stringify(ownershipEvent), /raw-device|deviceId|guest_session|cookie|active-token/);

    const parserOwnedRequest = createRequest("req-parser-owned");
    const parserOwnedReply = createReply();
    await buildProtectedPreHandler(
      createDeps(),
      { route: "api_chat", operation: "chat_message" },
      undefined,
      { multipartBodySelectorHandling: "route_parser" },
    )(parserOwnedRequest, parserOwnedReply.reply);
    assert.equal(parserOwnedReply.captured.statusCode, undefined);
    assert.equal(getProtectedOwner(parserOwnedRequest).deviceId, "device-owned");
  });

  it("throws a sanitized invariant error when no protected owner is attached", async () => {
    const app = Fastify({ logger: false });
    app.get("/missing-owner", (request) => getProtectedOwner(request));

    const response = await app.inject({ method: "GET", url: "/missing-owner" });

    assert.equal(response.statusCode, 500);
    assert.match(response.body, /Protected route owner was not resolved/);
    assert.doesNotMatch(response.body, /device|cookie|token|body/i);
  });

  it("exposes buildProtectedPreHandler for direct Fastify lifecycle use", async () => {
    const app = Fastify({ logger: false });
    registerProtectedRouteSupport(app);
    app.get("/direct", {
      preHandler: buildProtectedPreHandler(createDeps(), { route: "api_sse", operation: "sse_subscribe" }),
    }, (request) => ({ deviceId: getProtectedOwner(request).deviceId }));

    const response = await app.inject({
      method: "GET",
      url: "/direct",
      headers: { cookie: "guest_session=active-token" },
    });

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { deviceId: "device-owned" });
  });
});
