import { OnboardingStepper } from "./onboarding/OnboardingStepper.js";
import { PullToRefreshSurface } from "./PullToRefreshSurface.js";

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
  return (
    <PullToRefreshSurface
      onRefresh={refreshOnboardingShell}
      surfaceId="onboarding"
      completionLabel="初始設定已重新整理"
      ariaLabel="下拉重新整理初始設定"
    >
      <main className="screen-scroll sp-onboarding-scroll">
        <OnboardingStepper />
      </main>
    </PullToRefreshSurface>
  );
}
