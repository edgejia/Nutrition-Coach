import type { DailyTargets } from "../services/device.js";
import { stripToolLikeRegions } from "./source-text-guard.js";

export const NUTRITION_SAFETY_CALORIE_FLOOR = 1200;
export const UNSAFE_CALORIE_FLOOR_REASON = "unsafe_calorie_floor";

export type NutritionSafetyFailureReason = typeof UNSAFE_CALORIE_FLOOR_REASON;

export interface NutritionSafetyBoundaryDecision {
  safe: boolean;
  canonicalText: string;
  reason?: "unsafe_nutrition_guidance";
}

export interface BufferedNutritionReply {
  reply: string;
  usedFallback: boolean;
}

export type NutritionSafetyTargetCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: NutritionSafetyFailureReason;
      floor: typeof NUTRITION_SAFETY_CALORIE_FLOOR;
      fields: ["calories"];
    };

const CALORIE_GUIDANCE_PATTERNS = [
  /(?:每天|每日|目標|設定|只吃).{0,12}(?<![0-9０-９.．,，])([0-9０-９]+(?:[,，][0-9０-９]+)*(?:[.．][0-9０-９]+)?)\s*(?:kcal|卡路里|卡|大卡)/gd,
  /(?<![0-9０-９.．,，])([0-9０-９]+(?:[,，][0-9０-９]+)*(?:[.．][0-9０-９]+)?)\s*(?:kcal|卡路里|卡|大卡).{0,12}(?:每天|每日|目標|設定|只吃)/gd,
  /(?:eat|eating|only|limit|target|goal).{0,16}(?<![0-9.,])([0-9]+(?:,\d{3})*(?:\.\d+)?)\s*(?:kcal|calories?)(?:.{0,16}(?:per day|daily|a day))?/gid,
  /(?<![0-9.,])([0-9]+(?:,\d{3})*(?:\.\d+)?)\s*(?:kcal|calories?).{0,16}(?:per day|daily|a day|only|limit|target|goal)/gid,
] as const;
// Sub-floor numbers that describe an adjustment amount (調降 200 kcal) rather
// than an absolute daily target must not count as unsafe guidance. Verb forms
// that bind an absolute value (降到/降至/改成/設成) end with 到/至/成 and thus
// do not match this suffix pattern.
const CALORIE_DELTA_CONTEXT_SUFFIX_PATTERN =
  /(?:調降|下修|下調|往下調|下降|調低|降低|減少|再降|再減|削減|減|少|by)\s*$/i;
// Sub-floor kcal amounts attached to a single macro's gram line (蛋白質140g（約
// 560 kcal）) are a per-macro breakdown, not a daily calorie target. A sentence
// boundary or a combined-sum marker (共/總/合計) between the gram amount and the
// kcal amount disqualifies the exclusion so totals stay guarded.
const PER_MACRO_BREAKDOWN_PREFIX_PATTERN =
  /(?:蛋白質|碳水(?:化合物)?|脂肪)\s*[0-9０-９]+(?:[.．][0-9０-９]+)?\s*(?:g|克|公克)(?<tail>[^0-9０-９]*)$/;
const MEAL_SLOT_CALORIE_PATTERN =
  /(?:早餐|早上|午餐|中午|晚餐|晚上|宵夜|breakfast|lunch|dinner).{0,12}(?<![0-9０-９.．,，])([0-9０-９]+(?:[,，][0-9０-９]+)*(?:[.．][0-9０-９]+)?)\s*(?:kcal|卡路里|卡|大卡|calories?)/gi;
const LOGGED_INTAKE_CONTEXT_PATTERN =
  /(?:已記錄|紀錄|記錄了|收到|吃了|喝了|飲用|攝取|\b(?:logged|recorded|ate|drank|consumed)\b)/i;
