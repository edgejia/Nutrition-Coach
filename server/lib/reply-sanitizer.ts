export const SENSITIVE_IDENTIFIER_REPLACEMENTS = [
  ["log_food", "完成記錄"],
  ["find_meals", "查詢餐點"],
  ["get_daily_summary", "查詢今日攝取"],
  ["plan_next_meal", "規劃下一餐"],
  ["update_meal", "更新餐點"],
  ["delete_meal", "刪除餐點"],
  ["update_goals", "更新目標"],
  ["propose_goals", "建議目標"],
  ["propose_meal_numeric_correction", "建議餐點數值修正"],
  ["propose_meal_estimate", "建議餐點估算"],
  ["protein_sources", "蛋白質來源"],
  ["usedConservativeAssumption", "保守假設"],
  ["quantityUncertaintyReason", "份量不確定原因"],
  ["missing_quantity", "缺少份量"],
  ["planningFacts", "規劃依據"],
  ["remainingCalories", "剩餘熱量"],
  ["macroGap", "營養缺口"],
  ["coach_planning", "下一餐建議"],
  ["coach_compact", "營養建議"],
  ["system-prompt.v3", "內部細節"],
  ["llm-trace.v2", "內部細節"],
  ["deviceId", "內部細節"],
  ["revision", "內部細節"],
  ["tool_call", "內部細節"],
  ["model_response", "內部細節"],
  ["providerRequestId", "內部細節"],
  ["errorName", "內部細節"],
  ["errorType", "內部細節"],
  ["errorCode", "內部細節"],
] as const;

export const COUNTER_MARKER_PATTERN = /[（(]\s*\d+\s*\/\s*\d+\s*[）)]/g;
const IDENTIFIER_CHARS = "A-Za-z0-9_-";

const AMBIGUOUS_COUNTER_SUFFIX_PATTERN =
  /([（(]\s*|[（(]\s*\d+\s*|[（(]\s*\d+\s*\/\s*|[（(]\s*\d+\s*\/\s*\d+\s*)$/;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const IDENTIFIER_REPLACEMENT_PATTERNS = SENSITIVE_IDENTIFIER_REPLACEMENTS.map(
  ([identifier, replacement]) => ({
    pattern: new RegExp(`(^|[^${IDENTIFIER_CHARS}])(${escapeRegExp(identifier)})(?=$|[^${IDENTIFIER_CHARS}])`, "gi"),
    replacement,
  }),
);

function precedingCharAllowsIdentifierStart(text: string, prefixLength: number): boolean {
  if (text.length === prefixLength) return true;
  const precedingChar = text[text.length - prefixLength - 1] ?? "";
  return !new RegExp(`[${IDENTIFIER_CHARS}]`).test(precedingChar);
}

function getSensitiveIdentifierOverlapLength(text: string): number {
  const lowerText = text.toLocaleLowerCase();
  const endsWithCompleteIdentifier = SENSITIVE_IDENTIFIER_REPLACEMENTS.some(([identifier]) =>
    lowerText.endsWith(identifier.toLocaleLowerCase()) && precedingCharAllowsIdentifierStart(text, identifier.length),
  );
  if (endsWithCompleteIdentifier) {
    return 0;
  }

  return SENSITIVE_IDENTIFIER_REPLACEMENTS.reduce((maxOverlap, [identifier]) => {
    const lowerIdentifier = identifier.toLocaleLowerCase();
    for (let prefixLength = identifier.length - 1; prefixLength > 0; prefixLength -= 1) {
      if (
        lowerText.endsWith(lowerIdentifier.slice(0, prefixLength))
        && precedingCharAllowsIdentifierStart(text, prefixLength)
      ) {
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
  const sanitized = IDENTIFIER_REPLACEMENT_PATTERNS.reduce(
    (current, { pattern, replacement }) => current.replace(pattern, `$1${replacement}`),
    text,
  );

  return sanitized.replace(COUNTER_MARKER_PATTERN, "");
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
