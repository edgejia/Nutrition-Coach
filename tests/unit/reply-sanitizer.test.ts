import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  createStreamingSanitizer,
  getAmbiguousCounterSuffixLength,
  sanitizeReply,
} from "../../server/lib/reply-sanitizer.js";

const COUNTER_TEXT_PATTERN = /[（(]\s*\d+\s*\/\s*\d+\s*[）)]/;
const PLANNING_IDENTIFIER_REPLACEMENTS = [
  ["plan_next_meal", "規劃下一餐"],
  ["planningFacts", "規劃依據"],
  ["remainingCalories", "剩餘熱量"],
  ["macroGap", "營養缺口"],
  ["coach_planning", "下一餐建議"],
  ["coach_compact", "營養建議"],
] as const;

describe("reply sanitizer", () => {
  it("removes complete nutrition counters with ASCII and full-width parentheses", () => {
    assert.equal(sanitizeReply("早餐 (1/3) 完成"), "早餐  完成");
    assert.equal(sanitizeReply("早餐 ( 1 / 3 ) 完成"), "早餐  完成");
    assert.equal(sanitizeReply("早餐 （1/3） 完成"), "早餐  完成");
    assert.equal(sanitizeReply("早餐 （ 1 / 3 ） 完成"), "早餐  完成");
  });

  it("holds ambiguous counter suffixes until the stream can sanitize or release them", () => {
    assert.equal(getAmbiguousCounterSuffixLength("今天("), 1);
    assert.equal(getAmbiguousCounterSuffixLength("今天(1"), 2);
    assert.equal(getAmbiguousCounterSuffixLength("今天(1/"), 3);
    assert.equal(getAmbiguousCounterSuffixLength("今天(1/3"), 4);
    assert.equal(getAmbiguousCounterSuffixLength("今天（ 12 / 30"), "（ 12 / 30".length);
    assert.equal(getAmbiguousCounterSuffixLength("今天(一"), 0);
  });

  it("does not expose adjacent split ASCII counters in any pushed chunk", () => {
    const sanitizer = createStreamingSanitizer();
    const emitted = [
      sanitizer.push("今天"),
      sanitizer.push("(1"),
      sanitizer.push("/3)"),
      sanitizer.push("完成"),
      sanitizer.flush(),
    ];

    assert.deepEqual(emitted, ["今天", "", "", "完成", ""]);
    assert.equal(emitted.join(""), "今天完成");
    for (const chunk of emitted) {
      assert.doesNotMatch(chunk, COUNTER_TEXT_PATTERN);
      assert.doesNotMatch(chunk, /\(1|\/3\)/);
    }
  });

  it("does not expose adjacent split full-width counters in any pushed chunk", () => {
    const sanitizer = createStreamingSanitizer();
    const emitted = [
      sanitizer.push("今天"),
      sanitizer.push("（2"),
      sanitizer.push("/4）"),
      sanitizer.push("完成"),
      sanitizer.flush(),
    ];

    assert.deepEqual(emitted, ["今天", "", "", "完成", ""]);
    assert.equal(emitted.join(""), "今天完成");
    for (const chunk of emitted) {
      assert.doesNotMatch(chunk, COUNTER_TEXT_PATTERN);
      assert.doesNotMatch(chunk, /（2|\/4）/);
    }
  });

  it("releases ordinary parentheses after they can no longer become counters", () => {
    const sanitizer = createStreamingSanitizer();
    const emitted = [
      sanitizer.push("提示"),
      sanitizer.push("("),
      sanitizer.push("abc"),
      sanitizer.push(")"),
      sanitizer.flush(),
    ];

    assert.deepEqual(emitted, ["提示", "", "(abc", ")", ""]);
    assert.equal(emitted.join(""), "提示(abc)");
  });

  it("flushes held tails through the finalized sanitizer without dropping ordinary text", () => {
    const counterSanitizer = createStreamingSanitizer();
    assert.equal(counterSanitizer.push("今天(1/3"), "今天");
    assert.equal(counterSanitizer.flush(), "(1/3");

    const ordinarySanitizer = createStreamingSanitizer();
    assert.equal(ordinarySanitizer.push("請看("), "請看");
    assert.equal(ordinarySanitizer.flush(), "(");
  });

  it("replaces Phase 102 planning internals with exact Traditional Chinese copy", () => {
    for (const [identifier, replacement] of PLANNING_IDENTIFIER_REPLACEMENTS) {
      const sanitized = sanitizeReply(`請依 ${identifier} 回答`);

      assert.equal(sanitized, `請依 ${replacement} 回答`);
      assert.doesNotMatch(sanitized, new RegExp(identifier));
    }
  });

  it("replaces all Phase 102 planning internals in a full reply", () => {
    const sanitized = sanitizeReply(
      "plan_next_meal used planningFacts: remainingCalories and macroGap for coach_planning / coach_compact.",
    );

    assert.equal(
      sanitized,
      "規劃下一餐 used 規劃依據: 剩餘熱量 and 營養缺口 for 下一餐建議 / 營養建議.",
    );
    for (const [identifier] of PLANNING_IDENTIFIER_REPLACEMENTS) {
      assert.doesNotMatch(sanitized, new RegExp(identifier));
    }
  });

  it("does not expose split planning tool or field identifiers in streamed chunks", () => {
    const sanitizer = createStreamingSanitizer();
    const emitted = [
      sanitizer.push("先用 plan_"),
      sanitizer.push("next_"),
      sanitizer.push("meal 看 "),
      sanitizer.push("remaining"),
      sanitizer.push("Calories"),
      sanitizer.push("。"),
      sanitizer.flush(),
    ];

    assert.equal(emitted.join(""), "先用 規劃下一餐 看 剩餘熱量。");
    for (const chunk of emitted) {
      assert.doesNotMatch(chunk, /plan_|next_|meal|remaining|Calories|plan_next_meal|remainingCalories/);
    }
  });

  it("keeps markdown table and bullet truncation out of the shared sanitizer", () => {
    const source = readFileSync("server/lib/reply-sanitizer.ts", "utf8");

    assert.doesNotMatch(source, /markdown|table|pipe table/i);
    assert.doesNotMatch(source, /bullet|MAX_COACH_REPLY_BULLETS|slice\(0,\s*5\)/);
    assert.equal(sanitizeReply("| A | B |\n|---|---|\n| 1 | 2 |"), "| A | B |\n|---|---|\n| 1 | 2 |");
  });
});
