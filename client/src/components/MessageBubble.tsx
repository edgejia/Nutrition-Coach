import type { Message } from "../types.js";

export function MessageBubble(props: {
  message: Message;
  onOpenSummary?: () => void;
}) {
  const { message, onOpenSummary } = props;
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[80%] rounded-3xl px-4 py-3 text-sm font-medium leading-relaxed text-white"
          style={{
            background: "linear-gradient(135deg, #D45E22, #E8682A, #F07832)",
            borderBottomRightRadius: 6,
            boxShadow: "0 4px 16px rgba(232,104,42,0.3)",
          }}
        >
          {message.imagePreviewUrl && (
            <img
              src={message.imagePreviewUrl}
              alt="附圖"
              className="mb-2 max-h-48 w-full rounded-xl object-cover"
            />
          )}
          {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div
        className="max-w-[88%] rounded-3xl px-4 py-3 text-sm leading-relaxed"
        style={{
          background: "var(--bg-card)",
          border: "1px solid var(--border-med)",
          borderTopLeftRadius: 6,
          color: "var(--text)",
        }}
      >
        {message.content && <p className="whitespace-pre-wrap">{message.content}</p>}
        {message.didLogMeal && onOpenSummary && (
          <button
            type="button"
            onClick={onOpenSummary}
            className="mt-3 text-sm font-semibold hover:underline"
            style={{ color: "var(--green)" }}
          >
            查看今日餐點 →
          </button>
        )}
      </div>
    </div>
  );
}
