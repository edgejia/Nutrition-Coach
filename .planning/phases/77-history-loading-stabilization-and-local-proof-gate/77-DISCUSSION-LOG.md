# Phase 77: History Loading Stabilization and Local Proof Gate - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-04
**Phase:** 77-History Loading Stabilization and Local Proof Gate
**Areas discussed:** Cold Miss UX, Day Detail Gap, Refresh Proof, Local Gate

---

## Cold Miss UX

| Option | Description | Selected |
|--------|-------------|----------|
| Target-week skeleton/placeholder state | Switch target context immediately; use neutral pending states until trends/day snapshot return. | ✓ |
| Keep prior-week content until target-week data arrives | Avoids blanks but risks prior-week data under target-week context. | |
| Hybrid | Header/week strip switch immediately, while hero/timeline keep prior data with an updating boundary. | |
| Other | Freeform behavior. | |

**User's choice:** Target-week placeholders with refinement: stable inline pending only.
**Notes:** The observed flash comes from the extra top-level `載入這週紀錄中...` card, not from target-week placeholders. Week strip, stats, hero, and timeline should show inline pending states in-place.

| Option | Description | Selected |
|--------|-------------|----------|
| Inline pending row/card in the timeline slot | Keep `當日餐點`, show `--筆`, and render pending copy where meals/empty state would appear. | ✓ |
| Skeleton meal rows | Reserve approximate meal-row shapes. | |
| Only placeholders in count/hero | Keep timeline quiet during pending. | |
| Other | Freeform behavior. | |

**User's choice:** Inline pending row/card.
**Notes:** The current `TimelinePanel` has the right shape. This differs from the problematic week banner because it stays inside the day section.

| Option | Description | Selected |
|--------|-------------|----------|
| Trends day data is enough for hero/count; day snapshot is required for meals | Use trends aggregates for hero/count, require day snapshot for meal rows. | ✓ |
| Require day snapshot for both hero/count and meals | Keeps all selected-day content blank longer. | |
| Require both trends and day snapshot before changing any selected-day content | Heavy all-or-nothing loading behavior. | |
| Other | Freeform behavior. | |

**User's choice:** Trends aggregates can support hero/count; day snapshot is required for meals.
**Notes:** This matches existing code separation: `SelectedDayHero` can use `selectedWeekDay.calories`, section count can use `selectedWeekDay.mealCount`, and meal rows require `snapshot.meals`.

| Option | Description | Selected |
|--------|-------------|----------|
| Remove week-level loading card for week switches | Rely on inline pending only. | ✓ |
| Keep it only for first-ever History load | Preserve initial card but not week-switch card. | |
| Replace with subtle inline status text in the header | Avoid content block but add header state. | |
| Other | Freeform behavior. | |

**User's choice:** Remove separate week-level loading card for week switches.
**Notes:** Do not keep a first-ever special card unless planning/research proves initial History entry has no usable inline context.

---

## Day Detail Gap

| Option | Description | Selected |
|--------|-------------|----------|
| Open Day Detail only after snapshot-backed state is available | Day Detail remains backed by `/api/history/days/:date`. | ✓ |
| Allow opening Day Detail with aggregate-only placeholder state | Expands loading into another screen. | |
| Keep day-level container open but disable meal targeting | Adds nuanced branches. | |
| Other | Freeform behavior. | |

**User's choice:** Open Day Detail only after the selected date has snapshot-backed state.
**Notes:** Day Detail can open for real meals or a confirmed empty day after snapshot returns; not while only trends are known.

| Option | Description | Selected |
|--------|-------------|----------|
| Hide/withhold meal rows until snapshot returns | Avoid stale or aggregate-derived edit identity. | ✓ |
| Keep previous meal rows visible but disabled | Risks prior-date meals in target-date context. | |
| Render disabled skeleton rows | Implies records may exist before proof. | |
| Other | Freeform behavior. | |

**User's choice:** Hide/withhold meal rows until selected day snapshot returns.
**Notes:** `buildHistoryMealEditPayload` needs real meal id, revision id, nutrition, image, loggedAt, and item facts.

| Option | Description | Selected |
|--------|-------------|----------|
| Show empty state and allow Day Detail date-level open | Confirmed empty snapshot is loaded. | ✓ |
| Show empty state but keep Day Detail closed | Simpler but inconsistent with snapshot-backed rule. | |
| Treat empty snapshot like pending | Hides loaded empty facts. | |
| Other | Freeform behavior. | |

**User's choice:** Confirmed empty day shows empty state and allows date-level Day Detail open.
**Notes:** `trends.mealCount === 0` alone is not enough; empty meal-list state must be snapshot-backed.

| Option | Description | Selected |
|--------|-------------|----------|
| Keep Day Detail unavailable; show inline error in timeline slot | Failed snapshot means no snapshot-backed state. | ✓ |
| Allow Day Detail open with error state | Expands Day Detail into error/loading surface. | |
| Fall back to trends as empty/partial state | Risks treating aggregate facts as snapshot facts. | |
| Other | Freeform behavior. | |

