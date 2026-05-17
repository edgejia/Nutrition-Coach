---
status: partial
phase: 60-goal-proposal-authority-and-rejected-goal-copy
source:
  - 60-01-SUMMARY.md
  - 60-02-SUMMARY.md
  - 60-03-SUMMARY.md
started: 2026-05-17T09:03:36+08:00
updated: 2026-05-17T09:04:30+08:00
---

## Current Test

[testing paused - 5 items outstanding]

## Tests

### 1. Goal Recommendation Proposal
expected: When you ask for a vague daily-goal recommendation instead of explicit numbers, chat returns a concrete Traditional Chinese proposal for calories/protein/carbs/fat, does not claim the targets were updated, and does not change the current daily targets yet.
result: [pending]

### 2. Confirm Active Proposal
expected: After a proposal is active, a short confirmation such as "好" applies the latest backend proposal, returns goal-update result metadata, and publishes a goals update exactly after the targets persist.
result: [pending]

### 3. Reject Or Cancel Proposal
expected: With an active proposal, cancel or negated-consent text such as "先不用", "不好", "不可以", or "不行" returns neutral backend copy, leaves targets unchanged, publishes no goals update, and clears only the active pending proposal.
result: [pending]

### 4. Missing Or Stale Proposal Confirmation
expected: If no valid active proposal exists, or the model tries a stale/mismatched proposal identifier, confirmation fails closed with deterministic Traditional Chinese guidance, leaves targets unchanged, and publishes no goals update.
result: [pending]

### 5. Malformed Goal Update Rejection
expected: If the model calls update_goals without the required mode or with malformed values, the user sees backend-rendered rejection copy instead of LLM-authored success prose; targets stay unchanged and no goals update is published.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps
