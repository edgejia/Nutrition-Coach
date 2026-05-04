import { useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { SportCameraIcon, SportCloseIcon, SportSendIcon } from "./SportIcons.js";

interface ChatInputProps {
  onSend: (message: string, image?: File) => void;
  onBeforeSend?: (payload: { hasImage: boolean; hasText: boolean }) => void;
  disabled: boolean;
}

export function ChatInput({ onSend, onBeforeSend, disabled }: ChatInputProps) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const isComposingRef = useRef(false);
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
    if (e.nativeEvent.isComposing) return;
    if (isComposingRef.current) return;
    if (e.key !== "Enter") return;
    if (e.shiftKey) return;

    if (!e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      submitMessage();
      return;
    }

    if (e.metaKey || e.ctrlKey) {
      e.preventDefault();
      submitMessage();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="sp-chat-input">
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
        className="sp-chat-camera"
        aria-label="附加照片"
      >
        <SportCameraIcon size={20} stroke={1.8} />
      </button>
      <div className="sp-chat-input-well">
        {image && (
          <span className="sp-chat-image-chip">
            <span>{image.name}</span>
            <button
              type="button"
              onClick={() => {
                setImage(null);
                if (fileRef.current) fileRef.current.value = "";
              }}
              aria-label="移除照片"
            >
              <SportCloseIcon size={14} stroke={2} />
            </button>
          </span>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onCompositionStart={() => {
            isComposingRef.current = true;
          }}
          onCompositionEnd={() => {
            isComposingRef.current = false;
          }}
          placeholder="描述你吃了什麼…"
          rows={1}
          className="sp-chat-textarea"
        />
        <button
          type="submit"
          disabled={disabled || !canSend}
          className="sp-chat-send"
          data-ready={canSend}
          aria-label="送出"
        >
          <SportSendIcon size={18} stroke={2} />
        </button>
      </div>
    </form>
  );
}
