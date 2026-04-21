import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { FastifyInstance } from "fastify";

function getSetCookieHeaders(res: Awaited<ReturnType<FastifyInstance["inject"]>>) {
  const rawHeader = res.headers["set-cookie"];
  if (Array.isArray(rawHeader)) {
    return rawHeader;
  }
  return typeof rawHeader === "string" ? [rawHeader] : [];
}

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
    const setCookieHeaders = getSetCookieHeaders(res);
    assert.equal(setCookieHeaders.length, 2);
    assert.ok(setCookieHeaders.some((value) => value.startsWith("guest_session=")));
    assert.ok(setCookieHeaders.some((value) => value.startsWith("guest_session_resume=")));
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

  it("POST /api/device/session migrates a legacy device into cookie-backed mode", async () => {
    const create = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });
    const { deviceId, dailyTargets } = create.json();

    const res = await app.inject({
      method: "POST",
      url: "/api/device/session",
      payload: { legacyDeviceId: deviceId },
    });

    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.json(), {
      deviceId,
      goal: "fat_loss",
      dailyTargets,
      establishedBy: "legacy_migration",
    });
    const setCookieHeaders = getSetCookieHeaders(res);
    assert.equal(setCookieHeaders.length, 2);
    assert.ok(setCookieHeaders.some((value) => value.startsWith("guest_session=")));
    assert.ok(setCookieHeaders.some((value) => value.startsWith("guest_session_resume=")));
  });

  it("POST /api/device/session rejects invalid legacy device ids", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device/session",
      payload: { legacyDeviceId: "missing-device" },
    });

    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.json(), { error: "Invalid device ID" });
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

  it("OBS-02: emits target_gen_fallback event when LLM returns invalid targets", async () => {
    const logLines: string[] = [];
    const logStream = new Writable({
      write(chunk, _, cb) {
        chunk.toString().split("\n").filter(Boolean).forEach((line: string) => logLines.push(line));
        cb();
      },
    });

    const obs02LLM = new MockLLMProvider();
    // Queue 2 invalid responses — target-generation makes 2 attempts before fallback
    obs02LLM.queueChatResponse({ content: "not valid json at all" });
    obs02LLM.queueChatResponse({ content: "also not valid json" });

    const obs02App = await buildApp({
      dbPath: ":memory:",
      llmProvider: obs02LLM,
      logger: { level: "info", stream: logStream },
    });

    // POST /api/device with full intake fields to trigger generateTargets
    const res = await obs02App.inject({
      method: "POST",
      url: "/api/device",
      payload: {
        goal: "fat_loss",
        sex: "female",
        age: 30,
        heightCm: 165,
        weightKg: 60,
        activityLevel: "moderate",
        trainingFrequency: "3_4",
      },
    });

    await obs02App.close();

    // Response should still succeed (fallback targets used)
    assert.equal(res.statusCode, 200, `Expected 200 but got ${res.statusCode}: ${res.body}`);

    // Find target_gen_fallback event in captured log lines
    let fallbackEventFound = false;
    for (const line of logLines) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (parsed.event === "target_gen_fallback") {
        fallbackEventFound = true;
        assert.ok(
          typeof parsed.reason === "string" && parsed.reason.length > 0,
          `target_gen_fallback must have a non-empty reason field. Got: ${JSON.stringify(parsed)}`,
        );
        break;
      }
    }
    assert.ok(
      fallbackEventFound,
      `Expected a log line with event="target_gen_fallback" but none found. Lines captured: ${logLines.length}`,
    );
  });
});
