import type {
  ProposalActionEventMetadata,
  ProposalActionRequest,
  ProposalCardMetadata,
} from "../types.js";
import { useRef, type KeyboardEvent } from "react";

type ActiveProposalEdit = {
  messageId: string;
  proposalId: string;
  value: string;
};

function cx(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}

function getStatusCopy(status: ProposalCardMetadata["status"]) {
  switch (status) {
    case "active":
      return "待確認";
    case "approved":
      return "已套用";
    case "rejected":
      return "已取消";
    case "expired":
      return "已過期";
    case "superseded":
      return "已取代";
    case "stale":
      return "已失效";
  }
}

function getDefaultInputHint(proposalKind: ProposalCardMetadata["proposalKind"]) {
  switch (proposalKind) {
    case "goal":
      return "輸入新的每日目標，例如：蛋白質改 120g";
    case "meal_numeric":
      return "輸入你想改成的數字，例如：蛋白質改 30g";
    case "meal_estimate":
      return "輸入明確數字，例如：熱量改 460 kcal 或蛋白質改 30g";
    case "meal_delete":
      return "輸入新的需求；這不會直接刪除餐點";
  }
}

export function ProposalActionEvent({ event }: { event: ProposalActionEventMetadata }) {
  return (
    <div className="sp-message-row sp-message-row-user">
      <div className="sp-proposal-action-event">
        <span className="sp-proposal-action-event-label">提案動作</span>
        <span>{event.transcriptCopy}</span>
      </div>
    </div>
  );
}

export function ProposalCard({
  proposalCard,
  onApprove,
  onEdit,
  onReject,
  activeEdit,
  pendingAction,
  isActionPending,
  actionError,
  onInlineEditChange,
  onInlineEditSubmit,
  onCancelEdit,
}: {
  proposalCard: ProposalCardMetadata;
  onApprove?: (request: ProposalActionRequest) => void;
  onEdit?: (proposalCard: ProposalCardMetadata) => void;
  onReject?: (request: ProposalActionRequest) => void;
  activeEdit?: ActiveProposalEdit;
  pendingAction?: ProposalActionRequest["action"] | null;
  isActionPending?: boolean;
  actionError?: string | null;
  onInlineEditChange?: (value: string) => void;
  onInlineEditSubmit?: () => void;
  onCancelEdit?: () => void;
}) {
  const isActive = proposalCard.status === "active" && proposalCard.isActionable;
  const isDelete = proposalCard.proposalKind === "meal_delete";
  const isEditing = activeEdit?.proposalId === proposalCard.proposalId;
  const inputHint = proposalCard.inputHint ?? getDefaultInputHint(proposalCard.proposalKind);
  const isPending = Boolean(isActionPending || pendingAction);
  const isComposingRef = useRef(false);
  const canSubmitInlineEdit = Boolean(activeEdit?.value.trim());
  const isInlineSubmitDisabled = activeEdit ? !canSubmitInlineEdit || isPending : false;

  function submitInlineEdit() {
    if (!canSubmitInlineEdit) {
      return;
    }
    if (isPending) {
      return;
    }
    onInlineEditSubmit?.();
  }

  function handleInlineEditKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;
    if (isComposingRef.current) return;
    if (event.key !== "Enter") return;
    if (event.shiftKey) return;

    event.preventDefault();
    submitInlineEdit();
  }

  return (
    <div className="sp-message-row sp-message-row-assistant">
      <section
        className={cx(
          "sp-proposal-card",
          isActive && "sp-proposal-card-active",
          actionError && "sp-proposal-card-error",
          !isActive && "sp-proposal-inactive",
        )}
        aria-label={proposalCard.title}
        aria-busy={isPending}
      >
        <div className="sp-proposal-head">
          <div>
            <div className="sp-proposal-eyebrow">確認提案</div>
            <h3>{proposalCard.title}</h3>
          </div>
          <span className="sp-proposal-status">{getStatusCopy(proposalCard.status)}</span>
        </div>

        <div className="sp-proposal-rows">
          {proposalCard.details.rows.map((row, index) => (
            <div className="sp-proposal-row" key={`${row.label}-${index}`}>
              <span>{row.label}</span>
              <span>
                {row.before || row.after ? (
                  <>
                    {row.before ? <i>{row.before}</i> : null}
                    {row.before && row.after ? <b aria-hidden="true">→</b> : null}
                    {row.after ? <strong>{row.after}</strong> : null}
                  </>
                ) : (
                  row.value
                )}
              </span>
            </div>
          ))}
        </div>

        {isActive ? (
          <>
            <div className="sp-proposal-actions">
              <button
                className={cx("sp-proposal-action", "sp-proposal-approve", isDelete && "sp-proposal-danger")}
                type="button"
                disabled={isPending}
                onClick={() => onApprove?.({
                  proposalId: proposalCard.proposalId,
                  kind: proposalCard.proposalKind,
                  action: "approve",
                })}
              >
                {proposalCard.actions.approveLabel}
              </button>
              <button
                className="sp-proposal-action sp-proposal-edit"
                type="button"
                disabled={isPending}
                onClick={() => onEdit?.(proposalCard)}
              >
                {proposalCard.actions.editLabel}
              </button>
              <button
                className="sp-proposal-action sp-proposal-reject"
                type="button"
                disabled={isPending}
                onClick={() => onReject?.({
                  proposalId: proposalCard.proposalId,
                  kind: proposalCard.proposalKind,
                  action: "reject",
                })}
              >
                {proposalCard.actions.rejectLabel}
              </button>
            </div>
            {isEditing ? (
              <form
                className="sp-proposal-inline-edit"
                onSubmit={(event) => {
                  event.preventDefault();
                  submitInlineEdit();
                }}
              >
                <textarea
                  aria-label={inputHint}
                  autoFocus
                  className="sp-proposal-inline-input"
                  onChange={(event) => onInlineEditChange?.(event.currentTarget.value)}
                  onCompositionStart={() => {
                    isComposingRef.current = true;
                  }}
                  onCompositionEnd={() => {
                    isComposingRef.current = false;
                  }}
                  onKeyDown={handleInlineEditKeyDown}
                  placeholder={inputHint}
                  rows={2}
                  value={activeEdit.value}
                />
                <div className="sp-proposal-inline-actions">
                  <button
                    className="sp-proposal-action sp-proposal-inline-send"
                    type="submit"
                    disabled={isInlineSubmitDisabled}
                    aria-disabled={isInlineSubmitDisabled}
                  >
                    送出
                  </button>
                  <button
                    className="sp-proposal-action sp-proposal-inline-cancel"
                    type="button"
                    disabled={isPending}
                    onClick={() => onCancelEdit?.()}
                  >
                    關閉編輯
                  </button>
                </div>
              </form>
            ) : null}
            {isPending ? (
              <p className="sp-proposal-pending" role="status">
                處理中...
              </p>
            ) : null}
            {actionError ? (
              <p className="sp-proposal-error" role="alert">
                {actionError}
              </p>
            ) : null}
          </>
        ) : (
          <p className="sp-proposal-lapse">
            {proposalCard.lapseCopy ?? "這個提案目前無法處理，可能已過期或被新的提案取代。請重新提出需求。"}
          </p>
        )}
      </section>
    </div>
  );
}
