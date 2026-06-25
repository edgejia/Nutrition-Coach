import { OnboardingStepper } from "./onboarding/OnboardingStepper.js";
import { PullToRefreshSurface } from "./PullToRefreshSurface.js";

function refreshOnboardingShell() {
  window.location.reload();
}

export function Onboarding() {
  return (
    <PullToRefreshSurface onRefresh={refreshOnboardingShell} ariaLabel="下拉重新整理初始設定">
      <OnboardingStepper />
    </PullToRefreshSurface>
  );
}