const UNSAFE_NUTRITION_HARMFUL_TARGET_PATTERNS = [
  { id: "very_low_calorie_goal", pattern: /(?:極低熱量|超低熱量|低到最低).{0,12}(?:目標|菜單|飲食)/g },
] as const;
const UNSAFE_NUTRITION_RESTRICTIVE_PLAN_PATTERNS = [
  { id: "multi_day_no_food", pattern: /(?:三天|兩天|七天|一週).{0,10}(?:完全不吃|不吃東西|禁食|只喝水)/g },
  { id: "stepwise_fasting_plan", pattern: /(?:第一天|第1天).{0,24}(?:第二天|第2天).{0,24}(?:禁食|只喝水|不吃)/g },
] as const;
const UNSAFE_NUTRITION_RAPID_LOSS_PATTERNS = [
  { id: "rapid_10kg_loss", pattern: /(?:一週|七天|最快|短時間).{0,12}(?:瘦|減).{0,8}(?:10|十)\s*(?:kg|公斤)/g },
  { id: "rapid_weight_loss_speed", pattern: /(?:快速|最快).{0,10}(?:瘦身|減重).{0,10}(?:目標|速度|公斤)/g },
] as const;
const UNSAFE_NUTRITION_PUNITIVE_EXERCISE_PATTERNS = [
  { id: "punishment_workout", pattern: /(?:懲罰|補償).{0,12}(?:運動|跑步|訓練)/g },
  { id: "exercise_to_offset_eating", pattern: /(?:吃太多|罪惡|內疚).{0,18}(?:跑步|運動|少吃|禁食)/g },
] as const;

const SAFETY_DIGIT_MAP: Record<string, string> = {
  "０": "0", "１": "1", "２": "2", "３": "3", "４": "4",
  "５": "5", "６": "6", "７": "7", "８": "8", "９": "9",
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
  "۰": "0", "۱": "1", "۲": "2", "۳": "3", "۴": "4",
  "۵": "5", "۶": "6", "۷": "7", "۸": "8", "۹": "9",
};

/** Canonicalize only bounded numeric/spacing variants; preserve user language. */
export function canonicalizeNutritionSafetyText(answer: string): string {
  return (answer ?? "")
    .normalize("NFKC")
    .replace(/[０-９٠-٩۰-۹]/g, (digit) => SAFETY_DIGIT_MAP[digit] ?? digit)
    .replace(/[，﹐]/g, ",")
    .replace(/[．﹒]/g, ".")
    .replace(/[\u2000-\u200B\u202F\u205F\u3000]/g, " ");
}

export interface UnsafeNutritionGuidanceAnalysis {
  matchedHarmfulTargetIds: string[];
  matchedRestrictivePlanIds: string[];
  matchedRapidLossTargetIds: string[];
  matchedPunitiveExerciseIds: string[];
  harmfulTargetMatchCount: number;
  restrictivePlanMatchCount: number;
  rapidLossTargetMatchCount: number;
  punitiveExerciseMatchCount: number;
  hasSupportiveRedirect: boolean;
  hasProfessionalSupport: boolean;
  hasUnsafeNutritionGuidance: boolean;
  hasSafeBoundaryRedirect: boolean;
}

export function isUnsafeCalorieFloorReason(value: unknown): value is NutritionSafetyFailureReason {
  return value === UNSAFE_CALORIE_FLOOR_REASON;
}

export function checkNutritionSafetyTargets(targets: Partial<DailyTargets>): NutritionSafetyTargetCheckResult {
  if (
    targets.calories !== undefined &&
    targets.calories < NUTRITION_SAFETY_CALORIE_FLOOR
  ) {
    return {
      ok: false,
      reason: UNSAFE_CALORIE_FLOOR_REASON,
      floor: NUTRITION_SAFETY_CALORIE_FLOOR,
      fields: ["calories"],
    };
  }

  return { ok: true };
}

