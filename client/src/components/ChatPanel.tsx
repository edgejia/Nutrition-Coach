import { useEffect, useRef } from "react";
import { useStore } from "../store.js";
import { sendMessage, loadHistory } from "../api.js";
import { MessageBubble } from "./MessageBubble.js";
import { ChatInput } from "./ChatInput.js";

export function ChatPanel() {
  const deviceId = useStore((s) => s.deviceId);
  const messages = useStore((s) => s.messages);
  const setMessages = useStore((s) => s.setMessages);
  const addMessage = useStore((s) => s.addMessage);
  const sending = useStore((s) => s.sending);
  const setSending = useStore((s) => s.setSending);
  const clearDevice = useStore((s) => s.clearDevice);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!deviceId) return;
    let cancelled = false;
    const activeDeviceId = deviceId;
    loadHistory()
      .then(({ messages }) => {
        if (cancelled) return;
        if (useStore.getState().deviceId !== activeDeviceId) return;
        setMessages(messages);
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof Error && err.message === "UNAUTHORIZED") clearDevice();
      });
    return () => {
      cancelled = true;
    };
  }, [deviceId, setMessages, clearDevice]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(text: string, image?: File) {
    const activeDeviceId = useStore.getState().deviceId;
    if (!activeDeviceId) return;
    const userMsg = { id: crypto.randomUUID(), role: "user" as const, content: text || "(圖片)", createdAt: new Date().toISOString() };
    addMessage(userMsg);
    setSending(true);
    try {
      const { reply } = await sendMessage(text, image);
      if (useStore.getState().deviceId !== activeDeviceId) return;
      addMessage({ id: crypto.randomUUID(), role: "assistant", content: reply, createdAt: new Date().toISOString() });
    } catch (err) {
      if (err instanceof Error && err.message === "UNAUTHORIZED") { clearDevice(); return; }
      if (useStore.getState().deviceId !== activeDeviceId) return;
      addMessage({ id: crypto.randomUUID(), role: "assistant", content: "抱歉，發生錯誤，請再試一次。", createdAt: new Date().toISOString() });
    } finally {
      if (useStore.getState().deviceId === activeDeviceId) {
        setSending(false);
      }
    }
  }

  return (
    <div className="flex flex-1 flex-col">
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        <div ref={endRef} />
      </div>
      <ChatInput onSend={handleSend} disabled={sending} />
    </div>
  );
}
