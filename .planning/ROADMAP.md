# Roadmap: Nutrition Coach

## Milestones

- **v2.0 Logging & Mobile Quality Foundation** - shipped 2026-05-07; archived in [`milestones/v2.0/ROADMAP.md`](milestones/v2.0/ROADMAP.md)
- **v2.1 AI Trust Infrastructure & Logging Reliability** - shipped 2026-05-12; archived in [`milestones/v2.1/ROADMAP.md`](milestones/v2.1/ROADMAP.md)
- **v2.2 LLM Failure Localization Foundation** - shipped 2026-05-15; archived in [`milestones/v2.2/ROADMAP.md`](milestones/v2.2/ROADMAP.md)
- **v2.2 Promotion Blocker Reopen** - Phase 59 complete 2026-05-16; no staging/main promotion authorized
- **v2.3 Authoritative Mutation Outcomes and Fresh Meal State** - shipped locally 2026-05-20; archived in [`milestones/v2.3/ROADMAP.md`](milestones/v2.3/ROADMAP.md); no staging/main promotion performed
- **v2.4 Correction Authority and Meal Intent Fidelity** - shipped locally 2026-05-30; archived in [`milestones/v2.4/ROADMAP.md`](milestones/v2.4/ROADMAP.md); no staging/main promotion performed
- **v2.5 Structured LLM Boundaries and DTO Reliability** - shipped locally 2026-06-02; archived in [`milestones/v2.5/ROADMAP.md`](milestones/v2.5/ROADMAP.md); no staging/main promotion performed
- **v2.6 Meal Editing and History Usability** - active; initialized 2026-06-02 from Notion tracker exploration; no staging/main promotion authorized

## Current Status

Active milestone: **v2.6 Meal Editing and History Usability**.

v2.6 returns to user-visible meal workflows after v2.4/v2.5 stabilized mutation authority, correction safety, structured LLM output, DTO validation, receipt persistence, and history state. The milestone focuses on making logged meals easier to revisit and edit: Home today rows should open Meal Edit, grouped meals should support direct item add/edit/delete operations, and History should avoid disruptive cold week-switch loading behavior.

Planning remains local ignored GSD state because `origin/staging` stopped tracking `.planning/**` artifacts; code promotion still follows `feature/* -> staging -> main` with explicit approval required for production.

## Archived Execution History

| Milestone | Scope | Phase Archive | Notes |
|---|---|---|---|
| v2.3 | Phases 60-64 | [`milestones/v2.3/phases/`](milestones/v2.3/phases/) | Local release proof only; no staging/main promotion. |
| v2.4 | Phases 65-68 | [`milestones/v2.4/phases/`](milestones/v2.4/phases/) | Correction authority and meal intent fidelity; local release proof only. |
| v2.5 | Phases 69-73 | [`milestones/v2.5/phases/`](milestones/v2.5/phases/) | Structured LLM boundaries and DTO reliability; local release proof only. |

## Completed v2.4 Scope

| Phase | Milestone | Plans Complete | Status | Completed |
|---|---|---:|---|---|
| 65. Tool Contract Alignment and Meal-Period Authority | v2.4 | 8/8 | Complete | 2026-05-27 |
| 66. Numeric Correction Provenance Guard | v2.4 | 5/5 | Complete | 2026-05-28 |
| 67. Correction Targeting and Backend Clarification Rendering | v2.4 | 7/7 | Complete | 2026-05-29 |
| 68. Structured Tool Results and Release-Proof Gate | v2.4 | 4/4 | Complete | 2026-05-29 |

## Completed v2.5 Scope

| Phase | Milestone | Plans Complete | Status | Completed |
|---|---|---:|---|---|
| 69. Provider Structured Output Boundary | v2.5 | 1/1 | Complete | 2026-05-31 |
| 70. Onboarding Target Generation Structured Path | v2.5 | 2/2 | Complete | 2026-05-31 |
| 71. Authoritative DTO Validation Expansion | v2.5 | 3/3 | Complete | 2026-06-01 |
| 72. Receipt Atomicity and Structured History State | v2.5 | 6/6 | Complete | 2026-06-01 |
| 73. Release/Security Hardening and Local Proof Gate | v2.5 | 3/3 | Complete | 2026-06-01 |

