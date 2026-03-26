import { useStore } from "./store.js";

export function App() {
  const deviceId = useStore((s) => s.deviceId);
  return (
    <div className="min-h-screen bg-gray-50">
      {deviceId ? <p>Main (TODO)</p> : <p>Onboarding (TODO)</p>}
    </div>
  );
}
