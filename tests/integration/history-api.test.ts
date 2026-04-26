process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

type HistoryMeal = {
  id: string;
  dateKey: string;
  loggedAt: string;
  display: {
    title: string;
  };
  nutrition: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
  };
  items: Array<{
    name: string;
    position: number;
    nutrition: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    };
  }>;
  asset: {
    imageAssetId: string | null;
    imageUrl: string | null;
  };
  revision: {
    currentRevisionNumber: number;
  };
};

describe("History API", () => {
  let app: FastifyInstance;
  let deviceId: string;
  let foreignDeviceId: string;
  let sessionCookieHeader: string;
  let tempRoot: string;
  let uploadsDir: string;
  let assetsDir: string;
  let services: AppServices | undefined;

  function toCookieHeader(rawHeader: string | string[] | undefined) {
    const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
    return values.map((value) => value.split(";", 1)[0]).join("; ");
  }

  beforeEach(async () => {
    tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-history-api-"));
    uploadsDir = path.join(tempRoot, "uploads");
    assetsDir = path.join(tempRoot, "assets");
    const { buildApp } = await import("../../server/app.js");
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      uploadsDir,
      assetsDir,
      onServicesReady: (readyServices) => {
        services = readyServices;
      },
    });

    const deviceRes = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    deviceId = deviceRes.json().deviceId;
    sessionCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);

    const foreignDeviceRes = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "muscle_gain" },
    });
    foreignDeviceId = foreignDeviceRes.json().deviceId;
  });

  afterEach(async () => {
    if (app.server.listening) {
      await app.close();
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  function assertNoUnsafeHistoryFields(value: unknown) {
    const serialized = JSON.stringify(value);
    assert.ok(!serialized.includes("imagePath"), "history response must not expose imagePath");
    assert.ok(!serialized.includes("storageKey"), "history response must not expose storageKey");
    assert.ok(!serialized.includes("currentRevisionId"), "history response must not expose currentRevisionId");
    assert.ok(!serialized.includes("supersedesRevisionId"), "history response must not expose supersedesRevisionId");
    assert.ok(!serialized.includes("revisionId"), "history response must not expose raw revisionId");
    assert.ok(!serialized.includes("deletedAt"), "history response must not expose deleted revision metadata");
  }

  it("GET /api/history/meals returns owner-only current active meals with safe nested projections", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");

    const boundaryMeal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "午夜點心",
      calories: 120,
      protein: 6,
      carbs: 14,
      fat: 4,
      loggedAt: "2026-03-24T16:30:00.000Z",
    });
    const assetMeal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:00:00.000Z",
      imagePath: "asset:asset-1",
      items: [
        { foodName: "雞胸", calories: 240, protein: 42, carbs: 0, fat: 6 },
        { foodName: "地瓜", calories: 180, protein: 3, carbs: 41, fat: 0 },
      ],
    });
    const sameTimestampMeal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "同秒茶葉蛋",
      calories: 80,
      protein: 7,
      carbs: 1,
      fat: 5,
      loggedAt: "2026-03-25T04:00:00.000Z",
    });
    const updatedMeal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "待修正便當",
      calories: 500,
      protein: 20,
      carbs: 65,
      fat: 18,
      loggedAt: "2026-03-25T08:00:00.000Z",
    });
    await services.foodLoggingService.updateMeal(deviceId, updatedMeal.id, {
      loggedAt: "2026-03-25T08:00:00.000Z",
      items: [
        { foodName: "修正雞腿便當", calories: 620, protein: 34, carbs: 70, fat: 22 },
      ],
    });
    const deletedMeal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "已刪除餐點",
      calories: 400,
      protein: 16,
      carbs: 50,
      fat: 14,
      loggedAt: "2026-03-25T09:00:00.000Z",
    });
    await services.foodLoggingService.deleteMeal(deviceId, deletedMeal.id);
    await services.foodLoggingService.logFood(deviceId, {
      foodName: "隔天早餐",
      calories: 300,
      protein: 18,
      carbs: 28,
      fat: 10,
      loggedAt: "2026-03-25T16:30:00.000Z",
    });
    await services.foodLoggingService.logFood(foreignDeviceId, {
      foodName: "外部裝置餐點",
      calories: 999,
      protein: 99,
      carbs: 99,
      fat: 99,
      loggedAt: "2026-03-25T10:00:00.000Z",
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/history/meals?from=2026-03-25&to=2026-03-25&limit=10&deviceId=${foreignDeviceId}`,
      headers: { cookie: sessionCookieHeader, "x-device-id": foreignDeviceId },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json() as { meals: HistoryMeal[]; nextCursor: string | null };

    assert.equal(body.nextCursor, null);
    assert.deepEqual(
      body.meals.map((meal) => meal.id),
      [updatedMeal.id, sameTimestampMeal.id, assetMeal.id, boundaryMeal.id],
      "history meals should use descending loggedAt plus id ordering",
    );
    assert.ok(!body.meals.some((meal) => meal.id === deletedMeal.id));
    assert.ok(!body.meals.some((meal) => meal.display.title === "外部裝置餐點"));
    assert.ok(!body.meals.some((meal) => meal.display.title === "隔天早餐"));

    const assetProjection = body.meals.find((meal) => meal.id === assetMeal.id);
    assert.deepEqual(assetProjection, {
      id: assetMeal.id,
      dateKey: "2026-03-25",
      loggedAt: "2026-03-25T04:00:00.000Z",
      display: { title: "雞胸、地瓜" },
      nutrition: { calories: 420, protein: 45, carbs: 41, fat: 6 },
      items: [
        {
          name: "雞胸",
          position: 0,
          nutrition: { calories: 240, protein: 42, carbs: 0, fat: 6 },
        },
        {
          name: "地瓜",
          position: 1,
          nutrition: { calories: 180, protein: 3, carbs: 41, fat: 0 },
        },
      ],
      asset: { imageAssetId: "asset-1", imageUrl: "/api/assets/asset-1" },
      revision: { currentRevisionNumber: 1 },
    });

    const correctedProjection = body.meals.find((meal) => meal.id === updatedMeal.id);
    assert.deepEqual(correctedProjection, {
      id: updatedMeal.id,
      dateKey: "2026-03-25",
      loggedAt: "2026-03-25T08:00:00.000Z",
      display: { title: "修正雞腿便當" },
      nutrition: { calories: 620, protein: 34, carbs: 70, fat: 22 },
      items: [
        {
          name: "修正雞腿便當",
          position: 0,
          nutrition: { calories: 620, protein: 34, carbs: 70, fat: 22 },
        },
      ],
      asset: { imageAssetId: null, imageUrl: null },
      revision: { currentRevisionNumber: 2 },
    });

    assert.equal(body.meals.find((meal) => meal.id === boundaryMeal.id)?.dateKey, "2026-03-25");
    assertNoUnsafeHistoryFields(body);
  });
});
