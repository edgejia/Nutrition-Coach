import { useState } from "react";
import { useStore } from "../store.js";
import { SportBoltIcon } from "./SportIcons.js";

export function GuestSessionRecoveryGate() {
  const rebuildGuestSession = useStore((s) => s.rebuildGuestSession);
  const [rebuilding, setRebuilding] = useState(false);

  async function handleRebuild() {
    setRebuilding(true);
    try {
      await rebuildGuestSession();
    } finally {
      setRebuilding(false);
    }
  }

  return (
    <div className="sp-screen" style={{ justifyContent: "center", alignItems: "stretch" }}>
      <div style={{
        flex: 1,
        display: "flex", flexDirection: "column", justifyContent: "center",
        padding: "0 22px",
      }}>
        <div style={{ display: "inline-flex", alignSelf: "flex-start", marginBottom: 24 }}>
          <span style={{
            display: "inline-flex", alignItems: "center", gap: 8,
            padding: "6px 12px",
            background: "rgba(255,77,77,.12)",
            border: "1px solid rgba(255,77,77,.32)",
            borderRadius: 999,
            color: "#ffb3b3",
            fontFamily: "var(--sp-font-mono)", fontSize: 10,
            letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600,
          }}>
            <span style={{
              width: 6, height: 6, borderRadius: 999, background: "#ff4d4d",
              boxShadow: "0 0 10px #ff4d4d",
              animation: "sp-pulse 1.6s ease-in-out infinite",
            }} />
            工作階段已失效
          </span>
        </div>

        <h1 className="sp-zh" style={{ fontSize: 34, lineHeight: 1.12, margin: 0, color: "var(--sp-ink)", fontWeight: 900 }}>
          訪客日記<br/>暫時離線
        </h1>

        <p className="sp-zh" style={{
          fontSize: 14, lineHeight: 1.6,
          margin: "20px 0 0",
          color: "var(--sp-ink-2)", maxWidth: 320,
        }}>
          這個瀏覽器的訪客工作階段已失效。
          我們嘗試過一次自動恢復，但無法安全地接回原本的日記。
          重新建立會給你一個全新的訪客日記。
        </p>

        <div style={{
          marginTop: 22,
          background: "var(--sp-surface)",
          border: "1px solid var(--sp-line)",
          borderRadius: "var(--sp-r-md)",
          padding: "14px 16px",
          display: "flex", flexDirection: "column", gap: 6,
        }}>
          {[
            { k: "工作階段", v: "需重新建立" },
            { k: "自動恢復", v: "無法安全接回" },
            { k: "保存位置", v: "這個瀏覽器" },
          ].map(({ k, v }) => (
            <div key={k} style={{
              display: "flex", justifyContent: "space-between", gap: 12,
              fontFamily: "var(--sp-font-mono)", fontSize: 10,
              color: "var(--sp-ink-3)",
            }}>
              <span>{k}</span>
              <span style={{ color: k === "自動恢復" ? "#ffb3b3" : "var(--sp-ink-2)" }}>{v}</span>
            </div>
          ))}
        </div>

        <button type="button" onClick={() => void handleRebuild()} disabled={rebuilding}
          style={{
            marginTop: 18,
            background: "var(--sp-lime)", color: "#0a0b0d",
            border: 0, borderRadius: "var(--sp-r-pill)",
            padding: "16px 18px",
            fontFamily: "var(--sp-font-mono)", fontSize: 12,
            letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 700,
            cursor: rebuilding ? "wait" : "pointer",
            opacity: rebuilding ? 0.7 : 1,
            boxShadow: "0 0 32px rgba(214,255,58,.35)",
            display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 10,
          }}>
          {rebuilding ? (
            <>
              <span style={{
                width: 8, height: 8, borderRadius: 999, background: "#0a0b0d",
                animation: "sp-pulse 0.9s ease-in-out infinite",
              }} />
              正在重建…
            </>
          ) : (
            <>
              <SportBoltIcon size={14} stroke={2.2} />
              重新建立訪客日記
            </>
          )}
        </button>

        <button type="button" disabled aria-disabled="true" style={{
          marginTop: 10,
          background: "transparent", color: "var(--sp-ink-2)",
          border: "1px solid var(--sp-line)", borderRadius: "var(--sp-r-pill)",
          padding: "12px 18px",
          fontFamily: "var(--sp-font-mono)", fontSize: 11,
          letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 600,
          cursor: "not-allowed",
          opacity: 0.55,
        }}>
          尚未開放 · 先匯出原始紀錄
        </button>

        <p className="sp-zh" style={{
          margin: "20px 0 0",
          fontSize: 11, lineHeight: 1.6,
          color: "var(--sp-ink-3)",
        }}>
          重新建立後，舊紀錄不會自動帶過來。目前不支援從這個畫面匯出原始紀錄。
        </p>
      </div>
    </div>
  );
}
