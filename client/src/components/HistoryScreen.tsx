import { useStore } from "../store.js";
import { SketchButton, SketchSoftBox } from "./SketchPrimitives.js";

export function HistoryScreen() {
  const openSecondaryScreen = useStore((s) => s.openSecondaryScreen);

  return (
    <div className="sk-screen screen-shell">
      <header className="sk-screen-header">
        <span aria-hidden="true" />
        <h1 className="sk-heading text-xl">歷史</h1>
        <span aria-hidden="true" />
      </header>
      <main className="screen-scroll-safe p-4">
        <SketchSoftBox className="space-y-3 p-4">
          <div>
            <h2 className="sk-heading text-lg">還沒有資料</h2>
            <p className="sk-body mt-2" style={{ color: "var(--sk-ink-soft)" }}>
              History content lands in Phase 34
            </p>
          </div>
          <SketchButton onClick={() => openSecondaryScreen("dayDetail", "history")}>
            Day Detail shell
          </SketchButton>
        </SketchSoftBox>
      </main>
    </div>
  );
}
