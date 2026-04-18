/**
 * Numeric source-text authorization guard (Phase 10, GOAL-06).
 *
 * Given a set of numeric fields on a proposed tool call and the surrounding
 * conversational text (current user turn + immediately previous assistant
 * message only, per D-09), emit the set of numeric string candidates that the
 * user or assistant explicitly stated. The LLM is only authorized to mutate a
 * numeric field when the exact value it proposes appears (after comma /
 * whitespace / Chinese-numeral normalization) in that narrow scope.
 *
 * This guard is deliberately narrow:
 *   - It does not scan older history (D-09).
 *   - It does not apply any ±N% tolerance (D-10).
 *   - It rejects approximate suffixes such as `多` (e.g. `兩千多`, `1800多`).
 *   - It supports only common Chinese numeral compounds with base units
 *     `千`, `百`, `十`, and the colloquial `X千Y` / `X百Y` shorthand that
 *     native speakers use (`一千八` -> 1800, `一百二` -> 120).
 */

export interface SourceGuardContext {
  currentUserMessage: string;
  previousAssistantMessage?: string;
}

export interface SourceGuardResult {
  ok: boolean;
  guardedFields: string[];
}

const CHINESE_DIGIT: Record<string, number> = {
  零: 0,
  一: 1,
  二: 2,
  兩: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

const APPROX_SUFFIX = "多";

function hasExplicitConfirmation(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!normalized) return false;

  if (/(不要|不用|不行|不好|不是|不對|取消|先不要|先不用|no|not)/i.test(normalized)) {
    return false;
  }

  if (/^(好|可以|可|是|對|嗯|恩|ok|okay|yes|y|sure)$/.test(normalized)) {
    return true;
  }
  if (/(^|[，,。!！、])(好|可以|可|是|對|ok|okay|yes|y|sure)($|[，,。!！、])/.test(normalized)) {
    return true;
  }

  return /(幫我|直接)?(更新|套用|改成|照這樣|就這樣|用這組|照這組)/.test(normalized);
}

function stripFormatting(text: string): string {
  // Remove ASCII commas, Chinese commas, and all whitespace; keep the
  // `多` marker so we can still reject approximate runs after stripping.
  return text.replace(/[,\s，]/g, "");
}

/**
 * Parse a single Chinese numeral compound starting at `start` in `text`.
 * Returns the numeric value and the index immediately after the consumed run,
 * or `null` if no valid numeral starts there.
 */
function parseChineseNumeralAt(
  text: string,
  start: number,
): { value: number; end: number } | null {
  let i = start;
  const len = text.length;

  // Leading 十 case: e.g. 十 / 十五
  if (text[i] === "十") {
    let value = 10;
    i += 1;
    if (i < len && CHINESE_DIGIT[text[i]] !== undefined) {
      value += CHINESE_DIGIT[text[i]];
      i += 1;
    }
    return { value, end: i };
  }

  const leading = CHINESE_DIGIT[text[i]];
  if (leading === undefined) return null;

  // Leading digit only, no unit -> not a multi-digit compound; don't treat a
  // bare 一/二/三 as an authorized compound. Return null so we don't emit.
  if (i + 1 >= len) return null;

  const secondChar = text[i + 1];
  if (secondChar !== "千" && secondChar !== "百" && secondChar !== "十") {
    return null;
  }

  let value = 0;
  let cursor = i;

  // 千 position
  if (text[cursor + 1] === "千") {
    value += leading * 1000;
    cursor += 2;
    if (cursor >= len) return { value, end: cursor };
    // after 千: may be 零?, 一~九 followed by 百/十/<end>, or 百-unit, or 十-unit
    const nextCh = text[cursor];
    const nextDigit = CHINESE_DIGIT[nextCh];
    if (nextCh === "零") {
      // `一千零八` -> 1008 style
      cursor += 1;
      if (cursor < len) {
        const d = CHINESE_DIGIT[text[cursor]];
        if (d !== undefined) {
          value += d;
          cursor += 1;
        }
      }
      return { value, end: cursor };
    }
    if (nextDigit !== undefined) {
      // Look ahead: X千Y百..., X千Y十..., X千Y (colloquial)
      const afterDigit = text[cursor + 1];
      if (afterDigit === "百") {
        value += nextDigit * 100;
        cursor += 2;
        if (cursor >= len) return { value, end: cursor };
        const d2 = CHINESE_DIGIT[text[cursor]];
        if (d2 !== undefined && text[cursor + 1] === "十") {
          value += d2 * 10;
          cursor += 2;
          const d3 = CHINESE_DIGIT[text[cursor]];
          if (d3 !== undefined) {
            value += d3;
            cursor += 1;
          }
        } else if (d2 !== undefined) {
          // `一千二百三` colloquial -> 1230; uncommon but allow
          value += d2 * 10;
          cursor += 1;
        }
        return { value, end: cursor };
      }
      if (afterDigit === "十") {
        value += nextDigit * 10;
        cursor += 2;
        const d3 = CHINESE_DIGIT[text[cursor]];
        if (d3 !== undefined) {
          value += d3;
          cursor += 1;
        }
        return { value, end: cursor };
      }
      // Colloquial X千Y -> X*1000 + Y*100
      value += nextDigit * 100;
      cursor += 1;
      return { value, end: cursor };
    }
    return { value, end: cursor };
  }

  // 百 position (no 千 prefix)
  if (text[cursor + 1] === "百") {
    value += leading * 100;
    cursor += 2;
    if (cursor >= len) return { value, end: cursor };
    const nextCh = text[cursor];
    const nextDigit = CHINESE_DIGIT[nextCh];
    if (nextCh === "零") {
      cursor += 1;
      if (cursor < len) {
        const d = CHINESE_DIGIT[text[cursor]];
        if (d !== undefined) {
          value += d;
          cursor += 1;
        }
      }
      return { value, end: cursor };
    }
    if (nextDigit !== undefined) {
      const afterDigit = text[cursor + 1];
      if (afterDigit === "十") {
        value += nextDigit * 10;
        cursor += 2;
        const d3 = CHINESE_DIGIT[text[cursor]];
        if (d3 !== undefined) {
          value += d3;
          cursor += 1;
        }
        return { value, end: cursor };
      }
      // Colloquial X百Y -> X*100 + Y*10
      value += nextDigit * 10;
      cursor += 1;
      return { value, end: cursor };
    }
    return { value, end: cursor };
  }

  // 十 position (no 千/百 prefix): X十Y e.g. 二十五
  if (text[cursor + 1] === "十") {
    value += leading * 10;
    cursor += 2;
    if (cursor < len) {
      const d = CHINESE_DIGIT[text[cursor]];
      if (d !== undefined) {
        value += d;
        cursor += 1;
      }
    }
    return { value, end: cursor };
  }

  return null;
}

