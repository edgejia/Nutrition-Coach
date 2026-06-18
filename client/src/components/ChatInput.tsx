import { useLayoutEffect, useRef, useState, type ChangeEvent, type FormEvent, type KeyboardEvent } from "react";
import { getSupportedImageMimeType } from "../api.js";
import { SportCameraIcon, SportCloseIcon, SportSendIcon, SportStopIcon } from "./SportIcons.js";

const UPLOAD_ERROR_COPY = "目前只支援 JPG、PNG、WebP 照片。iPhone HEIC 請先轉成 JPG 後再上傳。";

function shouldUseMobileNewlineBehavior() {
  return window.matchMedia("(pointer: coarse), (hover: none)").matches;
}

interface ChatInputProps {
  onSend: (message: string, image?: File) => void;
  onBeforeSend?: (payload: { hasImage: boolean; hasText: boolean }) => void;
  onStop?: () => void;
  disabled: boolean;
  streaming?: boolean;
  stopDisabled?: boolean;
  stopping?: boolean;
}

export function ChatInput({
  onSend,
  onBeforeSend,
  onStop,
  disabled,
  streaming = false,
  stopDisabled = false,
  stopping = false,
}: ChatInputProps) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const isComposingRef = useRef(false);
  const canSend = Boolean(text.trim() || image);

  function resizeTextarea() {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "auto";
    textarea.style.overflowY = "hidden";
    textarea.style.height = `${textarea.scrollHeight}px`;

    const isOverflowing = textarea.scrollHeight > textarea.clientHeight + 1;
    textarea.style.overflowY = isOverflowing ? "auto" : "hidden";
  }

  useLayoutEffect(() => {
    resizeTextarea();
  }, [text]);

  function handleImageChange(event: ChangeEvent<HTMLInputElement>) {
    const selectedFile = event.target.files?.[0] ?? null;
    if (selectedFile) {
      const supportedMimeType = getSupportedImageMimeType(selectedFile);
      if (!supportedMimeType) {
        setUploadError(UPLOAD_ERROR_COPY);
        setImage(null);
        if (fileRef.current) fileRef.current.value = "";
        return;
      }
    }

    setUploadError("");
    setImage(selectedFile);
    if (!selectedFile && fileRef.current) fileRef.current.value = "";
  }

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
    setUploadError("");
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
    if (!e.metaKey && !e.ctrlKey && shouldUseMobileNewlineBehavior()) return;

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
        onChange={handleImageChange}
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
                setUploadError("");
                if (fileRef.current) fileRef.current.value = "";
              }}
              aria-label="移除照片"
            >
              <SportCloseIcon size={14} stroke={2} />
            </button>
          </span>
        )}
        {uploadError && (
          <p className="sp-chat-upload-error" role="alert">
            {uploadError}
          </p>
        )}
        <textarea
          ref={textareaRef}
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
          enterKeyHint="enter"
          rows={1}
          className="sp-chat-textarea"
        />
        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            disabled={stopDisabled}
            className="sp-chat-send sp-chat-send-stop"
            data-ready="true"
            data-streaming="true"
            data-stopping={stopping}
            aria-label="停止生成"
          >
            <SportStopIcon size={20} stroke={2} />
          </button>
        ) : (
          <button
            type="button"
            onClick={submitMessage}
            disabled={disabled || !canSend}
            className="sp-chat-send"
            data-ready={canSend}
            aria-label="送出"
          >
            <SportSendIcon size={18} stroke={2} />
          </button>
        )}
      </div>
    </form>
  );
}
