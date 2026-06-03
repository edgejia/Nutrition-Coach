# Phase 77: History Loading Stabilization and Local Proof Gate - Context

**Gathered:** 2026-06-04
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 77 stabilizes History week-switch loading so cold misses move immediately into the target week/date context without showing stale prior-week data or inserting disruptive transient loading blocks. It also proves that Home edit entry and grouped Meal Edit commits still refresh or invalidate History through the shared affected-date mutation path, then closes v2.6 with focused local, metadata-only proof.

This phase does not add monthly goals or analytics, hydration, onboarding/activity/product-home motion, broad visual polish, richer coaching copy, observability/productization, infrastructure cleanup, `OrchestratorResult` cleanup, legacy `logFood` cleanup, or staging/main promotion.

</domain>

<decisions>
## Implementation Decisions

### Cold Miss UX

- **D-01:** On uncached week switch, History should immediately show the target week/header/selected date context. Do not keep prior-week data under the new week/date.
- **D-02:** Cold miss pending state must be stable and inline. Week strip, stats, hero, and timeline should show `--`, pending tone, or stable placeholders in their existing slots.
- **D-03:** Remove or avoid the transient top-level `載入這週紀錄中...` week loading card/banner during week switches. The current broad `loadingTrends && !hasCurrentWeekCache` behavior fires on uncached week switches and is the observed layout-jump source.
- **D-04:** Do not preserve a separate first-ever History loading card unless planning/research proves initial History entry has no usable inline context. Prefer one History loading pattern: stable target-context placeholders.
- **D-05:** The timeline/day section should keep `當日餐點`, show `--筆`, and render `同步這天紀錄中...` inline where meals or empty state normally appear while the selected day snapshot is unresolved.
- **D-06:** Do not render skeleton meal rows during pending; they can imply records exist before `/api/history/days/:date` proves the actual list.
- **D-07:** Trends day data is enough for aggregate hero/count display. `SelectedDayHero` may use `selectedWeekDay.calories`, and `TimelinePanel` may use `selectedWeekDay.mealCount`, after `/api/history/trends` returns.
- **D-08:** Actual timeline meal rows require `snapshot.meals` from `/api/history/days/:date`. Trends aggregates cannot produce meal rows or edit identity.

### Snapshot-Backed Day Detail

- **D-09:** Day Detail remains a snapshot-backed read-only screen. Do not expose Day Detail activation while only trends are known or the selected day snapshot is pending.
- **D-10:** During selected-day pending, keep the inline History timeline pending card visible and do not add an aggregate-only Day Detail loading contract.
- **D-11:** Meal rows and meal edit activation require real `snapshot.meals` facts. `buildHistoryMealEditPayload` must only receive snapshot-backed meal id, revision id, nutrition, image, loggedAt, and item facts.
- **D-12:** Do not render stale previous rows, disabled rows, or skeleton rows while selected-day snapshot is pending.
- **D-13:** A confirmed empty day is loaded, not pending. Show the existing empty state and allow date-level Day Detail open only after `/api/history/days/:date` returns a snapshot with `meals.length === 0`.
- **D-14:** `trends.mealCount === 0` alone is not enough to show confirmed empty state or enable Day Detail.
- **D-15:** If `/api/history/days/:date` fails, keep Day Detail unavailable and show the existing inline History error in the meal-list slot. Trends may still support date/hero/count context, but must not become empty or partial snapshot facts.

### Refresh Proof

- **D-16:** After Home edit or grouped Meal Edit commits, refresh only the affected visible day/week and invalidate offscreen affected cache.
- **D-17:** If the affected date equals the selected date, refresh that day snapshot. If the affected week equals the visible week, refresh week trends.
- **D-18:** If affected day/week data is cached but offscreen, delete that cache entry so it cold-loads on next navigation.
- **D-19:** Avoid broad cache refreshes because Phase 77 is reducing unnecessary pending/loading churn. Do not ignore visible week trends because totals can go stale after edits.
- **D-20:** Cover Home edit entry and grouped Meal Edit commits. Prove the shared path: `refreshAfterMealMutation` -> `recordMealMutation` -> `lastMealMutation` -> History refresh/invalidate.
- **D-21:** Include Home-origin single edit/delete and grouped Meal Edit commit behavior as needed. Do not reopen all chat mutation sources unless research finds a regression in the shared `lastMealMutation` contract.
- **D-22:** Keep `lastMealMutation` as a screen-agnostic affected-date freshness signal. Do not add active-tab gating.
- **D-23:** If History is mounted, including behind a secondary screen, it consumes mutation notices and applies scoped refresh/invalidation. If History is not mounted because another primary tab is active, there is no History component cache to refresh; returning to History should use the normal load/cold-load path.
- **D-24:** Do not add a separate deferred-refresh contract in Phase 77.

