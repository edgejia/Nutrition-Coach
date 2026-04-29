process.env.TZ = "Asia/Taipei";

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { createScenarioApp } from "../harness/app-fixture.js";
import {
  buildInsightMetrics,
  loadInsightFixture,
  seedInsightFixture,
  type InsightFixtureName,
} from "../harness/insight-fixtures.js";

const FIXTURE_NAMES: InsightFixtureName[] = [
  "weekly-basic",
  "insufficient-data",
  "prompt-injection",
  "medical-boundary",
];

describe("insight fixtures", () => {
  test("loads all locked insight fixtures", () => {
    for (const name of FIXTURE_NAMES) {
      const fixture = loadInsightFixture(name);
      assert.equal(fixture.name, name);
      assert.match(fixture.dateRange.from, /^\d{4}-\d{2}-\d{2}$/);
      assert.match(fixture.dateRange.to, /^\d{4}-\d{2}-\d{2}$/);
      for (const meal of fixture.meals) {
        assert.ok(meal.name.length > 0);
        assert.equal(typeof meal.nutrition.calories, "number");
        assert.equal(typeof meal.nutrition.protein, "number");
        assert.equal(typeof meal.nutrition.carbs, "number");
        assert.equal(typeof meal.nutrition.fat, "number");
      }
    }
  });

  test("rejects unknown fixture names", () => {
    assert.throws(
      () => loadInsightFixture("unknown fixture" as InsightFixtureName),
      /Unknown insight fixture/,
    );
  });

  test("builds weekly-basic totals averages and allowedNumbers", () => {
    const fixture = loadInsightFixture("weekly-basic");
    const metrics = buildInsightMetrics(fixture);
    assert.deepEqual(metrics.totals, {
      calories: 2130,
      protein: 123,
      carbs: 232,
      fat: 75,
      mealCount: 5,
    });
    assert.equal(metrics.averages.calories, 2130 / 7);
    assert.equal(metrics.averages.protein, 123 / 7);
    assert.equal(metrics.completeness, "complete");
    assert.ok(metrics.mealNames.includes("雞胸便當"));
    assert.ok(metrics.mealNames.includes("優格"));
    assert.ok(metrics.mealNames.includes("鮭魚飯"));
    assert.ok(metrics.allowedNumbers.includes(2130));
    assert.ok(metrics.allowedNumbers.includes(123));
    assert.ok(metrics.allowedNumbers.includes(304.3));
  });

  test("insufficient-data yields sparse or empty completeness", () => {
    const metrics = buildInsightMetrics(loadInsightFixture("insufficient-data"));
    assert.ok(metrics.completeness === "sparse" || metrics.completeness === "empty");
    assert.equal(metrics.totals.mealCount, 1);
  });

  test("seedInsightFixture persists weekly-basic meals and matches deterministic metrics", async () => {
    const ctx = await createScenarioApp({});
    try {
      const fixture = loadInsightFixture("weekly-basic");
      const metrics = buildInsightMetrics(fixture);
      await seedInsightFixture(ctx.services, ctx.deviceId, fixture);

      const res = await ctx.app.inject({
        method: "GET",
        url: "/api/history/trends?from=2026-04-20&to=2026-04-26",
        headers: { cookie: ctx.cookieHeader },
      });

      assert.equal(res.statusCode, 200);
      const body = res.json() as {
        totals: typeof metrics.totals;
        averages: typeof metrics.averages;
      };
      assert.deepEqual(body.totals, metrics.totals);
      assert.deepEqual(body.averages, metrics.averages);
    } finally {
      await ctx.close();
    }
  });
});
