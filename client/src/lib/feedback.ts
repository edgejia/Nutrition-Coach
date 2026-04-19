export const FEEDBACK_FORM_ENV_NAME = "VITE_FEEDBACK_FORM_URL";
export const FEEDBACK_CTA_LABEL = "回報 Beta 問題";
declare const __NC_FEEDBACK_FORM_URL__: string | undefined;

function normalizeFeedbackUrl(value: string | null | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed;
}

export function readFeedbackFormUrl(configuredUrl = __NC_FEEDBACK_FORM_URL__) {
  return normalizeFeedbackUrl(configuredUrl);
}

export function getFeedbackEntryState(options: {
  sending: boolean;
  feedbackUrl: string | null | undefined;
}) {
  const feedbackUrl = normalizeFeedbackUrl(options.feedbackUrl);

  return {
    label: FEEDBACK_CTA_LABEL,
    feedbackUrl,
    disabled: options.sending || !feedbackUrl,
    opensInNewTab: Boolean(feedbackUrl),
  };
}
