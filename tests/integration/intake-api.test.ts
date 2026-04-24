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

  function assertValidationErrorBody(value: unknown): asserts value is {
    error: "VALIDATION_ERROR";
    errors: Array<{ field: string; code: string; step: number; message: string }>;
  } {
    assert.equal(typeof value, "object");
    assert.ok(value);
    const body = value as { error?: unknown; errors?: unknown };
    assert.equal(body.error, "VALIDATION_ERROR");
    assert.ok(Array.isArray(body.errors));
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
    assert.equal(mockLLM.chatCalls.length, 0);

    const body = res.json();
    assertValidationErrorBody(body);
    assert.deepEqual(body.errors, [
      {
        field: "goal",
        code: "INVALID_GOAL",
        step: 1,
        message: "請選擇減脂或增肌目標",
      },
    ]);
  });

  it("POST /api/device rejects out-of-range body data", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: createIntakePayload({ age: 9 }),
    });

    assert.equal(res.statusCode, 400);
    assert.equal(mockLLM.chatCalls.length, 0);

    const body = res.json();
    assertValidationErrorBody(body);
    assert.ok(
      body.errors.some((issue) => issue.field === "age" && issue.code === "AGE_OUT_OF_RANGE" && issue.step === 3),
    );
  });

  it("POST /api/device rejects malformed numeric intake values", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: createIntakePayload({
        age: "30",
        heightCm: "175",
        bodyFatPercent: "18",
        tdee: "2400",
      }),
    });

    assert.equal(res.statusCode, 400);
    assert.equal(mockLLM.chatCalls.length, 0);

    const body = res.json();
    assertValidationErrorBody(body);
    assert.ok(body.errors.some((issue) => issue.field === "age" && issue.code === "INVALID_AGE" && issue.step === 3));
    assert.ok(
      body.errors.some((issue) => issue.field === "heightCm" && issue.code === "INVALID_HEIGHT_CM" && issue.step === 3),
    );
    assert.ok(
      body.errors.some(
        (issue) => issue.field === "bodyFatPercent" && issue.code === "INVALID_BODY_FAT_PERCENT" && issue.step === 5,
      ),
    );
    assert.ok(body.errors.some((issue) => issue.field === "tdee" && issue.code === "INVALID_TDEE" && issue.step === 5));
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

    const body = res.json();
    assertValidationErrorBody(body);
    assert.deepEqual(
      body.errors.map((issue) => issue.field),
      ["heightCm", "weightKg", "activityLevel", "trainingFrequency"],
    );
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

    const body = res.json();
    assertValidationErrorBody(body);
    assert.ok(
      body.errors.some(
        (issue) => issue.field === "activityLevel" && issue.code === "INVALID_ACTIVITY_LEVEL" && issue.step === 4,
      ),
    );
    assert.ok(
      body.errors.some(
        (issue) =>
          issue.field === "trainingFrequency" &&
          issue.code === "INVALID_TRAINING_FREQUENCY" &&
          issue.step === 4,
      ),
    );
  });

  it("POST /api/device preserves multi-step validation issues in one response", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/device",
      payload: createIntakePayload({
        goalClarification: "a".repeat(301),
        age: 9,
      }),
    });

    assert.equal(res.statusCode, 400);
    assert.equal(mockLLM.chatCalls.length, 0);

    const body = res.json();
    assertValidationErrorBody(body);
    assert.ok(
      body.errors.some(
        (issue) =>
          issue.field === "goalClarification" &&
          issue.code === "GOAL_CLARIFICATION_TOO_LONG" &&
          issue.step === 2,
      ),
    );
    assert.ok(body.errors.some((issue) => issue.field === "age" && issue.code === "AGE_OUT_OF_RANGE" && issue.step === 3));
    assert.deepEqual(
      [...new Set(body.errors.map((issue) => issue.step))].sort((a, b) => a - b),
      [2, 3],
    );
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
