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
