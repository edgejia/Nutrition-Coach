---
phase: 63-sse-meal-row-freshness-and-affected-date-invalidation
secured: 2026-05-18T23:01:10+08:00
status: secured
threats_total: 25
threats_closed: 25
threats_open: 0
accepted_risks: 2
unregistered_flags: 0
asvs_level: 1
block_on: open
security_enforcement: true
auditor: Codex security auditor
---

# Phase 63 Security Verification

Per secure-phase workflow, this audit verified only the declared Phase 63 threat registers from `63-01-PLAN.md` through `63-05-PLAN.md`. Implementation files were read-only; only this security artifact was created.

## Scope

| Item | Result |
|---|---|
| Required files loaded | All requested plans, summaries, verification/review artifacts, AGENTS.md, Nutrition security skill, and listed implementation files were read. |
| Project skills loaded | All `.codex/skills/*/SKILL.md` files were read; no `.agents/skills` directory exists in this repo. |
| Config | `.planning/config.json` does not define `asvs_level` or `block_on`; this file uses the established GSD default `asvs_level: 1` and `block_on: open`. |
| Threat flags | `63-02` through `63-05` summaries declare `None`; `63-01-SUMMARY.md` has no Threat Flags section and no unregistered flag was found. |

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|---|---|---|---|---|
| T-63-01-01 | Spoofing | mitigate | CLOSED | `/api/sse` calls `resolveGuestSession` before subscribing or writing frames and derives `deviceId` from the session only: `server/routes/sse.ts:21-30`; no `x-device-id` or `deviceId` query/header auth matches in SSE route grep. |
| T-63-01-02 | Tampering | mitigate | CLOSED | Initial frame serializes `{ summary, affectedDate: summary.date, source: "initial" }`: `server/routes/sse.ts:60-67`. |
| T-63-01-03 | Information Disclosure | mitigate | CLOSED | Publisher imports only Fastify/types, serializes route-provided payload, removes stale replies, and has no DB/service/log calls: `server/realtime/publisher.ts:1-69`. |
| T-63-01-04 | Denial of Service | accept | DOCUMENTED ACCEPTED | Accepted risk `AR-63-01` documents unchanged stale-reply cleanup and bounded scope. |
| T-63-01-05 | Information Disclosure | mitigate | CLOSED | SSE integration assertions inspect envelope keys and numeric summary fields only, and log tests assert device IDs are absent: `tests/integration/sse.test.ts:128-142`, `tests/integration/sse.test.ts:190-214`, `tests/integration/sse.test.ts:219-258`. |
| T-63-02-01 | Tampering | mitigate | CLOSED | Direct meal helper returns unless `dailySummary.date === affectedDate`, then publishes only `{ summary, affectedDate, source: "meal_mutation" }`: `server/routes/meals.ts:99-128`. |
| T-63-02-02 | Tampering | mitigate | CLOSED | Chat helper derives publish affected date from committed route data or summary date, requires equality, and wraps publisher failure as non-fatal: `server/routes/chat.ts:387-428`. |
| T-63-02-03 | Repudiation | mitigate | CLOSED | Streaming paths write `event: stopped`/`event: done` before `publishSummarySafe`: `server/routes/chat.ts:970-978`, `server/routes/chat.ts:991-1005`, `server/routes/chat.ts:1050-1068`, `server/routes/chat.ts:1113-1124`; integration test asserts daily_summary is observed after chat done: `tests/integration/chat-api.test.ts:2784-2848`. |
| T-63-02-04 | Elevation of Privilege | mitigate | CLOSED | Chat, meals, and SSE routes resolve guest sessions before route work and use session-derived `deviceId`: `server/routes/chat.ts:1151-1189`, `server/routes/meals.ts:171-181`, `server/routes/meals.ts:273-283`, `server/routes/sse.ts:21-30`; grep found no `x-device-id` or SSE `deviceId` query trust. |
| T-63-02-05 | Information Disclosure | mitigate | CLOSED | Publish logs contain metadata only (`event`, `affectedDate`, `summaryStatus`/failure reason) and no prompts/body/image/session data: `server/routes/meals.ts:118-126`, `server/routes/chat.ts:420-425`; route tests include redaction assertions for sensitive log payload classes: `tests/integration/chat-api.test.ts:3230`, `tests/integration/chat-api.test.ts:3898`. |
| T-63-03-01 | Tampering | mitigate | CLOSED | `daily_summary` listener parses in `try/catch`, requires `isDailySummarySSEPayload`, then invokes envelope-aware handler or nested legacy summary only after validation: `client/src/sse.ts:55-85`. |
| T-63-03-02 | Denial of Service | mitigate | CLOSED | Malformed JSON/invalid shapes are swallowed in the listener catch; unit test asserts invalid frames do not throw or invoke callbacks: `client/src/sse.ts:71-85`, `tests/unit/sse-client.test.ts:153-188`. |
| T-63-03-03 | Tampering | mitigate | CLOSED | `isRealDateKey` uses regex plus local calendar round-trip before accepting dates; tests reject impossible dates: `client/src/lib/history-week.ts:63-85`, `tests/unit/history-week.test.ts:25-34`. |
| T-63-03-04 | Tampering | mitigate | CLOSED | `sse.ts` validates only calendar-real envelope shape/date equality and dispatches future-valid payloads to coordinator policy; no store/refetch imports or calls found in `client/src/sse.ts`: `client/src/sse.ts:1-115`, `tests/unit/sse-client.test.ts:133-151`. |
| T-63-03-05 | Information Disclosure | mitigate | CLOSED | Parser code contains no logging/debug callbacks and no store/refetch side effects; unit tests use synthetic envelope payloads: `client/src/sse.ts:1-115`, `tests/unit/sse-client.test.ts:81-188`. |
| T-63-04-01 | Tampering | mitigate | CLOSED | Coordinator same-day path increments a token, fetches rows with `refreshReason: "meal_mutation"`, commits `setMeals` first, then `setDailySummary` only if latest: `client/src/sse-summary-coordinator.ts:26-62`; unit test asserts order: `tests/unit/sse-summary-coordinator.test.ts:82-99`. |
| T-63-04-02 | Tampering | mitigate | CLOSED | Initial meal loads use the same token family and commit rows only through `commitRowsIfLatest`: `client/src/sse-summary-coordinator.ts:41-48`, `client/src/sse-summary-coordinator.ts:91-101`; MainLayout uses `runInitialMealsLoad`: `client/src/components/MainLayout.tsx:144-159`. |
| T-63-04-03 | Tampering | mitigate | CLOSED | Historical non-future branch calls only `recordMealMutation`; future branch returns; same-day paths are separate: `client/src/sse-summary-coordinator.ts:64-89`; unit test asserts historical path does not fetch rows or commit summary/rows: `tests/unit/sse-summary-coordinator.test.ts:183-190`. |
| T-63-04-04 | Denial of Service | mitigate | CLOSED | Future events return with no mutation; overlapping events are latest-token guarded without queue/coalescing state: `client/src/sse-summary-coordinator.ts:26-33`, `client/src/sse-summary-coordinator.ts:41-62`, `client/src/sse-summary-coordinator.ts:65-69`; unit tests cover latest-only and future no-op: `tests/unit/sse-summary-coordinator.test.ts:111-130`, `tests/unit/sse-summary-coordinator.test.ts:192-199`. |
| T-63-04-05 | Information Disclosure | mitigate | CLOSED | Coordinator imports only client types and injected deps; tests use synthetic meal/summary objects and source contracts reject raw SSE wiring: `client/src/sse-summary-coordinator.ts:1-103`, `tests/unit/sse-summary-coordinator.test.ts:60-79`, `tests/unit/main-layout-sse-contract.test.ts:14-40`. |
| T-63-05-01 | Tampering | mitigate | CLOSED | Day Detail observes `lastMealMutation`, returns unless `affectedDate === dateKey`, calls `getHistoryDaySnapshot`, and has no `setDailySummary`/`setMeals`/`getMeals` calls: `client/src/components/HistoryDayDetailScreen.tsx:104-168`; source contract asserts the same: `tests/unit/history-day-detail-source-contract.test.ts:18-34`. |
| T-63-05-02 | Tampering | mitigate | CLOSED | Day Detail uses monotonic `loadTokenRef` plus cancellation refs so older fetches cannot overwrite current state: `client/src/components/HistoryDayDetailScreen.tsx:118-145`, `client/src/components/HistoryDayDetailScreen.tsx:150-168`. |
| T-63-05-03 | Tampering | mitigate | CLOSED | HistoryScreen keeps selected-day/current-week gates and returns when neither matches: `client/src/components/HistoryScreen.tsx:500-536`; source contract asserts no active-tab/secondary-screen shortcut: `tests/unit/history-screen-contract.test.ts:168-179`. |
| T-63-05-04 | Information Disclosure | mitigate | CLOSED | Historical source-contract tests inspect source strings and reject today summary/meal APIs and stale/freshness UI strings; no prompts/provider/images/sessions/DB snapshots are introduced: `tests/unit/history-day-detail-source-contract.test.ts:18-45`, `tests/unit/history-screen-contract.test.ts:196-225`. |
| T-63-05-05 | Denial of Service | accept | DOCUMENTED ACCEPTED | Accepted risk `AR-63-02` documents one visible-surface refetch per matching nonce and no explicit coalescing per D-34. |

