import type { IntakeValidationIssue, OnboardingField, OnboardingStep } from "../types.js";
import { clearValidationIssueForField } from "./onboarding-intake-validation.js";

export function groupValidationIssuesByStep(
  errors: IntakeValidationIssue[],
): Partial<Record<OnboardingStep, IntakeValidationIssue[]>> {
  return errors.reduce<Partial<Record<OnboardingStep, IntakeValidationIssue[]>>>((grouped, issue) => {
    const current = grouped[issue.step] ?? [];
    grouped[issue.step] = [...current, issue];
    return grouped;
  }, {});
}

export function getStepFieldErrors(
  errors: IntakeValidationIssue[],
  step: OnboardingStep,
): Partial<Record<OnboardingField, string>> {
  return errors.reduce<Partial<Record<OnboardingField, string>>>((fieldErrors, issue) => {
    if (issue.step === step && fieldErrors[issue.field] === undefined) {
      fieldErrors[issue.field] = issue.message;
    }
    return fieldErrors;
  }, {});
}

export function clearStepFieldError(
  errors: IntakeValidationIssue[],
  field: OnboardingField,
): IntakeValidationIssue[] {
  return clearValidationIssueForField(errors, field);
}
