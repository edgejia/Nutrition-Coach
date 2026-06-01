---
phase: 71
slug: authoritative-dto-validation-expansion
status: verified
threats_open: 0
asvs_level: 1
created: 2026-06-01
---

# Phase 71 Security Audit

**Phase:** 71 - authoritative-dto-validation-expansion  
**ASVS Level:** 1  
**Config:** `block_on=open`, `security_enforcement=true`  
**Threats Open:** 0  
**Threats Closed:** 16/16  
**Audit Date:** 2026-06-01

## Scope

This audit verifies declared mitigations from the three Phase 71 `threat_model` blocks only:

- `71-01-PLAN.md`: `T-71-01` through `T-71-05`, `T-71-SC`
- `71-02-PLAN.md`: `T-71-06` through `T-71-10`, `T-71-SC`
- `71-03-PLAN.md`: `T-71-11` through `T-71-15`, `T-71-SC`

Duplicate `T-71-SC` entries share the same rationale and are treated as one accepted risk.

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-71-01 | Tampering | mitigate | CLOSED | `client/src/sse.ts:1` imports shared guards; `client/src/sse.ts:27` validates `daily_summary` before callbacks; `client/src/sse.ts:48` validates `goals_update` before callbacks; `tests/unit/sse-client.test.ts:158` and `tests/unit/sse-client.test.ts:316` prove malformed frames no-op. |
| T-71-02 | Tampering | mitigate | CLOSED | `client/src/store.ts:149` guards `setMeals`; `client/src/store.ts:276` guards `setDailySummary`; `client/src/store.ts:300` guards `setDailyTargets`; `tests/unit/store.test.ts:214`, `tests/unit/store.test.ts:253`, and `tests/unit/store.test.ts:266` prove malformed writes preserve state/storage. |
| T-71-03 | Tampering | mitigate | CLOSED | `client/src/dto-guards.ts:94` requires authoritative meal row core fields, revision identity, finite nutrition, positive `itemCount`, and explicit enum `mealPeriod`; `tests/unit/sse-client.test.ts:257` proves valid row acceptance and invalid period rejection. |
| T-71-04 | Information Disclosure | mitigate | CLOSED | `tests/unit/sse-client.test.ts:18` uses an in-process fake EventSource; `tests/unit/store.test.ts:5` uses in-memory localStorage. Targeted grep found no unit-test filesystem/log writer imports or secret/provider payload patterns in `tests/unit/sse-client.test.ts` or `tests/unit/store.test.ts`. |
| T-71-05 | Information Disclosure | mitigate | CLOSED | `client/src/api.ts:380` preserves `withAuthorizedAssetUrl()` and `client/src/api.ts:389` deletes legacy `deviceId`; `tests/unit/api-client.test.ts:1241` proves `deviceId` query stripping. |
| T-71-06 | Tampering | mitigate | CLOSED | `client/src/api.ts:469`, `client/src/api.ts:475`, `client/src/api.ts:481`, `client/src/api.ts:534`, and `client/src/api.ts:967` define named response assertions; `client/src/api.ts:626`, `client/src/api.ts:871`, `client/src/api.ts:884`, `client/src/api.ts:1047`, and `client/src/api.ts:1056` read JSON as `unknown` and assert before return; `tests/unit/api-client.test.ts:815` proves stable invalid-payload failures. |
| T-71-07 | Tampering | mitigate | CLOSED | `client/src/api.ts:785` parses stream data as `unknown`; `client/src/api.ts:801` and `client/src/api.ts:816` dispatch terminal callbacks while conditionally including only valid authoritative additions; `tests/unit/api-client.test.ts:1565` and `tests/unit/api-client.test.ts:1792` prove malformed additions are omitted while callbacks fire. |
| T-71-08 | Tampering | mitigate | CLOSED | `client/src/api.ts:939` requires complete history meal DTOs; `client/src/api.ts:1008` throws instead of fabricating history meal facts; `client/src/meal-edit-payload.ts:72` requires revision identity and complete core facts before edit payload creation; `tests/unit/meal-edit-payload.test.ts:244` and `tests/unit/meal-edit-payload.test.ts:274` prove fail-closed edit handoff. |
| T-71-09 | Information Disclosure | mitigate | CLOSED | `client/src/api.ts:380` strips legacy asset `deviceId`; normalized paths call it at `client/src/api.ts:411`, `client/src/api.ts:1003`, and `client/src/api.ts:1036`; `tests/unit/api-client.test.ts:306`, `tests/unit/api-client.test.ts:738`, and `tests/unit/api-client.test.ts:1241` prove stripping is preserved. |
| T-71-10 | Information Disclosure | mitigate | CLOSED | `tests/unit/api-client.test.ts:22` uses mock fetch payloads; `tests/unit/meal-edit-payload.test.ts:14` uses synthetic local DTOs. Targeted grep found no unit-test filesystem/log writer imports or real secret/session/provider body capture patterns in the Plan 71-02 unit proof. |
| T-71-11 | Tampering | mitigate | CLOSED | `tests/integration/device-api.test.ts:93` asserts finite `dailyTargets`; `tests/integration/day-snapshot-api.test.ts:87` asserts public day snapshot DTOs; `tests/integration/history-api.test.ts:75` asserts public history meal DTOs; `tests/integration/history-trends-api.test.ts:89` asserts valid trend DTOs. |
| T-71-12 | Spoofing | mitigate | CLOSED | Protected route handlers call `resolveGuestSession` before deriving `deviceId`: `server/routes/device.ts:464`, `server/routes/day-snapshot.ts:18`, `server/routes/history.ts:146`, `server/routes/history.ts:196`, `server/routes/history.ts:267`, and `server/routes/history.ts:311`. Spoofed query/header selectors are covered by `tests/integration/history-api.test.ts:336` and `tests/integration/history-trends-api.test.ts:210`. |
| T-71-13 | Tampering | mitigate | CLOSED | `server/services/history-query.ts:409` normalizes only stored valid `mealPeriod`; `server/routes/day-snapshot.ts:54` only emits existing `mealPeriod`; `tests/integration/day-snapshot-api.test.ts:244` and `tests/integration/history-api.test.ts:418` prove explicit values are preserved and legacy rows are not inferred. |
| T-71-14 | Information Disclosure | mitigate | CLOSED | `tests/integration/device-api.test.ts:202` asserts goal responses omit request/session/telemetry echoes; `tests/integration/day-snapshot-api.test.ts:238` asserts no `currentRevisionId`, raw `deviceId`, or `deviceId=`; `tests/integration/history-api.test.ts:182` asserts unsafe history fields are absent; `tests/integration/history-trends-api.test.ts:105` asserts trend responses omit raw device/revision/asset query fields. |
| T-71-15 | Information Disclosure | mitigate | CLOSED | Integration proof uses `:memory:` SQLite via `tests/integration/device-api.test.ts:120`, `tests/integration/day-snapshot-api.test.ts:118`, `tests/integration/history-api.test.ts:154`, and `tests/integration/history-trends-api.test.ts:132`; logging assertions at `tests/integration/device-api.test.ts:681`, `tests/integration/device-api.test.ts:742`, and `tests/integration/device-api.test.ts:852` prove sensitive sentinels/session/provider details are excluded from captured proof logs. |
| T-71-SC | Tampering | accept | CLOSED | Accepted risk logged below. Commit-file verification for Phase 71 task commits lists only client/server/test source files and does not include `package.json`, `yarn.lock`, or package manager metadata. |

## Accepted Risks Log

| Threat ID | Risk | Rationale | Status |
|-----------|------|-----------|--------|
| T-71-SC | Package installation tampering | No package installation was part of Phase 71; implementation used local TypeScript predicates and existing test tooling. Phase commit-file verification found no package manifest or lockfile changes. | ACCEPTED |

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-06-01 | 16 | 16 | 0 | gsd-security-auditor |

## Threat Flags

No unregistered flags.

- `71-02-SUMMARY.md` explicitly reports `## Threat Flags` as `None`.
- `71-01-SUMMARY.md` and `71-03-SUMMARY.md` do not declare additional threat flags.

## Result

`SECURED` - all declared mitigations are present in implementation and/or focused tests; no open threats block the phase under `block_on=open`.

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-01
