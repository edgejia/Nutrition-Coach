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

type HistorySearchResult = {
  item: {
    name: string;
    position: number;
    nutrition: {
      calories: number;
      protein: number;
      carbs: number;
      fat: number;
    };
  };
  meal: HistoryMeal;
};

describe("History search API", () => {
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
    tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-history-search-api-"));
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
    assert.ok(!serialized.includes("imagePath"), "search response must not expose imagePath");
    assert.ok(!serialized.includes("storageKey"), "search response must not expose storageKey");
    assert.ok(!serialized.includes("currentRevisionId"), "search response must not expose currentRevisionId");
    assert.ok(!serialized.includes("supersedesRevisionId"), "search response must not expose supersedesRevisionId");
    assert.ok(!serialized.includes("revisionId"), "search response must not expose raw revisionId");
    assert.ok(!serialized.includes("deletedAt"), "search response must not expose deleted revision metadata");
  }

  async function seedSearchContractMeals() {
    assert.ok(services, "expected onServicesReady to capture app services");

    const chickenMeal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "Chicken Salad",
      calories: 420,
      protein: 38,
      carbs: 18,
      fat: 21,
      loggedAt: "2026-03-25T04:00:00.000Z",
    });
    const chineseMeal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "雞胸便當",
      calories: 610,
      protein: 46,
      carbs: 72,
      fat: 16,
      loggedAt: "2026-03-25T05:00:00.000Z",
    });
    await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T06:00:00.000Z",
      items: [
        { foodName: "番茄", calories: 30, protein: 1, carbs: 7, fat: 0 },
        { foodName: "豆腐", calories: 160, protein: 16, carbs: 6, fat: 9 },
        { foodName: "菠菜", calories: 25, protein: 3, carbs: 4, fat: 0 },
      ],
    });
    const updatedMeal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "Superseded Beef Bowl",
      calories: 700,
      protein: 36,
      carbs: 80,
      fat: 24,
      loggedAt: "2026-03-25T07:00:00.000Z",
    });
    await services.foodLoggingService.updateMeal(deviceId, updatedMeal.id, {
      loggedAt: "2026-03-25T07:00:00.000Z",
      items: [
        { foodName: "Current Tofu Bowl", calories: 520, protein: 28, carbs: 64, fat: 18 },
      ],
    });
    const deletedMeal = await services.foodLoggingService.logFood(deviceId, {
      foodName: "Deleted Chicken Wrap",
      calories: 390,
      protein: 24,
      carbs: 42,
      fat: 12,
      loggedAt: "2026-03-25T08:00:00.000Z",
    });
    await services.foodLoggingService.deleteMeal(deviceId, deletedMeal.id);
    await services.foodLoggingService.logFood(foreignDeviceId, {
      foodName: "Chicken Salad",
      calories: 999,
      protein: 99,
      carbs: 99,
      fat: 99,
      loggedAt: "2026-03-25T09:00:00.000Z",
    });

    return { chickenMeal, chineseMeal, updatedMeal, deletedMeal };
  }

  async function seedNutritionBoundMeal() {
    assert.ok(services, "expected onServicesReady to capture app services");

    return services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T10:00:00.000Z",
      items: [
        { foodName: "Edamame Snack", calories: 130, protein: 8, carbs: 12, fat: 5 },
        { foodName: "Grilled Chicken", calories: 400, protein: 35, carbs: 8, fat: 12 },
      ],
    });
  }

  it("GET /api/history/search matches current item names and returns safe parent meal context", async () => {
    const seeded = await seedSearchContractMeals();

    const latinRes = await app.inject({
      method: "GET",
      url: `/api/history/search?q=chic&from=2026-03-25&to=2026-03-25&deviceId=${foreignDeviceId}`,
      headers: { cookie: sessionCookieHeader, "x-device-id": foreignDeviceId },
    });

    assert.equal(latinRes.statusCode, 200);
    const latinBody = latinRes.json() as { results: HistorySearchResult[]; nextCursor: string | null };
    assert.equal(latinBody.nextCursor, null);
    assert.deepEqual(
      latinBody.results.map((result) => result.meal.id),
      [seeded.chickenMeal.id],
      "search must derive ownership from the signed guest-session cookie, not raw selector inputs",
    );
    assert.deepEqual(latinBody.results[0], {
      item: {
        name: "Chicken Salad",
        position: 0,
        nutrition: { calories: 420, protein: 38, carbs: 18, fat: 21 },
      },
      meal: {
        id: seeded.chickenMeal.id,
        dateKey: "2026-03-25",
        loggedAt: "2026-03-25T04:00:00.000Z",
        display: { title: "Chicken Salad" },
        nutrition: { calories: 420, protein: 38, carbs: 18, fat: 21 },
        items: [
          {
            name: "Chicken Salad",
            position: 0,
            nutrition: { calories: 420, protein: 38, carbs: 18, fat: 21 },
          },
        ],
        asset: { imageAssetId: null, imageUrl: null },
        revision: { currentRevisionNumber: 1 },
      },
    });
    assertNoUnsafeHistoryFields(latinBody);

    const chineseRes = await app.inject({
      method: "GET",
      url: "/api/history/search?q=%E9%9B%9E&from=2026-03-25&to=2026-03-25",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(chineseRes.statusCode, 200);
    const chineseBody = chineseRes.json() as { results: HistorySearchResult[]; nextCursor: string | null };
    assert.deepEqual(chineseBody.results.map((result) => result.item.name), ["雞胸便當"]);
    assert.equal(chineseBody.results[0]?.meal.id, seeded.chineseMeal.id);
    assertNoUnsafeHistoryFields(chineseBody);
  });

  it("GET /api/history/search ignores generated display titles, deleted meals, and superseded revision items", async () => {
    const seeded = await seedSearchContractMeals();

    const displayOnlyRes = await app.inject({
      method: "GET",
      url: "/api/history/search?q=%E7%AD%893%E9%A0%85&from=2026-03-25&to=2026-03-25",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(displayOnlyRes.statusCode, 200);
    assert.deepEqual(displayOnlyRes.json(), { results: [], nextCursor: null });

    const supersededRes = await app.inject({
      method: "GET",
      url: "/api/history/search?q=Superseded&from=2026-03-25&to=2026-03-25",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(supersededRes.statusCode, 200);
    assert.deepEqual(supersededRes.json(), { results: [], nextCursor: null });

    const currentRevisionRes = await app.inject({
      method: "GET",
      url: "/api/history/search?q=tofu&from=2026-03-25&to=2026-03-25",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(currentRevisionRes.statusCode, 200);
    const currentRevisionBody = currentRevisionRes.json() as { results: HistorySearchResult[]; nextCursor: string | null };
    assert.deepEqual(currentRevisionBody.results.map((result) => result.meal.id), [seeded.updatedMeal.id]);
    assert.equal(currentRevisionBody.results[0]?.meal.revision.currentRevisionNumber, 2);

    const deletedRes = await app.inject({
      method: "GET",
      url: "/api/history/search?q=Deleted&from=2026-03-25&to=2026-03-25",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(deletedRes.statusCode, 200);
    const deletedBody = deletedRes.json() as { results: HistorySearchResult[]; nextCursor: string | null };
    assert.ok(!deletedBody.results.some((result) => result.meal.id === seeded.deletedMeal.id));
    assert.deepEqual(deletedBody, { results: [], nextCursor: null });
  });

  it("GET /api/history/search applies flat nutrition bounds to parent meal totals", async () => {
    const boundedMeal = await seedNutritionBoundMeal();

    const res = await app.inject({
      method: "GET",
      url:
        "/api/history/search?q=edamame&from=2026-03-25&to=2026-03-25" +
        "&caloriesMin=500&caloriesMax=600" +
        "&proteinMin=40&proteinMax=50" +
        "&carbsMin=15&carbsMax=25" +
        "&fatMin=10&fatMax=20",
      headers: { cookie: sessionCookieHeader },
    });

    assert.equal(res.statusCode, 200);
    const body = res.json() as { results: HistorySearchResult[]; nextCursor: string | null };
    assert.equal(body.nextCursor, null);
    assert.deepEqual(
      body.results.map((result) => ({
        itemName: result.item.name,
        itemProtein: result.item.nutrition.protein,
        mealId: result.meal.id,
        mealProtein: result.meal.nutrition.protein,
      })),
      [
        {
          itemName: "Edamame Snack",
          itemProtein: 8,
          mealId: boundedMeal.id,
          mealProtein: 43,
        },
      ],
      "nutrition filters must evaluate parent meal totals, not the matched item nutrition",
    );
    assert.deepEqual(body.results[0]?.meal.nutrition, { calories: 530, protein: 43, carbs: 20, fat: 17 });
    assertNoUnsafeHistoryFields(body);
  });

  it("GET /api/history/search returns INVALID_QUERY for empty q and invalid nutrition bounds", async () => {
    const cases = [
      {
        name: "missing q",
        url: "/api/history/search?from=2026-03-25&to=2026-03-25",
        issue: { field: "q", message: "q is required" },
      },
      {
        name: "trimmed empty q",
        url: "/api/history/search?q=%20%20%20&from=2026-03-25&to=2026-03-25",
        issue: { field: "q", message: "q is required" },
      },
      {
        name: "negative caloriesMin",
        url: "/api/history/search?q=chicken&from=2026-03-25&to=2026-03-25&caloriesMin=-1",
        issue: { field: "caloriesMin", message: "caloriesMin must be a non-negative number" },
      },
      {
        name: "non-numeric proteinMax",
        url: "/api/history/search?q=chicken&from=2026-03-25&to=2026-03-25&proteinMax=abc",
        issue: { field: "proteinMax", message: "proteinMax must be a non-negative number" },
      },
      {
        name: "carbsMin above carbsMax",
        url: "/api/history/search?q=chicken&from=2026-03-25&to=2026-03-25&carbsMin=20&carbsMax=10",
        issue: { field: "carbsMin", message: "carbsMin must be less than or equal to carbsMax" },
      },
      {
        name: "nested nutrition filter",
        url: "/api/history/search?q=chicken&from=2026-03-25&to=2026-03-25&nutrition%5Bprotein%5D%5Bmin%5D=10",
        issue: { field: "nutrition[protein][min]", message: "nutrition[protein][min] is not supported" },
      },
      {
        name: "JSON filters",
        url: "/api/history/search?q=chicken&from=2026-03-25&to=2026-03-25&filters=%7B%22proteinMin%22%3A10%7D",
        issue: { field: "filters", message: "filters is not supported" },
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
