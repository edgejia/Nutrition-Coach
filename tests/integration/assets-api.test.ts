process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

describe("Assets API", () => {
  let app: FastifyInstance;
  let assetsDir: string;
  let stagingDir: string;
  let services: AppServices | undefined;
  let ownerDeviceId: string;
  let ownerCookieHeader: string;
  let foreignCookieHeader: string;

  function toCookieHeader(rawHeader: string | string[] | undefined) {
    const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
    return values.map((value) => value.split(";", 1)[0]).join("; ");
  }

  beforeEach(async () => {
    assetsDir = await mkdtemp(path.join(os.tmpdir(), "nutrition-assets-api-"));
    stagingDir = await mkdtemp(path.join(os.tmpdir(), "nutrition-assets-api-staging-"));
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      assetsDir,
      onServicesReady(readyServices) {
        services = readyServices;
      },
    });

    const ownerDevice = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    ownerDeviceId = ownerDevice.json().deviceId as string;
    ownerCookieHeader = toCookieHeader(ownerDevice.headers["set-cookie"]);

    const foreignDevice = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "muscle_gain" } });
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

  async function createOwnedAsset() {
    assert.ok(services, "expected buildApp onServicesReady to expose services");
    const stagedPath = path.join(stagingDir, "meal.png");
    await writeFile(stagedPath, Buffer.from("asset-bytes"));
    return services.assetService.createAsset(ownerDeviceId, {
      stagedPath,
      mimeType: "image/png",
      originalFilename: "meal.png",
    });
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
