# Roadmap: Nutrition Coach

## Milestones

- **v2.0 Logging & Mobile Quality Foundation** - shipped 2026-05-07; archived in [`milestones/v2.0/ROADMAP.md`](milestones/v2.0/ROADMAP.md)
- **v2.1 AI Trust Infrastructure & Logging Reliability** - shipped 2026-05-12; archived in [`milestones/v2.1/ROADMAP.md`](milestones/v2.1/ROADMAP.md)
- **v2.2 LLM Failure Localization Foundation** - shipped 2026-05-15; archived in [`milestones/v2.2/ROADMAP.md`](milestones/v2.2/ROADMAP.md)
- **v2.2 Promotion Blocker Reopen** - Phase 59 complete 2026-05-16; no staging/main promotion authorized
- **v2.3 Authoritative Mutation Outcomes and Fresh Meal State** - shipped locally 2026-05-20; archived in [`milestones/v2.3/ROADMAP.md`](milestones/v2.3/ROADMAP.md); no staging/main promotion performed
- **v2.4 Correction Authority and Meal Intent Fidelity** - shipped locally 2026-05-30; archived in [`milestones/v2.4/ROADMAP.md`](milestones/v2.4/ROADMAP.md); no staging/main promotion performed
- **v2.5 Structured LLM Boundaries and DTO Reliability** - shipped locally 2026-06-02; archived in [`milestones/v2.5/ROADMAP.md`](milestones/v2.5/ROADMAP.md); no staging/main promotion performed
- **v2.6 Meal Editing and History Usability** - shipped locally 2026-06-03; archived in [`milestones/v2.6-ROADMAP.md`](milestones/v2.6-ROADMAP.md); no staging/main promotion performed

## Current Status

Active milestone: **None**. v2.6 is archived locally and the next milestone has not been planned.

v2.6 returned to user-visible meal workflows after v2.4/v2.5 stabilized mutation authority, correction safety, structured LLM output, DTO validation, receipt persistence, and history state. The milestone made logged meals easier to revisit and edit: Home today rows open Meal Edit, grouped meals support direct item add/edit/delete operations, and History avoids disruptive cold week-switch loading behavior.

Planning remains local ignored GSD state because `origin/staging` stopped tracking `.planning/**` artifacts; code promotion still follows `feature/* -> staging -> main` with explicit approval required for production.

## Archived Execution History

| Milestone | Scope | Phase Archive | Notes |
|---|---|---|---|
| v2.3 | Phases 60-64 | [`milestones/v2.3/phases/`](milestones/v2.3/phases/) | Local release proof only; no staging/main promotion. |
| v2.4 | Phases 65-68 | [`milestones/v2.4/phases/`](milestones/v2.4/phases/) | Correction authority and meal intent fidelity; local release proof only. |
| v2.5 | Phases 69-73 | [`milestones/v2.5/phases/`](milestones/v2.5/phases/) | Structured LLM boundaries and DTO reliability; local release proof only. |
| v2.6 | Phases 74-77 | [`milestones/v2.6-phases/`](milestones/v2.6-phases/) | Meal editing and history usability; local release proof only. |

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

## Completed v2.6 Scope

| Phase | Milestone | Plans Complete | Status | Completed |
|---|---|---:|---|---|
| 74. Home Meal Edit Entry and Existing Edit Contract Review | v2.6 | 3/3 | Complete    | 2026-06-02 |
| 75. Grouped Meal Direct CRUD Contract | v2.6 | 3/3 | Complete    | 2026-06-03 |
| 76. Grouped Meal Edit UI and Conditional Item Media Decision | v2.6 | 3/3 | Complete    | 2026-06-03 |
| 77. History Loading Stabilization and Local Proof Gate | v2.6 | 4/4 | Complete    | 2026-06-03 |

Details are archived in [`milestones/v2.6-ROADMAP.md`](milestones/v2.6-ROADMAP.md), [`milestones/v2.6-REQUIREMENTS.md`](milestones/v2.6-REQUIREMENTS.md), [`milestones/v2.6-MILESTONE-AUDIT.md`](milestones/v2.6-MILESTONE-AUDIT.md), and [`milestones/v2.6-phases/`](milestones/v2.6-phases/).

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
*Last updated: 2026-06-04 after v2.6 local closeout*
