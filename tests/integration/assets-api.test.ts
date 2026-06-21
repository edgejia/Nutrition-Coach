process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

describe("Assets API", () => {
  let app: FastifyInstance;
  let assetsDir: string;
  let stagingDir: string;
  let services: AppServices | undefined;
  let ownerDeviceId: string;
  let foreignDeviceId: string;
  let ownerCookieHeader: string;
  let foreignCookieHeader: string;
  let logCapture: ReturnType<typeof createLogCapture>;

  function toCookieHeader(rawHeader: string | string[] | undefined) {
    const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
    return values.map((value) => value.split(";", 1)[0]).join("; ");
  }

  function createLogCapture() {
    const logLines: string[] = [];
    const stream = new Writable({
      write(chunk, _, cb) {
        chunk.toString().split("\n").filter(Boolean).forEach((line: string) => logLines.push(line));
        cb();
      },
    });

    return { logLines, stream };
  }

  function parseJsonLogLines(logLines: string[]) {
    return logLines.flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>];
      } catch {
        return [];
      }
    });
  }

  function ownershipBypassEvents() {
    return parseJsonLogLines(logCapture.logLines).filter((record) => record.event === "ownership_bypass_blocked");
  }

  function assertLogEventApplicationKeys(event: Record<string, unknown>, allowedKeys: readonly string[]) {
    const pinoKeys = new Set(["level", "time", "pid", "hostname", "msg", "reqId"]);
    const allowed = new Set(allowedKeys);
    for (const key of Object.keys(event)) {
      assert.ok(pinoKeys.has(key) || allowed.has(key), `expected ${event.event} event to exclude metadata key ${key}`);
    }
  }

  function assertLogEventsExclude(events: readonly Record<string, unknown>[], forbiddenValues: readonly string[]) {
    const serialized = events.map((event) => JSON.stringify(event)).join("\n");
    for (const value of forbiddenValues) {
      assert.ok(!serialized.includes(value), `expected logs to exclude ${value}`);
    }
  }

  function assertAssetRawSelectorBlocked(input: {
    beforeEventCount: number;
    response: { statusCode: number; json: () => unknown; body: string; headers: Record<string, unknown> };
    forbiddenValues: readonly string[];
  }) {
    assert.equal(input.response.statusCode, 400);
    assert.deepEqual(input.response.json(), { error: "Raw device selector is not allowed" });
    assert.notEqual(input.response.headers["content-type"], "image/png");
    assert.doesNotMatch(input.response.body, /Asset not found/);
    assert.doesNotMatch(input.response.body, /asset-bytes/);
    assertLogEventsExclude([input.response.json() as Record<string, unknown>], input.forbiddenValues);

    const events = ownershipBypassEvents();
    assert.equal(events.length, input.beforeEventCount + 1);
    const event = events.at(-1)!;
    assert.equal(typeof event.requestId, "string");
    assert.deepEqual(
      {
        event: event.event,
        reason: event.reason,
        route: event.route,
        operation: event.operation,
      },
      {
        event: "ownership_bypass_blocked",
        reason: "raw_device_id_param",
        route: "api_assets",
        operation: "asset_read",
      },
    );
    assertLogEventApplicationKeys(event, ["event", "reason", "route", "operation", "requestId"]);
    assertLogEventsExclude([event], input.forbiddenValues);
  }

  beforeEach(async () => {
    logCapture = createLogCapture();
    assetsDir = await mkdtemp(path.join(os.tmpdir(), "nutrition-assets-api-"));
    stagingDir = await mkdtemp(path.join(os.tmpdir(), "nutrition-assets-api-staging-"));
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      assetsDir,
      logger: { level: "info", stream: logCapture.stream },
      onServicesReady(readyServices) {
        services = readyServices;
      },
    });

    const ownerDevice = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    ownerDeviceId = ownerDevice.json().deviceId as string;
    ownerCookieHeader = toCookieHeader(ownerDevice.headers["set-cookie"]);

    const foreignDevice = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "muscle_gain" } });
    foreignDeviceId = foreignDevice.json().deviceId as string;
    foreignCookieHeader = toCookieHeader(foreignDevice.headers["set-cookie"]);
  });

  afterEach(async () => {
    if (app.server.listening) {
      await app.close();
    } else {
      await app.close();
    }
    await rm(assetsDir, { recursive: true, force: true });
    await rm(stagingDir, { recursive: true, force: true });
  });

  async function createAsset(ownerDeviceId: string, fileName = "meal.png") {
    assert.ok(services, "expected buildApp onServicesReady to expose services");
    const stagedPath = path.join(stagingDir, fileName);
    await writeFile(stagedPath, Buffer.from("asset-bytes"));
    return services.assetService.createAsset(ownerDeviceId, {
      stagedPath,
      mimeType: "image/png",
      originalFilename: fileName,
    });
  }

  async function createOwnedAsset() {
    return createAsset(ownerDeviceId);
  }

  it("GET /api/assets/:id returns 401 without guest-session cookies", async () => {
    const asset = await createOwnedAsset();

    const res = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}`,
    });

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { error: "Guest session required" });
  });

  it("GET /api/assets/:id returns 404 for a foreign device", async () => {
    const asset = await createOwnedAsset();

    const res = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}`,
      headers: { cookie: foreignCookieHeader },
    });

    assert.equal(res.statusCode, 404);
    assert.deepEqual(res.json(), { error: "Asset not found" });
  });

  it("GET /api/assets/:id returns bytes and mime type for the cookie owner", async () => {
    const asset = await createOwnedAsset();

    const res = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}`,
      headers: { cookie: ownerCookieHeader },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "image/png");
    assert.equal(res.body.length > 0, true);
  });

  it("GET /api/assets/:id rejects valid-cookie raw selectors before asset lookup and logs metadata only", async () => {
    const ownerAsset = await createAsset(ownerDeviceId, "owner.png");
    const foreignAsset = await createAsset(foreignDeviceId, "foreign.png");
    const missingAssetId = "00000000-0000-4000-8000-000000000000";
    const cases = [
      {
        name: "owned-header",
        url: `/api/assets/${ownerAsset.id}`,
        headers: { cookie: ownerCookieHeader, "x-device-id": foreignDeviceId },
      },
      {
        name: "owned-query",
        url: `/api/assets/${ownerAsset.id}?deviceId=${encodeURIComponent(foreignDeviceId)}`,
        headers: { cookie: ownerCookieHeader },
      },
      {
        name: "foreign-query",
        url: `/api/assets/${foreignAsset.id}?deviceId=${encodeURIComponent(foreignDeviceId)}`,
        headers: { cookie: ownerCookieHeader },
      },
      {
        name: "missing-query",
        url: `/api/assets/${missingAssetId}?deviceId=${encodeURIComponent(foreignDeviceId)}`,
        headers: { cookie: ownerCookieHeader },
      },
    ] as const;

    const bodies = new Set<string>();
    for (const testCase of cases) {
      const beforeEventCount = ownershipBypassEvents().length;
      const res = await app.inject({
        method: "GET",
        url: testCase.url,
        headers: testCase.headers,
      });
      bodies.add(res.body);
      assertAssetRawSelectorBlocked({
        beforeEventCount,
        response: res,
        forbiddenValues: [
          ownerDeviceId,
          foreignDeviceId,
          ownerAsset.id,
          foreignAsset.id,
          missingAssetId,
          "x-device-id",
          "deviceId",
          "guest_session",
          "cookie",
        ],
      });
    }
    assert.equal(bodies.size, 1, "owned, foreign, and nonexistent asset IDs must return the same 400 shape");
  });

  it("GET /api/assets/:id rejects raw deviceId query-string auth", async () => {
    const asset = await createOwnedAsset();

    const res = await app.inject({
      method: "GET",
      url: `/api/assets/${asset.id}?deviceId=${ownerDeviceId}`,
    });

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { error: "Guest session required" });
  });
});
