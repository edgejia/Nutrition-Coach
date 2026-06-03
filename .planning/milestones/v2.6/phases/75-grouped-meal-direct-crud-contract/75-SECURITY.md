---
phase: 75
slug: grouped-meal-direct-crud-contract
status: verified
threats_open: 0
threats_total: 16
threats_closed: 16
asvs_level: 1
created: 2026-06-03
audited_at: 2026-06-03
mode: register_authored_at_plan_time
---

# Phase 75 — Security

Per-phase security contract for Phase 75 grouped meal direct CRUD contract.

## Scope

Verified only the plan-time threat register for Phase 75. The register was authored in `75-01-PLAN.md`, `75-02-PLAN.md`, and `75-03-PLAN.md`; no retroactive threat expansion was performed.

Implementation files were treated as read-only during audit. The `gsd-security-auditor` sub-agent returned `## SECURED` with all 16 declared threats closed or documented accepted risks.

## Trust Boundaries

| Boundary | Description | Data Crossing |
|---|---|---|
| Browser client -> `PATCH /api/meals/:id` | Untrusted grouped JSON body crosses into the server mutation route. | Meal mutation payload, revision precondition, grouped item nutrition facts |
| Signed guest session -> service `deviceId` | Route must derive ownership from signed cookies rather than raw caller identifiers. | Guest-session cookie, resolved device ownership |
| Route parser -> transaction service | Parsed public item rows become persisted revision facts. | Trimmed item names, calories, protein, carbs, fat, submitted order |
| Route -> summary/realtime side effects | Summary recompute and realtime publish must happen only after successful commit. | Aggregate meal mutation result, affected date, daily summary envelope |
| Direct route/service code -> chat persistence | Direct grouped edits must not create assistant messages, chat receipts, or compressed-history mutation outcomes. | Revision history and aggregate route response only |
| Test artifacts -> planning proof | Evidence must stay metadata-only and synthetic. | Test names, command results, source assertions |

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|---|---|---|---|---|---|
| T-75-01 | Tampering | `parseMealUpdateBody()` grouped branch | mitigate | Red tests require strict rejection for mixed shapes, aliases, nested nutrition, extra item keys, empty lists, invalid numbers, and bad positions. | closed |
| T-75-02 | Elevation of Privilege | `PATCH /api/meals/:id` ownership | mitigate | Existing signed guest-session route setup remains authoritative; no query/header `deviceId` authority is used. | closed |
| T-75-03 | Tampering | stale revision writes | mitigate | Missing/stale expected revision conflicts keep existing 409 body and no mutation side effects. | closed |
| T-75-04 | Information Disclosure | realtime summary publish | mitigate | Existing `meal_mutation` envelope omits `summaryOutcome`, `mealId`, and `mealRevisionId`. | closed |
| T-75-05 | Information Disclosure | proof artifacts | mitigate | Phase proof uses repo-native tests and synthetic values; no harness artifacts, provider bodies, session material, image data, or database snapshots were added. | closed |
| T-75-06 | Tampering | `parseGroupedMealItems()` | mitigate | Exact key allowlist, nonempty array, zero-based positions, finite nonnegative numbers, and nonblank names. | closed |
| T-75-07 | Elevation of Privilege | `resolveGuestSession()` and `foodLoggingService.updateMeal()` | mitigate | Signed cookie session resolution is preserved and only the resolved `deviceId` is passed into services. | closed |
| T-75-08 | Tampering | stale `expectedMealRevisionId` | mitigate | `updateTransaction()` enforces expected revision before writes and route converts `MealRevisionPreconditionError` with existing 409 shape. | closed |
| T-75-09 | Information Disclosure | route response and realtime envelope | mitigate | Existing aggregate response and metadata-only `meal_mutation` envelope are reused; no item rows, summary outcome in publish payload, chat receipts, or internal revision rows are exposed. | closed |
| T-75-10 | Repudiation | direct route edits and chat history | accept | Phase 75 intentionally keeps direct route edits out of chat receipts/outcomes per D-29; authoritative revision history remains in meal revisions. | closed |
| T-75-11 | Tampering | conflict branches | mitigate | Integration tests assert missing/stale grouped revisions return existing 409 bodies before side effects. | closed |
| T-75-12 | Denial of Service | invalid grouped payloads | mitigate | Validation failure stays simple 400 and does not trigger summary recompute or realtime fan-out. | closed |
| T-75-13 | Tampering | `meal_revision_items.position` | mitigate | Unit tests assert persisted positions are contiguous zero-based indexes matching submitted order. | closed |
| T-75-14 | Information Disclosure | proof artifacts and realtime output | mitigate | Tests and summaries record command/status/source assertions only; realtime envelope assertions stay metadata-only. | closed |
| T-75-15 | Repudiation | direct edits outside chat history | accept | Direct route edits remain represented by revision history and aggregate route response; no chat receipt persistence is planned per D-29. | closed |
| T-75-SC | Tampering | package-manager installs | mitigate | No package installs were planned or introduced. | closed |

