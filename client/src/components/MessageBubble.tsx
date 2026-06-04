import type { MealEditPayload, Message } from "../types.js";
import type { KeyboardEvent } from "react";
import { formatTurnReference } from "../api.js";
import { buildReceiptMealEditPayload } from "../meal-edit-payload.js";
import { AssistantMarkdown } from "./AssistantMarkdown.js";
import { PersistedAssetImage } from "./PersistedAssetImage.js";
import { SportBoltIcon, SportChevronRightIcon } from "./SportIcons.js";
import { SportReceipt } from "./SportPrimitives.js";

type ProvisionalBubbleProps = {
  isProvisional: boolean;
  isStatusLabel: boolean;
};

function isImagePlaceholderContent(content: string): boolean {
  return content.trim() === "(圖片)";
}

function formatNutritionValue(value: number) {
  return Math.round(value).toLocaleString("en-US");
}

const macroLabelCopy = {
  protein: "蛋白質",
  carbs: "碳水",
  fat: "脂肪",
} satisfies Record<"protein" | "carbs" | "fat", string>;

function isCompleteLoggedMealReceipt(message: Message) {
  return getCompleteReceiptEditPayload(message) !== null;
}

export function getCompleteReceiptEditPayload(message: Message): MealEditPayload | null {
  return buildReceiptMealEditPayload(message.loggedMeal);
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

function MacroRow({ label, value }: { label: "protein" | "carbs" | "fat"; value: number }) {
  return (
    <div className="sp-receipt-row">
      <span>{macroLabelCopy[label]}</span>
      <span>{formatNutritionValue(value)} g</span>
    </div>
  );
}

function ReceiptCard(props: {
  message: Message;
  editPayload: MealEditPayload | null;
  onOpenMealEdit?: (payload: MealEditPayload) => void;
}) {
  const { message, editPayload, onOpenMealEdit } = props;
  const loggedMeal = message.loggedMeal;

  if (!loggedMeal) {
    return null;
  }

  const isDeletedReceipt = loggedMeal.receiptStatus === "deleted";
  const receiptLabel = isDeletedReceipt ? "已刪除" : "已記錄";
  const canEdit = !isDeletedReceipt && editPayload !== null && onOpenMealEdit !== undefined;
  const receiptClassName = `sp-receipt-card${canEdit ? " sp-receipt-button" : ""}${
    isDeletedReceipt ? " sp-receipt-deleted" : ""
  }`;

  function handleOpenReceipt() {
    if (!editPayload) {
      return;
    }
    onOpenMealEdit?.(editPayload);
  }

  function handleReceiptKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!canEdit || (event.key !== "Enter" && event.key !== " ")) {
      return;
    }

    event.preventDefault();
    handleOpenReceipt();
  }

  return (
    <div className="sp-message-row sp-message-row-assistant">
      <SportReceipt
        className={receiptClassName}
        aria-label={
          canEdit
            ? `編輯 ${loggedMeal.foodName}`
            : isDeletedReceipt
              ? `${loggedMeal.foodName}，已刪除，歷史餐點快照`
              : undefined
        }
        onClick={canEdit ? handleOpenReceipt : undefined}
        onKeyDown={canEdit ? handleReceiptKeyDown : undefined}
        role={canEdit ? "button" : undefined}
        tabIndex={canEdit ? 0 : undefined}
      >
        <div
          className={`sp-receipt-head${loggedMeal.imageUrl ? " sp-receipt-head-with-thumbnail" : ""}`}
        >
          {loggedMeal.imageUrl ? (
            <div className="sp-receipt-thumbnail-frame">
              <PersistedAssetImage
                src={loggedMeal.imageUrl}
                alt={`${loggedMeal.foodName} 整餐照片`}
                imgClassName="sp-receipt-thumbnail"
                fallbackClassName="sp-receipt-thumbnail sp-receipt-thumbnail-fallback"
              />
            </div>
          ) : null}
          <div className="sp-receipt-title">
            <div className="sp-receipt-label">{receiptLabel}</div>
            <div className="sp-receipt-food">{loggedMeal.foodName}</div>
          </div>
          <div className="sp-receipt-kcal">
            <span>{formatNutritionValue(loggedMeal.calories)}</span>
            <small>kcal</small>
          </div>
          {canEdit ? (
            <span className="sp-receipt-chevron" aria-hidden="true">
              <SportChevronRightIcon size={16} stroke={2} />
            </span>
          ) : null}
        </div>
        <div className="sp-receipt-macros">
          <MacroRow label="protein" value={loggedMeal.protein} />
          <MacroRow label="carbs" value={loggedMeal.carbs} />
          <MacroRow label="fat" value={loggedMeal.fat} />
        </div>
      </SportReceipt>
    </div>
  );
}

