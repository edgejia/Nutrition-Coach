import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import type { DailySummary, DailyTargets } from "../../client/src/types.js";

// -----------------------------------------------------------------------------
// FakeEventSource — minimal EventSource shim that captures `addEventListener`
// registrations so tests can synthesize SSE events deterministically without
// spinning up a real HTTP server. The SSE client (`client/src/sse.ts`) only
// touches `addEventListener`, `close`, and `onerror`, so this shape is enough.
// -----------------------------------------------------------------------------
type FakeEventHandler = (event: MessageEvent<string>) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  public url: string;
  public listeners = new Map<string, FakeEventHandler[]>();
  public onerror: (() => void) | null = null;
  public closed = false;

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

describe("connectSSE", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    sse.disconnectSSE();
  });

  afterEach(() => {
    sse.disconnectSSE();
  });

  it("fake EventSource daily_summary event still calls the summary callback", () => {
    const receivedSummaries: DailySummary[] = [];
    const receivedTargets: DailyTargets[] = [];

    sse.connectSSE("device-1", {
      onSummary: (summary) => receivedSummaries.push(summary),
      onGoalsUpdate: (targets) => receivedTargets.push(targets),
    });

    const es = FakeEventSource.instances[0];
    assert.ok(es, "FakeEventSource should have been constructed");

    const summary: DailySummary = {
      date: "2026-04-18",
      totalCalories: 500,
      totalProtein: 30,
      totalCarbs: 60,
      totalFat: 15,
      mealCount: 2,
    };
    es.emit("daily_summary", JSON.stringify(summary));

    assert.equal(receivedSummaries.length, 1);
    assert.deepEqual(receivedSummaries[0], summary);
    assert.equal(receivedTargets.length, 0);
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
});
