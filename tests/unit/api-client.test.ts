import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

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
  });

  it("sendMessage includes X-Device-Id header from localStorage", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(200, { reply: "OK" });
    await api.sendMessage("hello");
    const headers = fetchCalls[0].init.headers as Record<string, string>;
    assert.equal(headers["X-Device-Id"], "d-1");
  });

  it("sendMessage throws UNAUTHORIZED on 401", async () => {
    storage.set("deviceId", "d-1");
    mockFetch(401, { error: "Invalid" });
    await assert.rejects(() => api.sendMessage("hello"), { message: "UNAUTHORIZED" });
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
});
