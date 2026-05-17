---
phase: 62
slug: meal-revision-tokens-and-stale-receipt-protection
audited: 2026-05-17T16:26:36Z
audit_date: 2026-05-18
status: verified
threats_open: 0
asvs_level: 1
block_on: open
security_enforcement: true
---

# Phase 62 - Security

Per-phase security audit for the authored threat registers in:

- `62-01-PLAN.md`
- `62-02-PLAN.md`
- `62-03-PLAN.md`
- `62-04-PLAN.md`
- `62-05-PLAN.md`

Implementation files were treated as read-only. This audit verifies declared mitigations only; it does not expand scope beyond Phase 62 threats.

## Configuration

| Setting | Value | Evidence |
|---------|-------|----------|
| ASVS level | 1 | GSD default; `.planning/config.json` does not override `workflow.security_asvs_level`. |
| Block on | open | User constraint and existing Phase 60/61 security file convention. |
| Security enforcement | enabled | User supplied "Security enforcement is enabled"; `.planning/config.json` does not disable it. |

## Threat Verification

| Threat ID | Category | Component | Disposition | Status | Evidence |
|-----------|----------|-----------|-------------|--------|----------|
| 62-01/T-62-01 | Tampering | `server/services/meal-transactions.ts` | mitigate | CLOSED | `assertExpectedMealRevision` compares expected token to `existing.currentRevisionId` before stale/missing return paths, and update/delete call it before revision inserts: `server/services/meal-transactions.ts:220`, `server/services/meal-transactions.ts:439`, `server/services/meal-transactions.ts:494`. |
| 62-01/T-62-02 | Tampering | `server/routes/meals.ts` | mitigate | CLOSED | Route sends `409` with `MEAL_REVISION_REQUIRED`; tests assert missing PATCH/DELETE fail closed with no side effects: `server/routes/meals.ts:90`, `tests/integration/meals-api.test.ts:374`, `tests/integration/meals-api.test.ts:447`. |
| 62-01/T-62-03 | Elevation of privilege | transaction lookup | mitigate | CLOSED | Meal mutation lookup is constrained by `deviceId` and transaction id from signed session routes: `server/routes/meals.ts:167`, `server/services/meal-transactions.ts:147`. |
| 62-01/T-62-04 | Information disclosure | direct conflict body/logs | mitigate | CLOSED | Conflict bodies contain only `error`, `mealId`, `affectedDate`, `currentMealRevisionId`; no summary fields in stale responses: `server/routes/meals.ts:90`, `tests/integration/meals-api.test.ts:109`, `tests/integration/meals-api.test.ts:432`. |
| 62-01/T-62-05 | Tampering | client stale checks | mitigate | CLOSED | Server transaction preconditions are authoritative independent of client behavior: `server/services/meal-transactions.ts:220`, `server/routes/meals.ts:189`, `server/routes/meals.ts:287`. |
| 62-01/T-62-06 | Repudiation / Tampering | summary recompute and realtime publish | mitigate | CLOSED | Route returns on `MealRevisionPreconditionError` before summary/publish calls; tests assert zero summary/publish calls: `server/routes/meals.ts:226`, `server/routes/meals.ts:232`, `tests/integration/meals-api.test.ts:382`. |
| 62-02/T-62-01 | Tampering | read DTOs | transfer | CLOSED | Transfer target is Plan 01/03 write authority; server checks verified at `server/services/meal-transactions.ts:220` and tool checks at `server/orchestrator/tools.ts:1271`. |
| 62-02/T-62-02 | Tampering | restored chat receipts | mitigate | CLOSED | Only current active receipts receive `mealId`, `dateKey`, and `mealRevisionId`; stale/deleted tests assert these fields are omitted: `server/services/chat.ts:113`, `server/services/chat.ts:117`, `tests/unit/chat.test.ts:204`, `tests/unit/chat.test.ts:241`. |
| 62-02/T-62-03 | Elevation of privilege | `server/services/chat.ts` receipt lookup | mitigate | CLOSED | Receipt lookup joins are constrained by receipt, chat message, meal transaction device ownership, and revision transaction id: `server/services/chat.ts:76`, `server/services/chat.ts:80`. |
| 62-02/T-62-04 | Information disclosure | public DTO projection | mitigate | CLOSED | Public receipts expose `mealRevisionId` while tests deny `currentRevisionId`: `server/routes/chat.ts:415`, `tests/unit/chat.test.ts:79`, `tests/unit/chat.test.ts:102`, `tests/integration/chat-api.test.ts:1809`. |
| 62-02/T-62-05 | Tampering | client-only stale protection | transfer | CLOSED | Transfer target is Plan 01/03 server preconditions; direct writes and tool writes pass expected revisions: `server/routes/meals.ts:208`, `server/orchestrator/tools.ts:1300`. |
| 62-02/T-62-06 | Denial of service / Tampering | chat SSE projection | mitigate | CLOSED | `projectLoggedMealReceipt` only adds `mealRevisionId` to existing payloads; done/stopped write remains after existing status/chunk flow: `server/routes/chat.ts:415`, `server/routes/chat.ts:966`, `tests/unit/api-client.test.ts:1128`, `tests/unit/api-client.test.ts:1233`. |
| 62-03/T-62-01 | Tampering | `update_meal` / `delete_meal` tools | mitigate | CLOSED | Tools require resolver-owned `{ mealId, mealRevisionId }` and pass it to service calls: `server/orchestrator/tools.ts:61`, `server/orchestrator/tools.ts:1131`, `server/orchestrator/tools.ts:1271`, `server/orchestrator/tools.ts:1355`. |
| 62-03/T-62-02 | Tampering | missing expected revision in tool path | mitigate | CLOSED | Id-only `resolvedMealIds` compatibility is rejected without execution in tests: `server/orchestrator/tools.ts:892`, `tests/unit/tools.test.ts:1288`, `tests/unit/tools.test.ts:1310`, `tests/unit/tools.test.ts:1339`. |
| 62-03/T-62-03 | Elevation of privilege | `mealCorrectionService` target lookup | mitigate | CLOSED | Candidate resolution returns revision identity from device-owned current meals, then service passes expected revision to transaction writes: `server/services/meal-correction.ts:376`, `server/services/meal-correction.ts:661`, `server/services/meal-correction.ts:721`. |
| 62-03/T-62-04 | Information disclosure | tool failure logs/proof | mitigate | CLOSED | Precondition failures map to stable fatal codes; tool argument logging uses summaries/redaction rather than raw payloads: `server/orchestrator/tools.ts:901`, `server/orchestrator/tools.ts:1260`, `server/orchestrator/tools.ts:1533`, `tests/unit/tools.test.ts:1458`. |
| 62-03/T-62-05 | Tampering | client-only stale checks | mitigate | CLOSED | Tool path uses backend resolver state plus transaction preconditions, not client receipt redaction: `server/orchestrator/tools.ts:1131`, `server/orchestrator/tools.ts:1300`, `server/services/meal-transactions.ts:236`. |
| 62-03/T-62-06 | Repudiation / Tampering | mutation receipt and summary/publish side effects | mitigate | CLOSED | Stale tool failures have no mutation kind or summary outcome and do not advance current revisions: `tests/unit/tools.test.ts:1456`, `tests/unit/tools.test.ts:1460`, `tests/unit/tools.test.ts:1467`. |
| 62-04/T-62-01 | Tampering | `client/src/api.ts` write calls | mitigate | CLOSED | Client writes serialize `expectedMealRevisionId` from payloads: `client/src/components/MealEditScreen.tsx:185`, `client/src/components/MealEditScreen.tsx:234`, `client/src/api.ts:868`, `client/src/api.ts:888`. |
| 62-04/T-62-02 | Tampering | missing expected revision from client | mitigate | CLOSED | Payload builders require/copy `mealRevisionId`; write helpers require options/input containing expected revision: `client/src/meal-edit-payload.ts:60`, `client/src/meal-edit-payload.ts:84`, `client/src/api.ts:868`, `tests/unit/api-client.test.ts:644`. |
| 62-04/T-62-03 | Elevation of privilege | forged/foreign device mutation attempts | transfer | CLOSED | Client cannot authorize ownership; transfer target is server signed-session/device scoped lookup: `server/routes/meals.ts:167`, `server/services/meal-transactions.ts:163`, `server/routes/chat.ts:1166`. |
| 62-04/T-62-04 | Information disclosure | conflict errors and tests | mitigate | CLOSED | Client conflict error preserves only stable code and minimal metadata; route tests assert minimal conflict bodies: `client/src/api.ts:231`, `client/src/api.ts:248`, `tests/unit/api-client.test.ts:751`, `tests/integration/meals-api.test.ts:432`. |
| 62-04/T-62-05 | Tampering | client-only stale protection | mitigate | CLOSED | UI handles recovery, but source relies on server 409 conflict type and disables stale instance controls: `client/src/components/MealEditScreen.tsx:143`, `client/src/components/MealEditScreen.tsx:212`, `client/src/components/MealEditScreen.tsx:432`. |
| 62-04/T-62-06 | Repudiation / Tampering | stale conflict recovery | mitigate | CLOSED | Stale conflicts call refresh/invalidation paths and do not enter success `onBack` path: `client/src/components/MealEditScreen.tsx:131`, `client/src/components/MealEditScreen.tsx:143`, `client/src/components/MealEditScreen.tsx:206`, `client/src/components/MealEditScreen.tsx:253`. |
| 62-05/T-62-05-01 | Tampering | `server/routes/meals.ts` PATCH preflight | mitigate | CLOSED | PATCH calls mutation guard with expected revision before grouped item-count rejection, asset validation, write, summary, or publish: `server/routes/meals.ts:189`, `server/routes/meals.ts:194`, `server/routes/meals.ts:201`, `server/routes/meals.ts:232`. |
| 62-05/T-62-05-02 | Tampering | `server/services/meal-transactions.ts` preflight | mitigate | CLOSED | Preflight reuses device-scoped lookup and `MealRevisionPreconditionError`; SQL is parameterized with `?`: `server/services/meal-transactions.ts:294`, `server/services/meal-transactions.ts:313`, `server/services/meal-transactions.ts:318`, `server/services/meal-transactions.ts:324`. |
| 62-05/T-62-05-03 | Elevation of privilege | revision preflight | mitigate | CLOSED | Routes derive `deviceId` from signed session and preflight lookup constrains by device and meal id: `server/routes/meals.ts:168`, `server/routes/meals.ts:175`, `server/services/meal-transactions.ts:313`. |
| 62-05/T-62-05-04 | Information disclosure | conflict response and test proof | mitigate | CLOSED | Stale grouped-precedence test asserts only stable conflict metadata and absence of summary fields: `tests/integration/meals-api.test.ts:541`, `tests/integration/meals-api.test.ts:548`, `tests/integration/meals-api.test.ts:635`. |
| 62-05/T-62-05-05 | Repudiation / Tampering | summary and realtime side effects | mitigate | CLOSED | Integration tests count summary and publish calls and require zero on stale preflight failure: `tests/integration/meals-api.test.ts:512`, `tests/integration/meals-api.test.ts:549`, `tests/integration/meals-api.test.ts:636`. |
| 62-05/T-62-05-06 | Tampering | `client/src/meal-edit-refresh.ts` | mitigate | CLOSED | Helper refreshes visible rows after committed success and records UX state only; no write authority or revision synthesis: `client/src/meal-edit-refresh.ts:18`, `client/src/meal-edit-refresh.ts:24`, `client/src/meal-edit-refresh.ts:35`. |
| 62-05/T-62-05-07 | Denial of service | same-day row refresh | accept | CLOSED | Accepted risk documented below; refresh is one bounded `getMeals({ refreshReason: "meal_mutation" })` per successful same-day mutation: `client/src/meal-edit-refresh.ts:31`, `client/src/meal-edit-refresh.ts:35`. |

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-62-01 | 62-05/T-62-05-07 | One `/api/meals` refresh per successful same-day edit/delete is bounded, same-origin, and already used by stale recovery behavior. It does not create write authority or widen data access. | Plan-authored disposition, verified by auditor | 2026-05-18 |

