---
phase: 61-committed-mutation-outcome-and-summary-contract
secured: 2026-05-17T16:04:10+08:00
asvs_level: 1
threats_total: 24
threats_closed: 24
threats_open: 0
block_on: open
status: verified
---

# Phase 61 Security Audit

## Result

SECURED.

The audit verified only the authored Phase 61 threat register. Implementation files were read-only; only this security artifact was updated. All declared mitigations are present in code after commit `3b9b4a3` redacted chat summary publish-failure logs.

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-61-01 | Information Disclosure | mitigate | CLOSED | `server/services/summary-outcome.ts:40` returns `SummaryOutcome` only; the failure branches catch without logging and expose only `status`/`reason` at `server/services/summary-outcome.ts:54` and `server/services/summary-outcome.ts:61`. Unit proof rejects `publish_failed` at `tests/unit/summary-outcome.test.ts:14` and covers fresh/recovered/unavailable at `tests/unit/summary-outcome.test.ts:47`, `tests/unit/summary-outcome.test.ts:86`, and `tests/unit/summary-outcome.test.ts:116`. |
| T-61-02 | Tampering | mitigate | CLOSED | Update/delete service calls remain scoped by caller-supplied `deviceId`: `updateTransaction(deviceId, mealId, ...)` at `server/services/meal-correction.ts:692` and `softDeleteTransaction(deviceId, mealId)` at `server/services/meal-correction.ts:740`. |
| T-61-03 | Repudiation | mitigate | CLOSED | Update/delete commit before summary recompute and return committed facts plus `summaryOutcome`: update at `server/services/meal-correction.ts:692` through `server/services/meal-correction.ts:726`; delete at `server/services/meal-correction.ts:740` through `server/services/meal-correction.ts:754`. |
| T-61-04 | Denial of Service | accept | CLOSED | Accepted by `61-01-PLAN.md` threat register. Implementation performs one normal summary read and one persisted-meal recovery read with no retry loop: `getDailySummary` at `server/services/summary-outcome.ts:49` and `getMealsByDate` at `server/services/summary-outcome.ts:25`. |
| T-61-05 | Information Disclosure | mitigate | CLOSED | Receipt renderer denylist includes internal/protocol terms including `summaryOutcome`, `dailySummary`, `recompute_failed`, `publish_failed`, `PATCH`, `DELETE`, and `/api` at `server/orchestrator/mutation-receipts.ts:5`; tests prove log/update/delete receipt copy has no forbidden terms at `tests/unit/mutation-receipts.test.ts:305`, `tests/unit/mutation-receipts.test.ts:340`, and `tests/unit/mutation-receipts.test.ts:375`. |
| T-61-06 | Spoofing | mitigate | CLOSED | Meal receipts are rendered from typed `MutationEffects`, not assistant prose: committed meal fields are required in `server/orchestrator/mutation-effects.ts:5`, `server/orchestrator/mutation-effects.ts:42`, `server/orchestrator/mutation-effects.ts:47`, and `server/orchestrator/mutation-effects.ts:52`; renderer switches on those typed effects at `server/orchestrator/mutation-receipts.ts:122`. |
| T-61-07 | Integrity | mitigate | CLOSED | Meal mutation effects keep `summaryOutcome` separate from committed meal facts at `server/orchestrator/mutation-effects.ts:34`; log/update/delete each require both committed facts and `summaryOutcome` at `server/orchestrator/mutation-effects.ts:42`, `server/orchestrator/mutation-effects.ts:47`, and `server/orchestrator/mutation-effects.ts:52`. |
| T-61-08 | Scope Boundary | accept | CLOSED | Accepted by `61-02-PLAN.md` and `61-06-PLAN.md`. Implementation leaves goals on a separate `committedSummary` contract at `server/orchestrator/mutation-effects.ts:38` and `server/orchestrator/mutation-effects.ts:57`; meal-only `summaryOutcome` handling is separate in `server/orchestrator/index.ts:978` through `server/orchestrator/index.ts:1031`. |
| T-61-09 | Tampering | mitigate | CLOSED | Tool contracts still use zod validation at `server/orchestrator/tools.ts:377`, `server/orchestrator/tools.ts:1241`, and `server/orchestrator/tools.ts:1315`; unresolved update/delete meal targets fail before service mutation at `server/orchestrator/tools.ts:1253` and `server/orchestrator/tools.ts:1326`. Validation failure proof is at `tests/unit/tools.test.ts:1058`. |
| T-61-10 | Repudiation | mitigate | CLOSED | Orchestrator requires `summaryOutcome` after successful meal mutation at `server/orchestrator/index.ts:132`, builds renderer-owned effects from committed facts at `server/orchestrator/index.ts:987`, `server/orchestrator/index.ts:1010`, and `server/orchestrator/index.ts:1022`, and returns `didMutateMeal` plus `summaryOutcome` at `server/orchestrator/index.ts:1105`. |
| T-61-11 | Information Disclosure | mitigate | CLOSED | Orchestrator hook payloads use redacted tool args at `server/orchestrator/index.ts:909` and tool result summaries at `server/orchestrator/index.ts:1052`; no raw provider body or assistant final text is added by the Phase 61 result path. SSE route redaction tests deny unsafe raw fragments in logs/traces at `tests/integration/chat-streaming.test.ts:3083` and `tests/integration/chat-streaming.test.ts:3130`. |
| T-61-12 | Integrity | mitigate | CLOSED | `SummaryOutcome` union excludes publish status at `server/services/summary-outcome.ts:4`; tests reject `publish_failed` in outcomes at `tests/unit/summary-outcome.test.ts:14`. Chat/direct route tests also reject publish failure in response bodies at `tests/integration/chat-api.test.ts:2293` and `tests/integration/meals-api.test.ts:456`. |
| T-61-13 | Spoofing | mitigate | CLOSED | Chat routes preserve signed guest-session resolution and cookie clearing: `/api/chat/stop` at `server/routes/chat.ts:1133`, `/api/chat` at `server/routes/chat.ts:1164`, and history at `server/routes/chat.ts:1548`. No raw `deviceId` query/header authority is used for these routes. |
| T-61-14 | Tampering | mitigate | CLOSED | Chat mutation tools derive `deviceId` from the orchestrator context and call scoped services, not raw model authority: log at `server/orchestrator/tools.ts:961`, update at `server/orchestrator/tools.ts:1248` through `server/orchestrator/tools.ts:1261`, delete at `server/orchestrator/tools.ts:1321` through `server/orchestrator/tools.ts:1331`. |
| T-61-15 | Information Disclosure | mitigate | CLOSED | Chat JSON/SSE response bodies project only allowed committed facts and `summaryOutcome`: SSE stopped/done payloads at `server/routes/chat.ts:941` through `server/routes/chat.ts:970`, JSON payload projection at `server/routes/chat.ts:1421` through `server/routes/chat.ts:1429`, and catch-path projection at `server/routes/chat.ts:1469` through `server/routes/chat.ts:1476`. Publish failure logging is metadata-only at `server/routes/chat.ts:406` through `server/routes/chat.ts:410`; regression proof rejects unsafe thrown material in logs and response payloads at `tests/integration/chat-api.test.ts:2338` through `tests/integration/chat-api.test.ts:2407`. |
| T-61-16 | Integrity | mitigate | CLOSED | `publishSummarySafe` remains non-fatal and outside response-body construction: it is called before JSON response assembly at `server/routes/chat.ts:1401` through `server/routes/chat.ts:1403` and in catch fallback at `server/routes/chat.ts:1455` through `server/routes/chat.ts:1457`; response projection still exposes `summaryOutcome` without publish status at `server/routes/chat.ts:1421` through `server/routes/chat.ts:1429` and `server/routes/chat.ts:1469` through `server/routes/chat.ts:1476`. The helper discards thrown publisher material and logs only `event: "summary_publish_failed"` plus `failureReason: "publisher_error"` at `server/routes/chat.ts:406` through `server/routes/chat.ts:410`; tests assert no `publish_failed` body status and no thrown error text at `tests/integration/chat-api.test.ts:2293` through `tests/integration/chat-api.test.ts:2407`. |
| T-61-17 | Spoofing | mitigate | CLOSED | Direct meal routes use `resolveGuestSession()` and clear cookies on failed session resolution at `server/routes/meals.ts:142` through `server/routes/meals.ts:151` and `server/routes/meals.ts:238` through `server/routes/meals.ts:247`; missing cookie tests assert 401 at `tests/integration/meals-api.test.ts:490`. |
| T-61-18 | Elevation of Privilege | mitigate | CLOSED | Direct route service calls are scoped by resolved `deviceId`: update at `server/routes/meals.ts:163`, `server/routes/meals.ts:175`, and `server/routes/meals.ts:181`; delete at `server/routes/meals.ts:254`. Foreign-device denial is tested at `tests/integration/meals-api.test.ts:210` and `tests/integration/meals-api.test.ts:553`. |
| T-61-19 | Information Disclosure | mitigate | CLOSED | Direct route publish logs contain event, affected date, and summary status only at `server/routes/meals.ts:89` and `server/routes/meals.ts:94`; no error message, raw user text, provider body, image data, session material, or DB snapshot is logged. Day-rollover log proof denies raw device id at `tests/integration/meals-api.test.ts:977` through `tests/integration/meals-api.test.ts:991`. |
| T-61-20 | Integrity | mitigate | CLOSED | Direct PATCH validates body at `server/routes/meals.ts:39`, rejects invalid/negative input at `server/routes/meals.ts:154`, rejects grouped direct edits at `server/routes/meals.ts:163`, commits before outcome projection at `server/routes/meals.ts:181`, and returns HTTP 200 committed facts plus `summaryOutcome` at `server/routes/meals.ts:217`. Delete mirrors commit before projection at `server/routes/meals.ts:254` and `server/routes/meals.ts:279`. |
| T-61-21 | Tampering | mitigate | CLOSED | Client guard accepts only exact statuses and `reason: "recompute_failed"` at `client/src/api.ts:163`; malformed values are omitted by normalization at `client/src/api.ts:399`. SSE done/stopped parsing uses that guard at `client/src/api.ts:675` and `client/src/api.ts:695`; malformed tests cover rejection at `tests/unit/api-client.test.ts:1054` and `tests/unit/api-client.test.ts:1128`. |
| T-61-22 | Information Disclosure | mitigate | CLOSED | Client tests use mocked fetch/SSE payloads and no live provider/session artifacts: direct mutation mocks are at `tests/unit/api-client.test.ts:664` and `tests/unit/api-client.test.ts:732`; component source-contract tests assert no visible degraded-summary copy at `tests/unit/meal-edit-screen.test.ts:58` and `tests/unit/meal-edit-screen.test.ts:75`. |
| T-61-23 | Integrity | mitigate | CLOSED | Direct mutation UI records committed side effects before optional summary refresh at `client/src/components/MealEditScreen.tsx:121`; save/delete call that helper even when `dailySummary` is absent at `client/src/components/MealEditScreen.tsx:151` and `client/src/components/MealEditScreen.tsx:178`. Summary Detail guards summary refresh on `dailySummary?.date` at `client/src/components/SummaryDetailScreen.tsx:510`. |
| T-61-24 | Elevation of Privilege | transfer | CLOSED | Transfer is documented in `61-06-PLAN.md`; implementation delegates authorization to signed-cookie routes. Client direct mutation calls send same-origin credentials at `client/src/api.ts:828` and `client/src/api.ts:839`; server routes enforce signed session resolution at `server/routes/meals.ts:142` and `server/routes/meals.ts:238`. |

