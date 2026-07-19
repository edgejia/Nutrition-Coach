process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { createMealTransactionsService } from "../../server/services/meal-transactions.js";

describe("Phase 127 NC-COR-02 meal snapshot", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let deviceId: string;

  beforeEach(async () => {
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      onServicesReady: (ready) => { services = ready; },
    });
    const created = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    assert.equal(created.statusCode, 200);
    deviceId = created.json().deviceId;
  });

  afterEach(async () => {
    await app.close();
  });

  it("returns one revision identity coupled to its immutable item facts", async () => {
    const meal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
        { foodName: "青菜", calories: 90, protein: 3, carbs: 8, fat: 4 },
      ],
    });
    const transactions = createMealTransactionsService(services.db);

    const snapshot = await transactions.getCurrentSnapshotForMutation(
      deviceId,
      meal.id,
      meal.mealRevisionId,
    );
    const facts = await services.mealCorrectionService.loadCurrentMealFacts(
      deviceId,
      meal.id,
      meal.mealRevisionId,
    );

    assert.equal(snapshot.header.currentRevisionId, meal.mealRevisionId);
    assert.equal(snapshot.items.length, 2);
    assert.equal(facts.currentMealRevisionId, snapshot.header.currentRevisionId);
    assert.equal(facts.items.length, snapshot.items.length);
    assert.equal(
      facts.totals.calories,
      facts.items.reduce((sum, item) => sum + item.calories, 0),
    );
    assert.equal(
      snapshot.items.every((item) => item.revisionId === snapshot.header.currentRevisionId),
      true,
    );
  });

  it("rejects a stale expected revision instead of returning mixed facts", async () => {
    const meal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [{ foodName: "早餐", calories: 400, protein: 20, carbs: 40, fat: 12 }],
    });

    await assert.rejects(
      () => createMealTransactionsService(services.db).getCurrentSnapshotForMutation(
        deviceId,
        meal.id,
        `${meal.mealRevisionId}:stale`,
      ),
      (error: unknown) => error instanceof Error && error.message === "MEAL_REVISION_STALE",
    );
  });

  it("rejects the old independent-read tuple when a revision advances between reads", async () => {
    const meal = await services.foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [{ foodName: "午餐", calories: 500, protein: 25, carbs: 55, fat: 15 }],
    });
    const updated = await services.foodLoggingService.updateMeal(deviceId, meal.id, {
      expectedMealRevisionId: meal.mealRevisionId,
      items: [{ foodName: "午餐", calories: 510, protein: 25, carbs: 55, fat: 15 }],
    });
    services.db.$client.prepare(
      "UPDATE meal_transactions SET current_revision_id = ?, current_revision_number = ? WHERE id = ?",
    ).run(meal.mealRevisionId, 1, meal.id);

    let interleaveObserved = false;
    const snapshotService = createMealTransactionsService(services.db, {
      afterHeaderRead: () => {
        interleaveObserved = true;
        services.db.$client.prepare(
          "UPDATE meal_transactions SET current_revision_id = ?, current_revision_number = ? WHERE id = ?",
        ).run(updated.mealRevisionId, 2, meal.id);
      },
    });
    const snapshot = await snapshotService.getCurrentSnapshotForMutation(
      deviceId,
      meal.id,
      meal.mealRevisionId,
    );

    assert.equal(interleaveObserved, true);
    assert.equal(
      snapshot.items.every((item) => item.revisionId === snapshot.header.currentRevisionId),
      true,
    );
    assert.equal(snapshot.header.currentRevisionId, meal.mealRevisionId);
    assert.equal(
      (services.db.$client.prepare("SELECT current_revision_id AS currentRevisionId FROM meal_transactions WHERE id = ?")
        .get(meal.id) as { currentRevisionId: string }).currentRevisionId,
      updated.mealRevisionId,
    );
    assert.equal(
      (services.db.$client.prepare("SELECT COUNT(*) AS count FROM meal_revisions WHERE transaction_id = ?")
        .get(meal.id) as { count: number }).count,
      2,
    );
  });
});
