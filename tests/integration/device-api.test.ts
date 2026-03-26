import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { FastifyInstance } from "fastify";

describe("Device API", () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    app = await buildApp({ dbPath: ":memory:", llmProvider: new MockLLMProvider() });
  });

  afterEach(async () => {
    await app.close();
  });

  it("POST /api/device creates a device", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.deviceId);
    assert.equal(body.dailyTargets.calories, 1500);
    assert.equal(body.dailyTargets.protein, 120);
  });

  it("POST /api/device rejects invalid goal", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fly_to_moon" },
    });
    assert.equal(res.statusCode, 400);
  });

  it("PUT /api/device/goals updates targets", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const { deviceId } = create.json();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { "x-device-id": deviceId },
      payload: { protein: 150 },
    });
    assert.equal(res.statusCode, 200);
    assert.equal(res.json().dailyTargets.protein, 150);
  });

  it("PUT /api/device/goals returns 401 without header", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      payload: { protein: 150 },
    });
    assert.equal(res.statusCode, 401);
  });
});