function AssistantTextBubble(props: {
  message: Message;
  isProvisional?: boolean;
  isStatusLabel?: boolean;
}) {
  const { message, isProvisional, isStatusLabel } = props;
  const isFallbackOrError = message.status === "error" || message.content.includes("抱歉，發生錯誤");
  const isError = !isProvisional && isFallbackOrError;
  const turnReference =
    !isProvisional &&
    !isStatusLabel &&
    isFallbackOrError &&
    typeof message.turnId === "string" &&
    message.turnId.trim().length > 0
      ? formatTurnReference(message.turnId)
      : null;

  if (!message.content.trim()) {
    return null;
  }

  if (isStatusLabel) {
    return (
      <div className="sp-message-row sp-message-row-assistant">
        <div className="sp-status-bubble">
          <SportBoltIcon size={14} stroke={2} />
          <span>{message.content}</span>
          {isProvisional ? <i className="sp-status-dot" aria-hidden="true" /> : null}
        </div>
      </div>
    );
  }

  return (
    <div className="sp-message-row sp-message-row-assistant">
      <div className={`sp-bubble-asst${isError ? " sp-bubble-error" : ""}`}>
        {isProvisional ? (
          <p className="whitespace-pre-wrap">
            {message.content}
            <span className="sp-stream-caret" aria-hidden="true">
              |
            </span>
          </p>
        ) : (
          <AssistantMarkdown content={message.content} />
        )}
        {turnReference ? <div className="sp-turn-reference">引用碼 {turnReference}</div> : null}
      </div>
    </div>
  );
}

export function MessageBubble(props: {
  message: Message;
  onImageSettle?: () => void;
  onOpenMealEdit?: (payload: MealEditPayload) => void;
} & Partial<ProvisionalBubbleProps>) {
  const { message, onImageSettle, onOpenMealEdit, isProvisional, isStatusLabel } = props;
  const isUser = message.role === "user";

  if (isUser) {
    const { imageSrc, text, hasImage, hasText, isImageOnly } = getUserMessagePresentation(message);

    return (
      <div className="sp-message-row sp-message-row-user">
        {isImageOnly ? (
          <PersistedAssetImage
            src={imageSrc}
            alt="附圖"
            imgClassName="sp-message-image sp-message-image-only"
            fallbackClassName="sp-message-image-fallback"
            onAssetSettle={onImageSettle}
          />
        ) : (
          <div className="sp-bubble-user">
            {hasImage && (
              <PersistedAssetImage
                src={imageSrc}
                alt="附圖"
                imgClassName="sp-message-image"
                fallbackClassName="sp-message-image-fallback"
                onAssetSettle={onImageSettle}
              />
            )}
            {hasText && <p className="whitespace-pre-wrap">{text}</p>}
          </div>
        )}
      </div>
    );
  }

  const editPayload = getCompleteReceiptEditPayload(message);
  const shouldRenderReceipt = Boolean(message.loggedMeal);
  const shouldRenderText = message.content.trim().length > 0;

  if (shouldRenderReceipt) {
    return (
      <>
        <ReceiptCard
          message={message}
          editPayload={isCompleteLoggedMealReceipt(message) ? editPayload : null}
          onOpenMealEdit={onOpenMealEdit}
        />
        {shouldRenderText ? (
          <AssistantTextBubble
            message={message}
            isProvisional={isProvisional}
            isStatusLabel={isStatusLabel}
          />
        ) : null}
      </>
    );
  }

  return (
    <AssistantTextBubble
      message={message}
      isProvisional={isProvisional}
      isStatusLabel={isStatusLabel}
    />
  );
}
