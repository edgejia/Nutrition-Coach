# Requirements Archive: v2.6 Meal Editing and History Usability

**Archived:** 2026-06-03
**Status:** SHIPPED

For current requirements, see `.planning/REQUIREMENTS.md`.

---

# Requirements: Nutrition Coach v2.6 Meal Editing and History Usability

**Defined:** 2026-06-02
**Core Value:** 讓記錄比不記錄還要容易--說一句話、傳一張照片，AI 搞定剩下的。

## v2.6 Requirements

Requirements for the v2.6 meal editing and history usability milestone. Each requirement maps to exactly one roadmap phase unless noted as proof/defer scope.

### Home Edit Entry

- [x] **HOME-EDIT-01**: Home today meal rows open the Meal Edit page for eligible meals, using the same public meal identity and revision-safe edit entry pattern as Chat and History.
- [x] **HOME-EDIT-02**: Home edit entry updates stale capability documentation or matrix claims so code and docs agree on where Meal Edit can be opened.
- [x] **EDIT-BASE-01**: Existing single-item edit/delete behavior is revalidated before grouped meal direct editing expands the contract.

### Grouped Meal Direct Editing

- [x] **GROUP-EDIT-01**: Grouped meals support direct item updates for item name, calories, and macros through a validated server contract.
- [x] **GROUP-EDIT-02**: Grouped meals support direct item additions without relying on model-authored estimates as committed authority.
- [x] **GROUP-EDIT-03**: Grouped meals support direct item deletion without deleting the entire meal unless the user chooses a whole-meal delete action.
- [x] **GROUP-EDIT-04**: Grouped direct edits preserve expected meal revision checks, affected-date freshness, `summaryOutcome`, and realtime publish behavior.

### Grouped Meal Edit UI

- [x] **GROUP-UI-01**: Meal Edit renders grouped meal items as editable rows with clear controls for edit, add, and delete.
- [x] **GROUP-UI-02**: Meal Edit surfaces validation errors, stale revision conflicts, and unsupported states without implying a successful mutation.
- [x] **GROUP-UI-03**: Successful grouped edits refresh affected meal, summary, and history state through existing authoritative DTO and store paths.
- [x] **MEDIA-DECISION-01**: Item-level photo mapping is either implemented because grouped item editing requires it or explicitly deferred with a source-of-truth note.

### History Usability

- [x] **HIST-UX-01**: History week switching keeps a stable layout during cold pending loads and avoids disruptive loading jumps.

### Proof and Release Gates

- [x] **PROOF-01**: v2.6 has targeted local proof for Home edit entry, grouped CRUD server behavior, grouped Meal Edit UI states, and History week-switch loading.
- [x] **PROOF-02**: Any generated trace, harness, screenshot, or verification evidence remains metadata-only and excludes raw prompts, user text, assistant final text, tool raw payloads, provider bodies, image data, session material, or database snapshots.
- [x] **PROOF-03**: Local closure runs `yarn tsc --noEmit` and the targeted test commands required by changed paths, with `yarn release:check` before any staging/main promotion request.

## Explicitly Deferred

Deferred from v2.6 unless a later planning step explicitly reopens the scope.

- **DEFER-01**: Monthly goals, monthly targets, monthly target analytics, and monthly achievement-rate features.
- **DEFER-02**: Hydration/water tracking from the primary logging flow.
- **DEFER-03**: Onboarding animation, activity spectrum redesign, product-home motion system, and broad visual polish.
- **DEFER-04**: Richer LLM coaching tone/copy not directly required for grouped edit receipts or validation feedback.
- **DEFER-05**: Observability dashboard/productization, `OrchestratorResult` surface refactor, and legacy `logFood` shim cleanup unless they become required to safely close grouped editing.
- **DEFER-06**: Staging or main promotion without explicit current-thread approval.

## Source Tracker Rows

v2.6 was initialized from the Notion Nutrition Coach Tracker on 2026-06-02.

| Tracker ID | Use in v2.6 |
|---|---|
| `NC-BACKLOG-004` | Home today meal rows open Meal Edit. |
| `NC-BACKLOG-005` | Grouped meal direct editing. |
| `NC-PARTIAL-005` | Grouped edit/delete/add operations. |
| `NC-PARTIAL-004` | Conditional item-level photo mapping decision. |
| `NC-PARTIAL-003` | History week-switch loading jump. |
| `NC-BACKLOG-002` | Deferred for monthly goals/analytics; revisit only for future monthly history browse scope. |

## Traceability

| Requirement | Phase | Status |
|---|---|---|
| HOME-EDIT-01 | Phase 74 | Complete |
| HOME-EDIT-02 | Phase 74 | Complete |
| EDIT-BASE-01 | Phase 74 | Complete |
| GROUP-EDIT-01 | Phase 75 | Complete |
| GROUP-EDIT-02 | Phase 75 | Complete |
| GROUP-EDIT-03 | Phase 75 | Complete |
| GROUP-EDIT-04 | Phase 75 | Complete |
| GROUP-UI-01 | Phase 76 | Complete |
| GROUP-UI-02 | Phase 76 | Complete |
| GROUP-UI-03 | Phase 76 | Complete |
| MEDIA-DECISION-01 | Phase 76 | Complete |
| HIST-UX-01 | Phase 77 | Complete |
| PROOF-01 | Phase 77 | Complete |
| PROOF-02 | Phase 77 | Complete |
| PROOF-03 | Phase 77 | Complete |
| DEFER-01 | Future milestone | Deferred |
| DEFER-02 | Future milestone | Deferred |
| DEFER-03 | Future milestone | Deferred |
| DEFER-04 | Future milestone | Deferred |
| DEFER-05 | Conditional future cleanup | Deferred |
| DEFER-06 | Release policy gate | Deferred / Policy |

**Coverage:**

- Active v2.6 requirements: 15 total
- Active mapped to phases: 15
- Deferred scope notes: 6 total
- Deferred mapped: 6
- Unmapped: 0

---
*Requirements defined: 2026-06-02*
