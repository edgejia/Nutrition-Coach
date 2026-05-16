---
title: "v2.2 promotion blocker: authoritative summary facts + SSE proof"
date: "2026-05-16"
resolved: "2026-05-17"
priority: "P1"
status: "resolved"
source: "Notion BUG / FEATURE 調整"
source_url: "https://www.notion.so/34528343a39580a6acfff1c74f94c6c0"
milestone: "v2.2"
branch: "feature/r-next-milestone-dev"
resolution: "Resolved by Phase 59 authoritative summary facts and SSE proof; local UAT accepted automated evidence."
---

# v2.2 Promotion Blocker: Authoritative Summary Facts + SSE Proof

## Goal

Unblock v2.2 promotion by closing the remaining summary/history fact-grounding failure and adding machine-checkable SSE ordering proof.

## Scope

- Refactor summary/history replies so backend-rendered deterministic facts are the authoritative source for meal names, meal count, day total kcal, and per-meal kcal.
- Split final summary/history replies into:
  - deterministic fact segment rendered from persisted facts
  - optional LLM advice segment that cannot introduce persisted meal names, kcal, macro attribution, meal count, or day total facts
- Apply the same fact renderer and advice guard across JSON, SSE, and non-SSE final reply paths.
- Keep the existing final guard as defense-in-depth, not the primary correctness mechanism.
- Update SSE harness proof so the helper drains to stream close and fails on any `chunk` or `status` after first `done`.
- Store SSE proof as structured metadata, not raw frame transcript.

## Out of Scope

- Other authoritative state boundary P1 items such as goal proposal confirmation, failed `update_goals` outcome rendering, stale chat receipts, or cross-tab meal row invalidation.
- Product polish backlog such as water tracking, monthly history, onboarding animation, or motion system work.
- Promotion to `staging` or `main`.

## Suggested Verification

- `yarn tsc --noEmit`
- `yarn test:integration`
- Targeted unit tests for summary/history fact rendering and advice stripping/fallback behavior.
- The matching SSE harness command after the scenario/helper is updated.
- `yarn release:check` before any later promotion toward `staging` or `main`.

## Resolution

- Phase 59 implemented deterministic summary/history fact rendering and advice isolation across orchestrator, JSON, drained-stream, and live SSE paths.
- Phase 59 updated SSE terminal proof to drain through stream close and store structured metadata only.
- `59-REVIEW.md` is clean with 0 findings.
- `59-SECURITY.md` reports `threats_open: 0`.
- `59-VALIDATION.md` reports Nyquist validation complete with 7/7 gaps resolved.
- `59-VERIFICATION.md` reports verifier passed with 7/7 score.
- `59-UAT.md` records user-approved automated/no-human UAT.
- No staging/main promotion, deployment, merge, push, fast-forward, or rebase was authorized or performed.