## Accepted Risks Log

| Risk ID | Threat ID | Risk | Control / Rationale | Accepted By | Date | Status |
|---|---|---|---|---|---|---|
| AR-63-01 | T-63-01-04 | `RealtimePublisher.publish()` keeps the existing stale-reply cleanup behavior rather than adding new DoS controls in this phase. | Phase 63 only changed `daily_summary` payload shape. The existing cleanup removes destroyed or failed replies during publish: `server/realtime/publisher.ts:35-55`. | Codex security auditor, per plan disposition | 2026-05-18 | CLOSED |
| AR-63-02 | T-63-05-05 | Repeated matching historical invalidations can cause one visible-surface refetch per nonce; explicit coalescing is not added. | D-34 explicitly does not require event coalescing. The implementation bounds updates to matching visible dates and suppresses stale fetch results with cancellation/latest-token checks: `client/src/components/HistoryDayDetailScreen.tsx:118-168`, `client/src/components/HistoryScreen.tsx:522-536`. | Codex security auditor, per plan disposition | 2026-05-18 | CLOSED |

## Unregistered Flags

None.

## Audit Trail

| Date | Auditor | Action | Result |
|---|---|---|---|
| 2026-05-18 | Codex security auditor | Loaded secure-phase workflow, all local project skills, all requested files, and additional files required to verify cited threats (`client/src/types.ts`, `client/src/lib/history-week.ts`, `client/src/components/HistoryScreen.tsx`, and focused tests). | Complete. |
| 2026-05-18 | Codex security auditor | Verified each declared `mitigate` disposition with targeted line-numbered reads and `rg` checks for auth ownership, envelope guards, publish payload shape, stale cleanup, parser validation, coordinator latest-wins behavior, and historical refresh gates. | 23 mitigated threats closed. |
| 2026-05-18 | Codex security auditor | Documented the two plan-declared `accept` dispositions in the accepted risks log. | 2 accepted risks closed. |

## Result

`threats_open: 0`
