import type { Message } from "../types.js";

type ProvisionalBubbleProps = {
  isProvisional: boolean;
  isStatusLabel: boolean;
};

export function MessageBubble(props: {
  message: Message;
  onOpenSummary?: () => void;
} & Partial<ProvisionalBubbleProps>) {
  const { message, onOpenSummary, isProvisional, isStatusLabel } = props;
  const isUser = message.role === "user";

  if (isUser) {
    const hasImage = Boolean(message.imagePreviewUrl);
    const hasText = Boolean(message.content);
    const isImageOnly = hasImage && !hasText;

    if (isImageOnly) {
      return (
        <div className="flex justify-end">
          <img
            src={message.imagePreviewUrl}
            alt="附圖"
            className="max-w-[80%] rounded-2xl object-contain max-h-64"
          />
        </div>
      );
    }

    // image+text OR text-only — both use orange gradient bubble
    return (
      <div className="flex justify-end">
        <div
          className="max-w-[80%] rounded-3xl px-4 py-3 text-sm font-normal leading-relaxed text-white"
          style={{
            background: "linear-gradient(135deg, #D45E22, #E8682A, #F07832)",
            borderBottomRightRadius: 6,
            boxShadow: "0 4px 16px rgba(232,104,42,0.3)",
          }}
        >
          {hasImage && (
            <img
              src={message.imagePreviewUrl}
              alt="附圖"
              className="mb-2 max-h-48 w-full rounded-xl object-contain"
            />
          )}
          {hasText && <p className="whitespace-pre-wrap">{message.content}</p>}
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
        {message.content &&
          (isStatusLabel ? (
            <p className="text-sm leading-relaxed" style={{ color: "var(--text-2)", fontStyle: "italic" }}>
              {message.content}
              {isProvisional && (
                <span className="animate-pulse" style={{ color: "var(--text-3)" }}>
                  ...
                </span>
              )}
            </p>
          ) : (
            <p className="whitespace-pre-wrap">
              {message.content}
              {isProvisional && (
                <span className="animate-pulse" style={{ color: "var(--orange)" }}>
                  |
                </span>
              )}
            </p>
          ))}
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