/**
 * Emit all numeric candidates authorized by `text`. Candidates are returned as
 * stringified integers so callers can compare directly against tool args.
 *
 * Arabic runs followed by `多` are dropped. Chinese compounds followed by
 * `多` are also dropped.
 */
export function normalizeNumericSourceText(text: string): string[] {
  const stripped = stripFormatting(text);
  const candidates = new Set<string>();

  // Arabic digit runs
  const digitRe = /\d+/g;
  let match: RegExpExecArray | null;
  while ((match = digitRe.exec(stripped)) !== null) {
    const end = match.index + match[0].length;
    const nextCh = stripped[end];
    if (nextCh === APPROX_SUFFIX) continue;
    candidates.add(match[0].replace(/^0+/, "") || "0");
  }

  // Chinese numeral compounds
  let i = 0;
  while (i < stripped.length) {
    const parsed = parseChineseNumeralAt(stripped, i);
    if (parsed) {
      const nextCh = stripped[parsed.end];
      if (nextCh !== APPROX_SUFFIX) {
        candidates.add(String(parsed.value));
      }
      i = parsed.end;
      continue;
    }
    i += 1;
  }

  return [...candidates];
}

/**
 * Authorize each `sourceField` by checking that the proposed numeric value
 * appears in the current user message or the immediately previous assistant
 * message (D-09). Fields whose value is `undefined` are skipped so partial
 * updates remain possible.
 */
export function checkSourceFields(
  args: Record<string, unknown>,
  sourceFields: readonly string[],
  context: SourceGuardContext,
): SourceGuardResult {
  const userCandidates = normalizeNumericSourceText(context.currentUserMessage ?? "");
  const assistantCandidates = context.previousAssistantMessage
    ? normalizeNumericSourceText(context.previousAssistantMessage)
    : [];
  const userAllowed = new Set<string>(userCandidates);
  const assistantAllowed = new Set<string>(assistantCandidates);
  const confirmedAssistantRecommendation = hasExplicitConfirmation(
    context.currentUserMessage ?? "",
  );

  const guardedFields: string[] = [];
  for (const field of sourceFields) {
    const value = args[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      // Non-numeric values cannot satisfy a numeric guard; reject.
      guardedFields.push(field);
      continue;
    }
    const key = String(value);
    if (userAllowed.has(key)) {
      continue;
    }
    if (assistantAllowed.has(key) && confirmedAssistantRecommendation) {
      continue;
    }
    guardedFields.push(field);
  }

  return { ok: guardedFields.length === 0, guardedFields };
}
