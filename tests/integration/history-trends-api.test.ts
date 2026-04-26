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

    await services.foodLoggingService.logFood(deviceId, {
      foodName: "三月二十四午餐",
      calories: 210,
      protein: 21,
      carbs: 24,
      fat: 6,
      loggedAt: "2026-03-24T04:00:00.000Z",
    });
    await services.foodLoggingService.logFood(deviceId, {
      foodName: "台北午夜後點心",
      calories: 120,
      protein: 6,
      carbs: 12,
      fat: 3,
      loggedAt: "2026-03-24T16:30:00.000Z",
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:00:00.000Z",
      items: [
        { foodName: "multi-item 雞胸", calories: 180, protein: 18, carbs: 18, fat: 6 },
        { foodName: "multiple items 地瓜", calories: 150, protein: 15, carbs: 18, fat: 6 },
      ],
    });
    await services.foodLoggingService.logFood(deviceId, {
      foodName: "三月二十六早餐",
      calories: 240,
      protein: 24,
      carbs: 24,
      fat: 9,
      loggedAt: "2026-03-25T16:30:00.000Z",
    });

    await services.foodLoggingService.logFood(foreignDeviceId, {
      foodName: "外部裝置餐點",
      calories: 999,
      protein: 99,
      carbs: 99,
      fat: 99,
      loggedAt: "2026-03-25T05:00:00.000Z",
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
});
