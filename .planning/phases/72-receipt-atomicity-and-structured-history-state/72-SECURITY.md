---
phase: 72
slug: receipt-atomicity-and-structured-history-state
status: verified
threats_open: 0
asvs_level: 1
block_on: open
security_enforcement: true
created: 2026-06-01
---

# Phase 72 Security Audit

**Phase:** 72 - receipt-atomicity-and-structured-history-state  
**ASVS Level:** 1  
**Config:** `block_on=open`, `security_enforcement=true`  
**Threats Open:** 0  
**Threats Closed:** 35/35  
**Audit Date:** 2026-06-01

## Scope

This audit verifies declared mitigations from the six Phase 72 `threat_model` blocks only. Each threat is plan-scoped because the plan files reuse IDs such as `T-72-01` for different components.

- `72-01-PLAN.md`: `T-72-01` through `T-72-05`, `T-72-SC`
- `72-02-PLAN.md`: `T-72-01` through `T-72-05`, `T-72-SC`
- `72-03-PLAN.md`: `T-72-01` through `T-72-05`, `T-72-SC`
- `72-04-PLAN.md`: `T-72-01` through `T-72-05`, `T-72-SC`
- `72-05-PLAN.md`: `T-72-01` through `T-72-04`, `T-72-SC`
- `72-06-PLAN.md`: `T-72-01` through `T-72-05`, `T-72-SC`

All plan-time threat models were parseable, so retroactive STRIDE mode was not used.

## Threat Verification

