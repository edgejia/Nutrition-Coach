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
  mealRevisionId: string;
  dateKey: string;
  loggedAt: string;
  display: {
    title: string;
  };
  itemCount: number;
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
  imageAssetId: string | null;
  imageUrl: string | null;
  mealPeriod?: "breakfast" | "lunch" | "dinner" | "late_night";
  revision: {
    currentRevisionNumber: number;
  };
};

const VALID_MEAL_PERIODS = new Set(["breakfast", "lunch", "dinner", "late_night"]);

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
}

function assertFiniteNumber(value: unknown, field: string): asserts value is number {
  assert.equal(typeof value, "number", `expected ${field} to be a number`);
  assert.ok(Number.isFinite(value), `expected ${field} to be finite`);
}

function assertNullableString(value: unknown, field: string) {
  assert.ok(value === null || typeof value === "string", `expected ${field} to be string or null`);
}

function assertNutritionDto(value: unknown, pathName: string) {
  assertRecord(value);
  assert.deepEqual(Object.keys(value).sort(), ["calories", "carbs", "fat", "protein"]);
  assertFiniteNumber(value.calories, `${pathName}.calories`);
  assertFiniteNumber(value.protein, `${pathName}.protein`);
  assertFiniteNumber(value.carbs, `${pathName}.carbs`);
  assertFiniteNumber(value.fat, `${pathName}.fat`);
}

