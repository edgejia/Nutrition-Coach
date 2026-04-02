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
    <form onSubmit={handleSubmit} className="flex items-end gap-2 rounded-2xl border bg-white p-3 shadow-sm">
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="rounded-lg bg-gray-100 p-2 text-gray-600 hover:bg-gray-200"
        title="上傳圖片"
      >
        +
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => setImage(e.target.files?.[0] ?? null)}
      />
      <div className="flex flex-1 flex-col">
        {image && (
          <span className="mb-1 text-xs text-gray-500">
            {image.name}
            <button type="button" onClick={() => { setImage(null); if (fileRef.current) fileRef.current.value = ""; }} className="ml-1 text-red-500">x</button>
          </span>
        )}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="輸入食物或問問題..."
          disabled={disabled}
          rows={1}
          className="w-full resize-none rounded-lg border px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
        />
      </div>
      <button
        type="submit"
        disabled={disabled || !canSend}
        className="rounded-lg bg-blue-600 px-4 py-2 text-sm text-white hover:bg-blue-700 disabled:opacity-50"
      >
        送出
      </button>
    </form>
  );
}
