process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import type { AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

type TrendBucket = {
  date: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  mealCount: number;
};

type TrendsResponse = {
  from: string;
  to: string;
  completeness: "empty" | "sparse" | "complete";
  daily: TrendBucket[];
  totals: Omit<TrendBucket, "date">;
  averages: {
    calories: number;
    protein: number;
    carbs: number;
    fat: number;
    mealsPerDay: number;
  };
};

const VALID_COMPLETENESS = new Set(["empty", "sparse", "complete"]);

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
  assert.equal(Array.isArray(value), false);
}

function assertFiniteNumber(value: unknown, field: string): asserts value is number {
  assert.equal(typeof value, "number", `expected ${field} to be a number`);
  assert.ok(Number.isFinite(value), `expected ${field} to be finite`);
}

function assertRealDateKey(value: unknown, field: string): asserts value is string {
  assert.equal(typeof value, "string", `expected ${field} to be a date string`);
  assert.ok(typeof value === "string", `expected ${field} to be a date string`);
  assert.match(value, /^\d{4}-\d{2}-\d{2}$/, `expected ${field} to be YYYY-MM-DD`);
  const parsed = new Date(`${value}T12:00:00`);
  assert.equal(Number.isNaN(parsed.getTime()), false, `expected ${field} to be calendar-real`);
  assert.equal(parsed.toISOString().slice(0, 10), value, `expected ${field} to round-trip as a calendar date`);
}

function assertTrendBucketDto(value: unknown, field: string) {
  assertRecord(value);
  assert.deepEqual(Object.keys(value).sort(), ["calories", "carbs", "date", "fat", "mealCount", "protein"]);
  assertRealDateKey(value.date, `${field}.date`);
  assertFiniteNumber(value.calories, `${field}.calories`);
  assertFiniteNumber(value.protein, `${field}.protein`);
  assertFiniteNumber(value.carbs, `${field}.carbs`);
  assertFiniteNumber(value.fat, `${field}.fat`);
  assertFiniteNumber(value.mealCount, `${field}.mealCount`);
}

function assertTrendTotalsDto(value: unknown, field: string) {
  assertRecord(value);
  assert.deepEqual(Object.keys(value).sort(), ["calories", "carbs", "fat", "mealCount", "protein"]);
  assertFiniteNumber(value.calories, `${field}.calories`);
  assertFiniteNumber(value.protein, `${field}.protein`);
  assertFiniteNumber(value.carbs, `${field}.carbs`);
  assertFiniteNumber(value.fat, `${field}.fat`);
  assertFiniteNumber(value.mealCount, `${field}.mealCount`);
}

function assertTrendAveragesDto(value: unknown, field: string) {
  assertRecord(value);
  assert.deepEqual(Object.keys(value).sort(), ["calories", "carbs", "fat", "mealsPerDay", "protein"]);
  assertFiniteNumber(value.calories, `${field}.calories`);
  assertFiniteNumber(value.protein, `${field}.protein`);
  assertFiniteNumber(value.carbs, `${field}.carbs`);
  assertFiniteNumber(value.fat, `${field}.fat`);
  assertFiniteNumber(value.mealsPerDay, `${field}.mealsPerDay`);
}

function assertHistoryTrendDto(value: unknown) {
  assertRecord(value);
  assert.deepEqual(Object.keys(value).sort(), ["averages", "completeness", "daily", "from", "to", "totals"]);
  assertRealDateKey(value.from, "historyTrend.from");
  assertRealDateKey(value.to, "historyTrend.to");
  assert.ok(
    typeof value.completeness === "string" && VALID_COMPLETENESS.has(value.completeness),
    `expected valid completeness, got ${String(value.completeness)}`,
  );
  assert.ok(Array.isArray(value.daily), "expected historyTrend.daily to be an array");
  for (const [index, bucket] of value.daily.entries()) {
    assertTrendBucketDto(bucket, `historyTrend.daily[${index}]`);
  }
  assertTrendTotalsDto(value.totals, "historyTrend.totals");
  assertTrendAveragesDto(value.averages, "historyTrend.averages");

  const serialized = JSON.stringify(value);
  for (const forbidden of ["deviceId", "currentRevisionId", "mealRevisionId", "revisionId", "imagePath", "deviceId="]) {
    assert.ok(!serialized.includes(forbidden), `expected history trend response to exclude ${forbidden}`);
  }
}

