# Requirements: Nutrition Coach v2.2 Promotion Blocker Reopen

## Phase 59 Requirements

## Completion Tracking

- [ ] **AUTH-01** Backend summary/history replies use persisted meal records as the authoritative source.
- [ ] **AUTH-02** Aggregate daily totals cannot authorize invented meal names or wrong per-meal attribution.
- [ ] **AUTH-03** Summary/history replies are split into deterministic fact text plus optional advice.
- [ ] **AUTH-04** Optional LLM advice cannot introduce concrete persisted facts.
- [x] **STREAM-01** SSE proof drains through stream close instead of stopping at the first `event: done`.
- [x] **STREAM-02** SSE proof fails if any `chunk` or `status` frame appears after the first `done`.
- [x] **STREAM-03** Harness artifacts store structured SSE proof metadata, not raw frame transcripts.

| ID | Phase | Requirement | Acceptance |
|----|-------|-------------|------------|
| AUTH-01 | Phase 59 | Backend summary/history replies use persisted meal records as the authoritative source for meal names, meal count, day total kcal, and per-meal kcal. | Fake meal names such as `牛肉飯` or `滷肉飯` cannot appear in final replies unless they exist in persisted facts. |
| AUTH-02 | Phase 59 | Aggregate daily totals cannot authorize invented meal names or assigning the full day total to one named meal. | With persisted `豆腐飯 520 kcal` and `鮭魚飯 380 kcal`, final replies cannot attribute `900 kcal` to `豆腐飯` as a single-meal value. |
| AUTH-03 | Phase 59 | Summary/history replies are split into deterministic backend-rendered fact text plus optional LLM advice text. | Backend can deterministically render an equivalent of `今天已記錄 2 餐，共 900 kcal：豆腐飯 520 kcal、鮭魚飯 380 kcal。` from persisted facts. |
| AUTH-04 | Phase 59 | Optional LLM advice cannot introduce concrete persisted meal names, per-meal kcal, macro attribution, meal count, or day total facts. | JSON, SSE, and non-SSE final reply paths use the same fact renderer and advice guard. |
| STREAM-01 | Phase 59 | SSE proof drains through stream close instead of stopping at the first `event: done`. | The proof records that stream close was observed after `done`. |
| STREAM-02 | Phase 59 | SSE proof fails if any `chunk` or `status` frame appears after the first `done`. | Targeted harness/test proof detects post-done frames as failures. |
| STREAM-03 | Phase 59 | Harness artifacts store structured SSE proof metadata, not raw frame transcripts. | Artifacts include fields such as first done observed, stream closed, and no post-done frames, while omitting raw SSE frame transcripts. |

## Source Notes

- `.planning/todos/pending/v2-2-authoritative-summary-facts-sse-proof.md`
- `.planning/notes/v2-2-authoritative-summary-facts-acceptance.md`
- `.planning/notes/v2-2-post-review-blocker-reopened.md`

## Out of Scope

- Goal proposal confirmation, failed `update_goals` outcome rendering, stale chat receipts, and cross-tab meal row invalidation.
- Product polish backlog work such as water tracking, monthly history, onboarding animation, or motion system work.
- Promotion to `staging` or `main`.

---
*Created: 2026-05-16 for reopened v2.2 promotion blocker planning*
