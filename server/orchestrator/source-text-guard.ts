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

export type SourceEvidenceScope = "current_turn" | "previous_assistant";
export type SourceEvidenceUnit = "kcal" | "g" | "implicit";
export type SourceEvidenceField = "calories" | "protein" | "carbs" | "fat" | "unknown";

/**
 * A numeric fact is useful for authorization only when its field, unit, and
 * conversational scope are retained together.  The old guard intentionally
 * exposed only a global candidate set; keeping this richer record here makes
 * it impossible for a protein number to satisfy a carbs/calories check.
 */
export interface NumericSourceEvidence {
  field: SourceEvidenceField;
  unit: SourceEvidenceUnit;
  value: number;
  scope: SourceEvidenceScope;
  affirmative: boolean;
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
const NUTRITION_UNIT_CHARS = new Set(["g", "G", "克", "卡"]);

const GOAL_PROPOSAL_CONSENT_PATTERNS = [
  /^(好|可以|幫我更新|就這樣|用這組|ok|okay|yes|y|sure)(?:$|[，,。!！、]|但)/i,
  /^套用(?:每日)?目標(?:更新)?$/i,
] as const;
const GOAL_PROPOSAL_CANCEL_PATTERNS = [
  /^(不要|取消|先不用|不用|不好|不可以|不行|不是|不對|no|nope|not)$/i,
  /^(先)?不要/,
] as const;

const TOOL_LIKE_MARKER_PATTERN =
  /(?:"(?:role|name|content)"\s*:|(?:function_call|tool_call|tool_result|arguments)\s*:|tool_call\b|tool_result\b)/gi;

const FIELD_LABELS: ReadonlyArray<{
  field: Exclude<SourceEvidenceField, "unknown">;
  pattern: RegExp;
}> = [
  { field: "calories", pattern: /(?:calories?|kcal|卡路里|熱量|大卡|卡)/iy },
  { field: "protein", pattern: /(?:protein|蛋白質|蛋白)/iy },
  { field: "carbs", pattern: /(?:carbohydrates?|carbs?|碳水化合物|碳水)/iy },
  { field: "fat", pattern: /(?:fats?|脂肪)/iy },
];

const FIELD_LABEL_SCAN =
  /(?:calories?|kcal|卡路里|熱量|大卡|卡|protein|蛋白質|蛋白|carbohydrates?|carbs?|碳水化合物|碳水|fats?|脂肪)/giu;
const TARGET_LABEL_SCAN = /(?:每日目標|日目標|daily\s+target|target|goal|目標)/giu;
const DIGIT_MAP: Record<string, string> = {
  "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
  "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

const FIELD_NEGATION_PATTERN =
  /(?:不要|別|不是|不想|不可|不應|不該|拒絕|避免|否認|不能|無法|do\s+not|don't|dont|not|never|without|avoid|cannot|can't|cant|no)\s*$/iu;
const AFFIRMATIVE_ACTION_PATTERN =
  /(?:改成|改為|改到|變成|換成|調成|設成|設定為|set\s+to|change\s+to|make\s+it)\s*$/iu;
const NUMERIC_TOKEN_PATTERN = /\d+(?:[\s,，]\d{3})*(?:[.．]\d+)?/gu;
const UNIT_PATTERN = /^(kcal|calories?|卡路里|大卡|卡|g|grams?|克|公克)/iu;
const SENTENCE_BOUNDARY_PATTERN = /[。！？!?；;.\n]/u;

function canonicalizeNumericText(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[０-９٠-٩۰-۹]/g, (digit) => DIGIT_MAP[digit] ?? digit)
    .replace(/[，﹐、]/g, ",")
    .replace(/[．﹒]/g, ".")
    .replace(/[：﹕]/g, ":");
}

function replaceRangeWithSpaces(text: string, start: number, end: number): string {
  return text.slice(0, start) + " ".repeat(Math.max(0, end - start)) + text.slice(end);
}

function findBalancedSpanEnd(text: string, start: number, open: string, close: string): number | null {
  let depth = 0;
  let quote: "\"" | "'" | null = null;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === open) {
      depth += 1;
      continue;
    }
    if (ch === close) {
      depth -= 1;
      if (depth === 0) {
        return i + 1;
      }
      if (depth < 0) {
        return null;
      }
    }
  }

  return null;
}

