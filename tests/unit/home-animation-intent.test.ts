import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  applyMealMutationMark,
  buildHomeNutritionSnapshot,
  deriveHomeEntryIntent,
  isNavigationEntryTrigger,
  snapshotsEqual,
} = await import("../../client/src/lib/home-animation-intent.js");

const targets = { calories: 1800, protein: 120, carbs: 220, fat: 60 };

function snapshot(overrides: Partial<ReturnType<typeof buildHomeNutritionSnapshot>> = {}) {
  return {
    date: "2026-07-07",
    kcal: 700,
    protein: 54,
    carbs: 68,
    fat: 24,
    targets,
    ...overrides,
  };
}

describe("home animation intent model", () => {
  it("enumerates replay, delta, and none intent shapes", () => {
    const current = snapshot();
    const replay = deriveHomeEntryIntent({
      trigger: "cold_start",
      today: "2026-07-07",
      baseline: null,
      current,
      unseenTodayMutation: false,
    });
    const baseline = snapshot({ kcal: 500 });
    const delta = deriveHomeEntryIntent({
      trigger: "nav_from_chat",
      today: "2026-07-07",
      baseline,
      current,
      unseenTodayMutation: true,
    });

    assert.deepEqual(replay.intent, { kind: "replay" });
    assert.deepEqual(delta.intent, { kind: "delta", from: baseline });
    assert.deepEqual({ kind: "none" }, { kind: "none" });
  });

  it("derives replay from a null baseline and advances nextBaseline to current", () => {
    const current = snapshot({ kcal: 830 });
    const result = deriveHomeEntryIntent({
      trigger: "nav_from_chat",
      today: "2026-07-07",
      baseline: null,
      current,
      unseenTodayMutation: true,
    });

    assert.deepEqual(result.intent, { kind: "replay" });
    assert.deepEqual(result.nextBaseline, current);
  });

  it("invalidates stale Asia/Taipei baselines before unseen mutation checks", () => {
    const current = snapshot({ date: "2026-07-07", kcal: 300 });
    const staleBaseline = snapshot({ date: "2026-07-06", kcal: 1800 });
    const result = deriveHomeEntryIntent({
      trigger: "nav_from_chat",
      today: "2026-07-07",
      baseline: staleBaseline,
      current,
      unseenTodayMutation: true,
    });

    assert.deepEqual(result.intent, { kind: "replay" });
    assert.deepEqual(result.nextBaseline, current);
  });

  it("collapses away mutations into one baseline-to-latest delta for chat and history navigation", () => {
    const baseline = snapshot({ kcal: 500, protein: 30 });
    const current = snapshot({ kcal: 820, protein: 64 });

    for (const trigger of ["nav_from_chat", "nav_from_history"] as const) {
      const result = deriveHomeEntryIntent({
        trigger,
        today: "2026-07-07",
        baseline,
        current,
        unseenTodayMutation: true,
      });

      assert.deepEqual(result.intent, { kind: "delta", from: baseline });
      assert.deepEqual(result.nextBaseline, current);
    }
  });

  it("replays on navigation when no today mutation was marked even if values differ", () => {
    const baseline = snapshot({ kcal: 500, protein: 30 });
    const current = snapshot({ kcal: 820, protein: 64 });

    for (const trigger of ["nav_from_chat", "nav_from_history"] as const) {
      assert.deepEqual(
        deriveHomeEntryIntent({
          trigger,
          today: "2026-07-07",
          baseline,
          current,
          unseenTodayMutation: false,
        }).intent,
        { kind: "replay" },
      );
    }
  });

  it("derives manual refresh replay for equal snapshots and delta for changed snapshots", () => {
    const baseline = snapshot({ kcal: 700 });
    const unchanged = snapshot({ kcal: 700, targets: { calories: 2100, protein: 140, carbs: 240, fat: 70 } });
    const changed = snapshot({ kcal: 760 });

    assert.deepEqual(
      deriveHomeEntryIntent({
        trigger: "manual_refresh",
        today: "2026-07-07",
        baseline,
        current: unchanged,
        unseenTodayMutation: false,
      }).intent,
      { kind: "replay" },
    );
    assert.deepEqual(
      deriveHomeEntryIntent({
        trigger: "manual_refresh",
        today: "2026-07-07",
        baseline,
        current: changed,
        unseenTodayMutation: false,
      }).intent,
      { kind: "delta", from: baseline },
    );
  });

  it("derives home-visible meal mutation delta only when display totals change", () => {
    const baseline = snapshot({ kcal: 700, protein: 54, carbs: 68, fat: 24 });
    const unchanged = snapshot({ kcal: 700, protein: 54, carbs: 68, fat: 24 });
    const decreased = snapshot({ kcal: 520, protein: 42, carbs: 48, fat: 18 });

    assert.deepEqual(
      deriveHomeEntryIntent({
        trigger: "meal_mutation",
        today: "2026-07-07",
        baseline,
        current: unchanged,
        unseenTodayMutation: false,
      }).intent,
      { kind: "none" },
    );
    assert.deepEqual(
      deriveHomeEntryIntent({
        trigger: "meal_mutation",
        today: "2026-07-07",
        baseline,
        current: decreased,
        unseenTodayMutation: false,
      }).intent,
      { kind: "delta", from: baseline },
    );
  });

  it("derives cold-start replay", () => {
    const baseline = snapshot({ kcal: 700 });
    const current = snapshot({ kcal: 760 });

    assert.deepEqual(
      deriveHomeEntryIntent({
        trigger: "cold_start",
        today: "2026-07-07",
        baseline,
        current,
        unseenTodayMutation: true,
      }).intent,
      { kind: "replay" },
    );
  });

  it("compares snapshots by rounded display nutrition numbers and ignores targets", () => {
    const first = snapshot({ targets });
    const second = snapshot({ targets: { calories: 2200, protein: 150, carbs: 260, fat: 80 } });
    const changed = snapshot({ kcal: 701 });

    assert.equal(snapshotsEqual(first, second), true);
    assert.equal(snapshotsEqual(first, changed), false);
  });

  it("marks only unseen today mutations away from home", () => {
    assert.equal(
      applyMealMutationMark({
        affectedDate: "2026-07-06",
        today: "2026-07-07",
        homeVisible: false,
        unseenTodayMutation: false,
      }),
      false,
    );
    assert.equal(
      applyMealMutationMark({
        affectedDate: "2026-07-07",
        today: "2026-07-07",
        homeVisible: true,
        unseenTodayMutation: false,
      }),
      false,
    );
    assert.equal(
      applyMealMutationMark({
        affectedDate: "2026-07-07",
        today: "2026-07-07",
        homeVisible: false,
        unseenTodayMutation: false,
      }),
      true,
    );
    assert.equal(
      applyMealMutationMark({
        affectedDate: "2026-07-07",
        today: "2026-07-07",
        homeVisible: false,
        unseenTodayMutation: true,
      }),
      true,
    );
  });

  it("builds rounded snapshots and coalesces null summary and targets to zeroes", () => {
    assert.deepEqual(
      buildHomeNutritionSnapshot({ date: "2026-07-07", summary: null, targets: null }),
      {
        date: "2026-07-07",
        kcal: 0,
        protein: 0,
        carbs: 0,
        fat: 0,
        targets: { calories: 0, protein: 0, carbs: 0, fat: 0 },
      },
    );
    assert.deepEqual(
      buildHomeNutritionSnapshot({
        date: "2026-07-07",
        summary: { totalCalories: 699.5, totalProtein: 53.4, totalCarbs: 68.6, totalFat: 23.5 },
        targets: { calories: 1799.5, protein: 119.4, carbs: 219.6, fat: 59.5 },
      }),
      {
        date: "2026-07-07",
        kcal: 700,
        protein: 53,
        carbs: 69,
        fat: 24,
        targets: { calories: 1800, protein: 119, carbs: 220, fat: 60 },
      },
    );
  });

  it("classifies navigation entry triggers for the scroll-to-top gate", () => {
    assert.equal(isNavigationEntryTrigger("nav_from_chat"), true);
    assert.equal(isNavigationEntryTrigger("nav_from_history"), true);
    assert.equal(isNavigationEntryTrigger("cold_start"), false);
    assert.equal(isNavigationEntryTrigger("manual_refresh"), false);
  });
});
