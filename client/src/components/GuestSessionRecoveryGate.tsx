import { useState } from "react";
import { useStore } from "../store.js";

export function GuestSessionRecoveryGate() {
  const rebuildGuestSession = useStore((s) => s.rebuildGuestSession);
  const [rebuilding, setRebuilding] = useState(false);

  async function handleRebuild() {
    setRebuilding(true);
    await rebuildGuestSession();
    setRebuilding(false);
  }

  return (
    <div
      className="flex min-h-screen items-center justify-center px-6 py-10"
      style={{ background: "var(--bg)" }}
    >
      <div
        className="w-full max-w-md rounded-[28px] p-7"
        style={{
          background: "linear-gradient(180deg, rgba(255,244,232,0.96) 0%, rgba(255,250,245,0.98) 100%)",
          border: "1px solid var(--border-med)",
          boxShadow: "0 22px 50px rgba(120, 70, 30, 0.12)",
        }}
      >
        <span
          className="inline-flex rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.22em]"
          style={{
            background: "rgba(232,104,42,0.12)",
            color: "var(--orange)",
          }}
        >
          session recovery
        </span>
        <h1
          className="mt-4 text-[30px] leading-tight"
          style={{
            color: "var(--text)",
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            letterSpacing: "-0.03em",
          }}
        >
          這個瀏覽器的訪客工作階段已失效
        </h1>
        <p className="mt-3 text-sm leading-6" style={{ color: "var(--text-2)" }}>
          我們已經嘗試過一次自動恢復，但這次無法安全地接回原本的日記。若要繼續使用，請明確重新建立一個新的訪客日記。
        </p>
        <button
          type="button"
          onClick={() => void handleRebuild()}
          disabled={rebuilding}
          className="mt-6 w-full rounded-2xl px-4 py-3 text-sm font-bold text-white disabled:opacity-60"
          style={{
            background: "var(--orange)",
            boxShadow: "0 14px 28px rgba(232,104,42,0.28)",
          }}
        >
          {rebuilding ? "重新建立中..." : "重新建立新的訪客日記"}
        </button>
      </div>
    </div>
  );
}
