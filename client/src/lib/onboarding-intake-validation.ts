import type { IntakeData, IntakeValidationIssue, OnboardingField, OnboardingStep } from "../types.js";

export type { IntakeValidationIssue, OnboardingField, OnboardingStep } from "../types.js";

const VALID_GOALS = ["fat_loss", "muscle_gain"] as const;
const VALID_SEXES = ["male", "female"] as const;
const VALID_ACTIVITY_LEVELS = ["sedentary", "light", "moderate", "active", "very_active"] as const;
const VALID_TRAINING_FREQUENCIES = ["none", "1_2", "3_4", "5_plus"] as const;
const STEP_TEXT_LIMITS = {
  goalClarification: 300,
  allergies: 300,
  advancedNotes: 500,
} as const;

type ValidationInput = Partial<Record<OnboardingField, unknown>>;

function createIssue(
  field: OnboardingField,
  code: string,
  step: OnboardingStep,
  message: string,
): IntakeValidationIssue {
  return { field, code, step, message };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readOptionalTrimmedString(value: unknown) {
  if (value === undefined) return { present: false as const };
  if (typeof value !== "string") return { present: true as const, valid: false as const };

  const trimmed = value.trim();
  return {
    present: true as const,
    valid: true as const,
    value: trimmed.length > 0 ? trimmed : undefined,
  };
}

function validateGoal(data: ValidationInput): IntakeValidationIssue[] {
  if (!VALID_GOALS.includes(data.goal as IntakeData["goal"])) {
    return [createIssue("goal", "INVALID_GOAL", 1, "請選擇減脂或增肌目標")];
  }

  return [];
}

function validateGoalClarification(data: ValidationInput): IntakeValidationIssue[] {
  const result = readOptionalTrimmedString(data.goalClarification);
  if (!result.present) return [];
  if (!result.valid) {
    return [createIssue("goalClarification", "INVALID_GOAL_CLARIFICATION", 2, "目標補充需為文字")];
  }
  if ((result.value?.length ?? 0) > STEP_TEXT_LIMITS.goalClarification) {
    return [createIssue("goalClarification", "GOAL_CLARIFICATION_TOO_LONG", 2, "目標補充最多 300 字")];
  }

  return [];
}

function validateBodyData(data: ValidationInput): IntakeValidationIssue[] {
  const issues: IntakeValidationIssue[] = [];

  if (!VALID_SEXES.includes(data.sex as IntakeData["sex"])) {
    issues.push(createIssue("sex", "INVALID_SEX", 3, "請選擇有效的性別"));
  }

  if (!isFiniteNumber(data.age)) {
    issues.push(createIssue("age", "INVALID_AGE", 3, "請輸入有效的年齡"));
  } else if (data.age < 10 || data.age > 120) {
    issues.push(createIssue("age", "AGE_OUT_OF_RANGE", 3, "年齡需介於 10-120"));
  }

  if (!isFiniteNumber(data.heightCm)) {
    issues.push(createIssue("heightCm", "INVALID_HEIGHT_CM", 3, "請輸入有效的身高"));
  } else if (data.heightCm < 50 || data.heightCm > 300) {
    issues.push(createIssue("heightCm", "HEIGHT_OUT_OF_RANGE", 3, "身高需介於 50-300 cm"));
  }

  if (!isFiniteNumber(data.weightKg)) {
    issues.push(createIssue("weightKg", "INVALID_WEIGHT_KG", 3, "請輸入有效的體重"));
  } else if (data.weightKg < 20 || data.weightKg > 500) {
    issues.push(createIssue("weightKg", "WEIGHT_OUT_OF_RANGE", 3, "體重需介於 20-500 kg"));
  }

  return issues;
}

function validateLifestyle(data: ValidationInput): IntakeValidationIssue[] {
  const issues: IntakeValidationIssue[] = [];

  if (!VALID_ACTIVITY_LEVELS.includes(data.activityLevel as IntakeData["activityLevel"])) {
    issues.push(createIssue("activityLevel", "INVALID_ACTIVITY_LEVEL", 4, "請選擇有效的活動量"));
  }

  if (!VALID_TRAINING_FREQUENCIES.includes(data.trainingFrequency as IntakeData["trainingFrequency"])) {
    issues.push(
      createIssue("trainingFrequency", "INVALID_TRAINING_FREQUENCY", 4, "請選擇有效的訓練頻率"),
    );
  }

  const allergies = readOptionalTrimmedString(data.allergies);
  if (allergies.present && !allergies.valid) {
    issues.push(createIssue("allergies", "INVALID_ALLERGIES", 4, "過敏資訊需為文字"));
  } else if ((allergies.value?.length ?? 0) > STEP_TEXT_LIMITS.allergies) {
    issues.push(createIssue("allergies", "ALLERGIES_TOO_LONG", 4, "過敏資訊最多 300 字"));
  }

  return issues;
}

function validateAdvancedMetrics(data: ValidationInput): IntakeValidationIssue[] {
  const issues: IntakeValidationIssue[] = [];

  if (data.bodyFatPercent !== undefined) {
    if (!isFiniteNumber(data.bodyFatPercent)) {
      issues.push(createIssue("bodyFatPercent", "INVALID_BODY_FAT_PERCENT", 5, "請輸入有效的體脂率"));
    } else if (data.bodyFatPercent < 2 || data.bodyFatPercent > 70) {
      issues.push(createIssue("bodyFatPercent", "BODY_FAT_OUT_OF_RANGE", 5, "體脂率需介於 2-70"));
    }
  }

  if (data.tdee !== undefined) {
    if (!isFiniteNumber(data.tdee)) {
      issues.push(createIssue("tdee", "INVALID_TDEE", 5, "請輸入有效的 TDEE"));
    } else if (data.tdee < 500 || data.tdee > 8000) {
      issues.push(createIssue("tdee", "TDEE_OUT_OF_RANGE", 5, "TDEE 需介於 500-8000"));
    }
  }

  const advancedNotes = readOptionalTrimmedString(data.advancedNotes);
  if (advancedNotes.present && !advancedNotes.valid) {
    issues.push(createIssue("advancedNotes", "INVALID_ADVANCED_NOTES", 5, "備註需為文字"));
  } else if ((advancedNotes.value?.length ?? 0) > STEP_TEXT_LIMITS.advancedNotes) {
    issues.push(createIssue("advancedNotes", "ADVANCED_NOTES_TOO_LONG", 5, "其他備註最多 500 字"));
  }

  return issues;
}

export function validateOnboardingStep(step: OnboardingStep, data: Partial<IntakeData>): IntakeValidationIssue[] {
  const input = data as ValidationInput;

  switch (step) {
    case 1:
      return validateGoal(input);
    case 2:
      return validateGoalClarification(input);
    case 3:
      return validateBodyData(input);
    case 4:
      return validateLifestyle(input);
    case 5:
      return validateAdvancedMetrics(input);
    default:
      return [];
  }
}

export function validateIntake(data: Partial<IntakeData>): IntakeValidationIssue[] {
  return [
    ...validateOnboardingStep(1, data),
    ...validateOnboardingStep(2, data),
    ...validateOnboardingStep(3, data),
    ...validateOnboardingStep(4, data),
    ...validateOnboardingStep(5, data),
  ];
}

export function getEarliestValidationStep(errors: IntakeValidationIssue[]): OnboardingStep {
  if (errors.length === 0) return 1;

  return errors.reduce<OnboardingStep>((earliest, issue) => (issue.step < earliest ? issue.step : earliest), errors[0]!.step);
}

export function clearValidationIssueForField(
  errors: IntakeValidationIssue[],
  field: OnboardingField,
): IntakeValidationIssue[] {
  return errors.filter((issue) => issue.field !== field);
}
