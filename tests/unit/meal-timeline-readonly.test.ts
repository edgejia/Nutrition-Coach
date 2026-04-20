import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MealTimeline } from "../../client/src/components/MealTimeline.js";

describe("MealTimeline read-only mode", () => {
  it("hides delete affordances for historical snapshots", () => {
    const html = renderToStaticMarkup(createElement(MealTimeline, {
      meals: [
        {
          id: "meal-1",
          foodName: "雞胸肉便當",
          calories: 520,
          protein: 42,
          carbs: 48,
          fat: 18,
          loggedAt: "2026-03-25T04:30:00.000Z",
        },
      ],
      deletingMealId: null,
      isReadOnly: true,
      onDelete: () => undefined,
    }));

    assert.doesNotMatch(html, /刪除/);
  });

  it("uses historical-safe empty copy in read-only mode", () => {
    const html = renderToStaticMarkup(createElement(MealTimeline, {
      meals: [],
      deletingMealId: null,
      isReadOnly: true,
      onDelete: () => undefined,
    }));

    assert.match(html, /這一天還沒有餐點紀錄/);
    assert.doesNotMatch(html, /今天還沒有餐點紀錄/);
  });
});
