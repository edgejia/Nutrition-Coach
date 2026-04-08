import { useEffect, useRef } from "react";
import { useStore } from "../store.js";
import { sendMessage, loadHistory } from "../api.js";
import { MessageBubble } from "./MessageBubble.js";
import { ChatInput } from "./ChatInput.js";
import { DashboardMiniBar } from "./DashboardMiniBar.js";
import type { PendingHomeChatDraft } from "../types.js";

export function ChatPanel() {
  const deviceId = useStore((s) => s.deviceId);
  const messages = useStore((s) => s.messages);
  const setMessages = useStore((s) => s.setMessages);
  const addMessage = useStore((s) => s.addMessage);
  const setDailySummary = useStore((s) => s.setDailySummary);
  const sending = useStore((s) => s.sending);
  const setSending = useStore((s) => s.setSending);
  const clearDevice = useStore((s) => s.clearDevice);
  const setActiveScreen = useStore((s) => s.setActiveScreen);
  const pendingHomeChatDraft = useStore((s) => s.pendingHomeChatDraft);
  const setPendingHomeChatDraft = useStore((s) => s.setPendingHomeChatDraft);
  const clearPendingHomeChatDraft = useStore((s) => s.clearPendingHomeChatDraft);
  const endRef = useRef<HTMLDivElement>(null);
  const attemptedDraftIdsRef = useRef<Set<string>>(new Set());

  const isChatLocked = sending;

  async function handleSend(text: string, image?: File, opts?: { draftId?: string; appendUserBubble?: boolean }) {
    const activeDeviceId = useStore.getState().deviceId;
    if (!activeDeviceId) return;
    if (opts?.appendUserBubble !== false) {
      const imagePreviewUrl = image ? URL.createObjectURL(image) : undefined;
      const userMsg = {
        id: crypto.randomUUID(),
        role: "user" as const,
        content: text || "",
        imagePreviewUrl,
        createdAt: new Date().toISOString(),
      };
      addMessage(userMsg);
    }
    setSending(true);
    try {
      const { reply, didLogMeal, dailySummary } = await sendMessage(text, image);
      if (useStore.getState().deviceId !== activeDeviceId) return;
      if (opts?.draftId && useStore.getState().pendingHomeChatDraft?.id === opts.draftId) {
        clearPendingHomeChatDraft();
      }
      if (didLogMeal && dailySummary) {
        setDailySummary(dailySummary);
      }
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: reply,
        createdAt: new Date().toISOString(),
        didLogMeal,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        if (opts?.draftId && useStore.getState().pendingHomeChatDraft?.id === opts.draftId) {
          clearPendingHomeChatDraft();
        }
        clearDevice();
        return;
      }
      if (useStore.getState().deviceId !== activeDeviceId) return;
      addMessage({
        id: crypto.randomUUID(),
        role: "assistant",
        content: "抱歉，發生錯誤，請再試一次。",
        createdAt: new Date().toISOString(),
      });
      if (opts?.draftId) {
        const currentDraft = useStore.getState().pendingHomeChatDraft;
        if (currentDraft && currentDraft.id === opts.draftId) {
          setPendingHomeChatDraft({ ...currentDraft, status: "failed" });
        }
      }
    } finally {
      if (useStore.getState().deviceId === activeDeviceId) {
        setSending(false);
      }
    }
  }

  async function sendPendingDraft(draft: PendingHomeChatDraft) {
    attemptedDraftIdsRef.current.add(draft.id);
    setPendingHomeChatDraft({ ...draft, status: "sending" });
    await handleSend(draft.text, draft.image, {
      draftId: draft.id,
      appendUserBubble: draft.status !== "failed",
    });
  }

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    const activeDeviceId = deviceId;
    loadHistory()
      .then(async ({ messages }) => {
        if (cancelled) return;
        if (useStore.getState().deviceId !== activeDeviceId) return;
        setMessages(messages);
        const draft = useStore.getState().pendingHomeChatDraft;
        if (draft && draft.status === "staged" && !attemptedDraftIdsRef.current.has(draft.id)) {
          await sendPendingDraft(draft);
        }
      })
      .catch(async (err) => {
        if (cancelled) return;
        if (err instanceof Error && err.message === "UNAUTHORIZED") {
          clearDevice();
          return;
        }
        const draft = useStore.getState().pendingHomeChatDraft;
        if (draft && draft.status === "staged" && !attemptedDraftIdsRef.current.has(draft.id)) {
          await sendPendingDraft(draft);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, setMessages, clearDevice, setPendingHomeChatDraft]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleBackToHome() {
    if (sending) return;
    clearPendingHomeChatDraft();
    setActiveScreen("home");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col" style={{ background: "var(--bg)" }}>
      <div className="shrink-0 px-5 pb-3 pt-4" style={{ borderBottom: "1px solid var(--border)" }}>
        <button
          type="button"
          onClick={handleBackToHome}
          disabled={isChatLocked}
          className="mb-3 flex items-center gap-2 text-xs font-semibold disabled:opacity-40"
          style={{ color: "var(--text-2)" }}
        >
          <span
            className="flex h-6 w-6 items-center justify-center rounded-lg text-xs"
            style={{
              background: "var(--bg-raised)",
              border: "1px solid var(--border-med)",
            }}
          >
            ‹
          </span>
          返回主頁
        </button>
        <h2
          className="mb-1 leading-none"
          style={{
            fontFamily: "var(--font-display)",
            fontSize: 28,
            fontWeight: 800,
            color: "var(--text)",
            letterSpacing: "-0.025em",
          }}
        >
          教練對話
        </h2>
        <p className="mb-2.5 text-xs leading-relaxed" style={{ color: "var(--text-2)" }}>
          同一個輸入框同時處理提問與記錄。AI 回覆會直接連回今日攝取狀態。
        </p>
        <DashboardMiniBar />
      </div>

      {isChatLocked && (
        <div
          className="shrink-0 px-4 py-2.5 text-sm font-medium"
          style={{
            borderBottom: "1px solid var(--border)",
            background: "var(--bg-card)",
            color: "var(--text-2)",
          }}
        >
          訊息送出中，請稍候。
        </div>
      )}
      {pendingHomeChatDraft?.status === "failed" && (
        <div
          className="shrink-0 px-4 py-3 text-sm"
          style={{
            borderBottom: "1px solid var(--border)",
            background: "rgba(232,160,32,0.06)",
            color: "var(--amber)",
          }}
        >
          上一筆草稿送出失敗。
          <button type="button" onClick={() => sendPendingDraft(pendingHomeChatDraft)} className="ml-3 font-semibold underline">
            重試送出
          </button>
          <button type="button" onClick={clearPendingHomeChatDraft} className="ml-3 font-semibold underline">
            取消草稿
          </button>
        </div>
      )}

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <MessageBubble
            key={m.id}
            message={m}
            onOpenSummary={m.didLogMeal ? () => setActiveScreen("summary") : undefined}
          />
        ))}
        {sending && (
          <div className="flex justify-start">
            <div
              className="flex items-center gap-1 rounded-2xl px-4 py-3"
              style={{ background: "var(--bg-card)", border: "1px solid var(--border-med)" }}
            >
              <span className="h-2 w-2 animate-bounce rounded-full [animation-delay:-0.3s]" style={{ background: "var(--text-3)" }} />
              <span className="h-2 w-2 animate-bounce rounded-full [animation-delay:-0.15s]" style={{ background: "var(--text-3)" }} />
              <span className="h-2 w-2 animate-bounce rounded-full" style={{ background: "var(--text-3)" }} />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="shrink-0 px-3 pb-safe" style={{ borderTop: "1px solid var(--border)", background: "var(--bg)" }}>
        <ChatInput onSend={handleSend} disabled={sending} />
      </div>
    </div>
  );
}
