import { useRef, useState, type FormEvent } from "react";

export function ChatEntryBar(props: {
  onSend: (message: string, image?: File) => void;
  disabled: boolean;
}) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!text.trim() && !image) return;
    props.onSend(text.trim(), image ?? undefined);
    setText("");
    setImage(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-end gap-2 rounded-2xl border bg-white p-3 shadow-sm">
      <button type="button" onClick={() => fileRef.current?.click()} className="rounded-lg bg-gray-100 p-2 text-gray-600 hover:bg-gray-200">
        +
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(event) => setImage(event.target.files?.[0] ?? null)}
      />
      <div className="flex flex-1 flex-col">
        {image && <span className="mb-1 text-xs text-gray-500">{image.name}</span>}
        <input
          type="text"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Ask the coach or log a meal with text / photo"
          disabled={props.disabled}
          className="w-full border-0 px-0 py-2 text-sm focus:outline-none disabled:opacity-50"
        />
      </div>
      <button
        type="submit"
        disabled={props.disabled || (!text.trim() && !image)}
        className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        送出
      </button>
    </form>
  );
}