function maskBalancedDelimitedSpans(input: string): string {
  let text = input;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const close = ch === "{" ? "}" : ch === "[" ? "]" : undefined;
    if (!close) continue;
    const end = findBalancedSpanEnd(text, i, ch, close);
    if (end === null) continue;
    text = replaceRangeWithSpaces(text, i, end);
    i = end - 1;
  }
  return text;
}

function maskFunctionCallSpans(input: string): string {
  let text = input;
  const callPattern = /\b[A-Za-z_][A-Za-z0-9_]*\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = callPattern.exec(text)) !== null) {
    const openIndex = match.index + match[0].lastIndexOf("(");
    const end = findBalancedSpanEnd(text, openIndex, "(", ")");
    if (end === null) continue;
    text = replaceRangeWithSpaces(text, match.index, end);
    callPattern.lastIndex = end;
  }
  return text;
}

function maskToolLikeMarkerSpans(input: string): string {
  let text = input;
  let match: RegExpExecArray | null;
  TOOL_LIKE_MARKER_PATTERN.lastIndex = 0;
  while ((match = TOOL_LIKE_MARKER_PATTERN.exec(text)) !== null) {
    const lineEndIndex = text.indexOf("\n", match.index);
    const end = lineEndIndex === -1 ? text.length : lineEndIndex;
    text = replaceRangeWithSpaces(text, match.index, end);
    TOOL_LIKE_MARKER_PATTERN.lastIndex = end;
  }
  return text;
}

export function stripToolLikeRegions(text: string): string {
  return maskToolLikeMarkerSpans(
    maskFunctionCallSpans(
      maskBalancedDelimitedSpans(text),
    ),
  );
}

function normalizeGoalProposalDecisionText(message: string): string {
  return message.trim().toLowerCase().replace(/\s+/g, "");
}

