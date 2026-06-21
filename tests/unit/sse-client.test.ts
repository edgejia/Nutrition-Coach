import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { DailySummary, DailySummarySSEPayload, DailyTargets } from "../../client/src/types.js";
import {
  isAuthoritativeMealEntryDto,
  isDailySummarySSEPayloadDto,
  isGoalsUpdatePayloadDto,
} from "../../client/src/dto-guards.js";

const storage = new Map<string, string>();
globalThis.localStorage = {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => {
    storage.set(key, value);
  },
  removeItem: (key: string) => {
    storage.delete(key);
  },
  clear: () => {
    storage.clear();
  },
  get length() {
    return storage.size;
  },
  key: (index: number) => [...storage.keys()][index] ?? null,
} as Storage;

const originalFetch = globalThis.fetch;
const defaultTargets: DailyTargets = {
  calories: 1800,
  protein: 130,
  carbs: 200,
  fat: 60,
};
const recoveryFetchCalls: { url: string; init?: RequestInit }[] = [];
let recoveryShouldSucceed = true;

function installRecoveryFetchStub() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    recoveryFetchCalls.push({ url, init });
    if (url === "/api/device/session" && init?.method === "POST") {
      if (!recoveryShouldSucceed) {
        return new Response(JSON.stringify({ error: "UNAUTHORIZED" }), { status: 401 });
      }
      return Response.json({
        deviceId: "device-recovered",
        goal: "maintain",
        dailyTargets: defaultTargets,
        establishedBy: "resume",
      });
    }
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
}

// -----------------------------------------------------------------------------
// FakeEventSource — minimal EventSource shim that captures `addEventListener`
// registrations so tests can synthesize SSE events deterministically without
// spinning up a real HTTP server. The SSE client (`client/src/sse.ts`) only
// touches `addEventListener`, `close`, and `onerror`, so this shape is enough.
// -----------------------------------------------------------------------------
type FakeEventHandler = (event: MessageEvent<string>) => void;

class FakeEventSource {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances: FakeEventSource[] = [];
  public url: string;
  public listeners = new Map<string, FakeEventHandler[]>();
  public onerror: ((event?: Event) => void) | null = null;
  public closed = false;
  public readyState = FakeEventSource.OPEN;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, handler: FakeEventHandler) {
    const existing = this.listeners.get(type) ?? [];
    existing.push(handler);
    this.listeners.set(type, existing);
  }

  removeEventListener(type: string, handler: FakeEventHandler) {
    const existing = this.listeners.get(type) ?? [];
    this.listeners.set(
      type,
      existing.filter((h) => h !== handler)
    );
  }

  close() {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  failWithReadyState(state: number) {
    this.readyState = state;
    this.onerror?.(new Event("error"));
  }

  // Test-only emitter mirroring the real EventSource dispatch behavior for a
  // named event (`event: <name>` in the SSE frame).
  emit(type: string, data: string) {
    const handlers = this.listeners.get(type) ?? [];
    const event = { data } as MessageEvent<string>;
    for (const handler of handlers) {
      handler(event);
    }
  }
}

