import { useStore } from "./store.js";
import { Onboarding } from "./components/Onboarding.js";
import { MainLayout } from "./components/MainLayout.js";

export function App() {
  const deviceId = useStore((s) => s.deviceId);
  return deviceId ? <MainLayout /> : <Onboarding />;
}
