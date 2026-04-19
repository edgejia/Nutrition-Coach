import { describe, it } from "node:test";
import assert from "node:assert/strict";

const { FEEDBACK_CTA_LABEL, readFeedbackFormUrl, getFeedbackEntryState } = await import("../../client/src/lib/feedback.js");

describe("Home feedback entry", () => {
  it("reads the configured feedback form URL from the public client config seam", () => {
    const url = readFeedbackFormUrl("https://example.com/forms/nutrition-coach-beta");

    assert.equal(url, "https://example.com/forms/nutrition-coach-beta");
  });

  it("treats empty config as missing", () => {
    const url = readFeedbackFormUrl("");

    assert.equal(url, null);
  });

  it("disables the CTA while sending or when the form URL is missing", () => {
    assert.deepEqual(getFeedbackEntryState({
      sending: false,
      feedbackUrl: "https://example.com/forms/nutrition-coach-beta",
    }), {
      label: FEEDBACK_CTA_LABEL,
      feedbackUrl: "https://example.com/forms/nutrition-coach-beta",
      disabled: false,
      opensInNewTab: true,
    });

    assert.deepEqual(getFeedbackEntryState({
      sending: true,
      feedbackUrl: "https://example.com/forms/nutrition-coach-beta",
    }), {
      label: FEEDBACK_CTA_LABEL,
      feedbackUrl: "https://example.com/forms/nutrition-coach-beta",
      disabled: true,
      opensInNewTab: true,
    });

    assert.deepEqual(getFeedbackEntryState({
      sending: false,
      feedbackUrl: null,
    }), {
      label: FEEDBACK_CTA_LABEL,
      feedbackUrl: null,
      disabled: true,
      opensInNewTab: false,
    });
  });
});
