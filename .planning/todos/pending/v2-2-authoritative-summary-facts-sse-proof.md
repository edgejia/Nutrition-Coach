---
title: "v2.2 promotion blocker: authoritative summary facts + SSE proof"
date: "2026-05-16"
priority: "P1"
status: "pending"
source: "Notion BUG / FEATURE 調整"
source_url: "https://www.notion.so/34528343a39580a6acfff1c74f94c6c0"
milestone: "v2.2"
branch: "feature/r-next-milestone-dev"
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