function assertPublicHistoryMealDto(value: unknown) {
  assertRecord(value);
  const allowedKeys = new Set([
    "id",
    "mealRevisionId",
    "dateKey",
    "loggedAt",
    "display",
    "itemCount",
    "nutrition",
    "items",
    "asset",
    "imageAssetId",
    "imageUrl",
    "mealPeriod",
    "revision",
  ]);
  for (const key of Object.keys(value)) {
    assert.ok(allowedKeys.has(key), `expected history meal to exclude ${key}`);
  }
  assert.equal(typeof value.id, "string");
  assert.equal(typeof value.mealRevisionId, "string");
  assert.equal(typeof value.dateKey, "string");
  assert.equal(typeof value.loggedAt, "string");
  assertRecord(value.display);
  assert.ok(typeof value.display.title === "string" && value.display.title.length > 0);
  assertFiniteNumber(value.itemCount, "meal.itemCount");
  assertNutritionDto(value.nutrition, "meal.nutrition");
  assert.ok(Array.isArray(value.items), "expected meal.items to be an array");
  for (const item of value.items) {
    assertRecord(item);
    assert.equal(typeof item.name, "string");
    assert.ok(typeof item.name === "string" && item.name.length > 0);
    assertFiniteNumber(item.position, "meal.items[].position");
    assertNutritionDto(item.nutrition, "meal.items[].nutrition");
  }
  assertRecord(value.asset);
  assert.deepEqual(Object.keys(value.asset).sort(), ["imageAssetId", "imageUrl"]);
  assertNullableString(value.asset.imageAssetId, "meal.asset.imageAssetId");
  assertNullableString(value.asset.imageUrl, "meal.asset.imageUrl");
  assertNullableString(value.imageAssetId, "meal.imageAssetId");
  assertNullableString(value.imageUrl, "meal.imageUrl");
  assert.deepEqual(value.asset.imageAssetId, value.imageAssetId);
  assert.deepEqual(value.asset.imageUrl, value.imageUrl);
  if (typeof value.imageUrl === "string") {
    assert.doesNotMatch(value.imageUrl, /deviceId=/);
  }
  if ("mealPeriod" in value) {
    assert.ok(
      typeof value.mealPeriod === "string" && VALID_MEAL_PERIODS.has(value.mealPeriod),
      `expected valid mealPeriod, got ${String(value.mealPeriod)}`,
    );
  }
  assertRecord(value.revision);
  assert.deepEqual(Object.keys(value.revision), ["currentRevisionNumber"]);
  assertFiniteNumber(value.revision.currentRevisionNumber, "meal.revision.currentRevisionNumber");
}

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
    assert.ok(!serialized.includes("deviceId"), "history response must not expose raw deviceId");
    assert.ok(!serialized.includes("deviceId="), "history response must not expose legacy asset deviceId queries");
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
        { foodName: "青菜", calories: 40, protein: 2, carbs: 8, fat: 2 },
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
        { foodName: "青菜", calories: 40, protein: 2, carbs: 8, fat: 2 },
      ],
    });
    const nearbyMeal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "鄰近茶葉蛋",
      calories: 80,
      protein: 7,
      carbs: 1,
      fat: 5,
      loggedAt: "2026-03-25T03:59:00.000Z",
    });
    const updatedMeal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "待修正便當",
      calories: 500,
      protein: 20,
      carbs: 65,
      fat: 18,
      loggedAt: "2026-03-25T08:00:00.000Z",
    });
    const correctedMeal = await services.foodLoggingService.updateMeal(deviceId, updatedMeal.id, {
      expectedMealRevisionId: updatedMeal.mealRevisionId,
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
    await services.foodLoggingService.deleteMeal(deviceId, deletedMeal.id, deletedMeal.mealRevisionId);
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
    for (const meal of body.meals) {
      assertPublicHistoryMealDto(meal);
    }
    assert.deepEqual(
      body.meals.map((meal) => meal.id),
      [updatedMeal.id, assetMeal.id, nearbyMeal.id, boundaryMeal.id],
      "history meals should use descending loggedAt ordering",
    );
    assert.ok(!body.meals.some((meal) => meal.id === deletedMeal.id));
    assert.ok(!body.meals.some((meal) => meal.display.title === "外部裝置餐點"));
    assert.ok(!body.meals.some((meal) => meal.display.title === "隔天早餐"));

    const assetProjection = body.meals.find((meal) => meal.id === assetMeal.id);
    assert.deepEqual(assetProjection, {
      id: assetMeal.id,
      mealRevisionId: assetMeal.mealRevisionId,
      dateKey: "2026-03-25",
      loggedAt: "2026-03-25T04:00:00.000Z",
      display: { title: "雞胸、地瓜、青菜" },
      itemCount: 3,
      nutrition: { calories: 460, protein: 47, carbs: 49, fat: 8 },
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
        {
          name: "青菜",
          position: 2,
          nutrition: { calories: 40, protein: 2, carbs: 8, fat: 2 },
        },
      ],
      asset: { imageAssetId: "asset-1", imageUrl: "/api/assets/asset-1" },
      imageAssetId: "asset-1",
      imageUrl: "/api/assets/asset-1",
      revision: { currentRevisionNumber: 1 },
    });

    const correctedProjection = body.meals.find((meal) => meal.id === updatedMeal.id);
    assert.deepEqual(correctedProjection, {
      id: updatedMeal.id,
      mealRevisionId: correctedMeal.mealRevisionId,
      dateKey: "2026-03-25",
      loggedAt: "2026-03-25T08:00:00.000Z",
      display: { title: "修正雞腿便當" },
      itemCount: 1,
      nutrition: { calories: 620, protein: 34, carbs: 70, fat: 22 },
      items: [
        {
          name: "修正雞腿便當",
          position: 0,
          nutrition: { calories: 620, protein: 34, carbs: 70, fat: 22 },
        },
      ],
      asset: { imageAssetId: null, imageUrl: null },
      imageAssetId: null,
      imageUrl: null,
      revision: { currentRevisionNumber: 2 },
    });

    assert.equal(body.meals.find((meal) => meal.id === boundaryMeal.id)?.dateKey, "2026-03-25");
    assert.equal(
      body.meals.find((meal) => meal.id === boundaryMeal.id)?.mealRevisionId,
      boundaryMeal.mealRevisionId,
    );
    assertNoUnsafeHistoryFields(body);
  });

  it("projects explicit mealPeriod through history list, search, and day detail without inferring legacy rows", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");

    const explicitLunch = await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞腿便當",
      calories: 650,
      protein: 36,
      carbs: 72,
      fat: 24,
      loggedAt: "2026-03-25T00:30:00.000Z",
      mealPeriod: "lunch",
    });
    const legacyBreakfastHour = await services.foodLoggingService.logFood(deviceId, {
      foodName: "蛋餅",
      calories: 360,
      protein: 18,
      carbs: 42,
      fat: 14,
      loggedAt: "2026-03-25T00:45:00.000Z",
    });

    const listRes = await app.inject({
      method: "GET",
      url: "/api/history/meals?from=2026-03-25&to=2026-03-25&limit=10",
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(listRes.statusCode, 200);
    const listBody = listRes.json() as { meals: HistoryMeal[] };
    for (const meal of listBody.meals) {
      assertPublicHistoryMealDto(meal);
    }
    assertNoUnsafeHistoryFields(listBody);
    const listExplicitMeal = listBody.meals.find((meal) => meal.id === explicitLunch.id);
    assert.ok(listExplicitMeal, "expected history list to include explicit lunch meal");
    assert.equal(listExplicitMeal.mealPeriod, "lunch");
    const listLegacyMeal = listBody.meals.find((meal) => meal.id === legacyBreakfastHour.id);
    assert.ok(listLegacyMeal, "expected history list to include legacy breakfast-hour meal");
    assert.equal(Object.prototype.hasOwnProperty.call(listLegacyMeal, "mealPeriod"), false);

    const searchRes = await app.inject({
      method: "GET",
      url: "/api/history/search?q=%E9%9B%9E%E8%85%BF&from=2026-03-25&to=2026-03-25&limit=10",
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(searchRes.statusCode, 200);
    const searchBody = searchRes.json() as {
      results: Array<{
        item: { name: string; position: number; nutrition: { calories: number; protein: number; carbs: number; fat: number } };
        meal: HistoryMeal;
      }>;
    };
    for (const result of searchBody.results) {
      assertRecord(result);
      assertRecord(result.item);
      assert.equal(typeof result.item.name, "string");
      assert.ok(result.item.name.length > 0);
      assertFiniteNumber(result.item.position, "history.search.item.position");
      assertNutritionDto(result.item.nutrition, "history.search.item.nutrition");
      assertPublicHistoryMealDto(result.meal);
    }
    assertNoUnsafeHistoryFields(searchBody);
    assert.equal(searchBody.results.find((result) => result.meal.id === explicitLunch.id)?.meal.mealPeriod, "lunch");

    const dayRes = await app.inject({
      method: "GET",
      url: "/api/history/days/2026-03-25",
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(dayRes.statusCode, 200);
    const dayBody = dayRes.json() as { meals: HistoryMeal[] };
    for (const meal of dayBody.meals) {
      assertPublicHistoryMealDto(meal);
    }
    assertNoUnsafeHistoryFields(dayBody);
    const dayExplicitMeal = dayBody.meals.find((meal) => meal.id === explicitLunch.id);
    assert.ok(dayExplicitMeal, "expected history day detail to include explicit lunch meal");
    assert.equal(dayExplicitMeal.mealPeriod, "lunch");
    const dayLegacyMeal = dayBody.meals.find((meal) => meal.id === legacyBreakfastHour.id);
    assert.ok(dayLegacyMeal, "expected history day detail to include legacy breakfast-hour meal");
    assert.equal(Object.prototype.hasOwnProperty.call(dayLegacyMeal, "mealPeriod"), false);
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
    for (const meal of firstBody.meals) {
      assertPublicHistoryMealDto(meal);
    }
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
    for (const meal of secondBody.meals) {
      assertPublicHistoryMealDto(meal);
    }
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
    assertNoUnsafeHistoryFields(res.json());
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
    for (const meal of body.meals) {
      assertPublicHistoryMealDto(meal);
    }

    assert.equal(body.date, "2026-03-25");
    assert.deepEqual(body.summary, {
      date: "2026-03-25",
      totalCalories: 700,
      totalProtein: 43,
      totalCarbs: 80,
      totalFat: 24,
      mealCount: 2,
    });
    assert.deepEqual(
      body.meals.map((meal) => meal.id),
      [seeded.assetMeal.id, seeded.boundaryMeal.id],
    );
    assert.deepEqual(body.meals[0], {
      id: seeded.assetMeal.id,
      mealRevisionId: seeded.assetMeal.mealRevisionId,
      dateKey: "2026-03-25",
      loggedAt: "2026-03-25T04:00:00.000Z",
      display: { title: "鮭魚、白飯、青菜" },
      itemCount: 3,
      nutrition: { calories: 580, protein: 37, carbs: 66, fat: 20 },
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
        {
          name: "青菜",
          position: 2,
          nutrition: { calories: 40, protein: 2, carbs: 8, fat: 2 },
        },
      ],
      asset: { imageAssetId: "asset-2", imageUrl: "/api/assets/asset-2" },
      imageAssetId: "asset-2",
      imageUrl: "/api/assets/asset-2",
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
