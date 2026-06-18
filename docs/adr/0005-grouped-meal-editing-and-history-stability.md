# ADR 0005: Grouped Meal Editing and History Stability

## Status

Accepted for v2.6.

## Context

Nutrition Coach already protected meal edits with public meal revision identity, but grouped meals remained effectively chat-correction-only from the direct edit UI. That created a workflow mismatch: users could revisit a grouped meal, but not safely add, edit, or delete individual items through Meal Edit.

History also exposed a usability gap during cold week or date switching. Snapshot-backed History data was the right authority model, but transient pending states could briefly disturb the layout and make fast navigation feel unstable.

## Decision

- Let Home today meal rows open the existing Meal Edit flow only when the row has complete public meal identity, revision identity, nutrition facts, item count, and logged-at authority.
- Represent grouped direct edits as a strict full-list `items[]` replacement under `expectedMealRevisionId`, with flat public item rows: `name`, `position`, `calories`, `protein`, `carbs`, and `fat`.
- Reuse the existing meal transaction, summary recompute, `summaryOutcome`, and realtime publish paths after grouped replacement commits.
- Keep item-level media out of grouped item DTOs and writes for v2.6. Whole-meal image identity remains meal-level until a future item-photo workflow is explicitly scoped.
- Treat History day snapshots as the only authority for timeline rows, Meal Edit activation, confirmed empty days, and Day Detail activation.
- Keep target week/date context mounted during cold loads and delay selected-day pending copy so fast reloads do not flash transient loading text.

## Consequences

- Grouped editing is now a normal direct edit workflow without weakening stale revision protection or letting model-authored estimates become committed authority.
- Deleting a grouped item is deletion by omission in a nonempty full-list replacement. Whole-meal delete remains a separate user action.
- The API keeps one direct PATCH endpoint, but malformed grouped bodies fail before summary recompute, publish, or revision advancement.
- Future item-photo work must add explicit item/media authority instead of attaching photo evidence to current media-free item rows.
- History can show stable target context while pending, but UI code must preserve the distinction between aggregate trend data and loaded day snapshot facts.

## Verification

v2.6 Phase 74-77 verification covers Home edit entry, grouped PATCH success/invalid/conflict behavior, ordered revision item persistence, grouped Meal Edit UI and transport contracts, grouped `/api/meals` item projection, History snapshot authority, delayed pending-copy anti-flicker proof, TypeScript, frontend build, synthetic mobile visual proof, and `yarn release:check`.
