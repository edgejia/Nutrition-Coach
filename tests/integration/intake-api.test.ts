process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

describe("Intake API", () => {
  let app: FastifyInstance;
  let mockLLM: MockLLMProvider;

  beforeEach(async () => {
    mockLLM = new MockLLMProvider();
    app = await buildApp({ dbPath: ":memory:", llmProvider: mockLLM });
  });

  afterEach(async () => {
    await app.close();
  });

  function createIntakePayload(overrides: Record<string, unknown> = {}) {
    return {
      goal: "fat_loss",
      sex: "male",
      age: 30,
      heightCm: 175,
      weightKg: 80,
      activityLevel: "moderate",
      trainingFrequency: "3_4",
      allergies: "花生",
      goalClarification: "不想影響重訓表現",
      ...overrides,
    };
  }

  function assertString(value: unknown): asserts value is string {
    assert.equal(typeof value, "string");
  }

  it("POST /api/device with intake returns AI-generated targets", async () => {
    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1750, protein: 145, carbs: 175, fat: 49 },
        explanation: "先維持訓練表現，再慢慢調整熱量。",
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: createIntakePayload(),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(mockLLM.chatCalls.length, 1);
    assert.equal(mockLLM.chatCalls[0].tools.length, 0);
    const prompt = mockLLM.chatCalls[0].messages[1].content;
    assertString(prompt);
    assert.match(prompt, /goalClarification/);
    assert.match(prompt, /不想影響重訓表現/);

    const body = res.json();
    assert.ok(body.deviceId);
    assert.deepEqual(body.dailyTargets, {
      calories: 1750,
      protein: 145,
      carbs: 175,
      fat: 49,
    });
    assert.equal(body.coachExplanation, "先維持訓練表現，再慢慢調整熱量。");
  });

  it("POST /api/device with intake falls back on LLM failure", async () => {
    mockLLM.queueChatError(new Error("API timeout"));
    mockLLM.queueChatError(new Error("API timeout"));

    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: createIntakePayload(),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(mockLLM.chatCalls.length, 2);

    const body = res.json();
    assert.ok(body.deviceId);
    assert.deepEqual(body.dailyTargets, {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
    assert.equal(body.coachExplanation, "先用預設目標，之後可再微調。");
  });

  it("POST /api/device still works with only goal", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fat_loss" },
    });

    assert.equal(res.statusCode, 200);
    assert.equal(mockLLM.chatCalls.length, 0);

    const body = res.json();
    assert.ok(body.deviceId);
    assert.deepEqual(body.dailyTargets, {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
    assert.equal(body.coachExplanation, null);
  });

  it("POST /api/device rejects invalid goal", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: { goal: "fly_to_moon" },
    });

    assert.equal(res.statusCode, 400);
    assert.deepEqual(res.json(), { error: "Invalid goal. Must be fat_loss or muscle_gain." });
  });

  it("POST /api/device rejects out-of-range body data", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: createIntakePayload({ age: 9 }),
    });

    assert.equal(res.statusCode, 400);
    assert.equal(mockLLM.chatCalls.length, 0);
  });

  it("POST /api/device rejects partial intake payloads", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: {
        goal: "fat_loss",
        sex: "male",
        age: 30,
      },
    });

    assert.equal(res.statusCode, 400);
    assert.equal(mockLLM.chatCalls.length, 0);
    assert.deepEqual(res.json(), { error: "Incomplete intake data" });
  });

  it("POST /api/device rejects invalid enum-like intake values", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: createIntakePayload({
        activityLevel: "extreme",
        trainingFrequency: "daily",
      }),
    });

    assert.equal(res.statusCode, 400);
    assert.equal(mockLLM.chatCalls.length, 0);
    assert.deepEqual(res.json(), { error: "Invalid intake data" });
  });

  it("POST /api/device rejects malformed non-object bodies with a clear error", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify("not-json-object"),
    });

    assert.equal(res.statusCode, 400);
    assert.equal(mockLLM.chatCalls.length, 0);
    assert.deepEqual(res.json(), { error: "Request body must be a JSON object." });
  });

  it("POST /api/device accepts optional advanced fields", async () => {
    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1850, protein: 155, carbs: 180, fat: 52 },
        explanation: "進一步考慮體脂與 TDEE 後，先用這組目標。",
      }),
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: createIntakePayload({
        bodyFatPercent: 18,
        tdee: 2400,
        advancedNotes: "晚餐常外食",
      }),
    });

    assert.equal(res.statusCode, 200);
    assert.equal(mockLLM.chatCalls.length, 1);
    const prompt = mockLLM.chatCalls[0].messages[1].content;
    assertString(prompt);
    assert.match(prompt, /bodyFatPercent/);
    assert.match(prompt, /18/);
    assert.match(prompt, /tdee/);
    assert.match(prompt, /2400/);
    assert.match(prompt, /advancedNotes/);
    assert.match(prompt, /晚餐常外食/);

    const body = res.json();
    assert.ok(body.deviceId);
    assert.deepEqual(body.dailyTargets, {
      calories: 1850,
      protein: 155,
      carbs: 180,
      fat: 52,
    });
    assert.equal(body.coachExplanation, "進一步考慮體脂與 TDEE 後，先用這組目標。");
  });
});
