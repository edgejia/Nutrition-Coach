# Phase 77: History Loading Stabilization and Local Proof Gate - Research

**Researched:** 2026-06-04  
**Domain:** React History UI state, Zustand mutation freshness, source-contract tests, local metadata-only proof  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

Source: copied verbatim from `.planning/phases/77-history-loading-stabilization-and-local-proof-gate/77-CONTEXT.md`. [VERIFIED: local file read]

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)

- Monthly goals/analytics and monthly target records remain deferred.
- Hydration/water tracking remains deferred.
- Onboarding animation, activity spectrum redesign, product-home motion, and broad visual polish remain deferred.
- Richer coaching copy remains deferred.
- Observability/productization, infrastructure cleanup, `OrchestratorResult` cleanup, and legacy `logFood` cleanup remain deferred unless required for safe local closure.
- Staging and main promotion remain deferred. Local proof and `yarn release:check` do not authorize promotion without separate current-thread approval.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HIST-UX-01 | History week switching keeps a stable layout during cold pending loads and avoids disruptive loading jumps. [VERIFIED: `.planning/REQUIREMENTS.md`] | Use pending target-week placeholders from `buildHistoryWeek()`/`buildHistoryWeekStats()`, remove the broad `loadingTrends && !hasCurrentWeekCache` page-level card during week switches, and add source plus mobile visual proof. [VERIFIED: `client/src/lib/history-week.ts`; VERIFIED: `client/src/components/HistoryScreen.tsx`; VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`] |
| PROOF-01 | v2.6 has targeted local proof for Home edit entry, grouped CRUD server behavior, grouped Meal Edit UI states, and History week-switch loading. [VERIFIED: `.planning/REQUIREMENTS.md`] | Cite or rerun representative commands from phases 74-76, add focused Phase 77 History source/unit proof, add mobile visual evidence for cold week-switch loading, and record the closure matrix. [VERIFIED: `74-VERIFICATION.md`; VERIFIED: `75-VERIFICATION.md`; VERIFIED: `76-VERIFICATION.md`] |
| PROOF-02 | Generated evidence remains metadata-only and excludes raw prompts, user text, assistant final text, raw tool/provider payloads, image data, session material, private logs, and database snapshots. [VERIFIED: `.planning/REQUIREMENTS.md`; VERIFIED: `77-CONTEXT.md`] | Use synthetic/local data and manifest metadata only; reuse the ADR 0001 evidence policy and Phase 49 visual-script privacy pattern. [VERIFIED: `docs/adr/0001-metadata-only-llm-failure-localization.md`; VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`] |
| PROOF-03 | Local closure runs `yarn tsc --noEmit`, targeted commands required by changed paths, and `yarn release:check` before any staging/main promotion request. [VERIFIED: `.planning/REQUIREMENTS.md`; VERIFIED: `AGENTS.md`] | Verification architecture maps TS/client/test/script changes to `yarn tsc --noEmit`, unit/source-contract tests, any visual script command, and final `yarn release:check`. [VERIFIED: `package.json`; VERIFIED: `scripts/release-check.mjs`; VERIFIED: `.codex/skills/nutrition-verify-change/SKILL.md`] |
</phase_requirements>

## Summary

Phase 77 should be planned as a narrow frontend state stabilization plus local proof gate. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `.planning/ROADMAP.md`] The main implementation risk is in `client/src/components/HistoryScreen.tsx`: it already computes target-week pending placeholders, but it still renders a page-level `載入這週紀錄中...` card whenever `loadingTrends && !hasCurrentWeekCache`, which is the locked disruptive-loading source. [VERIFIED: `client/src/components/HistoryScreen.tsx`; VERIFIED: `77-CONTEXT.md`]

The correct plan is not to add a new data layer or global refresh system. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `client/src/store.ts`] Keep History’s component-local `trendsCache` and `dayCache`, tighten pending/empty/error render decisions so rows and Day Detail are snapshot-backed, and preserve the shared post-mutation path through `refreshAfterMealMutation()` -> `recordMealMutation()` -> `lastMealMutation`. [VERIFIED: `client/src/components/HistoryScreen.tsx`; VERIFIED: `client/src/meal-edit-refresh.ts`; VERIFIED: `client/src/store.ts`]