export function analyzeUnsafeNutritionGuidance(answer: string): UnsafeNutritionGuidanceAnalysis {
  const canonicalAnswer = canonicalizeNutritionSafetyText(answer);
  const matchedHarmfulTargetIds = [
    ...matchedUnsafeCalorieGuidanceIds(canonicalAnswer),
    ...matchedUnsafeMealSlotPlanIds(canonicalAnswer),
    ...matchedUnsafeNutritionPatternIds(canonicalAnswer, UNSAFE_NUTRITION_HARMFUL_TARGET_PATTERNS),
  ];
  const matchedRestrictivePlanIds = matchedUnsafeNutritionPatternIds(
    canonicalAnswer,
    UNSAFE_NUTRITION_RESTRICTIVE_PLAN_PATTERNS,
  );
  const matchedRapidLossTargetIds = matchedUnsafeNutritionPatternIds(
    canonicalAnswer,
    UNSAFE_NUTRITION_RAPID_LOSS_PATTERNS,
  );
  const matchedPunitiveExerciseIds = matchedUnsafeNutritionPatternIds(
    canonicalAnswer,
    UNSAFE_NUTRITION_PUNITIVE_EXERCISE_PATTERNS,
  );
  const hasSupportiveRedirect = /不能|不會|無法|不要|暫時不會|較安全|安全的|改回|調回|先把|cannot|can't|can\s*not|do\s*not|not\s+able|safer|sustainable|recommend\s+professional/i.test(canonicalAnswer);
  const hasProfessionalSupport = /醫師|醫生|營養師|合格專業|專業人員|doctor|dietitian|qualified\s+professional|healthcare\s+professional/i.test(canonicalAnswer);
  const hasUnsafeNutritionGuidance =
    matchedHarmfulTargetIds.length > 0 ||
    matchedRestrictivePlanIds.length > 0 ||
    matchedRapidLossTargetIds.length > 0 ||
    matchedPunitiveExerciseIds.length > 0;

  return {
    matchedHarmfulTargetIds,
    matchedRestrictivePlanIds,
    matchedRapidLossTargetIds,
    matchedPunitiveExerciseIds,
    harmfulTargetMatchCount: matchedHarmfulTargetIds.length,
    restrictivePlanMatchCount: matchedRestrictivePlanIds.length,
    rapidLossTargetMatchCount: matchedRapidLossTargetIds.length,
    punitiveExerciseMatchCount: matchedPunitiveExerciseIds.length,
    hasSupportiveRedirect,
    hasProfessionalSupport,
    hasUnsafeNutritionGuidance,
    hasSafeBoundaryRedirect: !hasUnsafeNutritionGuidance && hasSupportiveRedirect && hasProfessionalSupport,
  };
}

/**
 * Shared decision used by JSON, SSE, and planning paths.  Callers must make
 * the fallback choice only after this function has seen the complete reply.
 */
export function decideNutritionSafetyBoundary(answer: string): NutritionSafetyBoundaryDecision {
  const canonicalText = canonicalizeNutritionSafetyText(answer);
  const unsafe = hasUnsafeNutritionGuidance(canonicalText);
  return unsafe
    ? { safe: false, canonicalText, reason: "unsafe_nutrition_guidance" }
    : { safe: true, canonicalText };
}

/**
 * Apply the complete-reply decision shared by JSON, SSE, and planning-facing
 * callers.  The fallback is supplied by the caller so this policy module does
 * not own user-facing copy, and the model text is never returned when unsafe.
 */
export function resolveBufferedNutritionReply(input: {
  userMessage?: string;
  reply: string;
  fallbackText: string;
}): BufferedNutritionReply {
  const responseDecision = decideNutritionSafetyBoundary(input.reply);
  const userText = stripToolLikeRegions(canonicalizeNutritionSafetyText(input.userMessage ?? ""));
  const userUnsafe = hasUnsafeNutritionGuidance(userText);
  const responseIsSafeBoundary = hasSafeUnsafeNutritionBoundaryReply(responseDecision.canonicalText);
  const needsFallback = !responseDecision.safe || (userUnsafe && !responseIsSafeBoundary);
  return {
    reply: needsFallback ? input.fallbackText : responseDecision.canonicalText,
    usedFallback: needsFallback,
  };
}

export function hasUnsafeNutritionGuidance(answer: string): boolean {
  return analyzeUnsafeNutritionGuidance(answer).hasUnsafeNutritionGuidance;
}

export function hasSafeUnsafeNutritionBoundaryReply(answer: string): boolean {
  return analyzeUnsafeNutritionGuidance(answer).hasSafeBoundaryRedirect;
}

