import type { Message } from "../types.js";

export function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const text = message.content || "(圖片)";
  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 ${
          isUser
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-900"
        }`}
      >
        <p className="whitespace-pre-wrap text-sm">{text}</p>
        {message.imagePath ? <p className="mt-1 text-xs opacity-70">附帶圖片</p> : null}
      </div>
    </div>
  );
}
