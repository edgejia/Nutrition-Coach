import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSSESummaryCoordinator,
  type MealRowRefreshReason,
} from "../../client/src/sse-summary-coordinator.js";
import { formatLocalDate } from "../../client/src/lib/time.js";
import type { DailySummary, DailySummarySSEPayload, MealEntry } from "../../client/src/types.js";

type Meal = Pick<MealEntry, "id" | "foodName" | "calories" | "protein" | "carbs" | "fat" | "itemCount" | "loggedAt">;

type ControlledMeals = {
  promise: Promise<{ meals: Meal[] }>;
  resolve: (value: { meals: Meal[] }) => void;
  reject: (error: unknown) => void;
};

function createControlledMeals(): ControlledMeals {
  let resolve!: (value: { meals: Meal[] }) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<{ meals: Meal[] }>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function summaryForDate(date: string, totalCalories: number): DailySummary {
  return {
    date,
    totalCalories,
    totalProtein: Math.round(totalCalories / 10),
    totalCarbs: Math.round(totalCalories / 5),
    totalFat: Math.round(totalCalories / 20),
    mealCount: Math.max(1, Math.round(totalCalories / 100)),
  };
}

function envelopeForDate(
  date: string,
  totalCalories: number,
  source: DailySummarySSEPayload["source"],
): DailySummarySSEPayload {
  return {
    summary: summaryForDate(date, totalCalories),
    affectedDate: date,
    source,
  };
}

function meal(id: string, calories: number): Meal {
  return {
    id,
    foodName: `meal ${id}`,
    calories,
    protein: 10,
    carbs: 20,
    fat: 5,
    itemCount: 1,
    loggedAt: "2026-05-18T04:00:00.000Z",
  };
}

function createHarness() {
  const getMealsCalls: Array<{ refreshReason?: MealRowRefreshReason }> = [];
  const pendingMeals: ControlledMeals[] = [];
  const commits: Array<{ type: "meals"; rows: Meal[] } | { type: "summary"; summary: DailySummary } | { type: "historical"; affectedDate: string }> = [];

  const coordinator = createSSESummaryCoordinator<Meal>({
    getMeals: (options) => {
      getMealsCalls.push(options ?? {});
      const controlled = createControlledMeals();
      pendingMeals.push(controlled);
      return controlled.promise;
    },
    setMeals: (rows) => commits.push({ type: "meals", rows }),
    setDailySummary: (summary) => commits.push({ type: "summary", summary }),
    recordMealMutation: (affectedDate) => commits.push({ type: "historical", affectedDate }),
    todayKey: () => "2026-05-18",
  });

  return { coordinator, getMealsCalls, pendingMeals, commits };
}

describe("SSE summary coordinator", () => {
  it("refetches same-day mutation rows before committing rows then summary", async () => {
    const { coordinator, getMealsCalls, pendingMeals, commits } = createHarness();
    const payload = envelopeForDate("2026-05-18", 640, "meal_mutation");
    const rows = [meal("latest", 640)];

    const handling = coordinator.handleSummary(payload);

    assert.deepEqual(getMealsCalls, [{ refreshReason: "meal_mutation" }]);
    assert.deepEqual(commits, []);

    pendingMeals[0]?.resolve({ meals: rows });
    await handling;

    assert.deepEqual(commits, [
      { type: "meals", rows },
      { type: "summary", summary: payload.summary },
    ]);
  });

  it("passes manual refresh reason through initial meals load", async () => {
    const { coordinator, getMealsCalls, pendingMeals, commits } = createHarness();
    const rows = [meal("manual", 520)];

    const initialLoad = coordinator.runInitialMealsLoad({ refreshReason: "manual_refresh" });

    pendingMeals[0]?.resolve({ meals: rows });
    await initialLoad;

    assert.deepEqual(getMealsCalls, [{ refreshReason: "manual_refresh" }]);
    assert.deepEqual(commits, [{ type: "meals", rows }]);
  });

  it("drops same-day mutation summary and rows when row refetch fails silently", async () => {
    const { coordinator, pendingMeals, commits } = createHarness();
    const handling = coordinator.handleSummary(envelopeForDate("2026-05-18", 700, "meal_mutation"));

    pendingMeals[0]?.reject(new Error("network unavailable"));
    await assert.doesNotReject(handling);

    assert.deepEqual(commits, []);
  });

  it("commits only the latest overlapping same-day mutation token", async () => {
    const { coordinator, pendingMeals, commits } = createHarness();
    const olderPayload = envelopeForDate("2026-05-18", 500, "meal_mutation");
    const newerPayload = envelopeForDate("2026-05-18", 900, "meal_mutation");
    const olderRows = [meal("older", 500)];
    const newerRows = [meal("newer", 900)];

    const olderHandling = coordinator.handleSummary(olderPayload);
    const newerHandling = coordinator.handleSummary(newerPayload);

    pendingMeals[1]?.resolve({ meals: newerRows });
    await newerHandling;
    pendingMeals[0]?.resolve({ meals: olderRows });
    await olderHandling;

    assert.deepEqual(commits, [
      { type: "meals", rows: newerRows },
      { type: "summary", summary: newerPayload.summary },
    ]);
  });

  it("drops an older initial row-load commit after a newer same-day mutation reconcile wins", async () => {
    const { coordinator, pendingMeals, commits } = createHarness();
    const initialRows = [meal("initial", 300)];
    const mutationRows = [meal("mutation", 840)];
    const mutationPayload = envelopeForDate("2026-05-18", 840, "meal_mutation");

    const initialLoad = coordinator.runInitialMealsLoad();
    const mutationHandling = coordinator.handleSummary(mutationPayload);

    pendingMeals[1]?.resolve({ meals: mutationRows });
    await mutationHandling;
    pendingMeals[0]?.resolve({ meals: initialRows });
    await initialLoad;

    assert.deepEqual(commits, [
      { type: "meals", rows: mutationRows },
      { type: "summary", summary: mutationPayload.summary },
    ]);
  });

  it("commits first initial same-day summary without fetching rows when no rows are loaded", async () => {
    const { coordinator, getMealsCalls, commits } = createHarness();
    const payload = envelopeForDate("2026-05-18", 480, "initial");

    await coordinator.handleSummary(payload);

    assert.deepEqual(getMealsCalls, []);
    assert.deepEqual(commits, [{ type: "summary", summary: payload.summary }]);
  });

  it("commits initial summary using the fixed Asia/Taipei app date key", async () => {
    const appToday = formatLocalDate(new Date("2026-05-17T16:30:00.000Z"));
    const getMealsCalls: Array<{ refreshReason?: MealRowRefreshReason }> = [];
    const commits: Array<{ type: "summary"; summary: DailySummary } | { type: "historical"; affectedDate: string }> = [];
    const coordinator = createSSESummaryCoordinator<Meal>({
      getMeals: (options) => {
        getMealsCalls.push(options ?? {});
        return Promise.resolve({ meals: [] });
      },
      setMeals: () => undefined,
      setDailySummary: (summary) => commits.push({ type: "summary", summary }),
      recordMealMutation: (affectedDate) => commits.push({ type: "historical", affectedDate }),
      todayKey: () => appToday,
    });
    const payload = envelopeForDate("2026-05-18", 720, "initial");

    await coordinator.handleSummary(payload);

    assert.equal(appToday, "2026-05-18");
    assert.deepEqual(getMealsCalls, []);
    assert.deepEqual(commits, [{ type: "summary", summary: payload.summary }]);
  });

  it("commits initial same-day reconnect summary before refreshing already-loaded rows", async () => {
    const { coordinator, pendingMeals, commits } = createHarness();
    const initialRows = [meal("loaded", 450)];
    const reconnectRows = [meal("reconnect", 560)];
    const payload = envelopeForDate("2026-05-18", 560, "initial");

    const initialLoad = coordinator.runInitialMealsLoad();
    pendingMeals[0]?.resolve({ meals: initialRows });
    await initialLoad;

    const reconnect = coordinator.handleSummary(payload);
    assert.deepEqual(commits, [
      { type: "meals", rows: initialRows },
      { type: "summary", summary: payload.summary },
    ]);

    pendingMeals[1]?.resolve({ meals: reconnectRows });
    await reconnect;

    assert.deepEqual(commits, [
      { type: "meals", rows: initialRows },
      { type: "summary", summary: payload.summary },
      { type: "meals", rows: reconnectRows },
    ]);
  });

  it("keeps initial same-day reconnect summary when row refresh fails", async () => {
    const { coordinator, pendingMeals, commits } = createHarness();
    const initialRows = [meal("loaded", 450)];
    const payload = envelopeForDate("2026-05-18", 560, "initial");

    const initialLoad = coordinator.runInitialMealsLoad();
    pendingMeals[0]?.resolve({ meals: initialRows });
    await initialLoad;

    const reconnect = coordinator.handleSummary(payload);
    assert.deepEqual(commits, [
      { type: "meals", rows: initialRows },
      { type: "summary", summary: payload.summary },
    ]);

    pendingMeals[1]?.reject(new Error("network unavailable"));
    await assert.doesNotReject(reconnect);

    assert.deepEqual(commits, [
      { type: "meals", rows: initialRows },
      { type: "summary", summary: payload.summary },
    ]);
  });

  it("routes historical events through recordMealMutation only", async () => {
    const { coordinator, getMealsCalls, commits } = createHarness();

    await coordinator.handleSummary(envelopeForDate("2026-05-17", 390, "meal_mutation"));

    assert.deepEqual(getMealsCalls, []);
    assert.deepEqual(commits, [{ type: "historical", affectedDate: "2026-05-17" }]);
  });

  it("silently ignores future valid dates without mutating dependencies", async () => {
    const { coordinator, getMealsCalls, commits } = createHarness();

    await coordinator.handleSummary(envelopeForDate("2026-05-19", 390, "meal_mutation"));

    assert.deepEqual(getMealsCalls, []);
    assert.deepEqual(commits, []);
  });
});