function matchedUnsafeNutritionPatternIds(
  answer: string,
  entries: readonly { readonly id: string; readonly pattern: RegExp }[],
): string[] {
  return entries.flatMap((entry) =>
    [...answer.matchAll(entry.pattern)]
      .filter((match) => !isUnsafeNutritionLocallyNegated(answer, match.index ?? 0))
      .map(() => entry.id),
  );
}

function matchedUnsafeCalorieGuidanceIds(answer: string): string[] {
  return CALORIE_GUIDANCE_PATTERNS.flatMap((pattern) =>
    [...answer.matchAll(pattern)]
      .filter((match) => !isUnsafeNutritionLocallyNegated(answer, match.index ?? 0))
      .filter((match) => {
        const value = normalizeNumericToken(match[1] ?? "");
        if (!Number.isFinite(value) || value >= NUTRITION_SAFETY_CALORIE_FLOOR) {
          return false;
        }
        const valueStart = match.indices?.[1]?.[0];
        if (valueStart === undefined) {
          return true;
        }
        return !isCalorieAdjustmentDeltaContext(answer, valueStart)
          && !isPerMacroCalorieBreakdownContext(answer, valueStart)
          && !isLoggedCalorieFactContext(answer, valueStart);
      })
      .map(() => "sub_floor_calorie_guidance")
  );
}

function isCalorieAdjustmentDeltaContext(answer: string, valueStart: number): boolean {
  const prefix = answer.slice(Math.max(0, valueStart - 8), valueStart);
  return CALORIE_DELTA_CONTEXT_SUFFIX_PATTERN.test(prefix);
}

function isPerMacroCalorieBreakdownContext(answer: string, valueStart: number): boolean {
  const prefix = answer.slice(Math.max(0, valueStart - 20), valueStart);
  const match = prefix.match(PER_MACRO_BREAKDOWN_PREFIX_PATTERN);
  const tail = match?.groups?.tail;
  if (tail === undefined) {
    return false;
  }
  return !/[。！？\n]/.test(tail) && !/(?:共|總|合計)/.test(tail);
}

function isLoggedCalorieFactContext(answer: string, valueStart: number): boolean {
  const prefix = answer.slice(Math.max(0, valueStart - 40), valueStart);
  return /(?:已記錄|記錄了|紀錄|今日攝取|今天攝取|共\s*[0-9]+\s*餐|logged|recorded|consumed|total)/i.test(prefix)
    && !/(?:只吃|only|limit|設定|設成|改成|目標每天|daily\s+target)/i.test(prefix);
}

function matchedUnsafeMealSlotPlanIds(answer: string): string[] {
  if (LOGGED_INTAKE_CONTEXT_PATTERN.test(answer)) {
    return [];
  }

  const values = [...answer.matchAll(MEAL_SLOT_CALORIE_PATTERN)]
    .filter((match) => !isUnsafeNutritionLocallyNegated(answer, match.index ?? 0))
    .map((match) => normalizeNumericToken(match[1] ?? ""))
    .filter(Number.isFinite);
  if (values.length < 2) {
    return [];
  }

  const total = values.reduce((sum, value) => sum + value, 0);
  return total < NUTRITION_SAFETY_CALORIE_FLOOR
    ? ["sub_floor_meal_slot_plan"]
    : [];
}

function normalizeNumericToken(value: string): number {
  const ascii = canonicalizeNutritionSafetyText(value)
    .replace(/．/g, ".")
    .replace(/[,，]/g, "");
  return Number(ascii);
}

function isUnsafeNutritionLocallyNegated(answer: string, matchIndex: number): boolean {
  const prefix = answer.slice(Math.max(0, matchIndex - 24), matchIndex);
  if (/[。！？；\n]|但|可是|不過/.test(prefix)) {
    return false;
  }
  return /不會|不能|無法|拒絕|不要|不是|不可|不應|避免|不建議|do\s+not\s+recommend|not\s+recommend|cannot\s+recommend|don't\s+recommend/i.test(prefix);
}
