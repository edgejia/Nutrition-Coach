import { useEffect, useState } from "react";
import { useStore } from "../../store.js";
import { submitIntake } from "../../api.js";
import { getStepFieldErrors, groupValidationIssuesByStep } from "../../lib/onboarding-flow.js";
import {
  applyFieldEditRecovery,
  getAdvancedMetricsSkipData,
  getStepAdvanceOutcome,
  runSubmitAttempt,
} from "../../lib/onboarding-stepper-flow.js";
import { StepGoal } from "./StepGoal.js";
import { StepGoalClarification } from "./StepGoalClarification.js";
import { StepBodyData } from "./StepBodyData.js";
import { StepLifestyle } from "./StepLifestyle.js";
import { StepAdvancedMetrics } from "./StepAdvancedMetrics.js";
import { StepCoachHandoff } from "./StepCoachHandoff.js";
import { SketchScreen } from "../SketchPrimitives.js";
import type { IntakeData, IntakeResult, IntakeValidationIssue, OnboardingField, OnboardingStep } from "../../types.js";

type PartialIntake = Partial<IntakeData>;
type StepState = OnboardingStep | 6;

interface OnboardingStepperPresentationProps {
  step: StepState;
  data: PartialIntake;
  validationIssues: IntakeValidationIssue[];
  loading: boolean;
  transportError: string | null;
  result: IntakeResult | null;
  onGoalSelect: (goal: IntakeData["goal"]) => void;
  onGoalClarificationNext: (goalClarification?: string) => void;
  onBodyDataNext: (bodyData: Pick<IntakeData, "sex" | "age" | "heightCm" | "weightKg">) => void;
  onLifestyleNext: (
    lifestyle: Pick<IntakeData, "activityLevel" | "trainingFrequency"> & Pick<Partial<IntakeData>, "allergies">,
  ) => void;
  onAdvancedMetricsNext: (metrics: Pick<Partial<IntakeData>, "bodyFatPercent" | "tdee" | "advancedNotes">) => void;
  onAdvancedMetricsSkip: () => void;
  onBack: (nextStep: OnboardingStep) => void;
  onStart: () => void;
  onRetry: () => void;
  onFieldEdit: (field: OnboardingField) => void;
}

function mergeStepIssues(
  previous: IntakeValidationIssue[],
  step: OnboardingStep,
  nextStepIssues: IntakeValidationIssue[],
) {
  return [...previous.filter((issue) => issue.step !== step), ...nextStepIssues];
}

export function OnboardingStepperPresentation({
  step,
  data,
  validationIssues,
  loading,
  transportError,
  result,
  onGoalSelect,
  onGoalClarificationNext,
  onBodyDataNext,
  onLifestyleNext,
  onAdvancedMetricsNext,
  onAdvancedMetricsSkip,
  onBack,
  onStart,
  onRetry,
  onFieldEdit,
}: OnboardingStepperPresentationProps) {
  const groupedIssues = groupValidationIssuesByStep(validationIssues);
  const goalError = groupedIssues[1]?.[0]?.message;
  const goalClarificationError = groupedIssues[2]?.[0]?.message;
  const bodyDataErrors = getStepFieldErrors(validationIssues, 3);
  const lifestyleErrors = getStepFieldErrors(validationIssues, 4);
  const advancedMetricErrors = getStepFieldErrors(validationIssues, 5);
  const selectedGoal = data.goal === "muscle_gain" ? "muscle_gain" : "fat_loss";

  let stepContent;
  switch (step) {
    case 1:
      stepContent = <StepGoal onSelect={onGoalSelect} error={goalError} />;
      break;
    case 2:
      stepContent = (
        <StepGoalClarification
          goal={selectedGoal}
          initialValue={data.goalClarification}
          error={goalClarificationError}
          onFieldEdit={() => onFieldEdit("goalClarification")}
          onNext={onGoalClarificationNext}
          onBack={() => onBack(1)}
        />
      );
      break;
    case 3:
      stepContent = (
        <StepBodyData
          initialData={data}
          errors={bodyDataErrors}
          onFieldEdit={onFieldEdit}
          onNext={onBodyDataNext}
          onBack={() => onBack(2)}
        />
      );
      break;
    case 4:
      stepContent = (
        <StepLifestyle
          initialData={data}
          errors={lifestyleErrors}
          onFieldEdit={onFieldEdit}
          onNext={onLifestyleNext}
          onBack={() => onBack(3)}
        />
      );
      break;
    case 5:
      stepContent = (
        <StepAdvancedMetrics
          initialData={data}
          errors={advancedMetricErrors}
          onFieldEdit={onFieldEdit}
          onNext={onAdvancedMetricsNext}
          onSkip={onAdvancedMetricsSkip}
          onBack={() => onBack(4)}
        />
      );
      break;
    case 6:
      stepContent = (
        <StepCoachHandoff
          loading={loading}
          transportError={transportError}
          result={result}
          onStart={onStart}
          onRetry={onRetry}
        />
      );
      break;
    default:
      stepContent = null;
  }

  return (
    <SketchScreen className="onboarding-stepper sk-screen">
      <div className="sk-screen-content screen-scroll-safe">
        {stepContent}
      </div>
    </SketchScreen>
  );
}