### Local Proof Gate

- **D-25:** Use source/unit contracts plus targeted browser/mobile visual evidence for History loading UX.
- **D-26:** Source/unit contracts should lock: no stale prior-week/day data under target context, no broad top-level week loading card during week switches, inline timeline pending copy, and snapshot-backed meal/empty/error behavior.
- **D-27:** Browser/mobile evidence should target the visible regression risk: cold week switch on a mobile viewport shows stable target-week inline placeholders/pending state, without the transient `載入這週紀錄中...` page-level card or layout jump.
- **D-28:** `yarn release:check` remains the final closure gate, not a substitute for targeted visual proof.
- **D-29:** Use a targeted v2.6 closure matrix covering phases 74-77. Include representative proof for Home edit entry, grouped CRUD server contract, grouped Meal Edit UI states, History loading UX, TypeScript, and final `yarn release:check`.
- **D-30:** Do not rerun every prior phase command wholesale. Phase 74-76 already passed focused verification; Phase 77 closure may cite or rerun representative targeted commands needed for `PROOF-01`, then add new History loading proof and the final local closure gate.
- **D-31:** Use synthetic/local visual evidence only. Browser/mobile proof may generate screenshots and manifests using seeded or mocked History/Home/Meal Edit data.
- **D-32:** Artifacts should record command/status metadata, screenshot outputs, and privacy/evidence policy only. Do not use real local DB data, raw prompts, user text, assistant final text, raw tool/provider payloads, image data, session material, private logs, or database snapshots.
- **D-33:** Closure notes should include the existing v2.6 defer list plus explicit no-promotion language. Local proof and `yarn release:check` close v2.6 locally only; they do not authorize staging or main promotion without separate current-thread approval.

### the agent's Discretion

Planner may choose exact helper names, whether to extract cache-decision helpers from `HistoryScreen`, exact source-contract test names, exact synthetic data shape for browser/mobile proof, and the exact visual evidence script/harness location. If a helper is extracted for visible/offscreen refresh decisions, add focused unit tests for selected day refresh, visible week refresh, offscreen cached day/week invalidation, and unrelated-date no-op.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope

- `.planning/ROADMAP.md` — Phase 77 goal, success criteria, implementation notes, and no-promotion boundary.
- `.planning/REQUIREMENTS.md` — `HIST-UX-01`, `PROOF-01`, `PROOF-02`, `PROOF-03`, and v2.6 deferred scope.
- `.planning/PROJECT.md` — Current product context, metadata-only proof policy, release/promotion constraints, and v2.6 state.
- `.planning/STATE.md` — Current Phase 77 position and accumulated carry-forward decisions.
- `.planning/phases/76-grouped-meal-edit-ui-and-conditional-item-media-decision/76-CONTEXT.md` — Grouped Meal Edit commit behavior, validation/recovery, post-commit refresh path, and media deferral.
- `.planning/phases/75-grouped-meal-direct-crud-contract/75-CONTEXT.md` — Grouped `items[]` direct CRUD contract, revision checks, summary/publish behavior, and grouped server proof surfaces.
- `.planning/phases/74-home-meal-edit-entry-and-existing-edit-contract-review/74-CONTEXT.md` — Home edit entry, single-item edit/delete review, Meal Edit origin behavior, capability metadata, and refresh path reuse.

### Codebase Maps

- `.planning/codebase/TESTING.md` — Node test runner, timezone wrapper, source/unit/integration/harness command patterns, and verification matrix.
- `.planning/codebase/STRUCTURE.md` — Script, generated artifact, and repository structure conventions.
- `.planning/codebase/CONVENTIONS.md` — Yarn-only workflow, TypeScript style, generated-doc checks, and metadata-only evidence conventions.

### History Loading and UI

- `client/src/components/HistoryScreen.tsx` — Week/day cache state, loading conditions, `TimelinePanel`, `SelectedDayHero`, Day Detail activation, meal row edit activation, and `lastMealMutation` refresh/invalidation effect.
- `client/src/lib/history-week.ts` — Pending week-day and pending stats helpers that already provide stable target-week placeholder facts.
- `client/src/app.css` — `sp-history-pending`, `sp-history-state-card`, History layout, and mobile visual behavior that must avoid the transient page-level loading jump.
- `client/src/api.ts` — `getHistoryTrends`, `getHistoryDaySnapshot`, DTO validation, and client error handling boundaries.
- `client/src/meal-edit-payload.ts` — `buildHistoryMealEditPayload` authority requirements for real snapshot-backed meal rows.
- `client/src/meal-edit-refresh.ts` — Shared post-mutation refresh helper that records affected-date mutation notices.
- `client/src/store.ts` — `recordMealMutation`, `lastMealMutation`, and secondary-screen state behavior.

