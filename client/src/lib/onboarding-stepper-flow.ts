import { IntakeValidationError } from "../api.js";
import type { IntakeData, IntakeResult, IntakeValidationIssue, OnboardingField, OnboardingStep } from "../types.js";
import { clearStepFieldError } from "./onboarding-flow.js";
import { getEarliestValidationStep, validateIntake, validateOnboardingStep } from "./onboarding-intake-validation.js";

const TRANSPORT_ERROR_MESSAGE = "無法連線，請稍後再試。";

export type GoalClarificationQuickNoteState = {
  goalClarification: string;
  selectedNotes: readonly string[];
};

export type GoalClarificationQuickNoteOutcome = GoalClarificationQuickNoteState & {
  inserted: boolean;
};

export function applyGoalClarificationQuickNote(
  state: GoalClarificationQuickNoteState,
  note: string,
): GoalClarificationQuickNoteOutcome {
  if (state.selectedNotes.includes(note)) {
    return {
      goalClarification: state.goalClarification,
      selectedNotes: state.selectedNotes,
      inserted: false,
    };
  }

  return {
    goalClarification: state.goalClarification.length > 0
      ? `${state.goalClarification}、${note}`
      : note,
    selectedNotes: [...state.selectedNotes, note],
    inserted: true,
  };
}

export function getStepAdvanceOutcome(
  step: OnboardingStep,
  mergedDraft: Partial<IntakeData>,
): { nextStep: OnboardingStep; issues: IntakeValidationIssue[] } {
  const issues = validateOnboardingStep(step, mergedDraft);
  if (issues.length > 0 || step === 5) {
    return { nextStep: step, issues };
  }

  return { nextStep: (step + 1) as OnboardingStep, issues: [] };
}

export function getSubmitGateOutcome(
  merged: IntakeData,
): { nextStep: OnboardingStep | 6; issues: IntakeValidationIssue[] } {
  const issues = validateIntake(merged);
  if (issues.length > 0) {
    return {
      nextStep: getEarliestValidationStep(issues),
      issues,
    };
  }

  return { nextStep: 6, issues: [] };
}

export function getAdvancedMetricsSkipData(): Pick<Partial<IntakeData>, "bodyFatPercent" | "tdee" | "advancedNotes"> {
  return {
    bodyFatPercent: undefined,
    tdee: undefined,
    advancedNotes: undefined,
  };
}

export function resolveSubmitFailure(
  error: unknown,
): { nextStep: OnboardingStep | 6; issues: IntakeValidationIssue[]; transportError: string | null } {
  if (error instanceof IntakeValidationError) {
    return {
      nextStep: error.step,
      issues: error.errors,
      transportError: null,
    };
  }

  return {
    nextStep: 6,
    issues: [],
    transportError: TRANSPORT_ERROR_MESSAGE,
  };
}

export async function runSubmitAttempt(
  merged: IntakeData,
  submit: (data: IntakeData) => Promise<IntakeResult>,
  onSubmitStart?: () => void,
): Promise<{
  nextStep: OnboardingStep | 6;
  issues: IntakeValidationIssue[];
  transportError: string | null;
  result: IntakeResult | null;
}> {
  const submitGate = getSubmitGateOutcome(merged);
  if (submitGate.issues.length > 0) {
    return {
      nextStep: submitGate.nextStep,
      issues: submitGate.issues,
      transportError: null,
      result: null,
    };
  }

  onSubmitStart?.();

  try {
    const result = await submit(merged);
    return {
      nextStep: 6,
      issues: [],
      transportError: null,
      result,
    };
  } catch (error) {
    const failure = resolveSubmitFailure(error);
    return {
      ...failure,
      result: null,
    };
  }
}

export function applyFieldEditRecovery(
  errors: IntakeValidationIssue[],
  field: OnboardingField,
): IntakeValidationIssue[] {
  return clearStepFieldError(errors, field);
}
