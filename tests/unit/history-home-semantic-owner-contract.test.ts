import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { afterEach, describe, it } from "node:test";

const storage = new Map<string, string>();
Object.defineProperty(globalThis, "localStorage", {
  value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
    clear: () => storage.clear(),
  },
});

const {
  formatMealRowTime,
  getDisplayMealLabel,
  getHomeCalorieDisplay,
  getHomeEmptyCoachCopy,
  getHomeMacroDisplays,
  getMealBadge,
  getMealMacroSummary,
} = await import("../../client/src/components/HomeScreen.js");
const {
  buildHistoryWeek,
  getHistoryCalorieStatus,
  getHistoryWeekHeaderLabel,
  getMondayWeekStart,
  isRealDateKey,
  selectSameWeekdayOrClosestAvailable,
  shiftHistoryWeek,
} = await import("../../client/src/lib/history-week.js");

const SEMANTIC_OWNER_ID = "history-home-semantic-owner";
const SEMANTIC_OWNER_LABEL = "History/Home runtime semantic owner";
const ownerRegistry = new Map<string, string>([[SEMANTIC_OWNER_ID, SEMANTIC_OWNER_LABEL]]);
const originalTz = process.env.TZ;

function registerSemanticOwner(registry: Map<string, string>, ownerId: string, label: string) {
  if (registry.has(ownerId)) {
    throw new Error(`duplicate semantic owner registration: ${ownerId}`);
  }
  registry.set(ownerId, label);
}

function assertOwnedEqual<T>(actual: T, expected: T, ownerId = SEMANTIC_OWNER_ID) {
  assert.equal(ownerId, "history-home-semantic-owner", `semantic owner token must be canonical: ${ownerId || "<missing>"}`);
  assert.equal(ownerRegistry.get(ownerId), SEMANTIC_OWNER_LABEL, `semantic owner registry mismatch: ${ownerId}`);
  assert.deepEqual(actual, expected);
}

function siblingPath(fileName: string) {
  return fileURLToPath(new URL(`./${fileName}`, import.meta.url));
}

async function readSibling(fileName: string) {
  return readFile(siblingPath(fileName), "utf8");
}

