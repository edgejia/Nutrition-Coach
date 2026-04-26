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

  async function seedPaginationMeals() {
    assert.ok(services, "expected onServicesReady to capture app services");

    const newest = await services.foodLoggingService.logFood(deviceId, {
      foodName: "晚餐",
      calories: 650,
      protein: 36,
      carbs: 70,
      fat: 22,
      loggedAt: "2026-03-25T12:30:00.000Z",
    });
    const middle = await services.foodLoggingService.logFood(deviceId, {
      foodName: "午餐",
      calories: 520,
      protein: 28,
      carbs: 58,
      fat: 18,
      loggedAt: "2026-03-25T05:30:00.000Z",
    });
    const oldest = await services.foodLoggingService.logFood(deviceId, {
      foodName: "早餐",
      calories: 330,
      protein: 18,
      carbs: 36,
      fat: 10,
      loggedAt: "2026-03-25T00:30:00.000Z",
    });

    return { newest, middle, oldest };
  }

  async function seedDaySnapshotMeals() {
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
      imagePath: "asset:asset-2",
      items: [
        { foodName: "鮭魚", calories: 280, protein: 30, carbs: 0, fat: 17 },
        { foodName: "白飯", calories: 260, protein: 5, carbs: 58, fat: 1 },
      ],
    });
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

    return { boundaryMeal, assetMeal };
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

  it("GET /api/history/meals returns opaque cursor pages without duplicate meals", async () => {
    const seeded = await seedPaginationMeals();

    const firstPage = await app.inject({
      method: "GET",
      url: "/api/history/meals?from=2026-03-25&to=2026-03-25&limit=2",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(firstPage.statusCode, 200);
    const firstBody = firstPage.json() as { meals: HistoryMeal[]; nextCursor: string | null };
    assert.deepEqual(firstBody.meals.map((meal) => meal.id), [seeded.newest.id, seeded.middle.id]);
    assert.equal(typeof firstBody.nextCursor, "string");
    const nextCursor = firstBody.nextCursor;
    assert.ok(nextCursor);
    assert.ok(nextCursor.length > 0);

    const secondPage = await app.inject({
      method: "GET",
      url: `/api/history/meals?from=2026-03-25&to=2026-03-25&limit=2&cursor=${encodeURIComponent(nextCursor)}`,
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(secondPage.statusCode, 200);
    const secondBody = secondPage.json() as { meals: HistoryMeal[]; nextCursor: string | null };
    assert.deepEqual(secondBody.meals.map((meal) => meal.id), [seeded.oldest.id]);
    assert.equal(secondBody.nextCursor, null);

    const allIds = [...firstBody.meals, ...secondBody.meals].map((meal) => meal.id);
    assert.deepEqual(new Set(allIds), new Set([seeded.newest.id, seeded.middle.id, seeded.oldest.id]));
    assert.equal(allIds.length, new Set(allIds).size, "cursor pages must not duplicate meal ids");
  });

  it("GET /api/history/meals returns INVALID_QUERY for malformed query inputs", async () => {
    const cases = [
      {
        name: "missing from",
        url: "/api/history/meals?to=2026-03-25&limit=10",
        issue: { field: "from", message: "from is required" },
      },
      {
        name: "missing to",
        url: "/api/history/meals?from=2026-03-25&limit=10",
        issue: { field: "to", message: "to is required" },
      },
      {
        name: "malformed from",
        url: "/api/history/meals?from=2026-2-5&to=2026-03-25&limit=10",
        issue: { field: "from", message: "from must be a valid YYYY-MM-DD date" },
      },
      {
        name: "invalid calendar to",
        url: "/api/history/meals?from=2026-02-01&to=2026-02-31&limit=10",
        issue: { field: "to", message: "to must be a valid YYYY-MM-DD date" },
      },
      {
        name: "from after to",
        url: "/api/history/meals?from=2026-03-26&to=2026-03-25&limit=10",
        issue: { field: "from", message: "from must be on or before to" },
      },
      {
        name: "limit below range",
        url: "/api/history/meals?from=2026-03-25&to=2026-03-25&limit=0",
        issue: { field: "limit", message: "limit must be between 1 and 100" },
      },
      {
        name: "limit above range",
        url: "/api/history/meals?from=2026-03-25&to=2026-03-25&limit=101",
        issue: { field: "limit", message: "limit must be between 1 and 100" },
      },
      {
        name: "non-numeric limit",
        url: "/api/history/meals?from=2026-03-25&to=2026-03-25&limit=abc",
        issue: { field: "limit", message: "limit must be an integer" },
      },
      {
        name: "malformed cursor",
        url: "/api/history/meals?from=2026-03-25&to=2026-03-25&limit=10&cursor=not-a-valid-cursor",
        issue: { field: "cursor", message: "cursor is invalid" },
      },
    ];

    for (const testCase of cases) {
      const res = await app.inject({
        method: "GET",
        url: testCase.url,
        headers: { cookie: sessionCookieHeader },
      });

      assert.equal(res.statusCode, 400, testCase.name);
      assert.deepEqual(
        res.json(),
        {
          error: "Invalid query",
          code: "INVALID_QUERY",
          issues: [testCase.issue],
        },
        testCase.name,
      );
    }
  });

  it("GET /api/history/days/:date returns a summary plus history meal projections", async () => {
    const seeded = await seedDaySnapshotMeals();

    const res = await app.inject({
      method: "GET",
      url: "/api/history/days/2026-03-25",
      headers: { cookie: sessionCookieHeader, "x-device-id": foreignDeviceId },
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
      meals: HistoryMeal[];
    };

    assert.equal(body.date, "2026-03-25");
    assert.deepEqual(body.summary, {
      date: "2026-03-25",
      totalCalories: 660,
      totalProtein: 41,
      totalCarbs: 72,
      totalFat: 22,
      mealCount: 2,
    });
    assert.deepEqual(
      body.meals.map((meal) => meal.id),
      [seeded.assetMeal.id, seeded.boundaryMeal.id],
    );
    assert.deepEqual(body.meals[0], {
      id: seeded.assetMeal.id,
      dateKey: "2026-03-25",
      loggedAt: "2026-03-25T04:00:00.000Z",
      display: { title: "鮭魚、白飯" },
      nutrition: { calories: 540, protein: 35, carbs: 58, fat: 18 },
      items: [
        {
          name: "鮭魚",
          position: 0,
          nutrition: { calories: 280, protein: 30, carbs: 0, fat: 17 },
        },
        {
          name: "白飯",
          position: 1,
          nutrition: { calories: 260, protein: 5, carbs: 58, fat: 1 },
        },
      ],
      asset: { imageAssetId: "asset-2", imageUrl: "/api/assets/asset-2" },
      revision: { currentRevisionNumber: 1 },
    });
    assertNoUnsafeHistoryFields(body);
  });

  it("GET /api/history/days/:date returns INVALID_QUERY for invalid date params", async () => {
    const cases = [
      {
        name: "malformed date",
        url: "/api/history/days/2026-2-5",
        issue: { field: "date", message: "date must be a valid YYYY-MM-DD date" },
      },
      {
        name: "invalid calendar date",
        url: "/api/history/days/2026-02-31",
        issue: { field: "date", message: "date must be a valid YYYY-MM-DD date" },
      },
    ];

    for (const testCase of cases) {
      const res = await app.inject({
        method: "GET",
        url: testCase.url,
        headers: { cookie: sessionCookieHeader },
      });

      assert.equal(res.statusCode, 400, testCase.name);
      assert.deepEqual(
        res.json(),
        {
          error: "Invalid query",
          code: "INVALID_QUERY",
          issues: [testCase.issue],
        },
        testCase.name,
      );
    }
  });

  it("keeps legacy /api/day-snapshot?date=2026-02-31 invalid-date behavior unchanged", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/api/day-snapshot?date=2026-02-31",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { error: "Invalid date query" });
  });
});