Proof should be targeted. [VERIFIED: `77-CONTEXT.md`] The planner should update source/unit contracts around History loading and snapshot-backed behavior, optionally extract helper functions only if that improves testability, adapt the existing Phase 49 browser visual-evidence pattern for a mobile cold week switch, then close v2.6 with a metadata-only matrix and `yarn release:check`. [VERIFIED: `tests/unit/history-screen-contract.test.ts`; VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`; VERIFIED: `scripts/release-check.mjs`]

**Primary recommendation:** Plan one implementation slice for History pending/snapshot state, one focused proof slice for source/unit/browser evidence, and one local closure slice for v2.6 verification metadata with no staging/main promotion. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `.planning/ROADMAP.md`]

## Project Constraints (from AGENTS.md)

- Use `yarn` only; do not use `npm` for project commands. [VERIFIED: `AGENTS.md`]
- Use Node built-in `node:test`; do not introduce Jest or Vitest without explicit migration. [VERIFIED: `AGENTS.md`; VERIFIED: `.codex/skills/nutrition-gen-test/SKILL.md`]
- Run `yarn tsc --noEmit` after TypeScript edits. [VERIFIED: `AGENTS.md`; VERIFIED: `.codex/skills/nutrition-verify-change/SKILL.md`]
- Route/service edits require integration tests; this phase should avoid route/service edits unless research discovers an actual server regression. [VERIFIED: `AGENTS.md`; VERIFIED: `77-CONTEXT.md`]
- Keep `server/routes/*.ts` as transport boundaries, `server/services/*.ts` as domain/persistence boundaries, `client/src/store.ts` as the single Zustand boundary, and `client/src/api.ts`/`client/src/sse.ts` as transport helpers. [VERIFIED: `AGENTS.md`]
- Preserve ESM explicit `.js` local TypeScript imports. [VERIFIED: `AGENTS.md`; VERIFIED: `.planning/codebase/CONVENTIONS.md`]
- Preserve `TZ=Asia/Taipei` in tests and release gates. [VERIFIED: `AGENTS.md`; VERIFIED: `scripts/run-node-with-tz.mjs`; VERIFIED: `scripts/release-check.mjs`]
- Treat `tests/harness/artifacts/**` as generated verification evidence; do not hand-edit generated artifacts. [VERIFIED: `AGENTS.md`; VERIFIED: `.codex/skills/nutrition-new-harness-scenario/SKILL.md`]
- Keep planning/status updates scoped to the active phase and separate planning updates from code changes in summaries. [VERIFIED: `AGENTS.md`]
- Do not promote, merge, push, deploy, smoke-test staging, or touch `main` without explicit current-thread approval. [VERIFIED: `AGENTS.md`; VERIFIED: `77-CONTEXT.md`]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Cold week-switch pending UX | Browser / Client | API / Backend read endpoints | The pending layout is selected by `HistoryScreen` state and CSS while data comes from existing `/api/history/trends` and `/api/history/days/:date`. [VERIFIED: `client/src/components/HistoryScreen.tsx`; VERIFIED: `client/src/api.ts`] |
| Snapshot-backed meal rows and Day Detail activation | Browser / Client | API / Backend day snapshot | The client must wait for `HistoryDaySnapshot.meals` before rendering rows, building edit payloads, or opening Day Detail; the backend already exposes the snapshot endpoint. [VERIFIED: `client/src/types.ts`; VERIFIED: `client/src/api.ts`; VERIFIED: `client/src/meal-edit-payload.ts`] |
| Post-edit History refresh/invalidation | Browser / Client | Zustand store | `refreshAfterMealMutation()` records `affectedDate`; `store.recordMealMutation()` updates `lastMealMutation`; mounted History consumes the notice to refresh visible date/week or invalidate offscreen caches. [VERIFIED: `client/src/meal-edit-refresh.ts`; VERIFIED: `client/src/store.ts`; VERIFIED: `client/src/components/HistoryScreen.tsx`] |
| Grouped CRUD server proof | API / Backend | Browser / Client proof references | Phase 75 already owns grouped PATCH route/persistence proof; Phase 77 should cite or rerun representative integration proof instead of changing the route. [VERIFIED: `75-VERIFICATION.md`; VERIFIED: `tests/integration/meals-api.test.ts`] |
| Home edit entry proof | Browser / Client | Zustand store | Home edit entry is a client row activation and payload eligibility behavior through shared Meal Edit navigation. [VERIFIED: `74-VERIFICATION.md`; VERIFIED: `client/src/components/HomeScreen.tsx`; VERIFIED: `client/src/meal-edit-payload.ts`] |
| Metadata-only local closure | Local tooling / Scripts | Planning artifacts | Release proof is command/status/evidence metadata, not runtime product behavior or deployment. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `scripts/release-check.mjs`; VERIFIED: `docs/adr/0001-metadata-only-llm-failure-localization.md`] |

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| React | `^19.0.0` | Client component rendering for `HistoryScreen`, `HomeScreen`, and `MealEditScreen`. [VERIFIED: `package.json`; VERIFIED: `client/src/components/HistoryScreen.tsx`] | Existing app stack; no phase value in changing UI framework. [VERIFIED: `package.json`; VERIFIED: `.planning/PROJECT.md`] |
| Zustand | `^5.0.0` | Single client store boundary for `lastMealMutation`, `openDayDetail`, and `openMealEdit`. [VERIFIED: `package.json`; VERIFIED: `client/src/store.ts`] | Existing architecture says `client/src/store.ts` is the single Zustand state boundary. [VERIFIED: `AGENTS.md`] |
| TypeScript | `^5.7.0` | Static gate over client, server, and tests. [VERIFIED: `package.json`; VERIFIED: `tsconfig.json`] | Existing release gate runs `yarn tsc --noEmit`. [VERIFIED: `scripts/release-check.mjs`] |
| Node built-in test runner | Node v24.14.0 local runtime; `node --test` scripts | Source/unit/integration test runner. [VERIFIED: environment audit; VERIFIED: `package.json`] | Project forbids Jest/Vitest migration and test skills require `node:test`. [VERIFIED: `AGENTS.md`; VERIFIED: `.codex/skills/nutrition-gen-test/SKILL.md`] |
| Vite | `^6.2.0` | Client build and local visual evidence target through built `dist/client` or Vite dev server. [VERIFIED: `package.json`; VERIFIED: `scripts/phase45-mobile-evidence.mjs`; VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`] | Existing scripts and release gate already build the Vite client. [VERIFIED: `package.json`; VERIFIED: `scripts/release-check.mjs`] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| Fastify | `5.8.5` | Existing API server for History and meal mutation endpoints. [VERIFIED: `package.json`; VERIFIED: `client/src/api.ts`] | Use only for representative grouped CRUD integration proof or if a discovered server bug requires route/service edits. [VERIFIED: `75-VERIFICATION.md`; VERIFIED: `77-CONTEXT.md`] |
| better-sqlite3 / SQLite | `^11.8.0` | Real DB backing integration tests. [VERIFIED: `package.json`; VERIFIED: `.codex/skills/nutrition-gen-test/SKILL.md`] | Use real SQLite for route/service integration proof; do not mock DB if backend tests are touched. [VERIFIED: `AGENTS.md`] |
| Microsoft Edge | 148.0.3967.96 | Local browser for CDP screenshot evidence. [VERIFIED: environment audit] | Use for synthetic mobile History visual evidence if adapting the Phase 49 `.mjs` script. [VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing source-contract tests | React Testing Library | Do not add; no such dependency exists and project forbids test framework churn. [VERIFIED: `package.json`; VERIFIED: `AGENTS.md`] |
| Existing CDP `.mjs` visual script pattern | Playwright Test package | Do not add; existing Phase 49 script already captures mobile History states without package installation. [VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`] |
| Component-local `trendsCache`/`dayCache` | Global History cache in Zustand | Do not add; locked decisions call for scoped refresh/invalidation and no deferred-refresh contract. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `client/src/components/HistoryScreen.tsx`] |

**Installation:** No external package installation is recommended for Phase 77. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `package.json`]

```bash
# No install command. Use existing repo stack and yarn scripts.
```

**Version verification:** Existing versions were verified from `package.json`; local tool availability was verified with `node --version`, `yarn --version`, `gsd-tools --version`, and the Edge executable. [VERIFIED: environment audit]

## Package Legitimacy Audit

No new external packages are recommended or required. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `package.json`]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| None | — | — | — | — | Not run | Approved: no install surface. [VERIFIED: package audit scope] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: no recommended packages]  
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: no recommended packages]

`slopcheck` is not installed locally, but this is non-blocking because Phase 77 should not install any packages. [VERIFIED: environment audit]

## Architecture Patterns

### System Architecture Diagram

```text
User taps previous/next week
  -> HistoryScreen.moveWeek()
  -> set weekStartKey + selectedDateKey to target context immediately
  -> render target week header / week strip / stats / hero / timeline with placeholder facts
  -> parallel existing effects:
       getHistoryTrends(target week)
         -> trendsCache[targetWeek] populated
         -> aggregate hero/count may show trend facts
       getHistoryDaySnapshot(target selected date)
         -> dayCache[targetDate] populated
         -> meals, empty state, errors, Day Detail, and Meal Edit identity become available

Meal mutation from Home or grouped Meal Edit
  -> updateMeal/deleteMeal response with affectedDate
  -> refreshAfterMealMutation()
  -> recordMealMutation(affectedDate)
  -> store.lastMealMutation nonce changes
  -> mounted HistoryScreen effect:
       if affected selected day: refresh day snapshot
       if affected visible week: refresh week trends
       if affected cached offscreen day/week: delete cached entry
       otherwise: no broad refresh
```

All arrows above map to existing code surfaces and locked decisions. [VERIFIED: `client/src/components/HistoryScreen.tsx`; VERIFIED: `client/src/meal-edit-refresh.ts`; VERIFIED: `client/src/store.ts`; VERIFIED: `77-CONTEXT.md`]

### Recommended Project Structure

```text
client/src/
├── components/
│   └── HistoryScreen.tsx          # Pending, empty/error, Day Detail, and mutation refresh behavior
├── lib/
│   └── history-week.ts            # Existing pending week-day and stats helpers; add helper tests here only if extracting logic
├── meal-edit-refresh.ts           # Existing affected-date mutation signal; preserve
└── store.ts                       # Existing lastMealMutation signal; preserve

tests/unit/
├── history-screen-contract.test.ts # Source contracts for History render/state boundaries
├── history-week.test.ts            # Helper proof if helpers change
└── meal-edit-refresh.test.ts       # Shared refresh path proof; extend only if behavior changes

tests/harness/scenarios/ or scripts/
└── phase77-history-loading-*.mjs    # Optional targeted mobile visual evidence, adapted from Phase 49 pattern
```

This layout follows existing project ownership and test locations. [VERIFIED: `AGENTS.md`; VERIFIED: `.planning/codebase/TESTING.md`; VERIFIED: repo file listing]

### Pattern 1: Target Context First, Data Later

**What:** Change week/date state immediately, render the target week shell with placeholders, then let trends/day snapshot effects fill in facts independently. [VERIFIED: `client/src/components/HistoryScreen.tsx`; VERIFIED: `client/src/lib/history-week.ts`]  
**When to use:** Use for uncached week switches and first History entry if no current cache exists. [VERIFIED: `77-CONTEXT.md`]  
**Example:**

```typescript
// Source: client/src/components/HistoryScreen.tsx and client/src/lib/history-week.ts
const currentTrends = trendsCache.get(weekStartKey) ?? null;
const hasCurrentWeekCache = currentTrends !== null;

const weekDays = buildHistoryWeek({
  weekStartKey,
  selectedDateKey,
  todayKey,
  trends: currentTrends?.daily ?? [],
  targets: dailyTargets,
  pending: !hasCurrentWeekCache,
});
```

Do not plan to keep the previous week’s data under a new target header. [VERIFIED: `77-CONTEXT.md`]

### Pattern 2: Snapshot-Backed Interactive Facts

**What:** Trends can support aggregate display, but `snapshot.meals` is the authority for row rendering, meal edit payloads, confirmed empty state, and Day Detail activation. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `client/src/api.ts`; VERIFIED: `client/src/meal-edit-payload.ts`]  
**When to use:** Use whenever a UI affordance would imply actual meals, edit identity, or read-only Day Detail content. [VERIFIED: `77-CONTEXT.md`]  
**Example:**

```typescript
// Source: client/src/components/HistoryScreen.tsx
const meals = snapshot?.meals ?? [];

if (snapshot !== null && meals.length > 0) {
  return <TimelineRows meals={meals} /* snapshot-backed row actions */ />;
}
```

The planner should add a confirmed-empty Day Detail activation path only after `snapshot !== null && snapshot.meals.length === 0`. [VERIFIED: `77-CONTEXT.md`; VERIFIED: current `TimelinePanel` lacks empty Day Detail activation in `client/src/components/HistoryScreen.tsx`]

### Pattern 3: Scoped Affected-Date Refresh

**What:** Treat `lastMealMutation` as a screen-agnostic invalidation/refresh notice and avoid active-tab gating. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `client/src/store.ts`; VERIFIED: `tests/unit/history-screen-contract.test.ts`]  
**When to use:** Use after Home-origin single edit/delete and grouped Meal Edit commits, because both go through `refreshAfterMealMutation()`. [VERIFIED: `client/src/components/MealEditScreen.tsx`; VERIFIED: `client/src/meal-edit-refresh.ts`; VERIFIED: `74-VERIFICATION.md`; VERIFIED: `76-VERIFICATION.md`]  
**Example:**

```typescript
// Source: client/src/components/HistoryScreen.tsx
const shouldRefreshDay = affectedDate === selectedDateKey;
const shouldRefreshWeek = affectedWeekStartKey === weekStartKey;

