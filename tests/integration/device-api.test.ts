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

  it("POST /api/device creates a device with muscle_gain goal", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "muscle_gain" },
    });
    assert.equal(res.statusCode, 200);
    const body = res.json();
    assert.ok(body.deviceId);
    assert.equal(body.dailyTargets.calories, 2500);
    assert.equal(body.dailyTargets.protein, 180);
  });

  it("PUT /api/device/goals rejects negative values", async () => {
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
      payload: { calories: -100 },
    });
    assert.equal(res.statusCode, 400);
  });

  it("PUT /api/device/goals returns 401 with invalid device id", async () => {
    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: { "x-device-id": "non-existent-id" },
      payload: { protein: 150 },
    });
    assert.equal(res.statusCode, 401);
  });

  it("PUT /api/device/goals returns 400 for null body", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const { deviceId } = create.json();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: {
        "x-device-id": deviceId,
        "content-type": "application/json",
      },
      body: "null",
    });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json().error);
  });

  it("PUT /api/device/goals returns 400 for array body", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const { deviceId } = create.json();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: {
        "x-device-id": deviceId,
        "content-type": "application/json",
      },
      body: "[1,2,3]",
    });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json().error);
  });

  it("PUT /api/device/goals returns 400 for string body", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const { deviceId } = create.json();

    const res = await app.inject({
      method: "PUT",
      url: "/api/device/goals",
      headers: {
        "x-device-id": deviceId,
        "content-type": "application/json",
      },
      body: '"hello"',
    });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json().error);
  });

  it("PUT /api/device/goals returns 400 for empty object body", async () => {
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
      payload: {},
    });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json().error);
  });

  it("PUT /api/device/goals returns 400 for unknown-only keys", async () => {
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
      payload: { sodium: 1 },
    });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json().error);
  });

  it("PUT /api/device/goals returns 400 for string field value", async () => {
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
      payload: { protein: "150" },
    });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json().error);
  });

  it("PUT /api/device/goals returns 400 for null field value", async () => {
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
      payload: { protein: null },
    });
    assert.equal(res.statusCode, 400);
    assert.ok(res.json().error);
  });
});
