---
phase: 63
slug: sse-meal-row-freshness-and-affected-date-invalidation
status: passed
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-18
audited: 2026-05-18
coverage_status: sufficient
gaps_found: 0
---

# Phase 63 - Nyquist Validation Coverage

> Per-phase validation contract and post-execution coverage audit for SSE meal-row freshness and affected-date invalidation.

## Compliance Status

**Result:** compliant.

No missing executable validation gaps were found. Phase 63 has automated coverage for the server SSE envelope, mutation affected-date emission, strict client parsing, same-day refetch-before-summary ordering, latest-wins races, historical invalidation, and harness-backed end-to-end SSE consumers. The live same-day browser flow was also recorded as human UAT in `63-VERIFICATION.md`.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` with `node:assert/strict` |
| **Config file** | `package.json`; no Jest/Vitest config |
| **Targeted runner** | `node scripts/run-node-with-tz.mjs --import tsx --test <files>` |
| **Suite commands** | `yarn tsc --noEmit`, `yarn test:unit`, `yarn test:integration` |
| **Harness command** | `yarn verify:harness -- daily-rollover` |
| **Timezone** | `TZ=Asia/Taipei` via `scripts/run-node-with-tz.mjs` |

## Requirement Coverage

| Requirement | Behavioral Obligation | Evidence | Status |
|-------------|-----------------------|----------|--------|
| REAL-01 | Same-day `daily_summary` SSE events include metadata that lets clients refresh or invalidate affected meal rows. | Initial and mutation frames are strict `{ summary, affectedDate, source }` envelopes; client parser dispatches envelope-aware payloads. | green |
| REAL-02 | Home/Summary cannot accept newer same-day totals beside stale visible rows. | `createSSESummaryCoordinator` refetches rows before committing same-day mutation summaries and drops failed/stale token results. | green |
| REAL-03 | Malformed, stale-date, future-date, and historical events preserve guards and do not overwrite current-day rows incorrectly. | Parser invalid-frame no-op tests, coordinator future no-op/historical invalidation tests, Day Detail and History source-contract gating tests. | green |

## Per-Task Verification Map

| Task ID | Plan | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 63-01-01 | 63-01 | REAL-01, REAL-03 | T-63-01 | `/api/sse` initial frames are authenticated and shaped as `{ summary, affectedDate: summary.date, source: "initial" }`. | integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/sse.test.ts` | yes | green |
| 63-02-01 | 63-02 | REAL-01, REAL-03 | T-63-02 | Chat and direct meal mutations publish `source: "meal_mutation"` envelopes for same-day and historical affected dates, without `summaryOutcome` or ids. | integration | `yarn test:integration` | yes | green |
| 63-03-01 | 63-03 | REAL-01, REAL-03 | T-63-03 | Malformed JSON, invalid sources, impossible dates, non-finite numbers, and mismatched dates invoke no client callbacks. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-week.test.ts tests/unit/sse-client.test.ts` | yes | green |
| 63-04-01 | 63-04 | REAL-02, REAL-03 | T-63-04 | Same-day SSE summaries commit only after latest-token row refetch succeeds; historical and future events do not mutate today. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/sse-summary-coordinator.test.ts tests/unit/main-layout-sse-contract.test.ts` | yes | green |
| 63-05-01 | 63-05 | REAL-03 | T-63-05 | Historical affected-date invalidation refreshes only matching visible Day Detail or selected-day/current-week History surfaces. | unit/source-contract | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-day-detail-source-contract.test.ts tests/unit/history-screen-contract.test.ts` | yes | green |
| 63-HARNESS-01 | 63 closure | REAL-01, REAL-03 | T-63-02, T-63-05 | Harness consumers unwrap strict SSE envelopes and still prove text-log/delete consistency. | integration/harness | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meal-delete-consistency.test.ts tests/integration/verification-text.test.ts` | yes | green |
| 63-HARNESS-02 | 63 closure | REAL-03 | T-63-03 | Asia/Taipei day-boundary summary isolation still works with strict SSE initial envelopes. | harness | `yarn verify:harness -- daily-rollover` | yes | green |

