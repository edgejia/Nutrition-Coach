process.env.TZ = "Asia/Taipei";

import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

describe("Phase 127 NC-COR-04 goal PATCH", () => {
  let app: FastifyInstance;
  let services: AppServices;
  let deviceId: string;
  let cookie: string;

  beforeEach(async () => {
    app = await buildApp({
      dbPath: ":memory:",
      llmProvider: new MockLLMProvider(),
      onServicesReady: (ready) => { services = ready; },
    });
    const created = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
    deviceId = created.json().deviceId;
    const rawCookie = created.headers["set-cookie"];
    cookie = (Array.isArray(rawCookie) ? rawCookie[0] : rawCookie ?? "").split(";", 1)[0];
  });

  afterEach(async () => {
    await app.close();
  });

  function readTargets() {
    return services.db.$client.prepare(
      "SELECT daily_calories AS calories, daily_protein AS protein, daily_carbs AS carbs, daily_fat AS fat FROM devices WHERE id = ?",
    ).get(deviceId) as { calories: number; protein: number; carbs: number; fat: number };
  }

  it("preserves disjoint calories-only and protein-only PATCH fields", async () => {
    const responses = await Promise.all([
      app.inject({ method: "PATCH", url: "/api/device/goals", headers: { cookie }, payload: { calories: 1600 } }),
      app.inject({ method: "PATCH", url: "/api/device/goals", headers: { cookie }, payload: { protein: 130 } }),
    ]);
    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 200]);
    const targets = readTargets();
    assert.equal(targets.calories, 1600);
    assert.equal(targets.protein, 130);
    assert.equal(typeof targets.carbs, "number");
    assert.equal(typeof targets.fat, "number");
  });

  it("rejects an invalid merged target without a partial field write", async () => {
    services.db.$client.prepare(
      "UPDATE devices SET daily_calories = ?, daily_protein = ?, daily_carbs = ?, daily_fat = ? WHERE id = ?",
    ).run(2000, 100, 100, 30, deviceId);

    const originalUpdateGoals = services.deviceService.updateGoals;
    let entered = 0;
    let releaseRace: (() => void) | undefined;
    let resolveBothEntered: (() => void) | undefined;
    const bothEntered = new Promise<void>((resolve) => { resolveBothEntered = resolve; });
    const release = new Promise<void>((resolve) => { releaseRace = resolve; });
    services.deviceService.updateGoals = async (id, goals) => {
      entered += 1;
      if (entered === 2) resolveBothEntered?.();
      await release;
      return originalUpdateGoals(id, goals);
    };

    const requests = Promise.all([
      app.inject({ method: "PATCH", url: "/api/device/goals", headers: { cookie }, payload: { calories: 1300 } }),
      app.inject({ method: "PATCH", url: "/api/device/goals", headers: { cookie }, payload: { protein: 200 } }),
    ]);
    await bothEntered;
    releaseRace?.();
    const responses = await requests;

    assert.deepEqual(responses.map((response) => response.statusCode).sort(), [200, 400]);
    const rejected = responses.find((response) => response.statusCode === 400);
    assert.ok(rejected);
    assert.equal(rejected.json().reason, "macro_calorie_inconsistent");
    const targets = readTargets();
    const caloriesAccepted = responses[0]?.statusCode === 200;
    assert.equal(targets.calories === 1300, caloriesAccepted);
    assert.equal(targets.protein === 200, !caloriesAccepted);
    assert.equal(targets.carbs, 100);
    assert.equal(targets.fat, 30);
  });
});
