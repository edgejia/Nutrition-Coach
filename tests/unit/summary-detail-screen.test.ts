import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

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

const { formatLocalDate } = await import("../../client/src/lib/time.js");
const { useStore } = await import("../../client/src/store.js");
const {
  SummaryDetailScreen,
  SummaryDetailScreenPresentation,
} = await import("../../client/src/components/SummaryDetailScreen.js");
const summaryDetailSource = await readFile(
  fileURLToPath(new URL("../../client/src/components/SummaryDetailScreen.tsx", import.meta.url)),
  "utf8",
);

function formatSummaryDateLabel(dateKey: string) {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(year!, month! - 1, day!).toLocaleDateString("zh-TW", {
    month: "numeric",
    day: "numeric",
    weekday: "short",
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

describe("SummaryDetailScreen disclosure shell", () => {
  beforeEach(() => {
    storage.clear();

    const todayKey = formatLocalDate(new Date());
    useStore.setState({
      deviceId: "device-1",
      goal: "fat_loss",
      activeScreen: "home",
      guestSessionStatus: "ready",
      guestSessionRecoveryAttempted: false,
      dailyTargets: {
        calories: 1800,
        protein: 140,
        carbs: 180,
        fat: 60,
      },
      dailySummary: {
        date: todayKey,
        totalCalories: 920,
        totalProtein: 54,
        totalCarbs: 88,
        totalFat: 34,
        mealCount: 2,
      },
      messages: [],
      coachAdvice: null,
      meals: [],
      pendingHomeChatDraft: null,
      showSettings: false,
      sending: false,
      provisionalBubble: null,
    });
  });

  it("renders the selected day inside a collapsed disclosure shell on first paint", () => {
    const todayKey = formatLocalDate(new Date());
    const html = renderToStaticMarkup(createElement(SummaryDetailScreen));

    assert.match(html, /選擇日期/);
    assert.match(html, /展開月曆/);
    assert.match(html, /今天 · 即時/);
    assert.match(html, /aria-controls="summary-calendar-panel"/);
    assert.match(html, /aria-expanded="false"/);
    assert.doesNotMatch(html, /查看上個月/);
    assert.doesNotMatch(html, /查看下個月/);
    assert.match(html, new RegExp(escapeRegExp(formatSummaryDateLabel(todayKey))));
  });

  it("renders historical collapsed-shell copy through the pure presentation seam", () => {
    const todayKey = "2026-04-22";
    const selectedDateKey = "2026-04-19";
    const html = renderToStaticMarkup(createElement(SummaryDetailScreenPresentation, {
      todayKey,
      selectedDateKey,
      visibleMonthKey: selectedDateKey.slice(0, 7),
      isCalendarOpen: false,
      loading: false,
      deletingMealId: null,
      error: null,
      sending: false,
      liveSummary: {
        date: todayKey,
        totalCalories: 920,
        totalProtein: 54,
        totalCarbs: 88,
        totalFat: 34,
        mealCount: 2,
      },
      targets: {
        calories: 1800,
        protein: 140,
        carbs: 180,
        fat: 60,
      },
      snapshot: {
        date: selectedDateKey,
        summary: {
          date: selectedDateKey,
          totalCalories: 1180,
          totalProtein: 86,
          totalCarbs: 112,
          totalFat: 38,
          mealCount: 3,
        },
        meals: [],
      },
      onBack: () => undefined,
      onToggleCalendar: () => undefined,
      onBrowseMonth: () => undefined,
      onSelectDate: () => undefined,
      onDeleteMeal: () => undefined,
    }));

    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /歷史快照/);
    assert.match(html, /今天的即時更新不會覆蓋這個畫面。/);
  });

  it("renders meal metadata with resolved explicit meal-period labels and fallback labels", () => {
    const todayKey = "2026-04-22";
    const html = renderToStaticMarkup(createElement(SummaryDetailScreenPresentation, {
      todayKey,
      selectedDateKey: todayKey,
      visibleMonthKey: todayKey.slice(0, 7),
      isCalendarOpen: false,
      loading: false,
      deletingMealId: null,
      error: null,
      sending: false,
      liveSummary: {
        date: todayKey,
        totalCalories: 920,
        totalProtein: 54,
        totalCarbs: 88,
        totalFat: 34,
        mealCount: 2,
      },
      targets: {
        calories: 1800,
        protein: 140,
        carbs: 180,
        fat: 60,
      },
      snapshot: {
        date: todayKey,
        summary: {
          date: todayKey,
          totalCalories: 920,
          totalProtein: 54,
          totalCarbs: 88,
          totalFat: 34,
          mealCount: 2,
        },
        meals: [
          {
            id: "meal-1",
            mealRevisionId: "rev-1",
            foodName: "雞腿便當",
            calories: 620,
            protein: 38,
            carbs: 72,
            fat: 18,
            itemCount: 1,
            loggedAt: "2026-04-22T07:30:00+08:00",
            mealPeriod: "lunch",
          },
          {
            id: "meal-2",
            mealRevisionId: "rev-2",
            foodName: "優格",
            calories: 300,
            protein: 16,
            carbs: 20,
            fat: 16,
            itemCount: 1,
            loggedAt: "2026-04-22T15:00:00+08:00",
          },
        ],
      },
      onBack: () => undefined,
      onToggleCalendar: () => undefined,
      onBrowseMonth: () => undefined,
      onSelectDate: () => undefined,
      onDeleteMeal: () => undefined,
    }));

    assert.match(html, /07:30 · 午餐/);
    assert.match(html, /15:00 · 點心/);
  });

  it("uses shared meal-row label helpers without adding meal-period controls", () => {
    assert.match(summaryDetailSource, /import \{ formatMealRowTime, getDisplayMealLabel \} from "\.\/HomeScreen\.js";/);
    assert.match(summaryDetailSource, /\{formatMealRowTime\(meal\.loggedAt\)\} · \{getDisplayMealLabel\(meal\.mealPeriod, meal\.loggedAt\)\}/);
    assert.doesNotMatch(summaryDetailSource, /mealPeriod.*(?:select|picker|toast|modal|snackbar)|(?:select|picker).*mealPeriod/i);
  });

  it("refreshes shared today state after Summary Detail meal deletion", () => {
    assert.match(summaryDetailSource, /MealRevisionConflictError/);
    assert.match(summaryDetailSource, /import \{ refreshAfterMealMutation \} from "\.\.\/meal-edit-refresh\.js";/);
    assert.match(summaryDetailSource, /const redactChatReceiptIdentity = useStore\(\(s\) => s\.redactChatReceiptIdentity\);/);
    assert.match(summaryDetailSource, /await refreshAfterMealMutation\(\{\s*redactChatReceiptIdentity,\s*recordMealMutation,\s*setDailySummary,\s*getMeals,\s*setMeals,\s*todayKey: \(\) => formatLocalDate\(new Date\(\)\),\s*\}, \{\s*mealId,\s*affectedDate,\s*dailySummary,\s*\}\);/);
    assert.match(summaryDetailSource, /if \(err instanceof MealRevisionConflictError\) \{/);
    assert.match(summaryDetailSource, /mealId: err\.mealId,\s*affectedDate: err\.affectedDate,/);
    assert.doesNotMatch(
      summaryDetailSource,
      /if \(dailySummary\?\.date === todayKey\) \{\s*setDailySummary\(dailySummary\);\s*const \{ meals \} = await getMeals\(\{ refreshReason: "meal_mutation" \}\);\s*setMeals\(meals\);\s*\}/,
    );
  });
});
