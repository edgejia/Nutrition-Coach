import type { DailyTargets } from "../services/device.js";

export const NUTRITION_SAFETY_CALORIE_FLOOR = 1200;
export const UNSAFE_CALORIE_FLOOR_REASON = "unsafe_calorie_floor";

export type NutritionSafetyFailureReason = typeof UNSAFE_CALORIE_FLOOR_REASON;

export type NutritionSafetyTargetCheckResult =
  | { ok: true }
  | {
      ok: false;
      reason: NutritionSafetyFailureReason;
      floor: typeof NUTRITION_SAFETY_CALORIE_FLOOR;
      fields: ["calories"];
    };

const CALORIE_GUIDANCE_PATTERNS = [
  /(?:每天|每日|目標|設定|只吃).{0,12}([0-9０-９]+(?:[,，][0-9０-９]+)*(?:[.．][0-9０-９]+)?)\s*(?:kcal|卡路里|卡|大卡)/g,
  /([0-9０-９]+(?:[,，][0-9０-９]+)*(?:[.．][0-9０-９]+)?)\s*(?:kcal|卡路里|卡|大卡).{0,12}(?:每天|每日|目標|設定|只吃)/g,
  /(?:eat|eating|only|limit|target|goal).{0,16}([0-9]+(?:,\d{3})*(?:\.\d+)?)\s*(?:kcal|calories?)(?:.{0,16}(?:per day|daily|a day))?/gi,
  /([0-9]+(?:,\d{3})*(?:\.\d+)?)\s*(?:kcal|calories?).{0,16}(?:per day|daily|a day|only|limit|target|goal)/gi,
] as const;
const MEAL_SLOT_CALORIE_PATTERN =
  /(?:早餐|早上|午餐|中午|晚餐|晚上|宵夜|breakfast|lunch|dinner).{0,12}([0-9０-９]+(?:[,，][0-9０-９]+)*(?:[.．][0-9０-９]+)?)\s*(?:kcal|卡路里|卡|大卡|calories?)/gi;
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
  const matchedHarmfulTargetIds = [
    ...matchedUnsafeCalorieGuidanceIds(answer),
    ...matchedUnsafeMealSlotPlanIds(answer),
    ...matchedUnsafeNutritionPatternIds(answer, UNSAFE_NUTRITION_HARMFUL_TARGET_PATTERNS),
  ];
  const matchedRestrictivePlanIds = matchedUnsafeNutritionPatternIds(
    answer,
    UNSAFE_NUTRITION_RESTRICTIVE_PLAN_PATTERNS,
  );
  const matchedRapidLossTargetIds = matchedUnsafeNutritionPatternIds(
    answer,
    UNSAFE_NUTRITION_RAPID_LOSS_PATTERNS,
  );
  const matchedPunitiveExerciseIds = matchedUnsafeNutritionPatternIds(
    answer,
    UNSAFE_NUTRITION_PUNITIVE_EXERCISE_PATTERNS,
  );
  const hasSupportiveRedirect = /不能|不會|無法|不要|暫時不會|較安全|安全的|改回|調回|先把/.test(answer);
  const hasProfessionalSupport = /醫師|醫生|營養師|合格專業|專業人員/.test(answer);
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
        return Number.isFinite(value) && value < NUTRITION_SAFETY_CALORIE_FLOOR;
      })
      .map(() => "sub_floor_calorie_guidance")
  );
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
  const ascii = value
    .replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0))
    .replace(/．/g, ".")
    .replace(/[,，]/g, "");
  return Number(ascii);
}

function isUnsafeNutritionLocallyNegated(answer: string, matchIndex: number): boolean {
  const prefix = answer.slice(Math.max(0, matchIndex - 24), matchIndex);
  if (/[。！？；\n]|但|可是|不過/.test(prefix)) {
    return false;
  }
  return /不會|不能|無法|拒絕|不要|不是|不可|不應|避免/.test(prefix);
}