describe(`Semantic owner: ${SEMANTIC_OWNER_LABEL}`, () => {
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("owns Home meal display, nutrition derivation, badges, and coach handoff semantics", () => {
    assertOwnedEqual(getDisplayMealLabel("lunch", "2026-04-29T07:30:00+08:00"), "午餐");
    assertOwnedEqual(getDisplayMealLabel("breakfast", "2026-04-29T12:30:00+08:00"), "早餐");
    assertOwnedEqual(getDisplayMealLabel("dinner", "2026-04-29T15:00:00+08:00"), "晚餐");
    assertOwnedEqual(getDisplayMealLabel("late_night", "2026-04-29T19:00:00+08:00"), "宵夜");
    assertOwnedEqual(getDisplayMealLabel(null, "2026-04-29T07:30:00+08:00"), "早餐");
    assertOwnedEqual(getDisplayMealLabel(undefined, "2026-04-29T12:30:00+08:00"), "午餐");
    assertOwnedEqual(getDisplayMealLabel(undefined, "2026-04-29T15:00:00+08:00"), "點心");
    assertOwnedEqual(getDisplayMealLabel(undefined, "2026-04-29T19:00:00+08:00"), "晚餐");
    assertOwnedEqual(getDisplayMealLabel("invalid" as never, "2026-04-29T15:00:00+08:00"), "點心");
    assertOwnedEqual(getDisplayMealLabel(null, "not-a-date"), "餐點");
    assertOwnedEqual(getDisplayMealLabel(), "餐點");

    assertOwnedEqual(formatMealRowTime("2026-04-29T07:30:00+08:00"), "07:30");
    assertOwnedEqual(formatMealRowTime("not-a-date"), "--:--");
    assertOwnedEqual(getHomeCalorieDisplay({ totalCalories: 1240 }, { calories: 2000 }), {
      consumed: 1240,
      target: 2000,
      remaining: 760,
      ringValue: 0.62,
      percent: 62,
    });
    assertOwnedEqual(getHomeCalorieDisplay({ totalCalories: 1240 }, { calories: 0 }), {
      consumed: 1240,
      target: 0,
      remaining: 0,
      ringValue: 0,
      percent: 0,
    });

    assertOwnedEqual(
      getHomeMacroDisplays(
        { totalProtein: 88, totalCarbs: 168, totalFat: 52 },
        { protein: 120, carbs: 280, fat: 72 },
      ),
      [
        {
          id: "protein",
          label: "蛋白",
          metric: "PROTEIN",
          current: 88,
          target: 120,
          progress: 0.7333333333333333,
          percent: 73,
          variant: "default",
        },
        {
          id: "carbs",
          label: "碳水",
          metric: "CARBS",
          current: 168,
          target: 280,
          progress: 0.6,
          percent: 60,
          variant: "cyan",
        },
        {
          id: "fat",
          label: "脂肪",
          metric: "FAT",
          current: 52,
          target: 72,
          progress: 0.7222222222222222,
          percent: 72,
          variant: "amber",
        },
      ],
    );

    for (const macro of getHomeMacroDisplays({ totalProtein: 1, totalCarbs: 2, totalFat: 3 }, null)) {
      assertOwnedEqual(Number.isNaN(macro.progress), false);
      assertOwnedEqual(macro.progress, 0);
      assertOwnedEqual(macro.percent, 0);
    }

    assertOwnedEqual(getMealMacroSummary({ protein: 18, carbs: 42, fat: 8 }), "P 18 · C 42 · F 8");
    assertOwnedEqual(getMealBadge("breakfast", "2026-04-29T12:30:00+08:00"), "B");
    assertOwnedEqual(getMealBadge("lunch", "2026-04-29T07:30:00+08:00"), "L");
    assertOwnedEqual(getMealBadge("late_night", "2026-04-29T19:00:00+08:00"), "N");
    assertOwnedEqual(getMealBadge(undefined, "2026-04-29T15:00:00+08:00"), "S");
    assertOwnedEqual(getMealBadge(undefined, "2026-04-29T19:00:00+08:00"), "D");
    assertOwnedEqual(getMealBadge(undefined, "not-a-date"), "M");
    assertOwnedEqual(getHomeEmptyCoachCopy(), {
      headline: "還沒有紀錄",
      body: "到「對話」描述你吃了什麼，AI 會幫你整理今天第一餐。",
      actions: [{ label: "去對話記錄", prompt: "我想記錄今天第一餐，請一步步引導我。" }],
    });
  });

  it("owns History week navigation, date validity, pending state, and calorie status semantics", () => {
    assertOwnedEqual(getMondayWeekStart("2026-04-30"), "2026-04-27");
    assertOwnedEqual(shiftHistoryWeek("2026-04-27", -1), "2026-04-20");
    assertOwnedEqual(shiftHistoryWeek("2026-04-27", 1), "2026-05-04");

    assertOwnedEqual(getHistoryWeekHeaderLabel("2026-05-04", "2026-05-06"), "本週");
    assertOwnedEqual(getHistoryWeekHeaderLabel("2026-04-27", "2026-05-06"), "上週");
    assertOwnedEqual(getHistoryWeekHeaderLabel("2026-04-20", "2026-05-06"), "歷史紀錄");
    assertOwnedEqual(getHistoryWeekHeaderLabel("2026-05-11", "2026-05-06"), "歷史紀錄");

    for (const dateKey of ["2026-04-30", "2026-02-28", "2026-12-31"]) {
      assertOwnedEqual(isRealDateKey(dateKey), true);
    }
    for (const dateKey of ["2026-4-30", "not-a-date", "2026-02-31", "2026-13-01"]) {
      assertOwnedEqual(isRealDateKey(dateKey), false);
    }

    const days = buildHistoryWeek({
      weekStartKey: "2026-04-27",
      selectedDateKey: "2026-04-30",
      todayKey: "2026-04-30",
      trends: [
        { date: "2026-04-27", calories: 0, protein: 0, carbs: 0, fat: 0, mealCount: 0 },
        { date: "2026-04-28", calories: 1600, protein: 80, carbs: 180, fat: 40, mealCount: 3 },
        { date: "2026-04-29", calories: 2300, protein: 120, carbs: 260, fat: 70, mealCount: 4 },
      ],
      targets: { calories: 2000, protein: 100, carbs: 250, fat: 70 },
    });
    assertOwnedEqual(days.length, 7);
    assertOwnedEqual(days[0]?.dateKey, "2026-04-27");
    assertOwnedEqual(days[0]?.status, "empty");
    assertOwnedEqual(days[1]?.status, "slightlyLow");
    assertOwnedEqual(days[1]?.waterLevel, 0.8);
    assertOwnedEqual(days[2]?.status, "over");
    assertOwnedEqual(days[2]?.waterLevel, 1);
    assertOwnedEqual(days[2]?.isOverTolerance, true);
    assertOwnedEqual(days[3]?.isSelected, true);
    assertOwnedEqual(days[3]?.isToday, true);
    assertOwnedEqual(days[4]?.isFuture, true);
    assertOwnedEqual(days[5]?.isFuture, true);
    assertOwnedEqual(days[6]?.isFuture, true);

    const pendingDays = buildHistoryWeek({
      weekStartKey: "2026-05-04",
      selectedDateKey: "2026-05-06",
      todayKey: "2026-05-06",
      trends: [],
      targets: { calories: 2000, protein: 100, carbs: 250, fat: 70 },
      pending: true,
    });
    assertOwnedEqual(pendingDays.length, 7);
    for (const day of pendingDays) {
      assertOwnedEqual(day.status, "pending");
      assertOwnedEqual(day.calories, null);
      assertOwnedEqual(day.mealCount, null);
      assertOwnedEqual(day.calorieRatio, null);
      assertOwnedEqual(day.waterLevel, 0);
    }
    const selectedPendingDay = pendingDays.find((day) => day.dateKey === "2026-05-06");
    assertOwnedEqual(selectedPendingDay?.dateKey, "2026-05-06");
    assertOwnedEqual(selectedPendingDay?.isSelected, true);
    assertOwnedEqual(selectedPendingDay?.isToday, true);

    assertOwnedEqual(getHistoryCalorieStatus({ calories: 1300, mealCount: 3, targetCalories: 2000 }).status, "low");
    assertOwnedEqual(
      getHistoryCalorieStatus({ calories: 1600, mealCount: 3, targetCalories: 2000 }).status,
      "slightlyLow",
    );
    assertOwnedEqual(getHistoryCalorieStatus({ calories: 2000, mealCount: 3, targetCalories: 2000 }).status, "inRange");
    assertOwnedEqual(getHistoryCalorieStatus({ calories: 2000, targetCalories: 2000 }).status, "inRange");
    assertOwnedEqual(getHistoryCalorieStatus({ calories: 2200, mealCount: 3, targetCalories: 2000 }).status, "inRange");
    assertOwnedEqual(getHistoryCalorieStatus({ calories: 2201, mealCount: 3, targetCalories: 2000 }).status, "over");
    assertOwnedEqual(getHistoryCalorieStatus({ calories: 2600, mealCount: 3, targetCalories: 2000 }).status, "highOver");

    const empty = getHistoryCalorieStatus({ calories: 0, mealCount: 0, targetCalories: 2000 });
    assertOwnedEqual(empty.status, "empty");
    assertOwnedEqual(empty.calorieRatio, null);
    assertOwnedEqual(empty.waterLevel, 0);
    const targetMissing = getHistoryCalorieStatus({ calories: 600, mealCount: 1, targetCalories: null });
    assertOwnedEqual(targetMissing.status, "targetMissing");
    assertOwnedEqual(targetMissing.calorieRatio, null);
    assertOwnedEqual(targetMissing.waterLevel, 0);
    assertOwnedEqual(targetMissing.hasTarget, false);

    assertOwnedEqual(
      selectSameWeekdayOrClosestAvailable({
        nextWeekStartKey: "2026-05-04",
        previousSelectedDateKey: "2026-04-30",
        todayKey: "2026-04-30",
      }),
      "2026-04-30",
    );
  });

  it("keeps History civil-date navigation identical across host timezones", () => {
    for (const hostTimezone of [
      "Asia/Taipei",
      "UTC",
      "America/Los_Angeles",
      "Pacific/Kiritimati",
    ]) {
      process.env.TZ = hostTimezone;

      assertOwnedEqual(getMondayWeekStart("2026-04-30"), "2026-04-27");
      assertOwnedEqual(shiftHistoryWeek("2026-04-27", -1), "2026-04-20");
      assertOwnedEqual(shiftHistoryWeek("2026-04-27", 1), "2026-05-04");
      assertOwnedEqual(getMondayWeekStart("2026-01-01"), "2025-12-29");
    }
  });

  it("keeps existing History/Home source suites discoverable as bounded structural guards", async () => {
    const sourceSuites = [
      ["history-screen-contract.test.ts", 'describe("History screen source contract"', 'it("keeps History free of demo globals, demo labels, and inline mutation controls"'],
      ["history-day-detail-source-contract.test.ts", 'describe("History Day Detail source contract"', 'it("does not add stale or freshness indicators to the read-only detail UI"'],
      ["home-dashboard-contract.test.ts", 'describe("Home dashboard display contracts"', 'it("Home keeps logging anchored in Chat"'],
      ["home-sport-source-contract.test.ts", 'describe("Home canonical Sport kit source parity"', 'it("keeps production-only Home behavior as explicit adapters"'],
    ] as const;

    for (const [fileName, suiteLabel, negativeControl] of sourceSuites) {
      const source = await readSibling(fileName);
      assert.equal(source.includes(suiteLabel), true, `${fileName} must remain discoverable`);
      assert.equal(source.includes(negativeControl), true, `${fileName} must retain ${negativeControl}`);
    }
  });

  it("reverse-negative: altered calorie output fails the owner assertion", () => {
    const actual = getHomeCalorieDisplay({ totalCalories: 1240 }, { calories: 2000 });

    assert.throws(
      () => assertOwnedEqual(actual, { ...actual, percent: actual.percent + 1 }),
      /strictly deep-equal/,
    );
  });

  it("reverse-negative: missing or changed owner token fails closed", () => {
    assert.throws(() => assertOwnedEqual("午餐", "午餐", ""), /canonical/);
    assert.throws(
      () => assertOwnedEqual("午餐", "午餐", "history-home-semantic-owner-mutated"),
      /canonical/,
    );
  });

  it("reverse-negative: duplicate owner registration fails closed", () => {
    const registry = new Map<string, string>([["history-home-semantic-owner", SEMANTIC_OWNER_LABEL]]);

    assert.throws(
      () => registerSemanticOwner(registry, "history-home-semantic-owner", "duplicate owner"),
      /duplicate semantic owner registration/,
    );
  });
});
