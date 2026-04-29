import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CameraIcon, SendIcon } from "./SketchIcons.js";

interface ChatInputProps {
  onSend: (message: string, image?: File) => void;
  onBeforeSend?: (payload: { hasImage: boolean; hasText: boolean }) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, onBeforeSend, disabled }: ChatInputProps) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const canSend = Boolean(text.trim() || image);

  function submitMessage() {
    if (disabled || !canSend) return;
    const trimmedText = text.trim();
    onBeforeSend?.({
      hasImage: image !== null,
      hasText: trimmedText.length > 0,
    });
    onSend(trimmedText, image ?? undefined);
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
    <form onSubmit={handleSubmit} className="flex items-end gap-2 py-2">
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
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
        style={{
          background: "var(--sk-paper)",
          border: "1.5px solid var(--sk-ink)",
          color: "var(--sk-ink)",
          boxShadow: "1px 1.5px 0 var(--sk-ink)",
        }}
        aria-label="附加照片"
      >
        <CameraIcon size={20} />
      </button>
      <div
        className="flex min-h-11 flex-1 flex-col justify-center rounded-[22px] px-3 py-1.5"
        style={{
          background: "var(--sk-paper)",
          border: "1.5px solid var(--sk-ink)",
        }}
      >
        {image && (
          <span className="mb-1 text-xs" style={{ color: "var(--sk-ink-soft)" }}>
            {image.name}{" "}
            <button
              type="button"
              onClick={() => {
                setImage(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              style={{ color: "var(--sk-accent)" }}
              aria-label="移除照片"
            >
              ×
            </button>
          </span>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="記錄 ／ 提問 ／ 修改…"
          disabled={disabled}
          rows={1}
          className="max-h-24 min-h-7 w-full resize-none bg-transparent px-0 py-1 text-sm focus:outline-none disabled:opacity-50"
          style={{
            color: "var(--sk-ink)",
            fontFamily: "var(--sk-font-print)",
          }}
        />
      </div>
      <button
        type="submit"
        disabled={disabled || !canSend}
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full disabled:opacity-50"
        style={{
          background: canSend ? "var(--sk-ink)" : "var(--sk-paper)",
          border: "1.5px solid var(--sk-ink)",
          color: canSend ? "var(--sk-paper)" : "var(--sk-ink-faint)",
          boxShadow: canSend ? "1px 1.5px 0 var(--sk-ink)" : "none",
          transition: "background 0.15s, color 0.15s, box-shadow 0.15s",
        }}
        aria-label="送出"
      >
        <SendIcon size={18} />
      </button>
    </form>
  );
}
