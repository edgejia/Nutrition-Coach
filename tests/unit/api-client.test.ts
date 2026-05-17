import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { IntakeData } from "../../client/src/types.js";

// Minimal localStorage shim
const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => { storage.set(key, value); },
  removeItem: (key: string) => { storage.delete(key); },
  clear: () => { storage.clear(); },
  get length() { return storage.size; },
  key: (index: number) => [...storage.keys()][index] ?? null,
} as Storage;

const originalFetch = globalThis.fetch;
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(globalThis, "location");
const originalCreateImageBitmap = globalThis.createImageBitmap;
const originalDocument = globalThis.document;
let fetchCalls: Array<{ url: string; init: RequestInit }> = [];

function mockFetch(status: number, body: unknown) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push({ url, init: init ?? {} });
    return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
  }) as typeof fetch;
}

function makeSSEStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

function mockStreamFetch(status: number, chunks: string[]) {
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push({ url, init: init ?? {} });
    return {
      ok: status >= 200 && status < 300,
      status,
      body: makeSSEStream(chunks),
      headers: new Headers({ "content-type": "text/event-stream" }),
    } as Response;
  }) as typeof fetch;
}

const api = await import("../../client/src/api.js");

describe("API Client", () => {
  beforeEach(() => {
    storage.clear();
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
    if (originalLocationDescriptor) {
      Object.defineProperty(globalThis, "location", originalLocationDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "location");
    }
  });

  it("registerDevice sends POST with goal", async () => {
    mockFetch(200, { deviceId: "d-1", dailyTargets: { calories: 1500, protein: 120, carbs: 150, fat: 50 } });
    const result = await api.registerDevice("fat_loss");
    assert.equal(result.deviceId, "d-1");
    assert.equal(fetchCalls[0].url, "/api/device");
    assert.equal(fetchCalls[0].init.method, "POST");
    assert.equal(fetchCalls[0].init.credentials, "same-origin");
  });

  it("submitIntake sends POST to /api/device with intake payload and preserves usedFallback false", async () => {
    const intake: IntakeData = {
      goal: "fat_loss",
      sex: "female",
      age: 31,
      heightCm: 165,
      weightKg: 58,
      activityLevel: "moderate",
      trainingFrequency: "3_4",
      allergies: "peanuts",
      goalClarification: "tone up",
      bodyFatPercent: 24,
      tdee: 1900,
      advancedNotes: "prefers simple meals",
    };
    mockFetch(200, {
      deviceId: "d-2",
      dailyTargets: { calories: 1600, protein: 110, carbs: 140, fat: 55 },
      coachExplanation: "Use a modest deficit.",
      usedFallback: false,
    });

    const result = await api.submitIntake(intake);
    const usedFallback: boolean = result.usedFallback;

    assert.equal(fetchCalls[0].url, "/api/device");
    assert.equal(fetchCalls[0].init.method, "POST");
    assert.equal(fetchCalls[0].init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(fetchCalls[0].init.body)), intake);
    assert.equal(result.coachExplanation, "Use a modest deficit.");
    assert.equal(usedFallback, false);
  });

  it("submitIntake preserves usedFallback true from the server response", async () => {
    const intake: IntakeData = {
      goal: "fat_loss",
      sex: "female",
      age: 31,
      heightCm: 165,
      weightKg: 58,
      activityLevel: "moderate",
      trainingFrequency: "3_4",
    };
    mockFetch(200, {
      deviceId: "d-2",
      dailyTargets: { calories: 1500, protein: 120, carbs: 150, fat: 50 },
      coachExplanation: "Using conservative targets.",
      usedFallback: true,
    });

    const result = await api.submitIntake(intake);
    const usedFallback: boolean = result.usedFallback;

    assert.equal(usedFallback, true);
  });

  it("submitIntake throws IntakeValidationError for VALIDATION_ERROR responses", async () => {
    const intake: IntakeData = {
      goal: "fat_loss",
      sex: "female",
      age: 31,
      heightCm: 165,
      weightKg: 58,
      activityLevel: "moderate",
      trainingFrequency: "3_4",
    };

    mockFetch(400, {
      error: "VALIDATION_ERROR",
      errors: [
        {
          field: "goalClarification",
          code: "GOAL_CLARIFICATION_TOO_LONG",
          step: 2,
          message: "目標補充最多 300 字",
        },
        {
          field: "age",
          code: "AGE_OUT_OF_RANGE",
          step: 3,
          message: "年齡需介於 10-120",
        },
      ],
    });

    await assert.rejects(
      () => api.submitIntake(intake),
      (error: unknown) => {
        assert.ok(error instanceof api.IntakeValidationError);
        assert.equal(error.kind, "validation");
        assert.equal(error.step, 2);
        assert.equal(error.errors[0]?.code, "GOAL_CLARIFICATION_TOO_LONG");
        assert.equal(error.errors[1]?.code, "AGE_OUT_OF_RANGE");
        return true;
      },
    );
  });

  it("submitIntake can mock one local-dev goal validation error for UAT", async () => {
    const intake: IntakeData = {
      goal: "fat_loss",
      sex: "female",
      age: 31,
      heightCm: 165,
      weightKg: 58,
      activityLevel: "moderate",
      trainingFrequency: "3_4",
    };
    Object.defineProperty(globalThis, "location", {
      value: { hostname: "localhost" },
      configurable: true,
    });
    localStorage.setItem("nutritionCoach:mockNextIntakeValidationError", "goal");
    mockFetch(200, {
      deviceId: "d-2",
      dailyTargets: { calories: 1600, protein: 110, carbs: 140, fat: 55 },
      coachExplanation: "Use a modest deficit.",
    });

    await assert.rejects(
      () => api.submitIntake(intake),
      (error: unknown) => {
        assert.ok(error instanceof api.IntakeValidationError);
        assert.equal(error.step, 1);
        assert.equal(error.errors[0]?.field, "goal");
        assert.equal(error.errors[0]?.code, "INVALID_GOAL");
        return true;
      },
    );
    assert.equal(fetchCalls.length, 0);
    assert.equal(localStorage.getItem("nutritionCoach:mockNextIntakeValidationError"), null);
  });

  it("establishGuestSession migrates a legacy device into cookie-backed mode", async () => {
    mockFetch(200, {
      deviceId: "d-legacy",
      goal: "maintain",
      dailyTargets: { calories: 1500, protein: 120, carbs: 150, fat: 50 },
      establishedBy: "legacy_migration",
    });

    const result = await api.establishGuestSession({ legacyDeviceId: "d-legacy" });

    assert.equal(fetchCalls[0].url, "/api/device/session");
    assert.equal(fetchCalls[0].init.method, "POST");
    assert.equal(fetchCalls[0].init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(fetchCalls[0].init.body)), { legacyDeviceId: "d-legacy" });
    assert.equal(result.goal, "maintain");
    assert.equal(result.establishedBy, "legacy_migration");
  });

  it("establishGuestSession throws UNAUTHORIZED on 401", async () => {
    mockFetch(401, { error: "Invalid device ID" });
    await assert.rejects(() => api.establishGuestSession({ legacyDeviceId: "missing-device" }), {
      message: "UNAUTHORIZED",
    });
  });

  it("sendMessage uses same-origin credentials without raw device headers", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, { reply: "OK" });
    await api.sendMessage("hello");
    assert.equal(fetchCalls[0].init.credentials, "same-origin");
    assert.equal(fetchCalls[0].init.headers, undefined);
  });

  it("sendMessage returns didLogMeal when the backend provides it", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, { reply: "已記錄", didLogMeal: true });

    const result = await api.sendMessage("我吃了雞胸肉");

    assert.deepEqual(result, { reply: "已記錄", didLogMeal: true });
  });

  it("formatTurnReference returns the short public reference code", () => {
    assert.equal(
      api.formatTurnReference("a1b2c3d4-1111-4222-8333-0123456789ab"),
      "t-a1b2c3d4",
    );
  });

  it("sendMessage preserves the top-level turnId returned by the backend", async () => {
    storage.set("deviceId", "d-1");
    const turnId = "a1b2c3d4-1111-4222-8333-0123456789ab";
    mockFetch(200, { turnId, reply: "已記錄", didLogMeal: true });

    const result = await api.sendMessage("我吃了雞胸肉");

    assert.equal(result.turnId, turnId);
    assert.deepEqual(result, { turnId, reply: "已記錄", didLogMeal: true });
  });

  it("sendMessage normalizes loggedMeal image urls through withAuthorizedAssetUrl", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      reply: "已記錄",
      didLogMeal: true,
      loggedMeal: {
        mealId: "meal-1",
        foodName: "照片便當",
        calories: 640,
        protein: 32,
        carbs: 78,
        fat: 21,
        imageAssetId: "asset-1",
        imageUrl: "/api/assets/asset-1?deviceId=legacy-device",
      },
    });

    const result = await api.sendMessage("我吃了便當");

    assert.equal(result.loggedMeal?.imageAssetId, "asset-1");
    assert.equal(result.loggedMeal?.imageUrl, "/api/assets/asset-1");
  });

  it("sendMessage throws UNAUTHORIZED on 401", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(401, { error: "Invalid" });
    await assert.rejects(() => api.sendMessage("hello"), { message: "UNAUTHORIZED" });
  });

  it("loadHistory leaves asset urls on the cookie-backed path", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "(圖片)",
          imageAssetId: "asset-1",
          imageUrl: "/api/assets/asset-1",
          createdAt: "2026-04-19T00:00:00.000Z",
        },
      ],
    });

    const result = await api.loadHistory();

    assert.equal(result.messages[0]?.imageUrl, "/api/assets/asset-1");
  });

  it("loadHistory normalizes loggedMeal image urls without changing null image receipts", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      messages: [
        {
          id: "msg-1",
          role: "assistant",
          content: "已記錄",
          createdAt: "2026-04-19T00:00:00.000Z",
          didLogMeal: true,
          loggedMeal: {
            mealId: "meal-1",
            foodName: "照片便當",
            calories: 640,
            protein: 32,
            carbs: 78,
            fat: 21,
            imageAssetId: "asset-1",
            imageUrl: "/api/assets/asset-1?deviceId=legacy-device",
          },
        },
        {
          id: "msg-2",
          role: "assistant",
          content: "已記錄文字",
          createdAt: "2026-04-19T01:00:00.000Z",
          didLogMeal: true,
          loggedMeal: {
            mealId: "meal-2",
            foodName: "文字點心",
            calories: 120,
            protein: 6,
            carbs: 14,
            fat: 4,
            imageAssetId: null,
            imageUrl: null,
          },
        },
      ],
    });

    const result = await api.loadHistory();

    assert.equal(result.messages[0]?.loggedMeal?.imageAssetId, "asset-1");
    assert.equal(result.messages[0]?.loggedMeal?.imageUrl, "/api/assets/asset-1");
    assert.equal(result.messages[1]?.loggedMeal?.imageAssetId, null);
    assert.equal(result.messages[1]?.loggedMeal?.imageUrl, null);
  });

  it("getMeals uses same-origin credentials without raw device headers", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      meals: [
        {
          id: "meal-1",
          foodName: "雞胸肉便當",
          calories: 520,
          protein: 42,
          carbs: 48,
          fat: 18,
          loggedAt: "2026-04-01T04:30:00.000Z",
        },
      ],
    });

    const result = await api.getMeals();

    assert.equal(fetchCalls[0].url, "/api/meals");
    assert.equal(fetchCalls[0].init.credentials, "same-origin");
    assert.deepEqual(fetchCalls[0].init.headers, {});
    assert.equal(result.meals.length, 1);
  });

  it("getMeals leaves meal image urls on the cookie-backed path", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      meals: [
        {
          id: "meal-1",
          foodName: "雞胸肉便當",
          calories: 520,
          protein: 42,
          carbs: 48,
          fat: 18,
          imageAssetId: "asset-1",
          imageUrl: "/api/assets/asset-1",
          loggedAt: "2026-04-01T04:30:00.000Z",
        },
      ],
    });

    const result = await api.getMeals();

    assert.equal(result.meals[0]?.imageUrl, "/api/assets/asset-1");
  });

  it("getMeals preserves explicit null meal image fields", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      meals: [
        {
          id: "meal-1",
          foodName: "文字點心",
          calories: 120,
          protein: 6,
          carbs: 14,
          fat: 4,
          imageAssetId: null,
          imageUrl: null,
          loggedAt: "2026-04-01T04:30:00.000Z",
        },
      ],
    });

    const result = await api.getMeals();

    assert.equal(result.meals[0]?.imageAssetId, null);
    assert.equal(result.meals[0]?.imageUrl, null);
  });

  it("getDaySnapshot requests the explicit day with same-origin credentials", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      date: "2026-03-25",
      summary: {
        date: "2026-03-25",
        totalCalories: 520,
        totalProtein: 42,
        totalCarbs: 48,
        totalFat: 18,
        mealCount: 1,
      },
      meals: [],
    });

    const result = await api.getDaySnapshot("2026-03-25");

    assert.equal(fetchCalls[0].url, "/api/day-snapshot?date=2026-03-25");
    assert.equal(fetchCalls[0].init.credentials, "same-origin");
    assert.equal(result.date, "2026-03-25");
  });

  it("getDaySnapshot leaves meal image urls on the cookie-backed path", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      date: "2026-03-25",
      summary: {
        date: "2026-03-25",
        totalCalories: 520,
        totalProtein: 42,
        totalCarbs: 48,
        totalFat: 18,
        mealCount: 1,
      },
      meals: [
        {
          id: "meal-1",
          foodName: "雞胸肉便當",
          calories: 520,
          protein: 42,
          carbs: 48,
          fat: 18,
          imageAssetId: "asset-1",
          imageUrl: "/api/assets/asset-1",
          loggedAt: "2026-03-25T04:30:00.000Z",
        },
      ],
    });

    const result = await api.getDaySnapshot("2026-03-25");

    assert.equal(result.meals[0]?.imageUrl, "/api/assets/asset-1");
  });

  it("getDaySnapshot preserves explicit null meal image fields", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      date: "2026-03-25",
      summary: {
        date: "2026-03-25",
        totalCalories: 120,
        totalProtein: 6,
        totalCarbs: 14,
        totalFat: 4,
        mealCount: 1,
      },
      meals: [
        {
          id: "meal-1",
          foodName: "文字點心",
          calories: 120,
          protein: 6,
          carbs: 14,
          fat: 4,
          imageAssetId: null,
          imageUrl: null,
          loggedAt: "2026-03-25T04:30:00.000Z",
        },
      ],
    });

    const result = await api.getDaySnapshot("2026-03-25");

    assert.equal(result.meals[0]?.imageAssetId, null);
    assert.equal(result.meals[0]?.imageUrl, null);
  });

  it("getDaySnapshot throws UNAUTHORIZED on 401", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(401, { error: "Invalid" });
    await assert.rejects(() => api.getDaySnapshot("2026-03-25"), { message: "UNAUTHORIZED" });
  });

  it("getHistoryTrends requests the inclusive range with same-origin credentials", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      from: "2026-04-27",
      to: "2026-05-03",
      completeness: "sparse",
      daily: [],
      totals: { calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 },
      averages: { calories: 0, protein: 0, carbs: 0, fat: 0, mealsPerDay: 0 },
    });

    const result = await api.getHistoryTrends("2026-04-27", "2026-05-03");

    assert.equal(fetchCalls[0].url, "/api/history/trends?from=2026-04-27&to=2026-05-03");
    assert.equal(fetchCalls[0].init.credentials, "same-origin");
    assert.equal(result.from, "2026-04-27");
  });

  it("getHistoryDaySnapshot maps history day meals and strips legacy asset deviceId", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      date: "2026-04-29",
      summary: {
        date: "2026-04-29",
        totalCalories: 320,
        totalProtein: 30,
        totalCarbs: 40,
        totalFat: 10,
        mealCount: 1,
      },
      meals: [
        {
          id: "meal-1",
          loggedAt: "2026-04-29T07:30:00.000Z",
          display: { title: "燕麥 + 香蕉 + 杏仁" },
          nutrition: { calories: 320, protein: 18, carbs: 45, fat: 9 },
          asset: { imageAssetId: "asset-1", imageUrl: "/api/assets/asset-1?deviceId=legacy" },
        },
      ],
    });

    const result = await api.getHistoryDaySnapshot("2026-04-29");

    assert.equal(fetchCalls[0].url, "/api/history/days/2026-04-29");
    assert.equal(fetchCalls[0].init.credentials, "same-origin");
    assert.equal(result.meals[0]?.foodName, "燕麥 + 香蕉 + 杏仁");
    assert.equal(result.meals[0]?.imageUrl, "/api/assets/asset-1");
  });

  it("getHistoryDaySnapshot normalizes flat image fields and nested null asset fields", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      date: "2026-04-29",
      summary: {
        date: "2026-04-29",
        totalCalories: 440,
        totalProtein: 36,
        totalCarbs: 54,
        totalFat: 13,
        mealCount: 2,
      },
      meals: [
        {
          id: "meal-1",
          loggedAt: "2026-04-29T07:30:00.000Z",
          display: { title: "照片便當" },
          nutrition: { calories: 320, protein: 30, carbs: 40, fat: 9 },
          imageAssetId: "asset-flat",
          imageUrl: "/api/assets/asset-flat?deviceId=legacy",
        },
        {
          id: "meal-2",
          loggedAt: "2026-04-29T08:30:00.000Z",
          display: { title: "文字點心" },
          nutrition: { calories: 120, protein: 6, carbs: 14, fat: 4 },
          asset: { imageAssetId: null, imageUrl: null },
        },
      ],
    });

    const result = await api.getHistoryDaySnapshot("2026-04-29");

    assert.equal(result.meals[0]?.imageAssetId, "asset-flat");
    assert.equal(result.meals[0]?.imageUrl, "/api/assets/asset-flat");
    assert.equal(result.meals[1]?.imageAssetId, null);
    assert.equal(result.meals[1]?.imageUrl, null);
  });

  it("getHistoryDaySnapshot throws UNAUTHORIZED on 401", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(401, { error: "Invalid" });
    await assert.rejects(() => api.getHistoryDaySnapshot("2026-04-29"), { message: "UNAUTHORIZED" });
  });

  it("deleteMeal sends DELETE and returns affectedDate metadata", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      affectedDate: "2026-03-25",
      dailySummary: {
        date: "2026-03-25",
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        mealCount: 0,
      },
    });

    const result = await api.deleteMeal("meal-1");

    assert.deepEqual(result, {
      affectedDate: "2026-03-25",
      dailySummary: {
        date: "2026-03-25",
        totalCalories: 0,
        totalProtein: 0,
        totalCarbs: 0,
        totalFat: 0,
        mealCount: 0,
      },
    });
    assert.equal(fetchCalls[0].url, "/api/meals/meal-1");
    assert.equal(fetchCalls[0].init.method, "DELETE");
    assert.equal(fetchCalls[0].init.credentials, "same-origin");
  });

  it("deleteMeal resolves committed unavailable summary outcomes without dailySummary", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      affectedDate: "2026-03-25",
      deletedMealId: "meal-1",
      summaryOutcome: {
        status: "unavailable",
        reason: "recompute_failed",
      },
    });

    const result = await api.deleteMeal("meal-1");

    assert.deepEqual(result, {
      affectedDate: "2026-03-25",
      deletedMealId: "meal-1",
      summaryOutcome: {
        status: "unavailable",
        reason: "recompute_failed",
      },
    });
    assert.equal(result.dailySummary, undefined);
  });

  it("updateMeal sends PATCH with same-origin JSON body and returns refreshed daily summary", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      affectedDate: "2026-04-30",
      dailySummary: {
        date: "2026-04-30",
        totalCalories: 260,
        totalProtein: 20,
        totalCarbs: 8,
        totalFat: 12,
        mealCount: 1,
      },
      meal: {
        id: "meal-1",
        foodName: "雞胸肉沙拉半份",
        calories: 260,
        protein: 20,
        carbs: 8,
        fat: 12,
        imageAssetId: null,
        imageUrl: null,
        loggedAt: "2026-04-30T04:00:00.000Z",
      },
    });

    const input = {
      foodName: "雞胸肉沙拉半份",
      calories: 260,
      protein: 20,
      carbs: 8,
      fat: 12,
      imageAssetId: null,
    };
    const result = await api.updateMeal("meal-1", input);

    assert.equal(fetchCalls[0].url, "/api/meals/meal-1");
    assert.equal(fetchCalls[0].init.method, "PATCH");
    assert.equal(fetchCalls[0].init.credentials, "same-origin");
    assert.deepEqual(fetchCalls[0].init.headers, { "content-type": "application/json" });
    assert.deepEqual(JSON.parse(String(fetchCalls[0].init.body)), input);
    assert.equal(result.dailySummary?.totalCalories, 260);
    assert.equal(result.meal.foodName, "雞胸肉沙拉半份");
  });

  it("updateMeal resolves committed unavailable summary outcomes without dailySummary", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      affectedDate: "2026-04-30",
      summaryOutcome: {
        status: "unavailable",
        reason: "recompute_failed",
      },
      meal: {
        id: "meal-1",
        foodName: "雞胸肉沙拉半份",
        calories: 260,
        protein: 20,
        carbs: 8,
        fat: 12,
        imageAssetId: null,
        imageUrl: null,
        loggedAt: "2026-04-30T04:00:00.000Z",
      },
    });

    const result = await api.updateMeal("meal-1", {
      foodName: "雞胸肉沙拉半份",
      calories: 260,
      protein: 20,
      carbs: 8,
      fat: 12,
      imageAssetId: null,
    });

    assert.equal(result.affectedDate, "2026-04-30");
    assert.equal(result.dailySummary, undefined);
    assert.deepEqual(result.summaryOutcome, {
      status: "unavailable",
      reason: "recompute_failed",
    });
    assert.equal(result.meal.foodName, "雞胸肉沙拉半份");
  });

  it("updateMeal normalizes returned image urls through withAuthorizedAssetUrl", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, {
      affectedDate: "2026-04-30",
      dailySummary: {
        date: "2026-04-30",
        totalCalories: 660,
        totalProtein: 34,
        totalCarbs: 80,
        totalFat: 22,
        mealCount: 1,
      },
      meal: {
        id: "meal-1",
        foodName: "照片便當更新",
        calories: 660,
        protein: 34,
        carbs: 80,
        fat: 22,
        imageAssetId: "asset-1",
        imageUrl: "/api/assets/asset-1?deviceId=legacy-device",
        loggedAt: "2026-04-30T04:00:00.000Z",
      },
    });

    const result = await api.updateMeal("meal-1", {
      foodName: "照片便當更新",
      calories: 660,
      protein: 34,
      carbs: 80,
      fat: 22,
      imageAssetId: "asset-1",
    });

    assert.equal(result.meal.imageAssetId, "asset-1");
    assert.equal(result.meal.imageUrl, "/api/assets/asset-1");
  });

  it("updateMeal URL-encodes meal id and throws UNAUTHORIZED on 401", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(401, { error: "Invalid" });

    await assert.rejects(
      () =>
        api.updateMeal("meal 1/with slash", {
          foodName: "雞胸肉沙拉半份",
          calories: 260,
          protein: 20,
          carbs: 8,
          fat: 12,
          imageAssetId: null,
        }),
      { message: "UNAUTHORIZED" },
    );
    assert.equal(fetchCalls[0].url, "/api/meals/meal%201%2Fwith%20slash");
    assert.equal(fetchCalls[0].init.method, "PATCH");
  });

  it("loadHistory throws UNAUTHORIZED on 401", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(401, { error: "Invalid" });
    await assert.rejects(() => api.loadHistory(), { message: "UNAUTHORIZED" });
  });

  it("updateGoals throws UNAUTHORIZED on 401", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(401, { error: "Invalid" });
    await assert.rejects(() => api.updateGoals({ calories: 2000 }), { message: "UNAUTHORIZED" });
  });

  it("updateGoals keeps PUT compatibility contract", async () => {
    mockFetch(200, {
      dailyTargets: {
        calories: 2000,
        protein: 120,
        carbs: 220,
        fat: 60,
      },
    });

    await api.updateGoals({ calories: 2000, protein: 120 });

    assert.equal(fetchCalls[0].url, "/api/device/goals");
    assert.equal(fetchCalls[0].init.method, "PUT");
    assert.equal(fetchCalls[0].init.credentials, "same-origin");
    assert.deepEqual(fetchCalls[0].init.headers, { "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(fetchCalls[0].init.body as string), { calories: 2000, protein: 120 });
  });

  it("withAuthorizedAssetUrl removes legacy deviceId query params", () => {
    storage.set("deviceId", "device-123");

    assert.equal(
      api.withAuthorizedAssetUrl("/api/assets/asset-1?deviceId=existing-device"),
      "/api/assets/asset-1",
    );
  });

  it("withAuthorizedAssetUrl leaves non-asset urls unchanged", () => {
    storage.set("deviceId", "device-123");

    assert.equal(
      api.withAuthorizedAssetUrl("blob:http://localhost/preview-id"),
      "blob:http://localhost/preview-id",
    );
  });
});

