process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/app.js";
import type { AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

describe("Day snapshot API", () => {
  let app: FastifyInstance;
  let deviceId: string;
  let tempRoot: string;
  let uploadsDir: string;
  let assetsDir: string;
  let services: AppServices | undefined;

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-day-snapshot-api-"));
    uploadsDir = path.join(tempRoot, "uploads");
    assetsDir = path.join(tempRoot, "assets");
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      uploadsDir,
      assetsDir,
      onServicesReady: (readyServices) => {
        services = readyServices;
      },
    });
    deviceId = (
      await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } })
    ).json().deviceId;
  });

  afterEach(async () => {
    if (app.server.listening) {
      await app.close();
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("GET /api/day-snapshot returns summary and meals for the same selected local day", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");

    await services.foodLoggingService.logFood(deviceId, {
      foodName: "午夜點心",
      calories: 120,
      protein: 6,
      carbs: 14,
      fat: 4,
      loggedAt: "2026-03-24T16:30:00.000Z",
    });
    await services.foodLoggingService.logFood(deviceId, {
      foodName: "午餐便當",
      calories: 640,
      protein: 32,
      carbs: 78,
      fat: 21,
      imagePath: "asset:asset-1",
      loggedAt: "2026-03-25T04:00:00.000Z",
    });
    await services.foodLoggingService.logFood(deviceId, {
      foodName: "隔天早餐",
      calories: 300,
      protein: 18,
      carbs: 28,
      fat: 10,
      loggedAt: "2026-03-25T16:30:00.000Z",
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/day-snapshot?date=2026-03-25",
      headers: { "x-device-id": deviceId },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json() as {
      date: string;
      summary: {
        date: string;
        totalCalories: number;
        totalProtein: number;
        totalCarbs: number;
        totalFat: number;
        mealCount: number;
      };
      meals: Array<{
        id: string;
        foodName: string;
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
        imageAssetId: string | null;
        imageUrl: string | null;
        loggedAt: string;
      }>;
    };

    assert.equal(body.date, "2026-03-25");
    assert.deepEqual(body.summary, {
      date: "2026-03-25",
      totalCalories: 760,
      totalProtein: 38,
      totalCarbs: 92,
      totalFat: 25,
      mealCount: 2,
    });
    assert.equal(body.meals.length, 2);
    assert.match(body.meals[0]!.id, /^[0-9a-f-]+$/i);
    assert.match(body.meals[1]!.id, /^[0-9a-f-]+$/i);
    assert.deepEqual(body.meals.map(({ id, ...meal }) => meal), [
      {
        foodName: "午夜點心",
        calories: 120,
        protein: 6,
        carbs: 14,
        fat: 4,
        imageAssetId: null,
        imageUrl: null,
        loggedAt: "2026-03-24T16:30:00.000Z",
      },
      {
        foodName: "午餐便當",
        calories: 640,
        protein: 32,
        carbs: 78,
        fat: 21,
        imageAssetId: "asset-1",
        imageUrl: "/api/assets/asset-1",
        loggedAt: "2026-03-25T04:00:00.000Z",
      },
    ]);
  });

  it("GET /api/day-snapshot rejects missing and malformed dates", async () => {
    const missingDate = await app.inject({
      method: "GET",
      url: "/api/day-snapshot",
      headers: { "x-device-id": deviceId },
    });
    assert.equal(missingDate.statusCode, 400);
    assert.deepEqual(missingDate.json(), { error: "Missing date query" });

    const malformedDate = await app.inject({
      method: "GET",
      url: "/api/day-snapshot?date=2026-02-31",
      headers: { "x-device-id": deviceId },
    });
    assert.equal(malformedDate.statusCode, 400);
    assert.deepEqual(malformedDate.json(), { error: "Invalid date query" });
  });

  it("GET /api/day-snapshot requires a valid device header", async () => {
    const missingDevice = await app.inject({
      method: "GET",
      url: "/api/day-snapshot?date=2026-03-25",
    });
    assert.equal(missingDevice.statusCode, 401);
    assert.deepEqual(missingDevice.json(), { error: "Missing X-Device-Id" });

    const invalidDevice = await app.inject({
      method: "GET",
      url: "/api/day-snapshot?date=2026-03-25",
      headers: { "x-device-id": "invalid-device" },
    });
    assert.equal(invalidDevice.statusCode, 401);
    assert.deepEqual(invalidDevice.json(), { error: "Invalid device ID" });
  });
});
