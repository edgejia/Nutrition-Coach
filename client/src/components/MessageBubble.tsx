import type { Message } from "../types.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";

type ProvisionalBubbleProps = {
  isProvisional: boolean;
  isStatusLabel: boolean;
};

function isImagePlaceholderContent(content: string): boolean {
  return content.trim() === "(圖片)";
}

export function getUserMessagePresentation(message: Message) {
  const imageSrc = message.imagePreviewUrl ?? message.imageUrl ?? undefined;
  const text = isImagePlaceholderContent(message.content) ? "" : message.content;
  const hasImage = Boolean(imageSrc);
  const hasText = Boolean(text);

  return {
    imageSrc,
    text,
    hasImage,
    hasText,
    isImageOnly: hasImage && !hasText,
  };
}

export function MessageBubble(props: {
  message: Message;
  onOpenSummary?: () => void;
} & Partial<ProvisionalBubbleProps>) {
  const { message, onOpenSummary, isProvisional, isStatusLabel } = props;
  const isUser = message.role === "user";

  if (isUser) {
    const { imageSrc, text, hasImage, hasText, isImageOnly } = getUserMessagePresentation(message);

    if (isImageOnly) {
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%]">
            <PersistedAssetImage
              src={imageSrc}
              alt="附圖"
              imgClassName="max-h-64 max-w-full rounded-2xl object-contain"
              fallbackClassName="flex min-h-40 min-w-48 items-center justify-center rounded-2xl border px-4 py-6 text-center text-xs font-semibold"
              fallbackStyle={{
                background: "var(--bg-card)",
                borderColor: "var(--border-med)",
                color: "var(--text-2)",
              }}
            />
          </div>
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
            <PersistedAssetImage
              src={imageSrc}
              alt="附圖"
              imgClassName="mb-2 max-h-48 w-full rounded-xl object-contain"
              fallbackClassName="mb-2 flex min-h-32 w-full items-center justify-center rounded-xl border px-3 py-4 text-center text-xs font-semibold"
              fallbackStyle={{
                background: "rgba(28,27,25,0.32)",
                borderColor: "rgba(255,255,255,0.12)",
                color: "rgba(255,255,255,0.88)",
              }}
            />
          )}
          {hasText && <p className="whitespace-pre-wrap">{text}</p>}
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
