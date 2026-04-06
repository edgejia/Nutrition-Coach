import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";

interface ChatInputProps {
  onSend: (message: string, image?: File) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = Boolean(text.trim() || image);

  function submitMessage() {
    if (disabled || !canSend) return;
    onSend(text.trim(), image ?? undefined);
    setText("");
    setImage(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    submitMessage();
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      submitMessage();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2.5 py-2">
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => setImage(e.target.files?.[0] ?? null)}
      />
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={disabled}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg disabled:opacity-50"
        style={{
          background: "var(--bg-raised)",
          border: "1px solid var(--border-med)",
          color: "var(--text-2)",
        }}
      >
        📷
      </button>
      <div className="flex flex-1 flex-col">
        {image && (
          <span className="mb-1 text-xs" style={{ color: "var(--text-3)" }}>
            {image.name}{" "}
            <button
              type="button"
              onClick={() => {
                setImage(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              style={{ color: "var(--red)" }}
            >
              ×
            </button>
          </span>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Describe meal, ask a question, or upload a photo..."
          disabled={disabled}
          rows={1}
          className="w-full resize-none rounded-xl px-3 py-2.5 text-sm focus:outline-none disabled:opacity-50"
          style={{
            background: "var(--bg-raised)",
            border: "1px solid var(--border-med)",
            color: "var(--text)",
            fontFamily: "var(--font-body)",
          }}
        />
      </div>
      <button
        type="submit"
        disabled={disabled || !canSend}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-lg font-bold disabled:opacity-50"
        style={{
          background: canSend ? "var(--orange)" : "var(--bg-raised)",
          border: canSend ? "none" : "1px solid var(--border-med)",
          color: canSend ? "white" : "var(--text-3)",
          boxShadow: canSend ? "0 4px 16px rgba(232,104,42,0.3)" : "none",
          transition: "all 0.15s",
        }}
      >
        ↑
      </button>
    </form>
  );
}
