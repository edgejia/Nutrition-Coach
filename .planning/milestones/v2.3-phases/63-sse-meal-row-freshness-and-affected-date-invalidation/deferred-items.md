# Phase 63 Deferred Items

| Category | Item | Status | Deferred At |
| --- | --- | --- | --- |
| harness_consumer_migration | `meal-delete-consistency`, `text-log`, and `daily-rollover` harness consumers needed to unwrap Phase 63 `daily_summary` SSE envelopes before asserting summary fields. | resolved in `fix(63): unwrap SSE summary envelopes in harness`; `yarn test:integration` passes 304/304 | 63-02 |