void Promise.all([
  shouldRefreshDay ? loadSelectedDay(cancelledRef) : Promise.resolve(),
  shouldRefreshWeek ? loadTrends(cancelledRef) : Promise.resolve(),
]);
```

If helper extraction is chosen, the planner should test selected-day refresh, visible-week refresh, offscreen cache invalidation, and unrelated-date no-op. [VERIFIED: `77-CONTEXT.md`]

### Pattern 4: Synthetic Browser Proof With Explicit Privacy Manifest

**What:** Use a deterministic local browser script with mocked History responses, mobile viewport, screenshot byte/diversity checks, and manifest metadata. [VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`]  
**When to use:** Use to prove the visible cold week-switch regression risk, not as a substitute for source/unit contracts. [VERIFIED: `77-CONTEXT.md`]  
**Example:**

```javascript
// Source pattern: tests/harness/scenarios/49-history-dashboard-polish-visual.mjs
if (url.pathname === "/api/history/trends") {
  const from = url.searchParams.get("from");
  if (from === "2026-04-27") {
    return new Promise((resolve) =>
      setTimeout(() => resolve(jsonResponse(delayedWeek)), 2400)
    );
  }
}
```

The Phase 77 visual script should assert absence of `載入這週紀錄中...`, presence of target-week header context, inline `同步這天紀錄中...`, no blank/undersized screenshot, and no horizontal overflow. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`]

### Anti-Patterns to Avoid

- **Keeping old week data during cold miss:** This creates stale prior-week data under target context and violates D-01. [VERIFIED: `77-CONTEXT.md`]
- **Page-level week loading card on every cold switch:** The current `loadingTrends && !hasCurrentWeekCache` branch is the observed layout jump source. [VERIFIED: `client/src/components/HistoryScreen.tsx`; VERIFIED: `77-CONTEXT.md`]
- **Using trends `mealCount === 0` as confirmed empty:** Trends are aggregates and do not prove day snapshot facts. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `client/src/types.ts`]
- **Rendering disabled/skeleton meal rows:** Skeleton rows imply meals before the snapshot proves rows exist. [VERIFIED: `77-CONTEXT.md`]
- **Adding active-tab gating to `lastMealMutation`:** History may be mounted behind a secondary screen and still must consume notices. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `client/src/store.ts`]
- **Broad cache refresh after every mutation:** Phase 77 is explicitly reducing unnecessary loading churn. [VERIFIED: `77-CONTEXT.md`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Week date math and pending week placeholders | Ad hoc date arrays in `HistoryScreen` | `buildHistoryWeek()`, `buildHistoryWeekStats()`, `shiftHistoryWeek()`, `getMondayWeekStart()` | Existing helpers already encode Monday-first weeks, selected/today/future flags, pending day facts, and neutral stats. [VERIFIED: `client/src/lib/history-week.ts`; VERIFIED: `tests/unit/history-week.test.ts`] |
| Meal edit payload authority | A partial History row payload builder | `buildHistoryMealEditPayload()` from snapshot-backed `MealEntry` rows | The helper enforces revision id, finite nutrition, positive `itemCount`, loggedAt, image, period, and grouped item facts. [VERIFIED: `client/src/meal-edit-payload.ts`] |
| Post-mutation refresh propagation | A new History-specific event bus | `refreshAfterMealMutation()` plus `recordMealMutation()` plus `lastMealMutation` | Existing Home/Meal Edit paths already share the affected-date notice. [VERIFIED: `client/src/meal-edit-refresh.ts`; VERIFIED: `client/src/store.ts`; VERIFIED: `client/src/components/MealEditScreen.tsx`] |
| Source-level UI contracts | A new UI test framework | Existing `tests/unit/*source-contract*.test.ts` style with `node:test` | Repo already uses source-contract tests and project rules forbid Jest/Vitest churn. [VERIFIED: `tests/unit/history-screen-contract.test.ts`; VERIFIED: `AGENTS.md`] |
| Mobile visual proof | Installing Playwright Test | Existing CDP browser script pattern from Phase 49 or a small `.mjs` proof script | Edge is available locally and Phase 49 already has screenshot/manifest/privacy checks. [VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`; VERIFIED: environment audit] |

**Key insight:** The hard part is state authority, not technology choice. [VERIFIED: `77-CONTEXT.md`] The plan should separate aggregate trend display from snapshot-backed meal/detail facts and then prove that separation locally. [VERIFIED: `client/src/types.ts`; VERIFIED: `client/src/api.ts`; VERIFIED: `client/src/components/HistoryScreen.tsx`]

## Common Pitfalls

### Pitfall 1: Treating `loadingTrends && !hasCurrentWeekCache` as harmless first-load UX

**What goes wrong:** The broad condition fires on uncached week switches and inserts a top-level card above the stable History layout. [VERIFIED: `client/src/components/HistoryScreen.tsx`; VERIFIED: `77-CONTEXT.md`]  
**Why it happens:** The condition cannot distinguish first entry from a user-driven target-week cold miss. [VERIFIED: code inspection of `HistoryScreen.tsx`]  
**How to avoid:** Prefer inline target-context placeholders for both first entry and cold week switches unless implementation proves a first-entry gap. [VERIFIED: `77-CONTEXT.md`]  
**Warning signs:** Source still contains `loadingTrends && !hasCurrentWeekCache ? <SportCard ...>載入這週紀錄中...</SportCard>` in the main render path. [VERIFIED: `client/src/components/HistoryScreen.tsx`]

### Pitfall 2: Letting trend aggregates unlock empty state or Day Detail

**What goes wrong:** A trend bucket with `mealCount: 0` can make the UI show confirmed empty or allow Day Detail before `/api/history/days/:date` resolves. [VERIFIED: `77-CONTEXT.md`]  
**Why it happens:** Current `TimelinePanel` computes `displayMealCount` from `selectedDayMealCount` when `snapshot` is null and can therefore use trend facts for timeline count. [VERIFIED: `client/src/components/HistoryScreen.tsx`]  
**How to avoid:** Keep aggregate count display separate from confirmed empty/detail activation; only `snapshot !== null` can confirm empty or rows. [VERIFIED: `77-CONTEXT.md`]  
**Warning signs:** Empty state predicates use `displayMealCount === 0` without also requiring a loaded snapshot. [VERIFIED: `client/src/components/HistoryScreen.tsx`]

### Pitfall 3: Reusing previous snapshot rows while the selected day is pending

**What goes wrong:** Users can see or edit meals from a prior selected date under a new target date. [VERIFIED: `77-CONTEXT.md`]  
**Why it happens:** Component-local caches can make stale data tempting if the render path falls back to previous state. [VERIFIED: `client/src/components/HistoryScreen.tsx`; VERIFIED: `77-CONTEXT.md`]  
**How to avoid:** Key snapshots strictly by `selectedDateKey`, render no rows until `dayCache.get(selectedDateKey)` exists, and reject previous-row fallback patterns in source tests. [VERIFIED: `client/src/components/HistoryScreen.tsx`; VERIFIED: `tests/unit/history-screen-contract.test.ts`]  
**Warning signs:** Strings such as `previousSnapshot`, `previousDate`, disabled row branches, or skeleton rows appear in History pending code. [VERIFIED: current source-contract rejection pattern]

### Pitfall 4: Refreshing too broadly after edits

**What goes wrong:** Every mutation can cause unnecessary History reloads, pending UI churn, and stale week totals if visible-week trends are skipped. [VERIFIED: `77-CONTEXT.md`]  
**Why it happens:** Mutation freshness can be mistaken for a global cache reset. [VERIFIED: `77-CONTEXT.md`]  
**How to avoid:** Preserve the visible selected day refresh, visible week refresh, offscreen cached invalidation, and unrelated-date no-op split. [VERIFIED: `client/src/components/HistoryScreen.tsx`; VERIFIED: `tests/unit/history-screen-contract.test.ts`]  
**Warning signs:** New code clears all `dayCache`/`trendsCache`, adds active-tab gating, or ignores visible-week trend refresh. [VERIFIED: `77-CONTEXT.md`]

### Pitfall 5: Proof artifacts accidentally include sensitive data

**What goes wrong:** Screenshots/manifests or generated evidence can include real DB state, prompts, raw user text, assistant text, image data, provider/tool payloads, session material, or private logs. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `docs/adr/0001-metadata-only-llm-failure-localization.md`]  
**Why it happens:** Visual and harness proof is often easiest with real local state, but this milestone requires synthetic/local metadata-only proof. [VERIFIED: `77-CONTEXT.md`]  
**How to avoid:** Use deterministic seeded data and manifests that record only command/status, screenshot path, viewport, assertions, and privacy policy. [VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`; VERIFIED: `77-CONTEXT.md`]  
**Warning signs:** Artifact JSON contains raw prompts, real session ids/cookies, DB snapshots, provider bodies, image bytes, or user-authored logs. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `docs/adr/0001-metadata-only-llm-failure-localization.md`]

## Code Examples

### Remove the Broad Top-Level Cold Loading Card

```tsx
// Source to change: client/src/components/HistoryScreen.tsx
// Current problematic branch:
{loadingTrends && !hasCurrentWeekCache ? (
  <SportCard className="sp-history-state-card" variant="flat">
    載入這週紀錄中...
  </SportCard>
) : null}
```

Planner should replace this with inline target-context pending states rather than a separate page-level card. [VERIFIED: `client/src/components/HistoryScreen.tsx`; VERIFIED: `77-CONTEXT.md`]

### Make Empty State Snapshot-Backed

```tsx
// Source pattern to plan: client/src/components/HistoryScreen.tsx
const snapshotLoaded = snapshot !== null;
const confirmedEmpty = snapshotLoaded && snapshot.meals.length === 0;
```

Use `confirmedEmpty` for the empty state and date-level Day Detail activation; do not use trend-only `mealCount === 0`. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `client/src/types.ts`]

### Preserve Shared Mutation Freshness

```typescript
// Source: client/src/meal-edit-refresh.ts
deps.redactChatReceiptIdentity(input.mealId);
deps.recordMealMutation(input.affectedDate);
```

This is the shared signal that Home-origin and grouped Meal Edit commits should continue to use. [VERIFIED: `client/src/meal-edit-refresh.ts`; VERIFIED: `client/src/components/MealEditScreen.tsx`; VERIFIED: `74-VERIFICATION.md`; VERIFIED: `76-VERIFICATION.md`]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Page-level History loading card on cold pending week state | Target-week context with inline placeholders is the locked Phase 77 approach | Phase 77 planning decision on 2026-06-04 | Planner should remove/avoid the page-level `載入這週紀錄中...` branch during week switches. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `client/src/components/HistoryScreen.tsx`] |
| Grouped meals locked to chat correction | Grouped direct `items[]` server contract plus grouped Meal Edit UI | Phases 75-76 completed 2026-06-03 | Phase 77 proof should cite/rerun representative grouped CRUD/UI checks, not redesign grouped editing. [VERIFIED: `.planning/ROADMAP.md`; VERIFIED: `75-VERIFICATION.md`; VERIFIED: `76-VERIFICATION.md`] |
| Home rows claimed unsupported/unclear for edit entry | Home complete rows open Meal Edit through shared payload helper | Phase 74 completed 2026-06-02 | Phase 77 proof should include Home-origin edit path only as representative refresh proof. [VERIFIED: `74-VERIFICATION.md`] |
| Visual proof via broad manual inspection | Synthetic local browser scripts with screenshot, layout, manifest, and privacy checks | Existing Phase 49 and Phase 76 proof patterns | Phase 77 should adapt the existing pattern for cold week-switch UX. [VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`; VERIFIED: `76-HUMAN-UAT.md`] |

**Deprecated/outdated:**

- Treating `載入這週紀錄中...` as the default uncached week-switch copy is outdated for Phase 77. [VERIFIED: `77-CONTEXT.md`]
- Treating grouped meals as unsupported in Meal Edit is outdated after Phase 76. [VERIFIED: `76-VERIFICATION.md`]
- Treating local proof as promotion authorization remains rejected. [VERIFIED: `AGENTS.md`; VERIFIED: `77-CONTEXT.md`; VERIFIED: `.planning/ROADMAP.md`]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Phase 77 visual proof can adapt Phase 49’s CDP script pattern rather than adding a new browser-test dependency. [ASSUMED] | Architecture Patterns / Environment Availability | Low; if the existing script is too coupled, planner can create a similarly small `.mjs` script using the same local Edge/CDP pattern. |

## Open Questions (RESOLVED)

1. **RESOLVED: Should helper extraction be required or optional?**  
   - What we know: `77-CONTEXT.md` allows helper extraction at planner discretion and requires focused tests if extracted. [VERIFIED: `77-CONTEXT.md`]  
   - Resolution: Helper extraction is not required for Phase 77 and should be avoided unless needed to satisfy source-contract testability or keep the existing `HistoryScreen.tsx` contracts readable. [VERIFIED: `77-01-PLAN.md`]  
   - Implementation guidance: Start with source-contract assertions and direct `HistoryScreen.tsx` changes; extract pure helpers only if tests need observable decision functions for refresh/invalidation or pending state. If extracted, add focused unit tests for selected-day refresh, visible-week refresh, offscreen cached day/week invalidation, and unrelated-date no-op. [VERIFIED: existing source-contract pattern in `tests/unit/history-screen-contract.test.ts`; VERIFIED: `77-CONTEXT.md`]

2. **RESOLVED: Where should the Phase 77 visual proof script live?**  
   - What we know: Existing generated visual evidence lives both under `scripts/` and `tests/harness/scenarios/*.mjs`; direct browser `.mjs` scenarios are not run by `yarn verify:harness`. [VERIFIED: `.planning/codebase/TESTING.md`; VERIFIED: `AGENTS.md`; VERIFIED: repo file listing]  
   - Resolution: Phase 77 visual evidence lives at `tests/harness/scenarios/77-history-loading-visual.mjs`, with generated artifacts under `tests/harness/artifacts/77-history-loading/latest/`. [VERIFIED: `77-02-PLAN.md`]  
   - Implementation guidance: Treat the `.mjs` script as a direct browser/visual harness command, not a `yarn verify:harness` scenario; record command/status metadata and relative screenshot paths in the metadata-only manifest. [VERIFIED: `AGENTS.md`; VERIFIED: `77-02-PLAN.md`]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript/test scripts, visual `.mjs` scripts | yes | v24.14.0 | None needed. [VERIFIED: environment audit] |
| Yarn | All project commands | yes | 1.22.22 | None; AGENTS requires Yarn only. [VERIFIED: environment audit; VERIFIED: `AGENTS.md`] |
| gsd-tools | GSD phase metadata/optional commit | yes | gsd-sdk v1.1.0 | Manual file write if unavailable, but it is available. [VERIFIED: environment audit] |
| Microsoft Edge | Local CDP browser visual evidence | yes | 148.0.3967.96 | Google Chrome candidate exists in scripts, but Chrome was not found in audit. [VERIFIED: environment audit; VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`] |
| Google Chrome | Alternate visual evidence browser | no | — | Microsoft Edge is available. [VERIFIED: environment audit] |
| ctx7 | External library docs fallback | no | — | Not needed; Phase 77 uses existing local stack and no new library API. [VERIFIED: environment audit] |
| slopcheck | Package legitimacy gate | no | — | Not needed because no new packages are recommended. [VERIFIED: environment audit] |

**Missing dependencies with no fallback:** none. [VERIFIED: environment audit]  
**Missing dependencies with fallback:** Google Chrome is missing but Microsoft Edge is available for existing CDP visual scripts. [VERIFIED: environment audit]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in test runner via `node --test` and `tsx`; local Node is v24.14.0. [VERIFIED: `package.json`; VERIFIED: environment audit] |
| Config file | none; commands live in `package.json`. [VERIFIED: `package.json`; VERIFIED: `.planning/codebase/TESTING.md`] |
| Quick run command | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-screen-contract.test.ts tests/unit/history-week.test.ts tests/unit/meal-edit-refresh.test.ts` [VERIFIED: `package.json`; VERIFIED: relevant test files] |
| Full suite command | `yarn release:check` for closure; it runs TypeScript, full tests, and frontend build after timezone validation. [VERIFIED: `scripts/release-check.mjs`] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| HIST-UX-01 | No page-level week loading card during cold week switch; target context remains visible with inline placeholders. | unit/source contract + browser visual | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-screen-contract.test.ts`; plus planned visual script command | Unit file exists; visual script is Wave 0 gap. [VERIFIED: `tests/unit/history-screen-contract.test.ts`] |
| HIST-UX-01 | Pending timeline shows `當日餐點`, `--筆`, and `同步這天紀錄中...`; no meal skeleton rows. | unit/source contract | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-screen-contract.test.ts` | Existing file, needs updated assertions. [VERIFIED: `tests/unit/history-screen-contract.test.ts`] |
| HIST-UX-01 | Empty state and Day Detail activation are snapshot-backed; trends zero alone is not enough. | unit/source contract | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/history-screen-contract.test.ts` | Existing file, needs updated assertions. [VERIFIED: `tests/unit/history-screen-contract.test.ts`] |
| PROOF-01 | Home edit entry representative proof. | existing source/unit proof citation or targeted rerun | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/home-dashboard-contract.test.ts tests/unit/meal-edit-payload.test.ts tests/unit/meal-edit-refresh.test.ts` | Exists. [VERIFIED: `74-VERIFICATION.md`; VERIFIED: repo file listing] |
| PROOF-01 | Grouped CRUD server contract representative proof. | integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts` | Exists. [VERIFIED: `75-VERIFICATION.md`; VERIFIED: repo file listing] |
| PROOF-01 | Grouped Meal Edit UI states representative proof. | unit/source/helper | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts tests/unit/meal-edit-grouped-draft.test.ts tests/unit/api-client.test.ts tests/unit/meal-edit-payload.test.ts` | Exists. [VERIFIED: `76-VERIFICATION.md`; VERIFIED: repo file listing] |
| PROOF-02 | Generated evidence remains metadata-only. | artifact review / source policy | Planned visual manifest plus review against `77-CONTEXT.md` forbidden categories | Wave 0 gap for Phase 77 manifest. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `docs/adr/0001-metadata-only-llm-failure-localization.md`] |
| PROOF-03 | TypeScript and local release closure. | static/release gate | `yarn tsc --noEmit`; `yarn release:check` | Commands exist. [VERIFIED: `package.json`; VERIFIED: `scripts/release-check.mjs`] |

### Sampling Rate

- **Per task commit:** Run the narrow command for touched files, always including `yarn tsc --noEmit` after TypeScript edits. [VERIFIED: `AGENTS.md`; VERIFIED: `.codex/skills/nutrition-verify-change/SKILL.md`]
- **Per wave merge:** Run focused History source/unit tests plus any changed visual script command. [VERIFIED: `.planning/codebase/TESTING.md`; VERIFIED: `77-CONTEXT.md`]
- **Phase gate:** Run representative v2.6 closure commands, Phase 77 visual proof, `yarn tsc --noEmit`, and `yarn release:check`; record no-promotion language. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `scripts/release-check.mjs`]

### Wave 0 Gaps

- [ ] Update `tests/unit/history-screen-contract.test.ts` to lock no top-level `載入這週紀錄中...` cold-switch card, inline `同步這天紀錄中...`, snapshot-backed empty/detail behavior, and no previous/skeleton rows. [VERIFIED: existing test file; VERIFIED: `77-CONTEXT.md`]
- [ ] Add or adapt a Phase 77 mobile visual evidence script using synthetic data, delayed cold week response, screenshot assertions, and a metadata-only manifest. [VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`; VERIFIED: `77-CONTEXT.md`]
- [ ] Create the Phase 77 closure matrix artifact during execution/verification, not during research. [VERIFIED: `77-CONTEXT.md`]

## Security Domain

### Applicable ASVS Categories

OWASP ASVS is a web application verification standard and includes categories such as authentication, session management, access control, validation, and cryptography. [CITED: https://owasp.org/www-project-application-security-verification-standard/; CITED: https://devguide.owasp.org/en/06-verification/01-guides/03-asvs/]

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no direct change | Guest-session auth remains existing; do not alter auth/session flow in Phase 77. [VERIFIED: `AGENTS.md`; VERIFIED: `77-CONTEXT.md`] |
| V3 Session Management | yes, indirectly for visual proof | Synthetic visual proof must avoid real cookies/session material; browser scripts should mock local state and `/api/device/session`. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`] |
| V4 Access Control | no direct change | Existing protected History/meal endpoints stay same-origin/cookie-backed; no route edits planned. [VERIFIED: `client/src/api.ts`; VERIFIED: `AGENTS.md`] |
| V5 Input Validation | yes | Existing API DTO validation must remain authoritative; do not let malformed History day snapshots produce editable rows. [VERIFIED: `client/src/api.ts`; VERIFIED: `tests/unit/api-client.test.ts`] |
| V6 Cryptography | no direct change | Guest-session signing remains outside this phase. [VERIFIED: `AGENTS.md`; VERIFIED: `.planning/PROJECT.md`] |
| V7 Error Handling and Logging | yes | Proof artifacts must remain metadata-only and must not include raw prompt/user/provider/tool/image/session/DB material. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `docs/adr/0001-metadata-only-llm-failure-localization.md`] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Real user/session/DB data leaking into visual proof artifacts | Information Disclosure | Use synthetic mocked responses and manifest-only metadata; block external `/api/chat`, real history calls, raw device IDs, and provider keys as Phase 49 does. [VERIFIED: `77-CONTEXT.md`; VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`] |
| Malformed snapshot payload unlocks edit identity | Tampering / Elevation of Privilege | Keep `getHistoryDaySnapshot()` DTO validation and `buildHistoryMealEditPayload()` authority checks; rows only render from normalized snapshot meals. [VERIFIED: `client/src/api.ts`; VERIFIED: `client/src/meal-edit-payload.ts`] |
| Stale cached rows under new selected date allow wrong meal edit | Tampering | Key snapshot rendering by `selectedDateKey` and render no previous rows during pending. [VERIFIED: `client/src/components/HistoryScreen.tsx`; VERIFIED: `77-CONTEXT.md`] |
| Broad cache refresh causes unnecessary pending churn and stale totals | Denial of Service / Integrity | Use scoped selected-day refresh, visible-week refresh, and offscreen invalidation only. [VERIFIED: `client/src/components/HistoryScreen.tsx`; VERIFIED: `77-CONTEXT.md`] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/77-history-loading-stabilization-and-local-proof-gate/77-CONTEXT.md` - locked phase decisions, deferred scope, canonical code references. [VERIFIED: local file read]
- `.planning/REQUIREMENTS.md` - `HIST-UX-01`, `PROOF-01`, `PROOF-02`, `PROOF-03`, and deferred v2.6 scope. [VERIFIED: local file read]
- `.planning/ROADMAP.md` - Phase 77 goal, dependencies, success criteria, and no-promotion boundary. [VERIFIED: local file read]
- `AGENTS.md` - project workflow, architecture ownership, testing matrix, and promotion restrictions. [VERIFIED: local file read]
- `client/src/components/HistoryScreen.tsx` - current History cache, loading, timeline, Day Detail, Meal Edit, and mutation refresh behavior. [VERIFIED: local file read]
- `client/src/lib/history-week.ts` and `tests/unit/history-week.test.ts` - pending week/stat helpers and proof. [VERIFIED: local file read]
- `client/src/api.ts`, `client/src/types.ts`, and `tests/unit/api-client.test.ts` - History trend/day snapshot DTO contracts. [VERIFIED: local file read]
- `client/src/meal-edit-refresh.ts`, `client/src/store.ts`, and `tests/unit/meal-edit-refresh.test.ts` - shared affected-date mutation freshness signal. [VERIFIED: local file read]
- `74-VERIFICATION.md`, `75-VERIFICATION.md`, and `76-VERIFICATION.md` - representative prior v2.6 proof surfaces. [VERIFIED: local file read]
- `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs` - closest synthetic mobile History visual evidence pattern. [VERIFIED: local file read]
- `docs/adr/0001-metadata-only-llm-failure-localization.md` - metadata-only evidence policy. [VERIFIED: local file read]

### Secondary (MEDIUM confidence)

- OWASP ASVS official project page and OWASP Developer Guide ASVS page - security category framing only. [CITED: https://owasp.org/www-project-application-security-verification-standard/; CITED: https://devguide.owasp.org/en/06-verification/01-guides/03-asvs/]

### Tertiary (LOW confidence)

- None. [VERIFIED: research source audit]

## Metadata

**Confidence breakdown:**

- Standard stack: HIGH - existing package/tool versions and project commands are local and directly verified. [VERIFIED: `package.json`; VERIFIED: environment audit]
- Architecture: HIGH - implementation boundaries are explicit in `AGENTS.md`, `77-CONTEXT.md`, and current source. [VERIFIED: `AGENTS.md`; VERIFIED: `77-CONTEXT.md`; VERIFIED: `client/src/components/HistoryScreen.tsx`]
- Pitfalls: HIGH - each pitfall is tied to locked decisions or current code patterns. [VERIFIED: `77-CONTEXT.md`; VERIFIED: local source reads]
- Visual proof location recommendation: HIGH - Phase 77 plan resolution fixes the script path at `tests/harness/scenarios/77-history-loading-visual.mjs` and artifacts under `tests/harness/artifacts/77-history-loading/latest/`. [VERIFIED: `77-02-PLAN.md`; VERIFIED: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`]

**Research date:** 2026-06-04  
**Valid until:** 2026-07-04 for local architecture and project constraints; recheck if package versions or visual proof tooling changes. [ASSUMED]
