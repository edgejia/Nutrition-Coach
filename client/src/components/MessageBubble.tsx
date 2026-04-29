import type { Message } from "../types.js";
import { AssistantMarkdown } from "./AssistantMarkdown.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";

type ProvisionalBubbleProps = {
  isProvisional: boolean;
  isStatusLabel: boolean;
};

function isImagePlaceholderContent(content: string): boolean {
  return content.trim() === "(圖片)";
}

function hasCompleteLoggedMealReceipt(message: Message) {
  const receipt = message.loggedMeal;
  return Boolean(
    receipt &&
    receipt.foodName.trim().length > 0 &&
    Number.isFinite(receipt.calories) &&
    Number.isFinite(receipt.protein) &&
    Number.isFinite(receipt.carbs) &&
    Number.isFinite(receipt.fat),
  );
}

function formatNutritionValue(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

function NutritionRow({ label, value, unit }: { label: string; value: number; unit: string }) {
  return (
    <div className="flex items-center justify-between gap-4 text-xs">
      <span style={{ color: "var(--sk-ink-soft)" }}>{label}</span>
      <span className="sk-metric" style={{ color: "var(--sk-ink)" }}>
        {formatNutritionValue(value)} {unit}
      </span>
    </div>
  );
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
  onImageSettle?: () => void;
} & Partial<ProvisionalBubbleProps>) {
  const { message, onImageSettle, isProvisional, isStatusLabel } = props;
  const isUser = message.role === "user";

  if (isUser) {
    const { imageSrc, text, hasImage, hasText, isImageOnly } = getUserMessagePresentation(message);

    if (isImageOnly) {
      return (
        <div className="flex justify-end">
          <div className="max-w-[80%] rounded-2xl p-1" style={{ background: "var(--sk-accent-soft)" }}>
            <PersistedAssetImage
              src={imageSrc}
              alt="附圖"
              imgClassName="max-h-64 max-w-full rounded-xl object-contain"
              fallbackClassName="flex min-h-40 min-w-48 items-center justify-center rounded-xl border px-4 py-6 text-center text-xs font-semibold"
              fallbackStyle={{
                background: "var(--sk-paper)",
                borderColor: "var(--sk-ink)",
                color: "var(--sk-ink-soft)",
              }}
              onAssetSettle={onImageSettle}
            />
          </div>
        </div>
      );
    }

    return (
      <div className="flex justify-end">
        <div
          className="max-w-[80%] rounded-2xl px-4 py-3 text-sm font-normal leading-relaxed"
          style={{
            background: "var(--sk-accent-soft)",
            border: "1.25px solid var(--sk-ink)",
            borderBottomRightRadius: 6,
            color: "var(--sk-ink)",
          }}
        >
          {hasImage && (
            <PersistedAssetImage
              src={imageSrc}
              alt="附圖"
              imgClassName="mb-2 max-h-48 w-full rounded-xl object-contain"
              fallbackClassName="mb-2 flex min-h-32 w-full items-center justify-center rounded-xl border px-3 py-4 text-center text-xs font-semibold"
              fallbackStyle={{
                background: "var(--sk-paper)",
                borderColor: "var(--sk-ink)",
                color: "var(--sk-ink-soft)",
              }}
              onAssetSettle={onImageSettle}
            />
          )}
          {hasText && <p className="whitespace-pre-wrap">{text}</p>}
        </div>
      </div>
    );
  }

  if (hasCompleteLoggedMealReceipt(message) && message.loggedMeal) {
    return (
      <div className="flex justify-start">
        <div className="sk-box-soft max-w-[88%] px-4 py-3">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div>
              <div className="sk-heading text-base leading-none" style={{ color: "var(--sk-ink)" }}>
                已記錄 ✓
              </div>
              <div className="mt-1 text-sm leading-snug" style={{ color: "var(--sk-ink)" }}>
                {message.loggedMeal.foodName}
              </div>
            </div>
          </div>
          <div className="grid gap-1.5">
            <NutritionRow label="熱量" value={message.loggedMeal.calories} unit="kcal" />
            <NutritionRow label="蛋白" value={message.loggedMeal.protein} unit="g" />
            <NutritionRow label="碳水" value={message.loggedMeal.carbs} unit="g" />
            <NutritionRow label="脂肪" value={message.loggedMeal.fat} unit="g" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex justify-start">
      <div className="sk-box-soft max-w-[88%] px-4 py-3 text-sm leading-relaxed" style={{ borderTopLeftRadius: 6 }}>
        {message.content &&
          (isStatusLabel ? (
            <p className="text-sm leading-relaxed" style={{ color: "var(--sk-ink-soft)" }}>
              {message.content}
              {isProvisional && (
                <span className="sk-caret ml-1 animate-pulse" style={{ color: "var(--sk-ink-faint)" }}>
                  ...
                </span>
              )}
            </p>
          ) : (
            <>
              {isProvisional ? (
                <p className="whitespace-pre-wrap">
                  {message.content}
                  <span className="sk-caret ml-0.5 animate-pulse" style={{ color: "var(--sk-accent)" }}>
                    |
                  </span>
                </p>
              ) : (
                <AssistantMarkdown content={message.content} />
              )}
            </>
          ))}
      </div>
    </div>
  );
}