export function isGoalProposalCancel(message: string): boolean {
  const normalized = normalizeGoalProposalDecisionText(message);
  return normalized.length > 0
    && GOAL_PROPOSAL_CANCEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isGoalProposalConsent(message: string): boolean {
  const normalized = normalizeGoalProposalDecisionText(message);
  if (!normalized || isGoalProposalCancel(message)) return false;
  return GOAL_PROPOSAL_CONSENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

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

interface NumericToken {
  value: number;
  start: number;
  end: number;
}

function normalizeParsedNumericValue(value: number): number {
  return Number(Number(value).toFixed(3));
}

function numericTokensInText(input: string): NumericToken[] {
  const text = canonicalizeNumericText(input);
  const tokens: NumericToken[] = [];
  const occupied = new Set<number>();

  NUMERIC_TOKEN_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(NUMERIC_TOKEN_PATTERN)) {
    const raw = match[0] ?? "";
    const start = match.index ?? 0;
    const end = start + raw.length;
    const next = text.slice(end).replace(/^\s+/u, "");
    if (next.startsWith(APPROX_SUFFIX)) continue;
    const value = Number(raw.replace(/[\s,，]/g, ""));
    if (Number.isFinite(value)) {
      tokens.push({ value: normalizeParsedNumericValue(value), start, end });
      for (let index = start; index < end; index += 1) occupied.add(index);
    }
  }

  let index = 0;
  while (index < text.length) {
    if (occupied.has(index)) {
      index += 1;
      continue;
    }
    const parsed = parseChineseNumeralAt(text, index);
    if (parsed) {
      if (text[parsed.end] !== APPROX_SUFFIX) {
        tokens.push({
          value: normalizeParsedNumericValue(parsed.value),
          start: index,
          end: parsed.end,
        });
      }
      index = parsed.end;
      continue;
    }

    const bareValue = CHINESE_DIGIT[text[index] ?? ""];
    if (bareValue !== undefined) {
      const after = text.slice(index + 1).replace(/^\s+/u, "");
      const hasUnit = /^(?:kcal|calories?|卡路里|大卡|卡|g|grams?|克|公克)/iu.test(after);
      const prefix = text.slice(Math.max(0, index - 16), index);
      const hasFinalAction = AFFIRMATIVE_ACTION_PATTERN.test(prefix.replace(/\s+/g, ""));
      const hasFieldLabel = /(?:calories?|kcal|卡路里|熱量|大卡|卡|protein|蛋白質|蛋白|carbohydrates?|carbs?|碳水化合物|碳水|fats?|脂肪)\s*$/iu.test(prefix);
      if (hasUnit || hasFinalAction || hasFieldLabel) {
        tokens.push({
          value: bareValue,
          start: index,
          end: index + 1,
        });
      }
    }
    index += 1;
  }

  return tokens.sort((left, right) => left.start - right.start || left.end - right.end);
}

function unitAfterToken(text: string, end: number): SourceEvidenceUnit {
  const suffix = text.slice(end).replace(/^[\s:：]+/u, "");
  const match = suffix.match(UNIT_PATTERN);
  if (!match) return "implicit";
  return /^(?:g|grams?|克|公克)$/iu.test(match[1] ?? "") ? "g" : "kcal";
}

function fieldFromLabel(label: string): Exclude<SourceEvidenceField, "unknown"> | undefined {
  const normalized = label.toLocaleLowerCase("en-US");
  if (/^(?:calories?|kcal|卡路里|熱量|大卡|卡)$/iu.test(normalized)) return "calories";
  if (/^(?:protein|蛋白質|蛋白)$/iu.test(normalized)) return "protein";
  if (/^(?:carbohydrates?|carbs?|碳水化合物|碳水)$/iu.test(normalized)) return "carbs";
  if (/^(?:fats?|脂肪)$/iu.test(normalized)) return "fat";
  return undefined;
}

function fieldLabelsInText(text: string): Array<{ field: Exclude<SourceEvidenceField, "unknown">; start: number; end: number }> {
  const labels: Array<{ field: Exclude<SourceEvidenceField, "unknown">; start: number; end: number }> = [];
  FIELD_LABEL_SCAN.lastIndex = 0;
  for (const match of text.matchAll(FIELD_LABEL_SCAN)) {
    const label = match[0] ?? "";
    const field = fieldFromLabel(label);
    if (field) {
      labels.push({ field, start: match.index ?? 0, end: (match.index ?? 0) + label.length });
    }
  }
  return labels;
}

function hasTargetLabelBefore(text: string, start: number): boolean {
  TARGET_LABEL_SCAN.lastIndex = 0;
  for (const match of text.matchAll(TARGET_LABEL_SCAN)) {
    const matchStart = match.index ?? 0;
    if (matchStart >= start) break;
    if (!SENTENCE_BOUNDARY_PATTERN.test(text.slice(matchStart + (match[0]?.length ?? 0), start))) {
      return true;
    }
  }
  return false;
}

function hasGoalActionBefore(text: string, start: number): boolean {
  const prefix = text.slice(Math.max(0, start - 40), start).replace(/\s+/g, "");
  return /(?:改成|改為|改到|變成|換成|調成|設成|設定為|套用|setto|changeto|makeit|apply)[^。！？!?；;\n]*$/iu.test(prefix);
}

function hasNegatedNumericPrefix(text: string, start: number): boolean {
  const prefix = text.slice(Math.max(0, start - 56), start);
  const clauseStart = Math.max(
    prefix.lastIndexOf("。"),
    prefix.lastIndexOf("！"),
    prefix.lastIndexOf("!"),
    prefix.lastIndexOf("？"),
    prefix.lastIndexOf("?"),
    prefix.lastIndexOf("；"),
    prefix.lastIndexOf(";"),
    prefix.lastIndexOf("."),
    prefix.lastIndexOf("，"),
    prefix.lastIndexOf(","),
    prefix.lastIndexOf("\n"),
  );
  const clause = prefix.slice(clauseStart + 1).replace(/\s+/g, "");
  if (!clause) return false;
  if (FIELD_NEGATION_PATTERN.test(clause)) return true;
  return /^(?:不要|別|不是|不想|不可|不應|不該|拒絕|避免|否認|不能|無法|do not|don't|dont|not|never|without|avoid|cannot|can't|cant|no)[^。！？!?；;，,\n]{0,48}(?:改成|改為|改到|變成|換成|調成|設成|setto|changeto|makeit)?$/iu.test(clause);
}

function fieldUnitMatches(field: Exclude<SourceEvidenceField, "unknown">, unit: SourceEvidenceUnit): boolean {
  if (unit === "implicit") return true;
  return field === "calories" ? unit === "kcal" : unit === "g";
}

/**
 * Extract field-scoped, unit-aware numeric evidence.  Values with an
 * incompatible explicit unit are retained as non-authorizing evidence so the
 * caller can distinguish an absent fact from a rejected unit without ever
 * falling back to a global candidate set.
 */
export function extractNumericSourceEvidence(
  input: string,
  scope: SourceEvidenceScope = "current_turn",
): NumericSourceEvidence[] {
  const text = canonicalizeNumericText(stripToolLikeRegions(canonicalizeNumericText(input ?? "")));
  const labels = fieldLabelsInText(text);
  const tokens = numericTokensInText(text);
  const evidence: NumericSourceEvidence[] = [];

  for (const token of tokens) {
    const unit = unitAfterToken(text, token.end);
    const precedingLabels = labels.filter((label) => label.start < token.start);
    const nearestLabel = precedingLabels.at(-1);
    const separatedByBoundary = nearestLabel
      ? SENTENCE_BOUNDARY_PATTERN.test(text.slice(nearestLabel.end, token.start))
      : true;
    let field = !separatedByBoundary && nearestLabel
      ? nearestLabel.field
      : undefined;

    // "每日目標 1800 kcal" has no explicit macro label but the unit and
    // target scope make calories unambiguous.  A bare target number is kept
    // unknown and therefore cannot authorize a specific field.
    if (!field && unit === "kcal" && hasTargetLabelBefore(text, token.start)) {
      field = "calories";
    }
    // A bare exact target such as "改成 1200" is unambiguous against the
    // bounded macro schemas (protein <= 400, carbs <= 1000, fat <= 300).
    // Keep lower or context-free bare numbers unknown so they cannot widen
    // authority from one field to another.
    if (!field && unit === "implicit" && token.value > 1000 && hasGoalActionBefore(text, token.start)) {
      field = "calories";
    }
    if (!field) continue;

    const affirmative = !hasNegatedNumericPrefix(text, token.start);
    if (fieldUnitMatches(field, unit) || unit === "implicit") {
      evidence.push({ field, unit, value: token.value, scope, affirmative });
    } else {
      evidence.push({ field, unit, value: token.value, scope, affirmative: false });
    }
  }

  return evidence;
}

/**
 * Emit all numeric candidates authorized by `text`. Candidates are returned as
 * stringified numbers so callers can compare directly against tool args.
 *
 * Arabic runs followed by `多` are dropped. Chinese compounds followed by
 * `多` are also dropped.
 */
export function normalizeNumericSourceText(text: string): string[] {
  const stripped = stripFormatting(stripToolLikeRegions(canonicalizeNumericText(text ?? "")));
  const candidates = new Set<string>();

  // Arabic digit runs, including decimal final targets.
  const digitRe = /\d+(?:\.\d+)?/g;
  let match: RegExpExecArray | null;
  while ((match = digitRe.exec(stripped)) !== null) {
    const end = match.index + match[0].length;
    const nextCh = stripped[end];
    if (nextCh === APPROX_SUFFIX) continue;
    const normalized = Number(match[0]);
    if (Number.isFinite(normalized)) {
      candidates.add(String(normalized));
    }
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

    const bareDigit = CHINESE_DIGIT[stripped[i]];
    const nextCh = stripped[i + 1];
    if (bareDigit !== undefined && nextCh !== APPROX_SUFFIX && nextCh && NUTRITION_UNIT_CHARS.has(nextCh)) {
      candidates.add(String(bareDigit));
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
  const userEvidence = extractNumericSourceEvidence(
    context.currentUserMessage ?? "",
    "current_turn",
  );
  const assistantEvidence = context.previousAssistantMessage
    ? extractNumericSourceEvidence(context.previousAssistantMessage, "previous_assistant")
    : [];
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
    const canonicalField = fieldFromLabel(field) ?? (
      field === "calories" || field === "protein" || field === "carbs" || field === "fat"
        ? field
        : undefined
    );
    const expected = normalizeParsedNumericValue(value);
    const currentMatch = canonicalField
      ? userEvidence.some((evidence) => (
        evidence.field === canonicalField
        && evidence.value === expected
        && evidence.affirmative
      ))
      : normalizeNumericSourceText(context.currentUserMessage ?? "").includes(String(expected));
    const previousMatch = canonicalField
      ? assistantEvidence.some((evidence) => (
        evidence.field === canonicalField
        && evidence.value === expected
        && evidence.affirmative
      ))
      : normalizeNumericSourceText(context.previousAssistantMessage ?? "").includes(String(expected));
    if (currentMatch || (previousMatch && confirmedAssistantRecommendation)) {
      continue;
    }
    guardedFields.push(field);
  }

  return { ok: guardedFields.length === 0, guardedFields };
}
