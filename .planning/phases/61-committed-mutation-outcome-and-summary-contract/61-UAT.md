---
status: partial
phase: 61-committed-mutation-outcome-and-summary-contract
source:
  - 61-01-SUMMARY.md
  - 61-02-SUMMARY.md
  - 61-03-SUMMARY.md
  - 61-04-SUMMARY.md
  - 61-05-SUMMARY.md
  - 61-06-SUMMARY.md
started: 2026-05-17T16:09:08+08:00
updated: 2026-05-17T18:26:29+08:00
---

## Current Test

[external verification pending]

## Tests

### 1. Chat meal log survives summary refresh failure
expected: When a chat `log_food` mutation commits but the post-commit summary refresh or publish step degrades, the user still receives a committed meal receipt. The response exposes `summaryOutcome` as the freshness signal, does not turn the mutation into a failure, and does not show internal terms such as `recompute_failed`, `summaryOutcome`, `dailySummary`, or `publish_failed` in the user-facing receipt copy.
result: [pending]

### 2. Chat meal update and delete survive summary refresh failure
expected: When chat `update_meal` or `delete_meal` commits but summary recompute or recovery fails, the user still receives deterministic committed update/delete receipt copy. JSON and SSE terminal payloads include committed facts plus `summaryOutcome`, and missing top-level `dailySummary` does not cause fallback or error behavior.
result: [pending]

### 3. Direct meal PATCH and DELETE separate committed facts from summary freshness
expected: Direct `PATCH /api/meals/:id` and `DELETE /api/meals/:id` return HTTP 200 with committed meal facts and `summaryOutcome` after successful mutation. Recompute, recovery, or publish failure does not erase the committed mutation; top-level `dailySummary` appears only when the outcome is fresh or recovered.
result: [pending]

### 4. Client direct mutation consumers tolerate unavailable summaries
expected: The client parses valid `summaryOutcome` values from direct HTTP and chat SSE terminal payloads, ignores malformed outcome payloads safely, records committed mutation side effects after HTTP 200, and updates summary state only from usable summaries. No visible stale/degraded summary warning copy is introduced.
result: [pending]

### 5. Publish failure evidence remains metadata-only
expected: Chat and direct meal publish failures stay outside public response bodies and `summaryOutcome`. Logs record stable metadata such as event name and `publisher_error`, but do not include thrown error text, raw user text, tool payloads, provider bodies, image data, session material, or database snapshots.
result: [pending]

## Summary

total: 5
passed: 0
issues: 0
pending: 5
skipped: 0
blocked: 0

## Gaps

[none yet]