describe("sendMessageStream", () => {
  beforeEach(() => {
    storage.clear();
    fetchCalls = [];
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("dispatches onStatus for event: status", async () => {
    storage.set("deviceId", "d-1");
    mockStreamFetch(200, ['event: status\ndata: {"label":"分析圖片中..."}\n\n']);
    const labels: string[] = [];

    await api.sendMessageStream("hello", {
      onStatus: (label) => labels.push(label),
      onToken: () => {},
      onDone: () => {},
      onError: () => {},
    });

    assert.deepEqual(labels, ["分析圖片中..."]);
  });

  it("sendMessageStream passes AbortSignal and optional turnId metadata without aborting itself", async () => {
    storage.set("deviceId", "d-1");
    mockStreamFetch(200, ['event: done\ndata: {"didLogMeal":false}\n\n']);
    const controller = new AbortController();

    await api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: () => {},
      onDone: () => {},
      onError: () => {},
    }, undefined, { signal: controller.signal, turnId: "turn-client-1" });

    const call = fetchCalls[0];
    assert.equal(call?.url, "/api/chat");
    assert.equal(call?.init.signal, controller.signal);
    assert.equal(controller.signal.aborted, false);
    assert.ok(call?.init.body instanceof FormData);
    assert.equal(call.init.body.get("turnId"), "turn-client-1");
  });

  it("stopChatTurn posts the turnId to the graceful stop endpoint", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, { stopped: true, turnId: "turn-1" });

    const result = await api.stopChatTurn({ turnId: "turn-1" });

    assert.deepEqual(result, { stopped: true, turnId: "turn-1" });
    assert.equal(fetchCalls[0].url, "/api/chat/stop");
    assert.equal(fetchCalls[0].init.method, "POST");
    assert.equal(fetchCalls[0].init.credentials, "same-origin");
    assert.deepEqual(fetchCalls[0].init.headers, { "Content-Type": "application/json" });
    assert.deepEqual(JSON.parse(String(fetchCalls[0].init.body)), { turnId: "turn-1" });
  });

  it("stopChatTurn throws UNAUTHORIZED on 401", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(401, { error: "Invalid" });

    await assert.rejects(() => api.stopChatTurn({ turnId: "turn-1" }), { message: "UNAUTHORIZED" });
  });

  it("dispatches onToken for each event: chunk", async () => {
    storage.set("deviceId", "d-1");
    mockStreamFetch(200, [
      'event: chunk\ndata: {"token":"你好"}\n\n',
      'event: chunk\ndata: {"token":"！"}\n\n',
      'event: done\ndata: {"didLogMeal":false}\n\n',
    ]);
    const tokens: string[] = [];

    await api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: (token) => tokens.push(token),
      onDone: () => {},
      onError: () => {},
    });

    assert.deepEqual(tokens, ["你好", "！"]);
  });

  it("handles two SSE events in a single chunk (TCP buffering)", async () => {
    storage.set("deviceId", "d-1");
    const combined = 'event: chunk\ndata: {"token":"A"}\n\nevent: done\ndata: {"didLogMeal":false}\n\n';
    mockStreamFetch(200, [combined]);
    const tokens: string[] = [];
    let done = false;

    await api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: (token) => tokens.push(token),
      onDone: () => {
        done = true;
      },
      onError: () => {},
    });

    assert.deepEqual(tokens, ["A"]);
    assert.equal(done, true);
  });

  it("dispatches dailyTargets from done events", async () => {
    storage.set("deviceId", "d-1");
    const targets = { calories: 1800, protein: 130, carbs: 150, fat: 50 };
    mockStreamFetch(200, [
      `event: done\ndata: ${JSON.stringify({ didLogMeal: false, dailyTargets: targets })}\n\n`,
    ]);
    let receivedTargets: typeof targets | undefined;

    await api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: () => {},
      onDone: (payload) => {
        receivedTargets = payload.dailyTargets;
      },
      onError: () => {},
    });

    assert.deepEqual(receivedTargets, targets);
  });

  it("dispatches affectedDate from done events", async () => {
    storage.set("deviceId", "d-1");
    mockStreamFetch(200, [
      'event: done\ndata: {"didLogMeal":true,"affectedDate":"2026-03-25"}\n\n',
    ]);
    let affectedDate: string | undefined;

    await api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: () => {},
      onDone: (payload) => {
        affectedDate = payload.affectedDate;
      },
      onError: () => {},
    });

    assert.equal(affectedDate, "2026-03-25");
  });

  it("dispatches done loggedMeal image urls through withAuthorizedAssetUrl", async () => {
    storage.set("deviceId", "d-1");
    mockStreamFetch(200, [
      `event: done\ndata: ${JSON.stringify({
        didLogMeal: true,
        loggedMeal: {
          mealId: "meal-1",
          foodName: "照片便當",
          calories: 640,
          protein: 32,
          carbs: 78,
          fat: 21,
          imageAssetId: "asset-1",
          imageUrl: "/api/assets/asset-1?deviceId=legacy-device",
        },
      })}\n\n`,
    ]);
    let imageUrl: string | null | undefined;

    await api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: () => {},
      onDone: (payload) => {
        imageUrl = payload.loggedMeal?.imageUrl;
      },
      onError: () => {},
    });

    assert.equal(imageUrl, "/api/assets/asset-1");
  });

  it("dispatches valid done summaryOutcome and omits malformed values", async () => {
    storage.set("deviceId", "d-1");
    mockStreamFetch(200, [
      'event: done\ndata: {"didLogMeal":true,"didMutateMeal":true,"summaryOutcome":{"status":"unavailable","reason":"recompute_failed"},"dailySummary":{"date":"bad","totalCalories":"bad"},"turnId":"turn-1"}\n\n',
    ]);
    let donePayload: { summaryOutcome?: unknown; didMutateMeal?: boolean; dailySummary?: unknown } | undefined;

    await api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: () => {},
      onDone: (payload) => {
        donePayload = payload;
      },
      onError: () => {},
    });

    assert.equal(donePayload?.didMutateMeal, true);
    assert.equal(donePayload?.dailySummary, undefined);
    assert.deepEqual(donePayload?.summaryOutcome, {
      status: "unavailable",
      reason: "recompute_failed",
    });

    mockStreamFetch(200, [
      'event: done\ndata: {"didMutateMeal":true,"summaryOutcome":{"status":"unavailable","reason":"publish_failed"}}\n\n',
    ]);
    donePayload = undefined;

    await api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: () => {},
      onDone: (payload) => {
        donePayload = payload;
      },
      onError: () => {},
    });

    assert.equal((donePayload as { summaryOutcome?: unknown } | undefined)?.summaryOutcome, undefined);
  });

  it("dispatches stopped loggedMeal image urls through withAuthorizedAssetUrl", async () => {
    storage.set("deviceId", "d-1");
    mockStreamFetch(200, [
      `event: stopped\ndata: ${JSON.stringify({
        stopped: true,
        tokensStreamed: 3,
        didLogMeal: true,
        loggedMeal: {
          mealId: "meal-1",
          foodName: "照片便當",
          calories: 640,
          protein: 32,
          carbs: 78,
          fat: 21,
          imageAssetId: "asset-1",
          imageUrl: "/api/assets/asset-1?deviceId=legacy-device",
        },
      })}\n\n`,
    ]);
    let imageUrl: string | null | undefined;

    await api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: () => {},
      onDone: () => {},
      onStopped: (payload) => {
        imageUrl = payload.loggedMeal?.imageUrl;
      },
      onError: () => {},
    });

    assert.equal(imageUrl, "/api/assets/asset-1");
  });

  it("dispatches valid stopped summaryOutcome and omits malformed values", async () => {
    storage.set("deviceId", "d-1");
    mockStreamFetch(200, [
      'event: stopped\ndata: {"stopped":true,"tokensStreamed":2,"didMutateMeal":true,"summaryOutcome":{"status":"recovered","reason":"recompute_failed","dailySummary":{"date":"2026-04-30","totalCalories":260,"totalProtein":20,"totalCarbs":8,"totalFat":12,"mealCount":1}}}\n\n',
    ]);
    let stoppedPayload: { summaryOutcome?: unknown; didMutateMeal?: boolean } | undefined;

    await api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: () => {},
      onDone: () => {},
      onStopped: (payload) => {
        stoppedPayload = payload;
      },
      onError: () => {},
    });

    assert.equal(stoppedPayload?.didMutateMeal, true);
    assert.deepEqual(stoppedPayload?.summaryOutcome, {
      status: "recovered",
      reason: "recompute_failed",
      dailySummary: {
        date: "2026-04-30",
        totalCalories: 260,
        totalProtein: 20,
        totalCarbs: 8,
        totalFat: 12,
        mealCount: 1,
      },
    });

    mockStreamFetch(200, [
      'event: stopped\ndata: {"stopped":true,"tokensStreamed":2,"summaryOutcome":{"status":"fresh"}}\n\n',
    ]);
    stoppedPayload = undefined;

    await api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: () => {},
      onDone: () => {},
      onStopped: (payload) => {
        stoppedPayload = payload;
      },
      onError: () => {},
    });

    assert.equal((stoppedPayload as { summaryOutcome?: unknown } | undefined)?.summaryOutcome, undefined);
  });

  it("handles SSE event split across two chunks", async () => {
    storage.set("deviceId", "d-1");
    const part1 = 'event: chunk\ndata: {"to';
    const part2 = 'ken":"B"}\n\nevent: done\ndata: {"didLogMeal":false}\n\n';
    mockStreamFetch(200, [part1, part2]);
    const tokens: string[] = [];

    await api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: (token) => tokens.push(token),
      onDone: () => {},
      onError: () => {},
    });

    assert.deepEqual(tokens, ["B"]);
  });

  it("silently skips malformed JSON and continues processing", async () => {
    storage.set("deviceId", "d-1");
    const bad = 'event: chunk\ndata: NOT_JSON\n\nevent: done\ndata: {"didLogMeal":false}\n\n';
    mockStreamFetch(200, [bad]);
    let done = false;

    await assert.doesNotReject(() =>
      api.sendMessageStream("hello", {
        onStatus: () => {},
        onToken: () => {},
        onDone: () => {
          done = true;
        },
        onError: () => {},
      }),
    );

    assert.equal(done, true);
  });

  it("reports an interrupted stream when EOF arrives before done or error", async () => {
    storage.set("deviceId", "d-1");
    mockStreamFetch(200, ['event: chunk\ndata: {"token":"半途"}\n\n']);
    const errors: string[] = [];
    const tokens: string[] = [];
    let done = false;

    await api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: (token) => tokens.push(token),
      onDone: () => {
        done = true;
      },
      onError: (message) => errors.push(message),
    });

    assert.deepEqual(tokens, ["半途"]);
    assert.equal(done, false);
    assert.deepEqual(errors, ["Stream interrupted"]);
  });

  it("throws UNAUTHORIZED on 401 response", async () => {
    storage.set("deviceId", "d-1");
    mockStreamFetch(401, []);

    await assert.rejects(
      () =>
        api.sendMessageStream("hello", {
          onStatus: () => {},
          onToken: () => {},
          onDone: () => {},
          onError: () => {},
        }),
      { message: "UNAUTHORIZED" },
    );
  });

  it("surfaces server validation messages for rejected chat uploads", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(400, { error: "Invalid image type. Allowed: jpeg, png, webp" });

    await assert.rejects(() => api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: () => {},
      onDone: () => {},
      onError: () => {},
    }), { message: "Invalid image type. Allowed: jpeg, png, webp" });
  });

  it("rejects unsupported image types before sending chat uploads", async () => {
    storage.set("deviceId", "d-1");
    mockStreamFetch(200, ['event: done\ndata: {"didLogMeal":false}\n\n']);
    const heic = new File(["not-real-heic"], "meal.heic", { type: "image/heic" });

    await assert.rejects(() => api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: () => {},
      onDone: () => {},
      onError: () => {},
    }, heic), { message: "目前只支援 JPG、PNG、WebP 照片。若是 iPhone HEIC，請先轉成 JPG 後再上傳。" });

    assert.equal(fetchCalls.length, 0);
  });

  it("normalizes extension-only supported image files before chat upload", async () => {
    storage.set("deviceId", "d-1");
    mockStreamFetch(200, ['event: done\ndata: {"didLogMeal":false}\n\n']);
    const jpeg = new File(["jpeg-bytes"], "meal.JPG", { type: "" });

    await api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: () => {},
      onDone: () => {},
      onError: () => {},
    }, jpeg);

    const form = fetchCalls[0]?.init.body;
    assert.ok(form instanceof FormData);
    const uploaded = form.get("image");
    assert.ok(uploaded instanceof File);
    assert.equal(uploaded.type, "image/jpeg");
    assert.equal(uploaded.name, "meal.JPG");
  });

  it("compresses oversized supported images before chat upload", async () => {
    storage.set("deviceId", "d-1");
    mockStreamFetch(200, ['event: done\ndata: {"didLogMeal":false}\n\n']);

    globalThis.createImageBitmap = (async () => ({
      width: 4032,
      height: 3024,
      close: () => {},
    })) as typeof createImageBitmap;
    globalThis.document = {
      createElement: (tagName: string) => {
        assert.equal(tagName, "canvas");
        return {
          width: 0,
          height: 0,
          getContext: (contextType: string) => {
            assert.equal(contextType, "2d");
            return {
              fillStyle: "",
              fillRect: () => {},
              drawImage: () => {},
            };
          },
          toBlob: (callback: BlobCallback, mimeType?: string) => {
            assert.equal(mimeType, "image/jpeg");
            callback(new Blob(["compressed-jpeg"], { type: "image/jpeg" }));
          },
        };
      },
    } as unknown as Document;
    const largeJpeg = new File([new Uint8Array(6 * 1024 * 1024)], "meal.jpg", { type: "image/jpeg" });

    await api.sendMessageStream("hello", {
      onStatus: () => {},
      onToken: () => {},
      onDone: () => {},
      onError: () => {},
    }, largeJpeg);

    const form = fetchCalls[0]?.init.body;
    assert.ok(form instanceof FormData);
    const uploaded = form.get("image");
    assert.ok(uploaded instanceof File);
    assert.equal(uploaded.type, "image/jpeg");
    assert.equal(uploaded.name, "meal.jpg");
    assert.ok(uploaded.size < 5 * 1024 * 1024);
  });
});
