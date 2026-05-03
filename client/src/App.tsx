import { useEffect } from "react";
import { useStore } from "./store.js";
import { Onboarding } from "./components/Onboarding.js";
import { GuestSessionRecoveryGate } from "./components/GuestSessionRecoveryGate.js";
import { MainLayout, SportAppShell } from "./components/MainLayout.js";

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
    return (
      <SportAppShell>
        <Onboarding />
      </SportAppShell>
    );
  }

  if (guestSessionStatus === "recovery_required") {
    return (
      <SportAppShell>
        <GuestSessionRecoveryGate />
      </SportAppShell>
    );
  }

  if (guestSessionStatus !== "ready") {
    return (
      <SportAppShell>
        <div className="sp-screen items-center justify-center px-6 text-center">
          <div className="max-w-sm">
            <p className="sp-zh text-sm font-medium" style={{ color: "var(--sp-ink-2)" }}>
              正在恢復你的日記工作階段...
            </p>
          </div>
        </div>
      </SportAppShell>
    );
  }

  return <MainLayout />;
}
