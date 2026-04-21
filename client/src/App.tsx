import { useEffect } from "react";
import { establishGuestSession } from "./api.js";
import { useStore } from "./store.js";
import { Onboarding } from "./components/Onboarding.js";
import { MainLayout } from "./components/MainLayout.js";

export function App() {
  const deviceId = useStore((s) => s.deviceId);
  const guestSessionStatus = useStore((s) => s.guestSessionStatus);
  const setDevice = useStore((s) => s.setDevice);
  const setGuestSessionStatus = useStore((s) => s.setGuestSessionStatus);

  useEffect(() => {
    if (!deviceId || guestSessionStatus !== "unknown") {
      return;
    }

    let cancelled = false;
    setGuestSessionStatus("establishing");

    establishGuestSession({ legacyDeviceId: deviceId })
      .then((session) => {
        if (cancelled) {
          return;
        }
        setDevice(session.deviceId, session.goal, session.dailyTargets);
      })
      .catch(() => {
        if (!cancelled) {
          setGuestSessionStatus("recovery_required");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [deviceId, guestSessionStatus, setDevice, setGuestSessionStatus]);

  if (!deviceId) {
    return <Onboarding />;
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