## Verification Evidence

| Threat ID | Evidence |
|---|---|
| T-75-01 | `server/routes/meals.ts:139` selects grouped bodies by own `items`; `server/routes/meals.ts:140`-`149` rejects mixed or extra top-level keys; `server/routes/meals.ts:156` requires parsed grouped items; `tests/integration/meals-api.test.ts:678`-`847` asserts strict malformed grouped body rejection with no side effects. |
| T-75-02 | `server/routes/meals.ts:294`-`302` resolves the signed guest session before PATCH authority; `server/lib/guest-session-resolver.ts:36`-`44` derives `deviceId` from verified active session cookies; `server/routes/meals.ts:336`-`352` passes only that resolved `deviceId` into `foodLoggingService.updateMeal()`. |
| T-75-03 | `tests/integration/meals-api.test.ts:957`-`1112` asserts missing/stale PATCH and DELETE revisions return existing 409 bodies with zero summary/publish calls and unchanged state; `server/services/meal-transactions.ts:229`-`253` enforces required/stale revision preconditions. |
| T-75-04 | `tests/integration/meals-api.test.ts:120`-`136` asserts the `meal_mutation` realtime envelope omits `summaryOutcome`, `mealId`, and `mealRevisionId`; `server/routes/meals.ts:235`-`239` publishes only `summary`, `affectedDate`, and `source`. |
| T-75-05 | Phase commits touched only `tests/integration/meals-api.test.ts`, `server/routes/meals.ts`, and `tests/unit/meal-transactions.test.ts`; `git status --short -- tests/harness/artifacts` returned no harness artifact changes. |
| T-75-06 | `server/routes/meals.ts:72`-`130` implements `parseGroupedMealItems()` with nonempty array validation, exact item key allowlist, trimmed nonblank names, zero-based integer positions matching array index, finite nonnegative nutrition numbers, finite aggregate totals, and public `name` to service `foodName` mapping. |
| T-75-07 | `server/lib/guest-session-resolver.ts:36`-`58` reads and verifies signed session cookies; `server/routes/meals.ts:294`-`305` uses that resolution in PATCH; `server/services/food-logging.ts:165`-`166` passes the resolved `deviceId` into `mealTransactionsService.updateTransaction()`. |
| T-75-08 | `server/services/meal-transactions.ts:501`-`508` loads the existing transaction and calls `assertMutableExpectedRevision()` before any update writes; `server/routes/meals.ts:356`-`361` converts `MealRevisionPreconditionError` through the existing 409 conflict response. |
| T-75-09 | `server/routes/meals.ts:383`-`401` returns the aggregate meal response without item rows; `server/routes/meals.ts:235`-`239` publishes the metadata-only `meal_mutation` envelope; the no-chat-persistence source gate returned no matches. |
| T-75-10 | Accepted risk log documents the D-29 decision: direct route edits remain outside chat receipts/outcomes and are represented by meal revision history. |
| T-75-11 | `tests/integration/meals-api.test.ts:849`-`955` asserts missing and stale grouped revisions return `MEAL_REVISION_REQUIRED`/`MEAL_REVISION_STALE`, omit summary fields, make zero summary/publish calls, and leave current meal state unchanged. |
| T-75-12 | `server/routes/meals.ts:307`-`310` returns simple `400 { error: "Invalid meal update" }` before mutation side effects; `tests/integration/meals-api.test.ts:678`-`847` verifies malformed grouped payloads do not trigger summary recompute or realtime publish. |
| T-75-13 | `server/services/meal-transactions.ts:555`-`565` persists revision items with `items.map((item, position) => ...)`; `tests/unit/meal-transactions.test.ts:478`-`567` asserts contiguous zero-based persisted positions matching submitted order across full-list updates. |
| T-75-14 | `tests/integration/meals-api.test.ts:120`-`136` keeps realtime assertions metadata-only; all three phase summaries report no threat flags. |
| T-75-15 | Accepted risk log documents that direct edits outside chat history are represented by revision history and aggregate route response, with no chat receipt persistence planned per D-29. |
| T-75-SC | Phase summaries declare no added tech stack, phase commit file lists include no package manifests or lockfiles, and package-file status checks returned no package-file changes. |

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---|---|---|---|---|
| AR-75-01 | T-75-10 | Phase 75 intentionally follows D-29: direct edits are authoritative through meal revision history and aggregate route responses, not chat persistence. | Phase 75 plan-time threat register | 2026-06-03 |
| AR-75-02 | T-75-15 | Phase 75 intentionally keeps no chat receipt persistence for direct grouped route edits; revision history remains authoritative. | Phase 75 plan-time threat register | 2026-06-03 |

## Threat Flags

No unregistered flags. `75-01-SUMMARY.md`, `75-02-SUMMARY.md`, and `75-03-SUMMARY.md` each report `## Threat Flags` as none.

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|---|---:|---:|---:|---|
| 2026-06-03 | 16 | 16 | 0 | gsd-security-auditor |

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-06-03

