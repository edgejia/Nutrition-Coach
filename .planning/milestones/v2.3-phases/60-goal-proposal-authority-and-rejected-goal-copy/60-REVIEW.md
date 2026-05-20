---
phase: 60-goal-proposal-authority-and-rejected-goal-copy
reviewed: 2026-05-17T00:39:56Z
depth: standard
files_reviewed: 17
files_reviewed_list:
  - server/app.ts
  - server/orchestrator/index.ts
  - server/orchestrator/mutation-receipts.ts
  - server/orchestrator/source-text-guard.ts
  - server/orchestrator/system-prompt.ts
  - server/orchestrator/tools.ts
  - server/services/goal-proposals.ts
  - tests/integration/chat-goal-update.integration.test.ts
  - tests/integration/chat-streaming.test.ts
  - tests/integration/orchestrator.test.ts
  - tests/integration/sse.test.ts
  - tests/unit/goal-proposals.test.ts
  - tests/unit/mutation-receipts.test.ts
  - tests/unit/orchestrator-registry.test.ts
  - tests/unit/orchestrator.test.ts
  - tests/unit/system-prompt.test.ts
  - tests/unit/update-goals-contract.test.ts
findings:
  critical: 2
  warning: 0
  info: 0
  total: 2
fixed:
  critical: 2
  warning: 0
  info: 0
  total: 2
status: fixed
---

# Phase 60: Code Review Report

**Reviewed:** 2026-05-17T00:39:56Z
**Depth:** standard
**Files Reviewed:** 17
**Status:** fixed

## Summary

Reviewed the Phase 60 goal proposal authority path across app DI, orchestrator controlled replies, source-text guards, tool contracts, SSE/integration coverage, and renderer copy tests. The two blocker defects found in the goal-authority boundary have been fixed and remain documented below with their fix commits.

## Critical Issues

### CR-01: Negated consent can apply an active goal proposal

**Classification:** BLOCKER
**Fix status:** Fixed in `506471d` (`fix(60): CR-01 reject negated goal consent`)
**File:** `server/orchestrator/source-text-guard.ts:59`
**Issue:** `isGoalProposalConsent()` normalizes the whole user turn and then accepts if it contains any consent term. Because `isGoalProposalCancel()` only checks a narrow cancel list, negated consent such as `不好`, `不可以`, or `不行` is not rejected before the substring check sees `好` or `可以`. With an active proposal, `update_goals` in `latest_proposal` mode therefore passes the consent check at `server/orchestrator/tools.ts:1455` and mutates/publishes goals after the user rejected the proposal.
**Fix:**
```ts
const GOAL_PROPOSAL_CANCEL_PATTERNS = [
  /^(不要|取消|先不用|不用|不好|不可以|不行|不是|不對|no|nope|not)$/i,
  /^(先)?不要/,
] as const;

const GOAL_PROPOSAL_CONSENT_PATTERNS = [
  /^(好|可以|幫我更新|就這樣|用這組|ok|okay|yes|y|sure)$/i,
] as const;

export function isGoalProposalCancel(message: string): boolean {
  const normalized = normalizeGoalProposalDecisionText(message);
  return normalized.length > 0 && GOAL_PROPOSAL_CANCEL_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isGoalProposalConsent(message: string): boolean {
  const normalized = normalizeGoalProposalDecisionText(message);
  if (!normalized || isGoalProposalCancel(message)) return false;
  return GOAL_PROPOSAL_CONSENT_PATTERNS.some((pattern) => pattern.test(normalized));
}
```
Add unit and integration coverage proving `不好`, `不可以`, and `不行` leave targets unchanged, do not publish `goals_update`, and do not consume the active proposal unless the chosen product behavior explicitly treats them as cancel.

### CR-02: Missing or malformed `update_goals.mode` falls through to model-authored final text

**Classification:** BLOCKER
**Fix status:** Fixed in `ca5b27e` (`fix(60): CR-02 render malformed goal rejection`)
**File:** `server/orchestrator/tools.ts:1637`
**Issue:** The validation-failure adapter only returns deterministic renderer copy when `goalValidationFieldsFromFailure()` finds target fields. For invalid calls such as `{}` or `{ "calories": 1800 }` without `mode`, `validationFields` is empty, so execution returns `success: false` without `controlledReply` at `server/orchestrator/tools.ts:1657`. The orchestrator then saves a tool failure and continues to a later model round at `server/orchestrator/index.ts:949`, where `guardNoMutationLoggingClaim()` does not guard false goal-update success prose. A stale or malformed model call can therefore produce "已更新每日目標" text even though no goal update happened, violating the renderer-owned rejected-goal-copy contract.
**Fix:**
```ts
if (toolCall.function.name === "update_goals") {
  const validationFields = outcome.failureReason === "validation"
    ? goalValidationFieldsFromFailure(outcome.result)
    : [];
  const reply = validationFields.length > 0
    ? renderGoalValidationFailureCopy(validationFields)
    : renderGoalAuthorityFailureCopy();

  return {
    result: reply,
    summary: `failureReason: ${outcome.failureReason ?? "validation"}`,
    success: false,
    executed: false,
    failureReason: outcome.failureReason,
    updatedFields,
    controlledReply: {
      source: "renderer",
      reason: validationFields.length > 0 ? "goal_validation_failure" : "goal_authority_failure",
      text: reply,
    },
  };
}
```
Add orchestrator/Fastify coverage for `{}` and bare `{ calories: 1800 }` tool calls proving the response is backend-rendered rejection copy, targets remain unchanged, no `goals_update` is published, and no second LLM call is made.

---

_Reviewed: 2026-05-17T00:39:56Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