| Plan Ref | Threat ID | Category | Disposition | Status | Evidence |
|----------|-----------|----------|-------------|--------|----------|
| 72-01 | T-72-01 | Tampering | mitigate | CLOSED | `server/services/chat.ts:331` defines `saveAssistantReplyWithReceipt()`; `server/services/chat.ts:337` wraps assistant, receipt, and outcome writes in one transaction; `tests/unit/chat.test.ts:445` proves commit-together success; `tests/unit/chat.test.ts:531` proves rollback on invalid outcome persistence. |
| 72-01 | T-72-02 | Tampering | mitigate | CLOSED | `server/services/chat.ts:71` returns `undefined` for `log_food`, `update_meal`, `delete_meal`, and `update_goals` tool summaries; `server/services/chat.ts:199` loads only structured outcome rows; `server/services/chat.ts:211` validates rows before formatting; `tests/unit/history.test.ts:40` proves success strings no longer create scoped mutation markers. |
| 72-01 | T-72-03 | Information Disclosure | mitigate | CLOSED | `server/services/chat-mutation-outcomes.ts:57` blocks internal/debug/provider/payload key parts; `server/services/chat-mutation-outcomes.ts:76` blocks tool/provider/id text patterns; `tests/unit/chat.test.ts:527` asserts compressed history omits meal and revision IDs; `tests/integration/chat-api.test.ts:158` and `tests/integration/chat-streaming.test.ts:441` assert fail-closed payloads omit raw text, tool/provider payloads, IDs, and receipt identity. |
| 72-01 | T-72-04 | Elevation of Privilege | mitigate | CLOSED | `server/services/chat.ts:271` exposes edit identity only when the receipt revision is current and not deleted; `tests/unit/chat.test.ts:634` and `tests/integration/chat-api.test.ts:2239` prove stale/deleted receipts are display-only and omit `mealId`, `dateKey`, and `mealRevisionId`. |
| 72-01 | T-72-05 | Spoofing | mitigate | CLOSED | Same-device predicates are present in structured outcome lookup at `server/services/chat.ts:199`, receipt lookup at `server/services/chat.ts:238`, public history at `server/services/chat.ts:447`, and compressed history at `server/services/chat.ts:496`; integration/unit tests use real SQLite fixtures in `tests/unit/chat.test.ts:445` and `tests/integration/chat-api.test.ts:1602`. |
| 72-01 | T-72-SC | Tampering | accept | CLOSED | Accepted risk `AR-72-SC`; task commit-file verification found no `package.json`, `yarn.lock`, or package-manager metadata changes in Phase 72 task commits. |
| 72-02 | T-72-01 | Tampering | mitigate | CLOSED | `tests/integration/chat-api.test.ts:1602` forces JSON atomic receipt persistence failure after `log_food`; `tests/integration/chat-api.test.ts:1651` asserts response omission; `tests/integration/chat-api.test.ts:1662` asserts history omission; route implementation gates JSON projection at `server/routes/chat.ts:1472` and `server/routes/chat.ts:1515`. |
| 72-02 | T-72-02 | Tampering | mitigate | CLOSED | `tests/integration/chat-streaming.test.ts:899`, `tests/integration/chat-streaming.test.ts:1207`, and `tests/integration/chat-streaming.test.ts:3676` cover SSE done, stopped, and persistence-catch receipt-bearing paths; route projection is gated at `server/routes/chat.ts:1042`, `server/routes/chat.ts:1076`, and `server/routes/chat.ts:1223`. |
| 72-02 | T-72-03 | Information Disclosure | mitigate | CLOSED | `server/routes/chat.ts:286` logs only metadata for receipt persistence failure; JSON redaction assertions are at `tests/integration/chat-api.test.ts:158`; SSE redaction assertions are at `tests/integration/chat-streaming.test.ts:441`; thrown-material log/trace redaction is proved at `tests/integration/chat-api.test.ts:4279` and `tests/integration/chat-streaming.test.ts:3740`. |
| 72-02 | T-72-04 | Denial of Service | accept | CLOSED | Accepted risk `AR-72-02-04`; code still fails closed with sanitized fallback at `server/routes/chat.ts:270` and omits receipt projection unless persistence is `"persisted"` at `server/routes/chat.ts:1515`, `server/routes/chat.ts:1579`, and `server/routes/chat.ts:1634`. |
| 72-02 | T-72-05 | Elevation of Privilege | mitigate | CLOSED | `server/services/chat.ts:271` checks active current revisions before identity exposure; `tests/unit/chat.test.ts:634` and `tests/integration/chat-api.test.ts:2239` prove stale/deleted history receipts remain display-only. |
| 72-02 | T-72-SC | Tampering | accept | CLOSED | Accepted risk `AR-72-SC`; task commit-file verification found no package manifest or lockfile changes. |
| 72-03 | T-72-01 | Tampering | mitigate | CLOSED | `server/db/schema.ts:141` defines `chatMutationOutcomes`; `server/db/schema.ts:167` adds the action check; `server/db/schema.ts:171` adds the assistant-message unique index; `server/db/schema.ts:172` and `server/db/schema.ts:176` add device lookup indexes; migration SQL matches at `drizzle/0008_shiny_stellaris.sql:1` and `drizzle/0008_shiny_stellaris.sql:25`. |
| 72-03 | T-72-02 | Information Disclosure | mitigate | CLOSED | `server/services/chat-mutation-outcomes.ts:122` rejects extra or forbidden keys; `server/services/chat-mutation-outcomes.ts:137` validates meal facts; `server/services/chat-mutation-outcomes.ts:173` validates goal facts; `server/services/chat-mutation-outcomes.ts:249` formats only after validation. |
| 72-03 | T-72-03 | Spoofing | mitigate | CLOSED | `server/db/schema.ts:145` requires `deviceId`; downstream same-device predicates are present at `server/services/chat.ts:203` and `server/services/chat.ts:238`. |
| 72-03 | T-72-04 | Tampering | mitigate | CLOSED | `drizzle/0008_shiny_stellaris.sql:1` creates only the additive table; `drizzle/0008_shiny_stellaris.sql:25` through `drizzle/0008_shiny_stellaris.sql:27` create indexes; targeted grep found no migration DML backfill statements (`INSERT`, `UPDATE`, or `DELETE`) in `drizzle/0008_shiny_stellaris.sql`. |
| 72-03 | T-72-05 | Denial of Service | mitigate | CLOSED | Migration verification was recorded as passed in `.planning/phases/72-receipt-atomicity-and-structured-history-state/72-03-SUMMARY.md:102` through `.planning/phases/72-receipt-atomicity-and-structured-history-state/72-03-SUMMARY.md:105`; schema and migration artifacts are present at `server/db/schema.ts:141` and `drizzle/0008_shiny_stellaris.sql:1`. |
| 72-03 | T-72-SC | Tampering | accept | CLOSED | Accepted risk `AR-72-SC`; task commit-file verification found no package manifest or lockfile changes. |
| 72-04 | T-72-01 | Tampering | mitigate | CLOSED | `server/services/chat.ts:331` implements the narrow helper; `server/services/chat.ts:337` performs one transaction; `tests/unit/chat.test.ts:531` proves assistant/receipt rollback on structured outcome failure. |
| 72-04 | T-72-02 | Tampering | mitigate | CLOSED | `server/services/chat.ts:145` converts rows back into validator-owned facts; `server/services/chat.ts:199` loads same-device structured rows; `server/services/chat.ts:211` validates before formatting; `tests/unit/chat.test.ts:619` proves missing/malformed/invalid rows omit compressed mutation claims. |
| 72-04 | T-72-03 | Information Disclosure | mitigate | CLOSED | Formatter validation excludes internal keys and text at `server/services/chat-mutation-outcomes.ts:57` and `server/services/chat-mutation-outcomes.ts:76`; `tests/unit/chat.test.ts:527` asserts compressed facts omit meal/revision IDs; `tests/unit/orchestrator.test.ts:51` forbids IDs, raw tool data, provider metadata, assistant final text, debug, and protocol terms. |
| 72-04 | T-72-04 | Elevation of Privilege | mitigate | CLOSED | `server/services/chat.ts:271` gates edit identity on current active receipt state; `tests/unit/chat.test.ts:634` proves stale/deleted legacy receipts omit edit identity. |
| 72-04 | T-72-05 | Spoofing | mitigate | CLOSED | `server/services/chat.ts:203` includes `eq(chatMutationOutcomes.deviceId, deviceId)` in outcome queries; `server/services/chat.ts:238` through `server/services/chat.ts:244` constrain receipt joins by device. |
| 72-04 | T-72-SC | Tampering | accept | CLOSED | Accepted risk `AR-72-SC`; task commit-file verification found no package manifest or lockfile changes. |
| 72-05 | T-72-01 | Tampering | mitigate | CLOSED | `server/orchestrator/mutation-effects.ts:106` derives facts from committed `MutationEffects`; tests for log/update/delete/goals facts are at `tests/unit/orchestrator.test.ts:98`, `tests/unit/orchestrator.test.ts:136`, `tests/unit/orchestrator.test.ts:174`, and `tests/unit/orchestrator.test.ts:206`. |
| 72-05 | T-72-02 | Information Disclosure | mitigate | CLOSED | `tests/unit/orchestrator.test.ts:51` forbids IDs, raw tool payloads, `summaryOutcome`, provider metadata, final reply, debug, and protocol fields; safe propagation tests for all mutation families are at `tests/unit/orchestrator.test.ts:1392`, `tests/unit/orchestrator.test.ts:1430`, `tests/unit/orchestrator.test.ts:1490`, and `tests/unit/orchestrator.test.ts:1537`. |
| 72-05 | T-72-03 | Repudiation | mitigate | CLOSED | Visible receipts remain renderer-owned through `renderCheckedMutationReceipt()` at `server/orchestrator/index.ts:403`; `tests/unit/mutation-receipts.test.ts:653` proves visible copy is separate from structured history facts and excludes implementation terms. |
| 72-05 | T-72-04 | Spoofing | mitigate | CLOSED | `server/orchestrator/index.ts:1122` through `server/orchestrator/index.ts:1199` assigns `mutationOutcomeFact` only after successful tool execution builds committed mutation effects; `tests/unit/orchestrator.test.ts:1565` proves failed tools, controlled replies, and summary-only tools omit `mutationOutcomeFact`. |
| 72-05 | T-72-SC | Tampering | accept | CLOSED | Accepted risk `AR-72-SC`; task commit-file verification found no package manifest or lockfile changes. |
| 72-06 | T-72-01 | Tampering | mitigate | CLOSED | `finalizeAssistantReply()` calls `saveAssistantReplyWithReceipt()` for receipt/outcome-bearing replies at `server/routes/chat.ts:257`; non-receipt assistant save is restricted to the no-receipt/no-outcome branch at `server/routes/chat.ts:243`; route grep found no `saveMealReceiptReference` usage in `server/routes/chat.ts`. |
| 72-06 | T-72-02 | Information Disclosure | mitigate | CLOSED | JSON projection includes `loggedMeal` only when `receiptPersistence === "persisted"` at `server/routes/chat.ts:1515`, `server/routes/chat.ts:1579`, and `server/routes/chat.ts:1634`; SSE projection uses the same gate at `server/routes/chat.ts:1055`, `server/routes/chat.ts:1076`, `server/routes/chat.ts:1144`, and `server/routes/chat.ts:1223`; assertions are at `tests/integration/chat-api.test.ts:158` and `tests/integration/chat-streaming.test.ts:441`. |
| 72-06 | T-72-03 | Elevation of Privilege | mitigate | CLOSED | Service identity projection remains current-active-only at `server/services/chat.ts:271`; end-to-end stale history assertion is at `tests/integration/chat-api.test.ts:2239`; public history removes raw `deviceId` at `server/routes/chat.ts:1728`. |
| 72-06 | T-72-04 | Tampering | mitigate | CLOSED | `server/services/chat.ts:71` removes scoped mutation authority from display strings; `tests/unit/history.test.ts:40` proves success strings no longer create scoped mutation markers; `.planning/phases/72-receipt-atomicity-and-structured-history-state/72-04-SUMMARY.md:117` records the source guard that scanned `server/services/chat.ts` for old success-string authority and passed. |
| 72-06 | T-72-05 | Denial of Service | mitigate | CLOSED | Release gate definition runs TypeScript, full tests, and frontend build at `scripts/release-check.mjs:130` through `scripts/release-check.mjs:138`; Phase 72 closure recorded focused, unit, integration, TypeScript, migration, and `yarn release:check` pass evidence at `.planning/phases/72-receipt-atomicity-and-structured-history-state/72-06-SUMMARY.md:131` through `.planning/phases/72-receipt-atomicity-and-structured-history-state/72-06-SUMMARY.md:137`. |
| 72-06 | T-72-SC | Tampering | accept | CLOSED | Accepted risk `AR-72-SC`; task commit-file verification found no package manifest or lockfile changes. |

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date | Status |
|---------|------------|-----------|-------------|------|--------|
| AR-72-02-04 | `72-02:T-72-04` | Phase 72 intentionally does not add automatic repair for a committed domain mutation followed by receipt/outcome persistence failure. The accepted behavior is sanitized fallback plus no public receipt identity until atomic persistence succeeds. | Phase 72 plan disposition | 2026-06-01 | ACCEPTED |
| AR-72-SC | `72-01:T-72-SC`, `72-02:T-72-SC`, `72-03:T-72-SC`, `72-04:T-72-SC`, `72-05:T-72-SC`, `72-06:T-72-SC` | No package installation was part of Phase 72. Phase task commits touched source, tests, Drizzle migration artifacts, and planning summaries, with no package manifest or lockfile changes. | Phase 72 plan disposition | 2026-06-01 | ACCEPTED |

## Threat Flags

No unregistered flags.

| Summary | Threat Flags |
|---------|--------------|
| `72-01-SUMMARY.md` | None |
| `72-02-SUMMARY.md` | None |
| `72-03-SUMMARY.md` | None |
| `72-04-SUMMARY.md` | None |
| `72-05-SUMMARY.md` | None |
| `72-06-SUMMARY.md` | None |

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By | Notes |
|------------|---------------|--------|------|--------|-------|
| 2026-06-01 | 35 | 35 | 0 | gsd-security-auditor | State B audit created this file; implementation files were read-only; no implementation edits were made. |

## Result

`SECURED` - all declared plan-time mitigations are present in code, tests, migration artifacts, or accepted-risk documentation; no open threats block the phase under `block_on=open`.

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-01
