import { useState } from "react";
import { useStore } from "../../store.js";
import { submitIntake } from "../../api.js";
import { StepGoal } from "./StepGoal.js";
import { StepGoalClarification } from "./StepGoalClarification.js";
import { StepBodyData } from "./StepBodyData.js";
import { StepLifestyle } from "./StepLifestyle.js";
import { StepAdvancedMetrics } from "./StepAdvancedMetrics.js";
import { StepCoachHandoff } from "./StepCoachHandoff.js";
import type { IntakeData, IntakeResult } from "../../types.js";

type PartialIntake = Partial<IntakeData>;

export function OnboardingStepper() {
  const setDevice = useStore((s) => s.setDevice);
  const [step, setStep] = useState(1);
  const [data, setData] = useState<PartialIntake>({});
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  function advance(partial: PartialIntake, nextStep: number) {
    setData((prev) => ({ ...prev, ...partial }));
    setStep(nextStep);
  }

  async function handleSubmit(finalData: PartialIntake) {
    if (loading) return;
    const merged = { ...data, ...finalData } as IntakeData;
    setData(merged);
    setStep(6);
    setLoading(true);
    setError(null);
    try {
      const res = await submitIntake(merged);
      setResult(res);
    } catch {
      setError("無法連線，請稍後再試。");
    } finally {
      setLoading(false);
    }
  }

  function handleComplete() {
    if (!result) return;
    setDevice(result.deviceId, data.goal!, result.dailyTargets);
  }

  switch (step) {
    case 1:
      return <StepGoal onSelect={(goal) => advance({ goal }, 2)} />;
    case 2:
      return (
        <StepGoalClarification
          goal={data.goal as "fat_loss" | "muscle_gain"}
          onNext={(goalClarification) => advance({ goalClarification }, 3)}
          onBack={() => setStep(1)}
        />
      );
    case 3:
      return (
        <StepBodyData
          onNext={(bodyData) => advance(bodyData, 4)}
          onBack={() => setStep(2)}
        />
      );
    case 4:
      return (
        <StepLifestyle
          onNext={(lifestyle) => advance(lifestyle, 5)}
          onBack={() => setStep(3)}
        />
      );
    case 5:
      return (
        <StepAdvancedMetrics
          onNext={(metrics) => handleSubmit(metrics)}
          onSkip={() => handleSubmit({})}
          onBack={() => setStep(4)}
        />
      );
    case 6:
      return (
        <StepCoachHandoff
          loading={loading}
          error={error}
          result={result}
          onStart={handleComplete}
          onRetry={() => handleSubmit({})}
        />
      );
    default:
      return null;
  }
}