Details are archived in [`milestones/v2.5/ROADMAP.md`](milestones/v2.5/ROADMAP.md), [`milestones/v2.5/REQUIREMENTS.md`](milestones/v2.5/REQUIREMENTS.md), [`milestones/v2.5/MILESTONE-AUDIT.md`](milestones/v2.5/MILESTONE-AUDIT.md), and [`milestones/v2.5/phases/`](milestones/v2.5/phases/).

## Active v2.6 Scope

**Phase Numbering:**

- Integer phases continue from the previous milestone: 74, 75, 76, 77.
- Decimal phases are reserved for urgent insertions, if needed later.

- [x] **Phase 74: Home Meal Edit Entry and Existing Edit Contract Review** - Make Home today meal rows open Meal Edit like Chat and History rows, and verify the current single-item edit/delete contract before expanding grouped behavior. (completed 2026-06-02)
- [x] **Phase 75: Grouped Meal Direct CRUD Contract** - Add direct grouped meal item edit, add, and delete support through a server-owned contract that preserves revision, summary, and receipt authority. (completed 2026-06-03)
- [x] **Phase 76: Grouped Meal Edit UI and Conditional Item Media Decision** - Build the grouped Meal Edit UI for item CRUD and decide whether item-level photo mapping is required or explicitly deferred. (completed 2026-06-03)
- [ ] **Phase 77: History Loading Stabilization and Local Proof Gate** - Smooth cold week-switch loading behavior, close focused local verification, and record defer decisions without monthly goal scope.

## Phase Details

### Phase 74: Home Meal Edit Entry and Existing Edit Contract Review

**Goal:** Home today meal rows can enter the Meal Edit flow, and the existing single-item edit/delete behavior is revalidated before grouped editing expands the contract.
**Depends on:** v2.5 closeout
**Requirements:** HOME-EDIT-01, HOME-EDIT-02, EDIT-BASE-01
**Plans:** 3/3 plans complete
Plans:
**Wave 1**

- [x] 74-01-PLAN.md — Home edit payload eligibility and row activation.
- [x] 74-02-PLAN.md — Meal Edit Home back label and edit-contract revalidation.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 74-03-PLAN.md — Capability matrix/doc correction and final Phase 74 gates.

**Success Criteria** (what must be TRUE):

1. Home today meal rows expose the same edit entry affordance as Chat and History rows for eligible meals.
2. Navigation carries the public meal id and revision identity required by the existing Meal Edit stale-protection contract.
3. Capability docs or matrices no longer claim Home edit behavior that the code does not implement.
4. Existing single-item edit/delete coverage remains green before grouped behavior is added.

**Implementation Notes:**

- Keep ownership in the existing client transport/store boundaries.
- Preserve server-side revision checks as authoritative; Home navigation is UX support only.
- Notion source rows: `NC-BACKLOG-004`, `NC-PARTIAL-005`.

### Phase 75: Grouped Meal Direct CRUD Contract

**Goal:** Grouped meals can be edited directly through item-level add, update, and delete operations instead of being locked to chat correction.
**Depends on:** Phase 74
**Requirements:** GROUP-EDIT-01, GROUP-EDIT-02, GROUP-EDIT-03, GROUP-EDIT-04
**Plans:** 3/3 plans complete
Plans:
**Wave 1**

- [x] 75-01-PLAN.md — Red-first grouped PATCH contract coverage.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 75-02-PLAN.md — Strict grouped route parser and direct PATCH implementation.

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 75-03-PLAN.md — Grouped conflict, side-effect, persistence proof, and final gates.

**Success Criteria** (what must be TRUE):

1. Grouped meal item updates can change item name, calories, and macros through a validated server contract.
2. Grouped meal item additions create persisted item facts without fabricating LLM authority or bypassing summary recompute behavior.
3. Grouped meal item deletion works without deleting the whole meal unless the user explicitly chooses a whole-meal action.
4. Grouped direct writes preserve expected meal revision checks, affected-date freshness, `summaryOutcome`, and realtime publish behavior.
5. The previous chat-only grouped edit fallback is either removed where obsolete or remains explicit for unsupported cases.

**Implementation Notes:**

- Use real SQLite integration tests for route/service behavior.
- Prefer extending existing meal transaction service boundaries over creating a parallel grouped edit service.
- Keep item media mapping out of this phase unless the contract cannot represent required user actions without it.
- Notion source rows: `NC-BACKLOG-005`, `NC-PARTIAL-005`, `NC-PARTIAL-009` as optional cleanup adjacency.

