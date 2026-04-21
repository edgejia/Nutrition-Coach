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
  });

  it("registerDevice sends POST with goal", async () => {
    mockFetch(200, { deviceId: "d-1", dailyTargets: { calories: 1500, protein: 120, carbs: 150, fat: 50 } });
    const result = await api.registerDevice("fat_loss");
    assert.equal(result.deviceId, "d-1");
    assert.equal(fetchCalls[0].url, "/api/device");
    assert.equal(fetchCalls[0].init.method, "POST");
    assert.equal(fetchCalls[0].init.credentials, "same-origin");
  });

  it("submitIntake sends POST to /api/device with intake payload and returns coachExplanation", async () => {
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
    });

    const result = await api.submitIntake(intake);

    assert.equal(fetchCalls[0].url, "/api/device");
    assert.equal(fetchCalls[0].init.method, "POST");
    assert.equal(fetchCalls[0].init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(fetchCalls[0].init.body)), intake);
    assert.equal(result.coachExplanation, "Use a modest deficit.");
  });

  it("establishGuestSession migrates a legacy device into cookie-backed mode", async () => {
    mockFetch(200, {
      deviceId: "d-legacy",
      goal: "fat_loss",
      dailyTargets: { calories: 1500, protein: 120, carbs: 150, fat: 50 },
      establishedBy: "legacy_migration",
    });

    const result = await api.establishGuestSession({ legacyDeviceId: "d-legacy" });

    assert.equal(fetchCalls[0].url, "/api/device/session");
    assert.equal(fetchCalls[0].init.method, "POST");
    assert.equal(fetchCalls[0].init.credentials, "same-origin");
    assert.deepEqual(JSON.parse(String(fetchCalls[0].init.body)), { legacyDeviceId: "d-legacy" });
    assert.equal(result.establishedBy, "legacy_migration");
  });

  it("establishGuestSession throws UNAUTHORIZED on 401", async () => {
    mockFetch(401, { error: "Invalid device ID" });
    await assert.rejects(() => api.establishGuestSession({ legacyDeviceId: "missing-device" }), {
      message: "UNAUTHORIZED",
    });
  });

  it("sendMessage includes X-Device-Id header from localStorage", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, { reply: "OK" });
    await api.sendMessage("hello");
    const headers = fetchCalls[0].init.headers as Record<string, string>;
    assert.equal(headers["X-Device-Id"], "d-1");
  });

  it("sendMessage returns didLogMeal when the backend provides it", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, { reply: "已記錄", didLogMeal: true });

    const result = await api.sendMessage("我吃了雞胸肉");

    assert.deepEqual(result, { reply: "已記錄", didLogMeal: true });
  });

  it("sendMessage throws UNAUTHORIZED on 401", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(401, { error: "Invalid" });
    await assert.rejects(() => api.sendMessage("hello"), { message: "UNAUTHORIZED" });
  });

  it("loadHistory appends deviceId to asset urls for browser image fetches", async () => {
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

    assert.equal(result.messages[0]?.imageUrl, "/api/assets/asset-1?deviceId=d-1");
  });

  it("getMeals includes X-Device-Id", async () => {
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

    const headers = fetchCalls[0].init.headers as Record<string, string>;
    assert.equal(fetchCalls[0].url, "/api/meals");
    assert.equal(headers["X-Device-Id"], "d-1");
    assert.equal(result.meals.length, 1);
  });

  it("getMeals appends deviceId to meal image urls for browser image fetches", async () => {
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

    assert.equal(result.meals[0]?.imageUrl, "/api/assets/asset-1?deviceId=d-1");
  });

  it("getDaySnapshot requests the explicit day with X-Device-Id", async () => {
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
    const headers = fetchCalls[0].init.headers as Record<string, string>;
    assert.equal(headers["X-Device-Id"], "d-1");
    assert.equal(result.date, "2026-03-25");
  });

  it("getDaySnapshot appends deviceId to meal image urls for browser image fetches", async () => {
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

    assert.equal(result.meals[0]?.imageUrl, "/api/assets/asset-1?deviceId=d-1");
  });

  it("getDaySnapshot throws UNAUTHORIZED on 401", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(401, { error: "Invalid" });
    await assert.rejects(() => api.getDaySnapshot("2026-03-25"), { message: "UNAUTHORIZED" });
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
    const headers = fetchCalls[0].init.headers as Record<string, string>;
    assert.equal(headers["X-Device-Id"], "d-1");
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

  it("withAuthorizedAssetUrl preserves existing deviceId query params", () => {
    storage.set("deviceId", "device-123");

    assert.equal(
      api.withAuthorizedAssetUrl("/api/assets/asset-1?deviceId=existing-device"),
      "/api/assets/asset-1?deviceId=existing-device",
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
});