// Install the shim BEFORE importing sse.ts so that `new EventSource(...)` in
// `connectSSE` picks up the fake. The real Node 24 runtime does not expose
// `EventSource` as a native global in this project, so the assignment makes
// the bare identifier resolve via `globalThis`.
(globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;

const sse = await import("../../client/src/sse.js");
const { useStore } = await import("../../client/src/store.js");

describe("connectSSE", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    storage.clear();
    recoveryFetchCalls.length = 0;
    recoveryShouldSucceed = true;
    installRecoveryFetchStub();
    storage.set("deviceId", "device-1");
    storage.set("goal", "maintain");
    storage.set("dailyTargets", JSON.stringify(defaultTargets));
    useStore.setState({
      deviceId: "device-1",
      goal: "maintain",
      activeScreen: "home",
      guestSessionStatus: "ready",
      guestSessionRecoveryAttempted: false,
      dailyTargets: defaultTargets,
    });
    sse.disconnectSSE();
  });

  afterEach(() => {
    sse.disconnectSSE();
    globalThis.fetch = originalFetch;
  });

  const summaryForDate = (date: string): DailySummary => ({
    date,
    totalCalories: 500,
    totalProtein: 30,
    totalCarbs: 60,
    totalFat: 15,
    mealCount: 2,
  });

  const envelopeForDate = (
    date: string,
    source: DailySummarySSEPayload["source"] = "meal_mutation",
  ): DailySummarySSEPayload => ({
    summary: summaryForDate(date),
    affectedDate: date,
    source,
  });

  it("dispatches a valid daily_summary envelope to the envelope-aware callback", () => {
    const receivedEnvelopes: DailySummarySSEPayload[] = [];
    const receivedSummaries: DailySummary[] = [];
    const receivedTargets: DailyTargets[] = [];

    sse.connectSSE("device-1", {
      onDailySummaryEnvelope: (payload) => receivedEnvelopes.push(payload),
      onSummary: (summary) => receivedSummaries.push(summary),
      onGoalsUpdate: (targets) => receivedTargets.push(targets),
    });

    const es = FakeEventSource.instances[0];
    assert.ok(es, "FakeEventSource should have been constructed");
    assert.equal(es.url, "/api/sse");

    const payload = envelopeForDate("2026-04-18", "initial");
    es.emit("daily_summary", JSON.stringify(payload));

    assert.deepEqual(receivedEnvelopes, [payload]);
    assert.equal(receivedSummaries.length, 0);
    assert.equal(receivedTargets.length, 0);
  });

  it("falls back to the nested raw summary when only the legacy summary callback is provided", () => {
    const receivedSummaries: DailySummary[] = [];
    const receivedTargets: DailyTargets[] = [];

    sse.connectSSE("device-1", {
      onSummary: (summary) => receivedSummaries.push(summary),
      onGoalsUpdate: (targets) => receivedTargets.push(targets),
    });

    const es = FakeEventSource.instances[0];
    assert.ok(es, "FakeEventSource should have been constructed");

    const payload = envelopeForDate("2026-04-18", "initial");
    es.emit("daily_summary", JSON.stringify(payload));

    assert.equal(receivedSummaries.length, 1);
    assert.deepEqual(receivedSummaries[0], payload.summary);
    assert.equal(receivedTargets.length, 0);
  });

  it("dispatches future valid daily_summary envelopes for coordinator routing", () => {
    const receivedEnvelopes: DailySummarySSEPayload[] = [];
    const receivedSummaries: DailySummary[] = [];

    sse.connectSSE("device-1", {
      onDailySummaryEnvelope: (payload) => receivedEnvelopes.push(payload),
      onSummary: (summary) => receivedSummaries.push(summary),
      onGoalsUpdate: () => undefined,
    });

    const es = FakeEventSource.instances[0];
    assert.ok(es);

    const payload = envelopeForDate("2099-12-31", "meal_mutation");
    es.emit("daily_summary", JSON.stringify(payload));

    assert.deepEqual(receivedEnvelopes, [payload]);
    assert.equal(receivedSummaries.length, 0);
  });

  it("silently ignores invalid daily_summary frames without invoking callbacks", () => {
    const receivedEnvelopes: DailySummarySSEPayload[] = [];
    const receivedSummaries: DailySummary[] = [];
    const receivedTargets: DailyTargets[] = [];

    sse.connectSSE("device-1", {
      onDailySummaryEnvelope: (payload) => receivedEnvelopes.push(payload),
      onSummary: (summary) => receivedSummaries.push(summary),
      onGoalsUpdate: (targets) => receivedTargets.push(targets),
    });

    const es = FakeEventSource.instances[0];
    assert.ok(es);

    const valid = envelopeForDate("2026-04-18", "meal_mutation");
    const invalidFrames = [
      "NOT_JSON",
      JSON.stringify({ affectedDate: valid.affectedDate, source: valid.source }),
      JSON.stringify({ summary: valid.summary, source: valid.source }),
      JSON.stringify({ ...valid, source: "unknown" }),
      JSON.stringify({ ...valid, affectedDate: "2026/04/18" }),
      JSON.stringify({ ...valid, affectedDate: "2026-02-31" }),
      JSON.stringify({ ...valid, summary: { ...valid.summary, date: "2026-02-31" } }),
      `{"summary":{"date":"2026-04-18","totalCalories":1e309,"totalProtein":30,"totalCarbs":60,"totalFat":15,"mealCount":2},"affectedDate":"2026-04-18","source":"meal_mutation"}`,
      JSON.stringify({ ...valid, summary: { ...valid.summary, totalCalories: null } }),
      JSON.stringify({ ...valid, summary: { ...valid.summary, date: "2026-04-19" } }),
    ];

    for (const frame of invalidFrames) {
      assert.doesNotThrow(() => es.emit("daily_summary", frame));
    }

    assert.equal(receivedEnvelopes.length, 0);
    assert.equal(receivedSummaries.length, 0);
    assert.equal(receivedTargets.length, 0);
  });

  it("dispatches a valid daily_summary frame after malformed frames", () => {
    const receivedEnvelopes: DailySummarySSEPayload[] = [];
    const receivedSummaries: DailySummary[] = [];

    sse.connectSSE("device-1", {
      onDailySummaryEnvelope: (payload) => receivedEnvelopes.push(payload),
      onSummary: (summary) => receivedSummaries.push(summary),
      onGoalsUpdate: () => undefined,
    });

    const es = FakeEventSource.instances[0];
    assert.ok(es);

    const valid = envelopeForDate("2026-04-18", "meal_mutation");
    const invalidFrames = [
      "NOT_JSON",
      JSON.stringify({ ...valid, affectedDate: "2026-02-31" }),
      JSON.stringify({ ...valid, summary: { ...valid.summary, date: "2026-04-19" } }),
      JSON.stringify({ ...valid, summary: { ...valid.summary, totalProtein: "30" } }),
    ];

    for (const frame of invalidFrames) {
      assert.doesNotThrow(() => es.emit("daily_summary", frame));
    }

    es.emit("daily_summary", JSON.stringify(valid));

    assert.deepEqual(receivedEnvelopes, [valid]);
    assert.equal(receivedSummaries.length, 0);
  });

  it("shared push guards reject malformed payloads and preserve valid optional fields", () => {
    const validSummaryPayload = envelopeForDate("2026-04-18", "meal_mutation");
    assert.equal(isDailySummarySSEPayloadDto(validSummaryPayload), true);
    assert.equal(
      isDailySummarySSEPayloadDto({
        ...validSummaryPayload,
        summary: { ...validSummaryPayload.summary, totalCarbs: "60" },
      }),
      false,
    );
    assert.equal(
      isDailySummarySSEPayloadDto({
        ...validSummaryPayload,
        affectedDate: "2026-02-31",
      }),
      false,
    );

    assert.equal(
      isGoalsUpdatePayloadDto({
        targets: { calories: 1800, protein: 130, carbs: 200, fat: 60 },
      }),
      true,
    );
    assert.equal(
      isGoalsUpdatePayloadDto({
        targets: { calories: 1800, protein: 130, carbs: 200, fat: "60" },
      }),
      false,
    );

    assert.equal(
      isAuthoritativeMealEntryDto({
        id: "meal-1",
        mealRevisionId: "rev-1",
        foodName: "雞胸便當",
        calories: 640,
        protein: 45,
        carbs: 70,
        fat: 18,
        itemCount: 2,
        loggedAt: "2026-04-18T12:00:00.000Z",
        mealPeriod: "lunch",
        imageAssetId: null,
        imageUrl: "/api/assets/image-1",
      }),
      true,
    );
    assert.equal(
      isAuthoritativeMealEntryDto({
        id: "meal-1",
        mealRevisionId: "rev-1",
        foodName: "雞胸便當",
        calories: 640,
        protein: 45,
        carbs: 70,
        fat: 18,
        itemCount: 2,
        loggedAt: "2026-04-18T12:00:00.000Z",
        mealPeriod: "brunch",
      }),
      false,
    );
  });

  it("fake EventSource goals_update event with { targets } calls the goals callback with exactly those targets", () => {
    const receivedSummaries: DailySummary[] = [];
    const receivedTargets: DailyTargets[] = [];

    sse.connectSSE("device-1", {
      onSummary: (summary) => receivedSummaries.push(summary),
      onGoalsUpdate: (targets) => receivedTargets.push(targets),
    });

    const es = FakeEventSource.instances[0];
    assert.ok(es);

    const targets: DailyTargets = {
      calories: 1800,
      protein: 130,
      carbs: 200,
      fat: 60,
    };
    es.emit("goals_update", JSON.stringify({ targets }));

    assert.equal(receivedTargets.length, 1);
    assert.deepEqual(receivedTargets[0], targets);
    assert.equal(receivedSummaries.length, 0);
  });

  it("malformed goals_update JSON is ignored without throwing from the event listener", () => {
    const receivedTargets: DailyTargets[] = [];

    sse.connectSSE("device-1", {
      onSummary: () => undefined,
      onGoalsUpdate: (targets) => receivedTargets.push(targets),
    });

    const es = FakeEventSource.instances[0];
    assert.ok(es);

    // Completely malformed JSON.
    assert.doesNotThrow(() => es.emit("goals_update", "NOT_JSON"));
    // Empty object — no `targets` key.
    assert.doesNotThrow(() => es.emit("goals_update", JSON.stringify({})));
    // `targets` present but with a string instead of a number.
    assert.doesNotThrow(() =>
      es.emit("goals_update", JSON.stringify({ targets: { calories: "1800" } })),
    );
    // Partial numeric fields — missing some of the four required keys.
    assert.doesNotThrow(() =>
      es.emit(
        "goals_update",
        JSON.stringify({ targets: { calories: 1800, protein: 130 } }),
      ),
    );
    // All four keys present but one is a string, not a number.
    assert.doesNotThrow(() =>
      es.emit(
        "goals_update",
        JSON.stringify({ targets: { calories: 1800, protein: "130", carbs: 200, fat: 60 } }),
      ),
    );
    // All four keys present but one is NaN — rejected by Number.isFinite.
    assert.doesNotThrow(() =>
      es.emit(
        "goals_update",
        JSON.stringify({ targets: { calories: 1800, protein: 130, carbs: 200, fat: Number.NaN } }),
      ),
    );

    assert.equal(receivedTargets.length, 0);
  });

  it("valid goals_update after a malformed one still dispatches", () => {
    const receivedTargets: DailyTargets[] = [];

    sse.connectSSE("device-1", {
      onSummary: () => undefined,
      onGoalsUpdate: (targets) => receivedTargets.push(targets),
    });

    const es = FakeEventSource.instances[0];
    assert.ok(es);

    assert.doesNotThrow(() => es.emit("goals_update", "NOT_JSON"));

    const targets: DailyTargets = { calories: 2000, protein: 150, carbs: 210, fat: 70 };
    es.emit("goals_update", JSON.stringify({ targets }));

    assert.deepEqual(receivedTargets, [targets]);
  });

  it("models browser readyState constants and closed state", () => {
    assert.equal(FakeEventSource.CONNECTING, 0);
    assert.equal(FakeEventSource.OPEN, 1);
    assert.equal(FakeEventSource.CLOSED, 2);

    sse.connectSSE("device-1", {
      onSummary: () => undefined,
      onGoalsUpdate: () => undefined,
    });

    const es = FakeEventSource.instances[0];
    assert.ok(es);
    assert.equal(es.readyState, FakeEventSource.OPEN);

    es.close();

    assert.equal(es.closed, true);
    assert.equal(es.readyState, FakeEventSource.CLOSED);
  });

  it("controls guest-session recovery with a deterministic fetch stub", async () => {
    const recovered = await useStore.getState().recoverGuestSession();

    assert.equal(recovered, true);
    assert.equal(recoveryFetchCalls.length, 1);
    assert.equal(recoveryFetchCalls[0]?.url, "/api/device/session");
    assert.equal(useStore.getState().deviceId, "device-recovered");
    assert.equal(useStore.getState().guestSessionStatus, "ready");
    assert.equal(useStore.getState().guestSessionRecoveryAttempted, true);
  });

  it("does not recover or resubscribe while EventSource is CONNECTING", () => {
    sse.connectSSE("device-1", {
      onSummary: () => undefined,
      onGoalsUpdate: () => undefined,
    });

    const es = FakeEventSource.instances[0];
    assert.ok(es);

    es.failWithReadyState(FakeEventSource.CONNECTING);

    assert.equal(recoveryFetchCalls.length, 0);
    assert.equal(FakeEventSource.instances.length, 1);
    assert.equal(useStore.getState().guestSessionStatus, "ready");
    assert.equal(useStore.getState().guestSessionRecoveryAttempted, false);
  });
});