### Phase 76: Grouped Meal Edit UI and Conditional Item Media Decision

**Goal:** Meal Edit presents grouped meal items as editable rows with add/delete controls, validation feedback, and post-commit refresh behavior.
**Depends on:** Phase 75
**Requirements:** GROUP-UI-01, GROUP-UI-02, GROUP-UI-03, MEDIA-DECISION-01
**Plans:** 3/3 plans complete
Plans:
**Wave 1**

- [x] 76-01-PLAN.md — Red grouped editor, transport, and media-defer source contracts.

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 76-02-PLAN.md — Grouped draft helper, update input union, and compact Meal Edit grouped editor UI.
- [x] 76-03-PLAN.md — Existing `/api/meals` grouped item read-path projection and refresh proof.

**Success Criteria** (what must be TRUE):

1. A grouped meal opens in Meal Edit with item-level controls for edit, add, and delete.
2. Validation errors, stale revision conflicts, and unsupported states are visible and recoverable without implying a successful mutation.
3. Successful grouped edits refresh the affected meal row and relevant summary/history state using existing authoritative DTO paths.
4. Photo-to-food-item mapping is either implemented because grouped item editing requires it or explicitly deferred with a source-of-truth note.

**Implementation Notes:**

- Keep compact mobile ergonomics and avoid a broad visual redesign.
- Preserve whole-meal photo identity unless item-level mapping becomes necessary.
- Notion source rows: `NC-PARTIAL-004`, `NC-PARTIAL-005`, `NC-BACKLOG-005`.

### Phase 77: History Loading Stabilization and Local Proof Gate

**Goal:** History week switching avoids disruptive loading jumps on cold misses, and the milestone closes with focused local proof without monthly goal scope.
**Depends on:** Phase 76
**Requirements:** HIST-UX-01, PROOF-01, PROOF-02, PROOF-03

**Success Criteria** (what must be TRUE):

1. Week switching keeps a stable History layout during pending cold loads, with clear loading state that does not jump or erase context unnecessarily.
2. Grouped edit commits and Home edit entry integrate with History refresh behavior for affected dates.
3. Local verification covers Home edit entry, grouped CRUD server contract, grouped Meal Edit UI states, History loading, and TypeScript.
4. Monthly goals, monthly target analytics, hydration tracking, motion polish, coaching copy, and infrastructure cleanup remain explicitly deferred.

**Implementation Notes:**

- `NC-BACKLOG-002` monthly records is not part of v2.6 unless later narrowed to a lightweight browse-only entry; monthly goals are explicitly out of scope.
- Run `yarn tsc --noEmit` for TypeScript edits and targeted unit/integration/client checks selected by touched paths.
- No staging or main promotion without explicit current-thread approval.

## Progress

**Execution Order:**
Phases execute in numeric order: 74 -> 75 -> 76 -> 77.

| Phase | Milestone | Plans Complete | Status | Completed |
|---|---|---:|---|---|
| 74. Home Meal Edit Entry and Existing Edit Contract Review | v2.6 | 3/3 | Complete    | 2026-06-02 |
| 75. Grouped Meal Direct CRUD Contract | v2.6 | 3/3 | Complete    | 2026-06-03 |
| 76. Grouped Meal Edit UI and Conditional Item Media Decision | v2.6 | 3/3 | Complete    | 2026-06-03 |
| 77. History Loading Stabilization and Local Proof Gate | v2.6 | 0/0 | Planned | — |

## Future Milestone Candidates

- Water tracking from the primary logging flow.
- Monthly nutrition history beyond v2.6 History loading stabilization; monthly goals and monthly target analytics are deferred.
- Onboarding animation, motion system, and unrelated visual polish.
- User-flagged semantic failure capture after trigger, retention, privacy, storage, and access-control decisions.
- Local-only raw debugger implementation under the sibling raw debugger contract.
- Metadata-only production trace sampling and aggregate failure metrics.
- Richer Markdown/coaching copy after structured LLM and correction authority paths are stable.
- Item-photo/media workflows beyond the v2.6 conditional photo-to-food-item decision.
- Opt-in live-model eval gate for release/model upgrades.
- Agents SDK or Responses API adapter spikes after provider contract tests exist.

---
*Last updated: 2026-06-02 after v2.6 milestone initialization*
