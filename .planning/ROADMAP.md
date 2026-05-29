# Roadmap: Nutrition Coach

## Milestones

- **v2.0 Logging & Mobile Quality Foundation** - shipped 2026-05-07; archived in [`milestones/v2.0/ROADMAP.md`](milestones/v2.0/ROADMAP.md)
- **v2.1 AI Trust Infrastructure & Logging Reliability** - shipped 2026-05-12; archived in [`milestones/v2.1/ROADMAP.md`](milestones/v2.1/ROADMAP.md)
- **v2.2 LLM Failure Localization Foundation** - shipped 2026-05-15; archived in [`milestones/v2.2/ROADMAP.md`](milestones/v2.2/ROADMAP.md)
- **v2.2 Promotion Blocker Reopen** - Phase 59 complete 2026-05-16; no staging/main promotion authorized
- **v2.3 Authoritative Mutation Outcomes and Fresh Meal State** - shipped locally 2026-05-20; archived in [`milestones/v2.3-ROADMAP.md`](milestones/v2.3-ROADMAP.md); no staging/main promotion performed
- **v2.4 Correction Authority and Meal Intent Fidelity** - shipped locally 2026-05-30; archived in [`milestones/v2.4-ROADMAP.md`](milestones/v2.4-ROADMAP.md); no staging/main promotion performed

## Current Status

Active milestone: **none**.

v2.4 is archived locally. The project is awaiting the next milestone selection. `origin/staging` remains the deployment/test branch and is ahead of `origin/main`; staging/main promotion remains outside roadmap closeout and requires a separate ship workflow plus explicit current-thread approval.

## Archived Execution History

| Milestone | Scope | Phase Archive | Notes |
|---|---|---|---|
| v2.3 | Phases 60-64 | [`milestones/v2.3-phases/`](milestones/v2.3-phases/) | Local release proof only; no staging/main promotion. |
| v2.4 | Phases 65-68 | [`milestones/v2.4-phases/`](milestones/v2.4-phases/) | Correction authority and meal intent fidelity; local release proof only. |

## Completed v2.4 Scope

| Phase | Milestone | Plans Complete | Status | Completed |
|---|---|---:|---|---|
| 65. Tool Contract Alignment and Meal-Period Authority | v2.4 | 8/8 | Complete | 2026-05-27 |
| 66. Numeric Correction Provenance Guard | v2.4 | 5/5 | Complete | 2026-05-28 |
| 67. Correction Targeting and Backend Clarification Rendering | v2.4 | 7/7 | Complete | 2026-05-29 |
| 68. Structured Tool Results and Release-Proof Gate | v2.4 | 4/4 | Complete | 2026-05-29 |

## Future Milestone Candidates

- Water tracking from the primary logging flow.
- Monthly nutrition history beyond the current affected-date freshness scope.
- Onboarding animation, motion system, and unrelated visual polish.
- User-flagged semantic failure capture after trigger, retention, privacy, storage, and access-control decisions.
- Local-only raw debugger implementation under the sibling raw debugger contract.
- Metadata-only production trace sampling and aggregate failure metrics.
- Richer Markdown/coaching copy after correction authority is safe.
- Broader Meal Edit grouped-item and item-photo workflows.
- Split large authority modules such as `server/orchestrator/tools.ts` and `server/services/meal-correction.ts` after the v2.4 safety boundary has settled.

---
*Last updated: 2026-05-30 after v2.4 milestone closeout*
