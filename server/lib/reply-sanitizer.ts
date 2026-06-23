const SENSITIVE_IDENTIFIERS = [
  "log_food",
  "get_daily_summary",
  "plan_next_meal",
  "protein_sources",
  "usedConservativeAssumption",
  "quantityUncertaintyReason",
  "missing_quantity",
  "planningFacts",
  "remainingCalories",
  "macroGap",
  "coach_planning",
  "coach_compact",
] as const;

export const COUNTER_MARKER_PATTERN = /[（(]\s*\d+\s*\/\s*\d+\s*[）)]/g;

const AMBIGUOUS_COUNTER_SUFFIX_PATTERN =
  /([（(]\s*|[（(]\s*\d+\s*|[（(]\s*\d+\s*\/\s*|[（(]\s*\d+\s*\/\s*\d+\s*)$/;

function getSensitiveIdentifierOverlapLength(text: string): number {
  const endsWithCompleteIdentifier = SENSITIVE_IDENTIFIERS.some((identifier) => text.endsWith(identifier));
  if (endsWithCompleteIdentifier) {
    return 0;
  }

  return SENSITIVE_IDENTIFIERS.reduce((maxOverlap, identifier) => {
    for (let prefixLength = identifier.length - 1; prefixLength > 0; prefixLength -= 1) {
      if (text.endsWith(identifier.slice(0, prefixLength))) {
        return Math.max(maxOverlap, prefixLength);
      }
    }

    return maxOverlap;
  }, 0);
}

export function getAmbiguousCounterSuffixLength(text: string): number {
  const match = AMBIGUOUS_COUNTER_SUFFIX_PATTERN.exec(text);
  return match?.[0].length ?? 0;
}

// Last-gate filter: strip internal tool identifiers even when the model ignores
// the system prompt rule. Applied to every reply before DB write and client emit.
export function sanitizeReply(text: string): string {
  return text
    .replace(/log_food/g, "完成記錄")
    .replace(/get_daily_summary/g, "查詢今日攝取")
    .replace(/plan_next_meal/g, "規劃下一餐")
    .replace(/protein_sources/g, "蛋白質來源")
    .replace(/usedConservativeAssumption/g, "保守假設")
    .replace(/quantityUncertaintyReason/g, "份量不確定原因")
    .replace(/missing_quantity/g, "缺少份量")
    .replace(/planningFacts/g, "規劃依據")
    .replace(/remainingCalories/g, "剩餘熱量")
    .replace(/macroGap/g, "營養缺口")
    .replace(/coach_planning/g, "下一餐建議")
    .replace(/coach_compact/g, "營養建議")
    .replace(COUNTER_MARKER_PATTERN, "");
}

export function createStreamingSanitizer() {
  let tail = "";

  return {
    push(token: string): string {
      tail += token;
      const overlapLength = Math.max(
        getSensitiveIdentifierOverlapLength(tail),
        getAmbiguousCounterSuffixLength(tail),
      );

      if (tail.length <= overlapLength) {
        return "";
      }

      const safePrefix = tail.slice(0, tail.length - overlapLength);
      tail = tail.slice(tail.length - overlapLength);
      return sanitizeReply(safePrefix);
    },
    flush(): string {
      const finalChunk = sanitizeReply(tail);
      tail = "";
      return finalChunk;
    },
  };
}
