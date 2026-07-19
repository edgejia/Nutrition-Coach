process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { createHistoryQueryService } from "../../server/services/history-query.js";
import type { createFoodLoggingService } from "../../server/services/food-logging.js";

describe("Phase 127 NC-COR-05 history trend bound", () => {
  let app: FastifyInstance;
  let cookie: string;
  let deviceId: string;
  let historyQueryService: ReturnType<typeof createHistoryQueryService>;
  let foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  let sqlite: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } };

  beforeEach(async () => {
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      onServicesReady: (services) => {
        historyQueryService = services.historyQueryService;
        foodLoggingService = services.foodLoggingService;
        sqlite = (services.db as unknown as {
          $client: { prepare: (sql: string) => { get: (...args: unknown[]) => unknown } };
        }).$client;
      },
    });
    const created = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    deviceId = created.json().deviceId;
    const rawCookie = created.headers["set-cookie"];
    cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie ?? "").split(";", 1)[0];
  });

  afterEach(async () => {
    await app.close();
  });

  async function assertServiceRejectsBeforeExpansionOrTrendQuery(from: string, to: string) {
    let workObserved = false;
    const OriginalMap = globalThis.Map;
    const OriginalSet = globalThis.Set;
    const originalPrepare = sqlite.prepare;

    class ObservedMap<K, V> extends OriginalMap<K, V> {
      constructor(entries?: readonly (readonly [K, V])[] | null) {
        workObserved = true;
        super(entries ?? undefined);
      }
    }

    class ObservedSet<T> extends OriginalSet<T> {
      constructor(values?: readonly T[] | null) {
        workObserved = true;
        super(values ?? undefined);
      }
    }

    globalThis.Map = ObservedMap as typeof Map;
    globalThis.Set = ObservedSet as typeof Set;
    sqlite.prepare = (sql: string) => {
      if (sql.includes("meal_transactions")) {
        workObserved = true;
      }
      return originalPrepare.call(sqlite, sql);
    };

    try {
      await assert.rejects(
        historyQueryService.getTrends({ deviceId: "probe-device", from, to }),
        (error: unknown) =>
          error instanceof Error &&
          error.message === "Invalid history query",
      );
    } finally {
      globalThis.Map = OriginalMap;
      globalThis.Set = OriginalSet;
      sqlite.prepare = originalPrepare;
    }

    return !workObserved;
  }

  it("accepts exactly the documented 366-day inclusive maximum", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/history/trends?from=2026-01-01&to=2027-01-01",
      headers: { cookie },
    });
    assert.equal(response.statusCode, 200);
    const body = response.json() as { daily: unknown[]; totals: { mealCount: number } };
    assert.equal(body.daily.length, 366);
    assert.equal(body.totals.mealCount, 0);
  });

  it("rejects maximum-plus-one before bucket or SQLite work", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/history/trends?from=2026-01-01&to=2027-01-02",
      headers: { cookie },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json().issues, [{ field: "to", message: "date range must not exceed 366 days" }]);
    assert.equal(
      await assertServiceRejectsBeforeExpansionOrTrendQuery("2026-01-01", "2027-01-02"),
      true,
    );
  });

  it("rejects the extreme year range with the same bounded category", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/history/trends?from=0000-01-01&to=9999-12-31",
      headers: { cookie },
    });
    assert.equal(response.statusCode, 400);
    assert.deepEqual(response.json(), {
      error: "Invalid query",
      code: "INVALID_QUERY",
      issues: [{ field: "to", message: "date range must not exceed 366 days" }],
    });
    assert.equal(
      await assertServiceRejectsBeforeExpansionOrTrendQuery("0000-01-01", "9999-12-31"),
      true,
    );
  });

  it("keeps two-year meals and search history compatible while trends stay bounded", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2024-01-01T04:00:00.000Z",
      items: [{ foodName: "compatibility meal", calories: 400, protein: 20, carbs: 40, fat: 12 }],
    });

    const mealsResponse = await app.inject({
      method: "GET",
      url: "/api/history/meals?from=2024-01-01&to=2025-12-31&limit=10",
      headers: { cookie },
    });
    assert.equal(mealsResponse.statusCode, 200);
    assert.equal((mealsResponse.json() as { meals: unknown[] }).meals.length, 1);

    const searchResponse = await app.inject({
      method: "GET",
      url: "/api/history/search?q=compatibility&from=2024-01-01&to=2025-12-31&limit=10",
      headers: { cookie },
    });
    assert.equal(searchResponse.statusCode, 200);
    assert.equal((searchResponse.json() as { results: unknown[] }).results.length, 1);
  });
});