### Proof Surfaces

- `tests/unit/history-screen-contract.test.ts` — Existing History source-contract tests for cache behavior, loading copy, pending state, mutation refresh/invalidation, and UI structure.
- `tests/unit/history-week.test.ts` — Pending week-day and pending stats helper proof.
- `tests/unit/api-client.test.ts` — History API client DTO validation and route call shape.
- `tests/unit/meal-edit-refresh.test.ts` — Existing proof for `refreshAfterMealMutation` and affected-date recording.
- `tests/unit/meal-edit-screen.test.ts` — Grouped Meal Edit UI states, save/delete pending behavior, stale handling, and refresh usage.
- `tests/unit/home-dashboard-contract.test.ts` — Home edit entry source-contract coverage from Phase 74.
- `tests/integration/meals-api.test.ts` — Grouped CRUD direct route, revision, summary, and publish integration proof from Phase 75.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets

- `buildHistoryWeek()` and `buildHistoryWeekStats()` in `client/src/lib/history-week.ts`: Already produce pending target-week days/stats without fake nutrition values.
- `HistoryScreen` cache state: `trendsCache`, `dayCache`, `hasCurrentWeekCache`, `selectedSnapshot`, `selectedWeekDay`, and `lastMealMutation` already express the boundaries Phase 77 needs to tighten.
- `SelectedDayHero` in `client/src/components/HistoryScreen.tsx`: Already can display selected-week trend aggregate facts before a day snapshot exists.
- `TimelinePanel` in `client/src/components/HistoryScreen.tsx`: Already has the correct inline day pending shape: section stays in place, count can show `--筆`, and `同步這天紀錄中...` renders in the meal-list slot.
- `refreshAfterMealMutation()` in `client/src/meal-edit-refresh.ts`: Existing path for direct edit/delete success to record affected dates and refresh authoritative surfaces.

### Established Patterns

- History uses component-local caches for week trends and day snapshots; refresh/invalidation should remain scoped rather than global.
- Trends aggregates can support hero/count display, but actual meal rows, edit identity, confirmed empty state, and Day Detail require day snapshot facts.
- Client UI must not manufacture editable meal identity. `buildHistoryMealEditPayload` needs complete authoritative row facts.
- Source-contract tests are already used for History UI/loading/cache structure. Browser/mobile evidence should complement them only for visible layout stability.
- Local proof remains metadata-only and does not authorize deployment or promotion.

### Integration Points

- Tighten the top-level week loading condition in `HistoryScreen` so uncached week switches use inline pending slots instead of the transient page-level `載入這週紀錄中...` card.
- Preserve `buildHistoryWeek(... pending: !hasCurrentWeekCache)` and pending stats behavior as the target-week placeholder foundation.
- Keep `TimelinePanel` pending/error/empty states snapshot-backed: pending until day snapshot returns, empty only after snapshot `meals.length === 0`, error after day snapshot failure.
- Gate Day Detail and meal row edit activation on snapshot-backed state.
- Preserve or refine the `lastMealMutation` effect so visible affected day/week refresh and offscreen affected caches invalidate without active-tab gating or broad refresh churn.
- Add or update source/unit contracts around the loading and snapshot-backed state rules. Add targeted browser/mobile proof for visible cold week-switch stability.

</code_context>

<specifics>
## Specific Ideas

- Desired cold miss UX: immediate target-week header/date/week strip/hero/timeline context with stable inline pending states, not prior-week content and not a short-lived separate loading block.
- The problematic visual flash is the transient top-level `載入這週紀錄中...` `SportCard`, not the target-week placeholder strategy itself.
- Inline timeline pending copy should remain `同步這天紀錄中...` in the existing meal-list slot.
- Confirmed empty state must be snapshot-backed; `trends.mealCount === 0` alone is insufficient.
- Browser/mobile proof should use synthetic data and specifically demonstrate no transient page-level week loading card or layout jump during a cold week switch.

</specifics>

<deferred>
## Deferred Ideas

- Monthly goals/analytics and monthly target records remain deferred.
- Hydration/water tracking remains deferred.
- Onboarding animation, activity spectrum redesign, product-home motion, and broad visual polish remain deferred.
- Richer coaching copy remains deferred.
- Observability/productization, infrastructure cleanup, `OrchestratorResult` cleanup, and legacy `logFood` cleanup remain deferred unless required for safe local closure.
- Staging and main promotion remain deferred. Local proof and `yarn release:check` do not authorize promotion without separate current-thread approval.

</deferred>

---

*Phase: 77-History Loading Stabilization and Local Proof Gate*
*Context gathered: 2026-06-04*