## Transfer Documentation

| Threat Ref | Transfer Target | Verification |
|------------|-----------------|--------------|
| 62-02/T-62-01 | Plan 01 and Plan 03 server-side write authority | Direct and tool write preconditions verified at `server/services/meal-transactions.ts:220`, `server/orchestrator/tools.ts:1271`, and `server/orchestrator/tools.ts:1355`. |
| 62-02/T-62-05 | Plan 01 and Plan 03 server-side preconditions | Read identity is not write authority; write enforcement verified at `server/routes/meals.ts:208`, `server/services/meal-transactions.ts:494`, and `server/orchestrator/tools.ts:1300`. |
| 62-04/T-62-03 | Server signed-session and device-scoped route/service lookup | Meal routes and chat routes resolve signed guest sessions before using device ids, and transaction lookups constrain by `deviceId`: `server/routes/meals.ts:168`, `server/routes/chat.ts:1166`, `server/services/meal-transactions.ts:163`. |

## Threat Flags

| Source | Result |
|--------|--------|
| `62-01-SUMMARY.md` | None declared. |
| `62-02-SUMMARY.md` | No `## Threat Flags` section present; no unregistered flag text found during summary review. |
| `62-03-SUMMARY.md` | None declared. |
| `62-04-SUMMARY.md` | None declared. |
| `62-05-SUMMARY.md` | None declared. |

Unregistered flags: none.

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-18 | 31 | 31 | 0 | Codex security auditor |

## Sign-Off

- [x] All authored threats have a disposition.
- [x] Mitigated threats have code evidence in the cited implementation paths.
- [x] Transfer dispositions are tied to verified server-side controls.
- [x] Accepted risk is documented in the accepted risks log.
- [x] `threats_open: 0` confirmed.
- [x] Implementation files were not modified by this audit.

Approval: verified 2026-05-18
