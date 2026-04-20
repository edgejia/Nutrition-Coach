process.env.TZ = "Asia/Taipei";

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildHistoricalLoggedAt,
  resolveHistoricalDateIntent,
} from "../../server/lib/historical-date.js";

const FIXED_CURRENT_DATE = new Date("2026-04-19T12:00:00+08:00");

describe("historical-date resolver", () => {
  it("resolves supported explicit historical phrases to one local date key", () => {
    const cases = [
      { input: "幫我補記昨天晚餐吃牛肉麵", expected: "2026-04-18" },
      { input: "前天午餐是雞胸肉", expected: "2026-04-17" },
      { input: "2026-03-25 吃了蛋餅", expected: "2026-03-25" },
      { input: "2026/3/25 吃了蛋餅", expected: "2026-03-25" },
      { input: "3/25 吃了蛋餅", expected: "2026-03-25" },
      { input: "3月25日 吃了蛋餅", expected: "2026-03-25" },
      { input: "上週五晚餐吃壽司", expected: "2026-04-10" },
      { input: "前兩天多喝了一杯豆漿", expected: "2026-04-17" },
    ];

    for (const testCase of cases) {
      const resolved = resolveHistoricalDateIntent({
        input: testCase.input,
        currentDate: FIXED_CURRENT_DATE,
        mode: "mutation",
      });

      assert.equal(resolved.status, "resolved", testCase.input);
      assert.equal(resolved.dateKey, testCase.expected, testCase.input);
      assert.equal(resolved.isHistorical, true, testCase.input);
    }
  });

  it("resolves yearless dates to the nearest matching past date instead of a future date", () => {
    const resolved = resolveHistoricalDateIntent({
      input: "12/30 吃了火鍋",
      currentDate: FIXED_CURRENT_DATE,
      mode: "mutation",
    });

    assert.equal(resolved.status, "resolved");
    assert.equal(resolved.dateKey, "2025-12-30");
  });

  it("returns clarification for unsupported or ambiguous mutation phrases", () => {
    const unsupported = resolveHistoricalDateIntent({
      input: "上週吃了什麼",
      currentDate: FIXED_CURRENT_DATE,
      mode: "mutation",
    });
    assert.equal(unsupported.status, "needs_clarification");
    assert.equal(unsupported.reason, "unsupported");

    const conflicting = resolveHistoricalDateIntent({
      input: "把昨天和 3/25 的餐都補進去",
      currentDate: FIXED_CURRENT_DATE,
      mode: "mutation",
    });
    assert.equal(conflicting.status, "needs_clarification");
    assert.equal(conflicting.reason, "multiple_dates");

    const vague = resolveHistoricalDateIntent({
      input: "前陣子那餐幫我記一下",
      currentDate: FIXED_CURRENT_DATE,
      mode: "mutation",
    });
    assert.equal(vague.status, "needs_clarification");
    assert.equal(vague.reason, "unsupported");
  });

  it("allows multi-date resolution only for query mode", () => {
    const queryResult = resolveHistoricalDateIntent({
      input: "昨天和前天各吃多少蛋白質？",
      currentDate: FIXED_CURRENT_DATE,
      mode: "query",
    });

    assert.equal(queryResult.status, "resolved_many");
    assert.deepEqual(queryResult.dateKeys, ["2026-04-18", "2026-04-17"]);

    const mutationResult = resolveHistoricalDateIntent({
      input: "昨天和前天都幫我補記一份蛋白飲",
      currentDate: FIXED_CURRENT_DATE,
      mode: "mutation",
    });

    assert.equal(mutationResult.status, "needs_clarification");
    assert.equal(mutationResult.reason, "multiple_dates");
  });

  it("reuses the previous historical date only for obvious follow-up turns", () => {
    const followUp = resolveHistoricalDateIntent({
      input: "再加一杯豆漿",
      currentDate: FIXED_CURRENT_DATE,
      mode: "mutation",
      previousDateKey: "2026-04-18",
    });

    assert.equal(followUp.status, "resolved");
    assert.equal(followUp.dateKey, "2026-04-18");
    assert.equal(followUp.source, "carry_forward");
  });

  it("builds deterministic local anchors for neutral and meal-period historical logs", () => {
    const neutral = new Date(buildHistoricalLoggedAt({ dateKey: "2026-03-25" }));
    assert.equal(neutral.getFullYear(), 2026);
    assert.equal(neutral.getMonth(), 2);
    assert.equal(neutral.getDate(), 25);
    assert.equal(neutral.getHours(), 12);
    assert.equal(neutral.getMinutes(), 0);

    const breakfast = new Date(
      buildHistoricalLoggedAt({ dateKey: "2026-03-25", mealPeriod: "breakfast" }),
    );
    assert.equal(breakfast.getHours(), 8);
    assert.equal(breakfast.getMinutes(), 0);

    const dinner = new Date(
      buildHistoricalLoggedAt({ dateKey: "2026-03-25", mealPeriod: "dinner" }),
    );
    assert.equal(dinner.getHours(), 18);
    assert.equal(dinner.getMinutes(), 30);
  });
});
