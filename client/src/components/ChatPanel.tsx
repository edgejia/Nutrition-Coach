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
      const userMsg = { id: crypto.randomUUID(), role: "user" as const, content: text || "", imagePreviewUrl, createdAt: new Date().toISOString() };
      addMessage(userMsg);
    }
    setSending(true);
    try {
      const { reply, didLogMeal } = await sendMessage(text, image);
      if (useStore.getState().deviceId !== activeDeviceId) return;
      if (opts?.draftId && useStore.getState().pendingHomeChatDraft?.id === opts.draftId) {
        clearPendingHomeChatDraft();
      }
      addMessage({ id: crypto.randomUUID(), role: "assistant", content: reply, createdAt: new Date().toISOString(), didLogMeal });
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") {
        if (opts?.draftId && useStore.getState().pendingHomeChatDraft?.id === opts.draftId) {
          clearPendingHomeChatDraft();
        }
        clearDevice();
        return;
      }
      if (useStore.getState().deviceId !== activeDeviceId) return;
      addMessage({ id: crypto.randomUUID(), role: "assistant", content: "抱歉，發生錯誤，請再試一次。", createdAt: new Date().toISOString() });
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
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof Error && err.message === "UNAUTHORIZED") clearDevice();
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
    <div className="flex min-h-0 flex-1 flex-col bg-gray-50">
      <DashboardMiniBar />
      <div className="flex items-center justify-between border-b bg-white px-4 py-3">
        <span className="text-sm font-semibold text-gray-900">Expanded Chat</span>
        <button
          type="button"
          onClick={handleBackToHome}
          disabled={isChatLocked}
          className="text-sm text-blue-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40"
        >
          返回 Dashboard
        </button>
      </div>
      {isChatLocked && (
        <div className="border-b bg-gray-50 px-4 py-3 text-sm text-gray-600">
          訊息送出中，請稍候。
        </div>
      )}
      {pendingHomeChatDraft?.status === "failed" && (
        <div className="border-b bg-amber-50 px-4 py-3 text-sm text-amber-900">
          上一筆草稿送出失敗。
          <button
            type="button"
            onClick={() => sendPendingDraft(pendingHomeChatDraft)}
            className="ml-3 font-medium underline"
          >
            重試送出
          </button>
          <button
            type="button"
            onClick={clearPendingHomeChatDraft}
            className="ml-3 font-medium underline"
          >
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
            <div className="flex items-center gap-1 rounded-2xl bg-gray-100 px-4 py-3">
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.3s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400 [animation-delay:-0.15s]" />
              <span className="h-2 w-2 animate-bounce rounded-full bg-gray-400" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>
      <ChatInput onSend={handleSend} disabled={sending} />
    </div>
  );
}