export function OnboardingStepper() {
  const setDevice = useStore((s) => s.setDevice);
  const [step, setStep] = useState<StepState>(1);
  const [data, setData] = useState<PartialIntake>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [validationIssues, setValidationIssues] = useState<IntakeValidationIssue[]>([]);
  const [transportError, setTransportError] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [step]);

  function handleBack(nextStep: OnboardingStep) {
    setStep(nextStep);
    setTransportError(null);
    setLoading(false);
  }

  function handleFieldEdit(field: OnboardingField) {
    setValidationIssues((current) => applyFieldEditRecovery(current, field));
    setTransportError(null);
  }

  function handleStepAdvance(stepNumber: OnboardingStep, partial: PartialIntake) {
    const merged = { ...data, ...partial };
    const outcome = getStepAdvanceOutcome(stepNumber, merged);

    setData(merged);
    setValidationIssues((current) => mergeStepIssues(current, stepNumber, outcome.issues));
    setTransportError(null);
    setResult(null);
    setLoading(false);
    setStep(outcome.issues.length > 0 ? stepNumber : outcome.nextStep);
  }

  async function handleSubmit(finalData: Pick<Partial<IntakeData>, "bodyFatPercent" | "tdee" | "advancedNotes">) {
    if (loading) return;

    const merged = { ...data, ...finalData };
    const stepFiveOutcome = getStepAdvanceOutcome(5, merged);

    setData(merged);
    setValidationIssues((current) => mergeStepIssues(current, 5, stepFiveOutcome.issues));
    setTransportError(null);
    setResult(null);

    if (stepFiveOutcome.issues.length > 0) {
      setLoading(false);
      setStep(5);
      return;
    }

    const completeIntake = merged as IntakeData;
    const submitOutcome = await runSubmitAttempt(completeIntake, submitIntake, () => {
      setStep(6);
      setLoading(true);
      setTransportError(null);
      setValidationIssues([]);
      setResult(null);
    });

    setStep(submitOutcome.nextStep);
    setValidationIssues(submitOutcome.issues);
    setTransportError(submitOutcome.transportError);
    setResult(submitOutcome.result);
    setLoading(false);
  }

  function handleComplete() {
    if (!result || !data.goal) return;
    setDevice(result.deviceId, data.goal!, result.dailyTargets);
  }

  return (
    <OnboardingStepperPresentation
      step={step}
      data={data}
      validationIssues={validationIssues}
      loading={loading}
      transportError={transportError}
      result={result}
      onGoalSelect={(goal) => handleStepAdvance(1, { goal })}
      onGoalClarificationNext={(goalClarification) => handleStepAdvance(2, { goalClarification })}
      onBodyDataNext={(bodyData) => handleStepAdvance(3, bodyData)}
      onLifestyleNext={(lifestyle) => handleStepAdvance(4, lifestyle)}
      onAdvancedMetricsNext={handleSubmit}
      onAdvancedMetricsSkip={() => handleSubmit(getAdvancedMetricsSkipData())}
      onBack={handleBack}
      onStart={handleComplete}
      onRetry={() =>
        handleSubmit({
          bodyFatPercent: data.bodyFatPercent,
          tdee: data.tdee,
          advancedNotes: data.advancedNotes,
        })
      }
      onFieldEdit={handleFieldEdit}
    />
  );
}
