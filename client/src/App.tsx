import { useEffect } from "react";
import { useStore } from "./store.js";
import { Onboarding } from "./components/Onboarding.js";
import { GuestSessionRecoveryGate } from "./components/GuestSessionRecoveryGate.js";
import { MainLayout } from "./components/MainLayout.js";

export function App() {
  const deviceId = useStore((s) => s.deviceId);
  const guestSessionStatus = useStore((s) => s.guestSessionStatus);
  const bootstrapGuestSession = useStore((s) => s.bootstrapGuestSession);

  useEffect(() => {
    if (!deviceId || guestSessionStatus !== "unknown") {
      return;
    }

    void bootstrapGuestSession();
  }, [deviceId, guestSessionStatus, bootstrapGuestSession]);

  if (!deviceId) {
    return <Onboarding />;
  }

  if (guestSessionStatus === "recovery_required") {
    return <GuestSessionRecoveryGate />;
  }

  if (guestSessionStatus !== "ready") {
    return (
      <div className="flex min-h-screen items-center justify-center px-6 text-center" style={{ background: "var(--bg)" }}>
        <div className="max-w-sm">
          <p className="text-sm font-medium text-stone-700">正在恢復你的日記工作階段...</p>
        </div>
      </div>
    );
  }

  return <MainLayout />;
}
