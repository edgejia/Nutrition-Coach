import type {
  ProposalActionEventMetadata,
  ProposalActionRequest,
  ProposalCardMetadata,
} from "../types.js";

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
}: {
  proposalCard: ProposalCardMetadata;
  onApprove?: (request: ProposalActionRequest) => void;
  onEdit?: (proposalCard: ProposalCardMetadata) => void;
  onReject?: (request: ProposalActionRequest) => void;
}) {
  const isActive = proposalCard.status === "active" && proposalCard.isActionable;
  const isDelete = proposalCard.proposalKind === "meal_delete";

  return (
    <div className="sp-message-row sp-message-row-assistant">
      <section
        className={cx(
          "sp-proposal-card",
          isActive && "sp-proposal-card-active",
          !isActive && "sp-proposal-inactive",
        )}
        aria-label={proposalCard.title}
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
          <div className="sp-proposal-actions">
            <button
              className={cx("sp-proposal-action", "sp-proposal-approve", isDelete && "sp-proposal-danger")}
              type="button"
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
              onClick={() => onEdit?.(proposalCard)}
            >
              {proposalCard.actions.editLabel}
            </button>
            <button
              className="sp-proposal-action sp-proposal-reject"
              type="button"
              onClick={() => onReject?.({
                proposalId: proposalCard.proposalId,
                kind: proposalCard.proposalKind,
                action: "reject",
              })}
            >
              {proposalCard.actions.rejectLabel}
            </button>
          </div>
        ) : (
          <p className="sp-proposal-lapse">
            {proposalCard.lapseCopy ?? "這個提案目前無法處理，可能已過期或被新的提案取代。請重新提出需求。"}
          </p>
        )}
      </section>
    </div>
  );
}