## Open Threats

None.

## Accepted And Transferred Risks

| Risk ID | Threat ID | Disposition | Closure Evidence |
|---------|-----------|-------------|------------------|
| AR-61-01 | T-61-04 | accept | Plan accepts one persisted-meal recovery read and no retry loop; code has one `getDailySummary` attempt and one `getMealsByDate` recovery path in `server/services/summary-outcome.ts:49` and `server/services/summary-outcome.ts:25`. |
| AR-61-02 | T-61-08 | accept | Plan excludes `update_goals` migration; code keeps goal effects on `committedSummary` at `server/orchestrator/mutation-effects.ts:38` and `server/orchestrator/index.ts:1032`. |
| TR-61-01 | T-61-24 | transfer | Client authorization is transferred to same-origin signed-cookie routes; client uses `credentials: "same-origin"` at `client/src/api.ts:831` and `client/src/api.ts:842`, while server resolves sessions at `server/routes/meals.ts:142` and `server/routes/meals.ts:238`. |

## Threat Flags

No unregistered flags.

- `61-01-SUMMARY.md`: no `## Threat Flags` section present.
- `61-02-SUMMARY.md`: `## Threat Flags` reports `None`.
- `61-03-SUMMARY.md`: `## Threat Flags` reports `None`.
- `61-04-SUMMARY.md`: `## Threat Flags` reports `None`.
- `61-05-SUMMARY.md`: `## Threat Flags` reports `None`.
- `61-06-SUMMARY.md`: `## Threat Flags` reports `None`.

## Review Notes

- `61-REVIEW.md` CR-01 concerns `update_goals`; this is covered by accepted scope boundary T-61-08 and was not converted into an unrelated Phase 61 open threat.
- `61-REVIEW.md` WR-01 and WR-02 are adjacent correctness/contract warnings, not declared Phase 61 threat-register items.

## Audit Notes

- Project skills and required artifacts were loaded before threat verification, including `nutrition-security-review`.
- Implementation files were read-only during this audit.
- `.planning/config.json` does not define `asvs_level` or `block_on`; this file uses the established GSD default `asvs_level: 1` and `block_on: open`.
- Verification was by targeted source reads, grep evidence, and targeted reruns. `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts` passed with 75 tests; `yarn tsc --noEmit` passed.