## Executed Audit Commands

| Command | Observed Result | Status |
|---------|-----------------|--------|
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/sse.test.ts` | 8/8 pass | green |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-week.test.ts tests/unit/sse-client.test.ts tests/unit/sse-summary-coordinator.test.ts tests/unit/main-layout-sse-contract.test.ts tests/unit/history-day-detail-source-contract.test.ts tests/unit/history-screen-contract.test.ts` | 47/47 pass | green |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meal-delete-consistency.test.ts tests/integration/verification-text.test.ts` | 5/5 pass | green |
| `yarn verify:harness -- daily-rollover` | PASS daily-rollover 6/6 | green |
| `yarn tsc --noEmit` | pass | green |
| `yarn test:unit` | 799/799 pass | green |
| `yarn test:integration` | 304/304 pass | green |

## Nyquist Gap Audit

| Probe Area | Starting Hypothesis | Failing-Capable Test Evidence | Resolution |
|------------|---------------------|-------------------------------|------------|
| Server envelope shape | Server may still emit raw `DailySummary` frames. | `tests/integration/sse.test.ts` asserts exact envelope keys, `source`, and `affectedDate === summary.date`. | FILLED |
| Mutation affected-date emission | Historical mutations may still be suppressed by a today-only gate. | `tests/integration/chat-api.test.ts`, `tests/integration/meals-api.test.ts`, and harness-backed integrations assert same-day/historical mutation envelopes. | FILLED |
| Client strict parsing | Malformed or mismatched frames may still mutate state. | `tests/unit/sse-client.test.ts` sends malformed JSON, invalid shapes, invalid source, impossible dates, non-finite numbers, and date mismatches, then asserts no callbacks. | FILLED |
| Same-day row freshness | Summary may commit before visible same-day rows refresh. | `tests/unit/sse-summary-coordinator.test.ts` asserts row refetch first, `setMeals` before `setDailySummary`, drop-on-refetch-failure, and latest-token wins. | FILLED |
| MainLayout wiring | MainLayout may bypass coordinator with raw `setDailySummary`. | `tests/unit/main-layout-sse-contract.test.ts` rejects raw `onSummary`/`setDailySummary` SSE wiring and direct initial `setMeals(meals)` commits. | FILLED |
| Historical visible refresh | Historical invalidation may over-refresh or touch today state. | `tests/unit/history-day-detail-source-contract.test.ts` and `tests/unit/history-screen-contract.test.ts` assert exact-date Day Detail refresh, selected-day/current-week History gates, no today APIs, and no new freshness UI. | FILLED |
| Harness consumers | End-to-end harness readers may still parse raw summary payloads. | `tests/integration/meal-delete-consistency.test.ts`, `tests/integration/verification-text.test.ts`, and `yarn test:integration` pass with strict-envelope consumers. | FILLED |

## Manual-Only Verification

| Behavior | Requirement | Why Manual | Result |
|----------|-------------|------------|--------|
| Public beta/live same-day SSE freshness flow | REAL-01, REAL-02, REAL-03 | Automated tests prove event and state contracts; browser observation proves the realtime user-visible flow. | PASS, recorded in `63-VERIFICATION.md` as completed on 2026-05-18. |

## Validation Sign-Off

- [x] All Phase 63 tasks have automated verify commands.
- [x] All previously pending validation rows now map to existing test files.
- [x] Tests verify behavior that can fail, not only file presence.
- [x] Same-day stale-row prevention is covered by behavioral coordinator tests and MainLayout source-contract tests.
- [x] Historical affected-date invalidation is covered by visible-surface source-contract tests and harness-backed integrations.
- [x] Full TypeScript, unit, and integration gates passed during this audit.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** compliant after audit on 2026-05-18.