**User's choice:** Keep Day Detail unavailable and show inline History error.
**Notes:** Trends may support date/hero/count, but must not become empty or partial snapshot facts.

---

## Refresh Proof

| Option | Description | Selected |
|--------|-------------|----------|
| Only affected visible day/week; invalidate offscreen affected cache | Scoped refresh and invalidation. | ✓ |
| Refresh all History caches after every meal mutation | Broader churn. | |
| Only refresh selected day, ignore week trends until navigation | Weekly totals can go stale. | |
| Other | Freeform behavior. | |

**User's choice:** Only affected visible day/week; invalidate offscreen affected cache.
**Notes:** This matches the existing `lastMealMutation.affectedDate` pattern and avoids broad refresh churn.

| Option | Description | Selected |
|--------|-------------|----------|
| Home edit entry and grouped Meal Edit commits | Prove prior v2.6 direct edit surfaces drive shared refresh path. | ✓ |
| All meal mutations including chat log/update/delete | Broader than Phase 77. | |
| Grouped commits only | Misses Home edit integration. | |
| Other | Freeform behavior. | |

**User's choice:** Cover Home edit entry and grouped Meal Edit commits.
**Notes:** Do not reopen all chat mutation sources unless research finds a regression in the shared `lastMealMutation` contract.

| Option | Description | Selected |
|--------|-------------|----------|
| Contract-level source/unit proof unless helper is extracted | Existing source contracts guard client cache behavior. | ✓ |
| Add browser/runtime proof for cache behavior | Stronger but brittle. | |
| Add integration API proof | Wrong layer for client cache invalidation. | |
| Other | Freeform behavior. | |

**User's choice:** Contract-level source/unit proof is enough unless helper extraction creates a better unit-test target.
**Notes:** Reserve browser evidence for visible loading/UX behavior, not exact cache invalidation.

| Option | Description | Selected |
|--------|-------------|----------|
| Keep screen-agnostic affected-date behavior | No active-tab gating. | ✓ |
| Refresh only when History is active | Can miss refreshes. | |
| Defer all refresh until user returns to History | Adds new resume/loading contract. | |
| Other | Freeform behavior. | |

**User's choice:** Keep `lastMealMutation` as a screen-agnostic freshness signal.
**Notes:** If History is mounted, it consumes the mutation notice even behind a secondary screen. If unmounted, returning to History uses normal load/cold-load path.

---

## Local Gate

| Option | Description | Selected |
|--------|-------------|----------|
| Source/unit contracts plus targeted browser/mobile visual evidence | Locks code contract and visible no-jump behavior. | ✓ |
| Source/unit contracts only | Faster but weaker for visual regression. | |
| Browser evidence only | Proves visible behavior but leaves implementation contract fragile. | |
| Other | Freeform behavior. | |

**User's choice:** Use source/unit contracts plus targeted browser/mobile visual evidence.
**Notes:** Browser/mobile evidence should target cold week switch on mobile and prove no transient page-level card or layout jump.

| Option | Description | Selected |
|--------|-------------|----------|
| Targeted closure matrix covering phases 74-77 | Representative v2.6 closure proof. | ✓ |
| Only new Phase 77 proof plus release-check | May under-satisfy `PROOF-01`. | |
| Full test suite and all prior phase commands | Heavier than necessary. | |
| Other | Freeform behavior. | |

**User's choice:** Use a targeted v2.6 closure matrix covering phases 74-77.
**Notes:** Do not rerun every prior phase command wholesale; cite or rerun representative targeted commands and add new History loading proof.

| Option | Description | Selected |
|--------|-------------|----------|
| Synthetic/local visual evidence only; no raw user data | Screenshots/manifests with seeded or mocked data. | ✓ |
| Real local DB data is acceptable if redacted | More realistic but higher privacy risk. | |
| No screenshot artifacts, command logs only | Safer but weaker visual proof. | |
| Other | Freeform behavior. | |

**User's choice:** Synthetic/local visual evidence only.
**Notes:** Artifacts should record command/status metadata, screenshot outputs, and privacy/evidence policy only.

| Option | Description | Selected |
|--------|-------------|----------|
| Existing v2.6 defer list plus no staging/main promotion | Explicit closure non-scope. | ✓ |
| Only monthly goals and promotion | Shorter but incomplete. | |
| No defer list in context; leave it to requirements | Less duplicate text but weaker closure note. | |
| Other | Freeform behavior. | |

**User's choice:** Include the existing v2.6 defer list plus no-promotion note.
**Notes:** Local proof and `yarn release:check` close v2.6 locally only and do not authorize staging/main promotion.

---

## the agent's Discretion

- Exact helper names, source-contract test names, visual proof script/harness placement, synthetic fixture shape, and whether cache-decision logic is extracted are left to the planner.

## Deferred Ideas

- Monthly goals/analytics, hydration, motion/broad polish, richer coaching copy, observability/productization, infra cleanup, `OrchestratorResult` cleanup, legacy `logFood` cleanup, and staging/main promotion remain deferred.
