process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

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

function assertPublicDailySummaryDto(value: unknown) {
  assertRecord(value);
  assert.deepEqual(Object.keys(value).sort(), [
    "date",
    "mealCount",
    "totalCalories",
    "totalCarbs",
    "totalFat",
    "totalProtein",
  ]);
  assert.equal(typeof value.date, "string");
  assertFiniteNumber(value.totalCalories, "summary.totalCalories");
  assertFiniteNumber(value.totalProtein, "summary.totalProtein");
  assertFiniteNumber(value.totalCarbs, "summary.totalCarbs");
  assertFiniteNumber(value.totalFat, "summary.totalFat");
  assertFiniteNumber(value.mealCount, "summary.mealCount");
}

function assertPublicDaySnapshotMealDto(value: unknown) {
  assertRecord(value);
  const allowedKeys = new Set([
    "id",
    "mealRevisionId",
    "foodName",
    "itemCount",
    "calories",
    "protein",
    "carbs",
    "fat",
    "imageAssetId",
    "imageUrl",
    "loggedAt",
    "mealPeriod",
  ]);
  for (const key of Object.keys(value)) {
    assert.ok(allowedKeys.has(key), `expected day snapshot meal to exclude ${key}`);
  }
  assert.equal(typeof value.id, "string");
  assert.equal(typeof value.mealRevisionId, "string");
  assert.equal(typeof value.foodName, "string");
  assert.ok(typeof value.foodName === "string" && value.foodName.length > 0);
  assertFiniteNumber(value.calories, "meal.calories");
  assertFiniteNumber(value.protein, "meal.protein");
  assertFiniteNumber(value.carbs, "meal.carbs");
  assertFiniteNumber(value.fat, "meal.fat");
  assertFiniteNumber(value.itemCount, "meal.itemCount");
  assertNullableString(value.imageAssetId, "meal.imageAssetId");
  assertNullableString(value.imageUrl, "meal.imageUrl");
  assert.equal(typeof value.loggedAt, "string");
  if ("mealPeriod" in value) {
    assert.equal(typeof value.mealPeriod, "string");
    assert.ok(
      typeof value.mealPeriod === "string" && VALID_MEAL_PERIODS.has(value.mealPeriod),
      `expected valid mealPeriod, got ${String(value.mealPeriod)}`,
    );
  }
}

function assertPublicDaySnapshotDto(value: unknown) {
  assertRecord(value);
  assert.deepEqual(Object.keys(value).sort(), ["date", "meals", "summary"]);
  assert.equal(typeof value.date, "string");
  assertPublicDailySummaryDto(value.summary);
  assert.ok(Array.isArray(value.meals), "expected meals array");
  for (const meal of value.meals) {
    assertPublicDaySnapshotMealDto(meal);
  }
}

describe("Day snapshot API", () => {
  let app: FastifyInstance;
  let deviceId: string;
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
    tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-day-snapshot-api-"));
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
  });

  afterEach(async () => {
    if (app.server.listening) {
      await app.close();
    }
    await rm(tempRoot, { recursive: true, force: true });
  });

  it("GET /api/day-snapshot returns summary and meals for the same selected local day", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");

    const boundaryMeal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "午夜點心",
      calories: 120,
      protein: 6,
      carbs: 14,
      fat: 4,
      loggedAt: "2026-03-24T16:30:00.000Z",
    });
    const groupedMeal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      imagePath: "asset:asset-1",
      loggedAt: "2026-03-25T04:00:00.000Z",
      items: [
        { foodName: "雞腿", calories: 320, protein: 26, carbs: 0, fat: 18 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 1 },
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

    const res = await app.inject({
      method: "GET",
      url: "/api/day-snapshot?date=2026-03-25",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(res.statusCode, 200);
    assertPublicDaySnapshotDto(res.json());
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
        mealRevisionId: string;
        foodName: string;
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
        itemCount?: number;
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
      totalCarbs: 84,
      totalFat: 25,
      mealCount: 2,
    });
    assert.equal(body.meals.length, 2);
    assert.match(body.meals[0]!.id, /^[0-9a-f-]+$/i);
    assert.match(body.meals[1]!.id, /^[0-9a-f-]+$/i);
    assert.deepEqual(body.meals.map(({ id, ...meal }) => meal), [
      {
        foodName: "午夜點心",
        mealRevisionId: boundaryMeal.mealRevisionId,
        calories: 120,
        protein: 6,
        carbs: 14,
        fat: 4,
        itemCount: 1,
        imageAssetId: null,
        imageUrl: null,
        loggedAt: "2026-03-24T16:30:00.000Z",
      },
      {
        foodName: "雞腿、白飯、青菜",
        mealRevisionId: groupedMeal.mealRevisionId,
        calories: 640,
        protein: 32,
        carbs: 70,
        fat: 21,
        itemCount: 3,
        imageAssetId: "asset-1",
        imageUrl: "/api/assets/asset-1",
        loggedAt: "2026-03-25T04:00:00.000Z",
      },
    ]);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /currentRevisionId/);
    assert.doesNotMatch(serialized, /deviceId/);
    assert.doesNotMatch(serialized, /deviceId=/);
  });

  it("GET /api/day-snapshot projects explicit mealPeriod without inferring legacy rows", async () => {
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

    const res = await app.inject({
      method: "GET",
      url: "/api/day-snapshot?date=2026-03-25",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json() as { meals: Array<{ id: string; mealPeriod?: unknown }> };
    assertPublicDaySnapshotDto(body);
    const explicitMeal = body.meals.find((meal) => meal.id === explicitLunch.id);
    assert.ok(explicitMeal, "expected day snapshot to include explicit lunch meal");
    assert.equal(explicitMeal.mealPeriod, "lunch");

    const legacyMeal = body.meals.find((meal) => meal.id === legacyBreakfastHour.id);
    assert.ok(legacyMeal, "expected day snapshot to include legacy breakfast-hour meal");
    assert.equal(Object.prototype.hasOwnProperty.call(legacyMeal, "mealPeriod"), false);
    const serialized = JSON.stringify(body);
    assert.doesNotMatch(serialized, /currentRevisionId/);
    assert.doesNotMatch(serialized, /deviceId/);
    assert.doesNotMatch(serialized, /deviceId=/);
  });

  it("GET /api/day-snapshot rejects missing and malformed dates", async () => {
    const missingDate = await app.inject({
      method: "GET",
      url: "/api/day-snapshot",
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(missingDate.statusCode, 400);
    assert.deepEqual(missingDate.json(), { error: "Missing date query" });

    const malformedDate = await app.inject({
      method: "GET",
      url: "/api/day-snapshot?date=2026-02-31",
      headers: { cookie: sessionCookieHeader },
    });
    assert.equal(malformedDate.statusCode, 400);
    assert.deepEqual(malformedDate.json(), { error: "Invalid date query" });
  });

  it("GET /api/day-snapshot requires a valid guest session", async () => {
    const missingDevice = await app.inject({
      method: "GET",
      url: "/api/day-snapshot?date=2026-03-25",
    });
    assert.equal(missingDevice.statusCode, 401);
    assert.deepEqual(missingDevice.json(), { error: "Guest session required" });

    const invalidDevice = await app.inject({
      method: "GET",
      url: "/api/day-snapshot?date=2026-03-25",
      headers: { cookie: "guest_session=invalid; guest_session_resume=invalid" },
    });
    assert.equal(invalidDevice.statusCode, 401);
    assert.deepEqual(invalidDevice.json(), { error: "Invalid guest session" });
  });
});
