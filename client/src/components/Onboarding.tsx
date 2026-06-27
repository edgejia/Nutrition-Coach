import { useEffect } from "react";
import { recordOnboardingDebugEvent } from "../api.js";
import { OnboardingStepper } from "./onboarding/OnboardingStepper.js";
import { PullToRefreshSurface } from "./PullToRefreshSurface.js";

function getDebugStep(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 6
    ? value
    : undefined;
}

function getDebugBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function getDebugString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function refreshOnboardingShell() {
  document.documentElement.dataset.onboardingRefreshFired = "true";
  if (typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent("nutrition-coach:onboarding-refresh-fired"));
  }
  const reload = () => window.location.reload();
  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(reload);
    return;
  }
  reload();
}

export function Onboarding() {
  useEffect(() => {
    const handleBackDiagnostic = (event: Event) => {
      const detail = event instanceof CustomEvent && typeof event.detail === "object" && event.detail !== null
        ? event.detail as Record<string, unknown>
        : {};
      recordOnboardingDebugEvent({
        event: "onboarding_back_diagnostic",
        ...(getDebugString(detail.event) ? { diagnosticEvent: getDebugString(detail.event) } : {}),
        ...(getDebugStep(detail.currentStep) !== undefined ? { currentStep: getDebugStep(detail.currentStep) } : {}),
        ...(getDebugStep(detail.nextStep) !== undefined ? { nextStep: getDebugStep(detail.nextStep) } : {}),
        ...(getDebugBoolean(detail.handled) !== undefined ? { handled: getDebugBoolean(detail.handled) } : {}),
        ...(getDebugBoolean(detail.repaired) !== undefined ? { repaired: getDebugBoolean(detail.repaired) } : {}),
      });
    };
    const handleRefreshFired = () => {
      recordOnboardingDebugEvent({ event: "onboarding_refresh_fired" });
    };

    window.addEventListener("nutrition-coach:onboarding-back-diagnostic", handleBackDiagnostic);
    window.addEventListener("nutrition-coach:onboarding-refresh-fired", handleRefreshFired);
    return () => {
      window.removeEventListener("nutrition-coach:onboarding-back-diagnostic", handleBackDiagnostic);
      window.removeEventListener("nutrition-coach:onboarding-refresh-fired", handleRefreshFired);
    };
  }, []);

  return (
    <PullToRefreshSurface
      onRefresh={refreshOnboardingShell}
      surfaceId="onboarding"
      completionLabel="初始設定已重新整理"
      ariaLabel="下拉重新整理初始設定"
    >
      <div className="screen-scroll sp-onboarding-scroll">
        <OnboardingStepper />
      </div>
    </PullToRefreshSurface>
  );
}
