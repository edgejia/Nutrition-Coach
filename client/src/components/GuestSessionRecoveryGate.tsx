import { useState } from "react";
import { useStore } from "../store.js";
import { SportBoltIcon } from "./SportIcons.js";
import { SportCard, SportChip, SportScreen } from "./SportPrimitives.js";

export function GuestSessionRecoveryGate() {
  const rebuildGuestSession = useStore((s) => s.rebuildGuestSession);
  const [rebuilding, setRebuilding] = useState(false);

  async function handleRebuild() {
    setRebuilding(true);
    await rebuildGuestSession();
    setRebuilding(false);
  }

  return (
    <SportScreen
      className="min-h-screen justify-center"
      style={{ alignItems: "stretch", padding: "48px 22px" }}
    >
      <div className="flex flex-1 flex-col justify-center">
        <SportChip
          className="self-start"
          variant="warn"
          zh
          style={{ marginBottom: 24 }}
        >
          <span
            aria-hidden="true"
            className="inline-block size-1.5 rounded-full"
            style={{
              background: "var(--sp-red)",
              boxShadow: "0 0 10px var(--sp-red)",
            }}
          />
          工作階段已失效
        </SportChip>

        <h1 className="sp-zh m-0 text-[34px] font-black leading-[1.12] text-[color:var(--sp-ink)]">
          訪客日記
          <br />
          暫時離線
        </h1>

        <p className="sp-zh mt-5 max-w-[320px] text-sm leading-[1.6] text-[color:var(--sp-ink-2)]">
          這個瀏覽器的訪客工作階段已失效。我們嘗試過一次自動恢復，但無法安全地接回原本的日記。重新建立會給你一個全新的訪客日記。
        </p>

        <SportCard
          className="mt-[22px] flex flex-col gap-1.5 px-4 py-3.5"
          variant="flat"
          style={{ borderRadius: "var(--sp-r-md)" }}
        >
          <div className="sp-num flex justify-between gap-3 text-[10px] text-[color:var(--sp-ink-3)]">
            <span>自動恢復</span>
            <span className="text-[color:#ffb3b3]">失敗 · 1/1</span>
          </div>
          <div className="sp-num flex justify-between gap-3 text-[10px] text-[color:var(--sp-ink-3)]">
            <span>保存位置</span>
            <span className="text-[color:var(--sp-ink-2)]">瀏覽器 · cookie</span>
          </div>
        </SportCard>

        <button
          type="button"
          onClick={() => void handleRebuild()}
          disabled={rebuilding}
          className="sp-label mt-[18px] inline-flex min-h-12 w-full items-center justify-center gap-2.5 rounded-full px-[18px] py-4 font-bold text-[#0a0b0d] disabled:cursor-wait disabled:opacity-70"
          style={{
            background: "var(--sp-lime)",
            border: 0,
            boxShadow: "0 0 32px rgba(214,255,58,.35)",
            color: "#0a0b0d",
          }}
        >
          {rebuilding ? (
            <>
              <span
                aria-hidden="true"
                className="inline-block size-2 rounded-full bg-[#0a0b0d]"
              />
              重新建立中...
            </>
          ) : (
            <>
              <SportBoltIcon size={14} stroke={2.2} />
              重新建立訪客日記
            </>
          )}
        </button>
      </div>
    </SportScreen>
  );
}