describe("History trends API", () => {
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
    tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-history-trends-api-"));
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

  async function seedThreeDayTrendMeals() {
    assert.ok(services, "expected onServicesReady to capture app services");

    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-24T04:00:00.000Z",
      items: [
        { foodName: "三月二十四午餐", calories: 210, protein: 21, carbs: 24, fat: 6 },
      ],
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-24T16:30:00.000Z",
      items: [
        { foodName: "台北午夜後點心", calories: 120, protein: 6, carbs: 12, fat: 3 },
      ],
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:00:00.000Z",
      items: [
        { foodName: "multi-item 雞胸", calories: 180, protein: 18, carbs: 18, fat: 6 },
        { foodName: "multiple items 地瓜", calories: 150, protein: 15, carbs: 18, fat: 6 },
      ],
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T16:30:00.000Z",
      items: [
        { foodName: "三月二十六早餐", calories: 240, protein: 24, carbs: 24, fat: 9 },
      ],
    });

    await services.foodLoggingService.logGroupedMeal(foreignDeviceId, {
      loggedAt: "2026-03-25T05:00:00.000Z",
      items: [
        { foodName: "外部裝置餐點", calories: 999, protein: 99, carbs: 99, fat: 99 },
      ],
    });
  }

  it("GET /api/history/trends returns inclusive daily buckets, totals, and deterministic averages", async () => {
    await seedThreeDayTrendMeals();

    const res = await app.inject({
      method: "GET",
      url: `/api/history/trends?from=2026-03-24&to=2026-03-26&deviceId=${foreignDeviceId}`,
      headers: { cookie: sessionCookieHeader, "x-device-id": foreignDeviceId },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json() as TrendsResponse;
    assertHistoryTrendDto(body);

    assert.equal(body.from, "2026-03-24");
    assert.equal(body.to, "2026-03-26");
    assert.equal(body.daily.length, 3);
    assert.deepEqual(body.daily, [
      { date: "2026-03-24", calories: 210, protein: 21, carbs: 24, fat: 6, mealCount: 1 },
      { date: "2026-03-25", calories: 450, protein: 39, carbs: 48, fat: 15, mealCount: 2 },
      { date: "2026-03-26", calories: 240, protein: 24, carbs: 24, fat: 9, mealCount: 1 },
    ]);
    assert.deepEqual(body.totals, {
      calories: 900,
      protein: 84,
      carbs: 96,
      fat: 30,
      mealCount: 4,
    });
    assert.deepEqual(body.averages, {
      calories: 300,
      protein: 28,
      carbs: 32,
      fat: 10,
      mealsPerDay: 4 / 3,
    });
    assert.equal(
      body.daily.find((bucket) => bucket.date === "2026-03-25")?.mealCount,
      2,
      "distinct meal count should count the multi-item meal as one meal, not joined item rows",
    );
  });

  it("GET /api/history/trends returns INVALID_QUERY for missing or malformed date ranges", async () => {
    const cases = [
      {
        name: "missing from",
        url: "/api/history/trends?to=2026-03-26",
        issue: { field: "from", message: "from is required" },
      },
      {
        name: "missing to",
        url: "/api/history/trends?from=2026-03-24",
        issue: { field: "to", message: "to is required" },
      },
      {
        name: "malformed from",
        url: "/api/history/trends?from=2026-3-24&to=2026-03-26",
        issue: { field: "from", message: "from must be a valid YYYY-MM-DD date" },
      },
      {
        name: "invalid calendar to",
        url: "/api/history/trends?from=2026-03-24&to=2026-02-31",
        issue: { field: "to", message: "to must be a valid YYYY-MM-DD date" },
      },
      {
        name: "from after to",
        url: "/api/history/trends?from=2026-03-26&to=2026-03-24",
        issue: { field: "from", message: "from must be on or before to" },
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

  it("classifies empty, sparse, and complete ranges from meal presence only", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");

    const deletedMeal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-24T02:00:00.000Z",
      items: [
        { foodName: "已刪除早餐", calories: 450, protein: 30, carbs: 45, fat: 15 },
      ],
    });
    await services.foodLoggingService.deleteMeal(deviceId, deletedMeal.id, deletedMeal.mealRevisionId);
    await services.foodLoggingService.logGroupedMeal(foreignDeviceId, {
      loggedAt: "2026-03-25T10:00:00.000Z",
      items: [
        { foodName: "外部裝置晚餐", calories: 700, protein: 40, carbs: 70, fat: 20 },
      ],
    });

    const emptyRes = await app.inject({
      method: "GET",
      url: "/api/history/trends?from=2026-03-24&to=2026-03-26",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(emptyRes.statusCode, 200);
    const emptyBody = emptyRes.json() as TrendsResponse;
    assertHistoryTrendDto(emptyBody);
    assert.equal(emptyBody.completeness, "empty");
    assert.equal(emptyBody.daily.length, 3);
    assert.deepEqual(emptyBody.daily, [
      { date: "2026-03-24", calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 },
      { date: "2026-03-25", calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 },
      { date: "2026-03-26", calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 },
    ]);
    assert.deepEqual(emptyBody.totals, { calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 });
    assert.deepEqual(emptyBody.averages, { calories: 0, protein: 0, carbs: 0, fat: 0, mealsPerDay: 0 });

    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:00:00.000Z",
      items: [
        { foodName: "稀疏範圍午餐", calories: 300, protein: 20, carbs: 35, fat: 10 },
      ],
    });

    const sparseRes = await app.inject({
      method: "GET",
      url: "/api/history/trends?from=2026-03-24&to=2026-03-26",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(sparseRes.statusCode, 200);
    const sparseBody = sparseRes.json() as TrendsResponse;
    assertHistoryTrendDto(sparseBody);
    assert.equal(sparseBody.completeness, "sparse");
    assert.deepEqual(sparseBody.daily, [
      { date: "2026-03-24", calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 },
      { date: "2026-03-25", calories: 300, protein: 20, carbs: 35, fat: 10, mealCount: 1 },
      { date: "2026-03-26", calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 },
    ]);
    assert.deepEqual(sparseBody.totals, { calories: 300, protein: 20, carbs: 35, fat: 10, mealCount: 1 });
    assert.deepEqual(sparseBody.averages, {
      calories: 100,
      protein: 20 / 3,
      carbs: 35 / 3,
      fat: 10 / 3,
      mealsPerDay: 1 / 3,
    });

    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-24T05:00:00.000Z",
      items: [
        { foodName: "完整範圍第一天", calories: 10, protein: 1, carbs: 1, fat: 1 },
      ],
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T16:30:00.000Z",
      items: [
        { foodName: "完整範圍第三天", calories: 20, protein: 2, carbs: 2, fat: 2 },
      ],
    });

    const completeRes = await app.inject({
      method: "GET",
      url: "/api/history/trends?from=2026-03-24&to=2026-03-26",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(completeRes.statusCode, 200);
    const completeBody = completeRes.json() as TrendsResponse;
    assertHistoryTrendDto(completeBody);
    assert.equal(completeBody.completeness, "complete");
    assert.deepEqual(completeBody.daily, [
      { date: "2026-03-24", calories: 10, protein: 1, carbs: 1, fat: 1, mealCount: 1 },
      { date: "2026-03-25", calories: 300, protein: 20, carbs: 35, fat: 10, mealCount: 1 },
      { date: "2026-03-26", calories: 20, protein: 2, carbs: 2, fat: 2, mealCount: 1 },
    ]);
    assert.deepEqual(completeBody.totals, { calories: 330, protein: 23, carbs: 38, fat: 13, mealCount: 3 });
  });

  it("uses current revisions and excludes deleted or raw foreign-device selector rows", async () => {
    assert.ok(services, "expected onServicesReady to capture app services");

    const updatedMeal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:00:00.000Z",
      items: [
        { foodName: "原始便當", calories: 900, protein: 10, carbs: 100, fat: 40 },
      ],
    });
    await services.foodLoggingService.updateMeal(deviceId, updatedMeal.id, {
      expectedMealRevisionId: updatedMeal.mealRevisionId,
      loggedAt: "2026-03-25T04:00:00.000Z",
      items: [
        { foodName: "修正雞胸便當", calories: 500, protein: 50, carbs: 40, fat: 12 },
      ],
    });
    const deletedMeal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T07:00:00.000Z",
      items: [
        { foodName: "已刪除點心", calories: 250, protein: 5, carbs: 30, fat: 11 },
      ],
    });
    await services.foodLoggingService.deleteMeal(deviceId, deletedMeal.id, deletedMeal.mealRevisionId);
    await services.foodLoggingService.logGroupedMeal(foreignDeviceId, {
      loggedAt: "2026-03-25T08:00:00.000Z",
      items: [
        { foodName: "外部裝置高熱量晚餐", calories: 999, protein: 99, carbs: 99, fat: 99 },
      ],
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/history/trends?from=2026-03-25&to=2026-03-25&deviceId=${foreignDeviceId}`,
      headers: { cookie: sessionCookieHeader, "x-device-id": foreignDeviceId },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json() as TrendsResponse;
    assertHistoryTrendDto(body);

    assert.equal(body.completeness, "complete");
    assert.deepEqual(body.daily, [
      { date: "2026-03-25", calories: 500, protein: 50, carbs: 40, fat: 12, mealCount: 1 },
    ]);
    assert.deepEqual(body.totals, { calories: 500, protein: 50, carbs: 40, fat: 12, mealCount: 1 });
    assert.deepEqual(body.averages, { calories: 500, protein: 50, carbs: 40, fat: 12, mealsPerDay: 1 });
  });
});
