# Phase 63 Deferred Items

| Category | Item | Status | Deferred At |
| --- | --- | --- | --- |
| harness_consumer_migration | `yarn test:integration` still has `meal-delete-consistency` and `text-log` harness integration failures because those harness consumers parse `daily_summary` SSE payloads as raw `DailySummary` instead of the Phase 63 envelope. `meal-delete-consistency` was already surfaced in 63-01; `text-log` is the same migration class after mutation events now emit envelopes. | defer to downstream Phase 63 consumer/harness migration plans | 63-02 |
