# Requirements: Nutrition Coach v2.4 Correction Authority and Meal Intent Fidelity

**Defined:** 2026-05-26
**Core Value:** 讓記錄比不記錄還要容易--說一句話、傳一張照片，AI 搞定剩下的。

## v2.4 Requirements

Requirements for the v2.4 correction-authority milestone. Each requirement must map to exactly one roadmap phase.

### Tool Contract Alignment

- [x] **TOOL-01**: The `log_food` LLM-facing JSON schema and runtime Zod executor contract agree on whether `protein_sources` is required, so local tests and model tool calls enforce the same shape.
- [x] **TOOL-02**: Existing trusted-protein behavior remains protected after the schema alignment, including counted anchors, excluded trace sources, and conservative handling for uncertain inputs.
- [x] **TOOL-03**: Successful text and image meal logging still return committed meal receipts and `summaryOutcome` without reintroducing LLM-authored mutation facts.

### Meal Intent Fidelity

- [x] **INTENT-01**: User-explicit meal period intent such as `早餐`, `午餐`, `晚餐`, or `宵夜` is persisted as the meal period authority for new logs, even when the current clock hour would infer a different period.
- [x] **INTENT-02**: Current-day and historical meal rows expose period information from persisted structured facts instead of deriving display period only from `loggedAt` hour.
- [x] **INTENT-03**: Meal correction candidate scoring uses persisted meal period facts when available and does not let clock-derived period heuristics override explicit user intent.

### Correction Authority

- [x] **CORR-01**: User can change meal numeric fields through chat only when the current turn provides explicit numeric evidence or an approved backend-owned estimate/proposal.
- [x] **CORR-02**: User requests such as `蛋白質怪怪的，幫我改合理一點` do not mutate meal calories or macros directly; the backend returns deterministic clarification or proposal copy instead.
- [x] **CORR-03**: A rejected or clarification-required correction does not create a new meal revision, does not publish `daily_summary`, and does not show LLM-authored success-style text.

### Correction Targeting and Rendering

- [x] **TARGET-01**: Correction target resolution ranks current-turn, today, recency, explicit food label, and persisted meal-period evidence so ambiguous `那餐` requests surface the most relevant candidates without silently choosing unrelated historical meals.
- [x] **TARGET-02**: Multi-candidate correction clarification is backend-rendered with stable numbered options and concise target labels that do not echo the whole user correction request as a meal name.
- [ ] **TARGET-03**: `find_meals` and historical tool clarification results are carried as structured tool results through the orchestrator instead of reparsing serialized tool-message JSON.

### Proof and Release Gates

- [ ] **PROOF-01**: Targeted unit and integration tests cover tool schema alignment, explicit meal-period logging, numeric correction authority, target ranking, clarification rendering, and structured tool-result plumbing.
- [ ] **PROOF-02**: Any harness or artifact evidence for correction authority remains metadata-only and does not persist raw prompts, user text, assistant final text, tool raw payloads, image data, session material, or database snapshots.
- [ ] **PROOF-03**: Local closure runs `yarn tsc --noEmit` and `yarn release:check`, with no staging or main promotion.

## Future Requirements

Deferred to future releases. Tracked but not in current roadmap.

### Product Polish

- **POLISH-01**: User can track water intake from the primary logging flow.
- **POLISH-02**: User can browse monthly nutrition history beyond the current affected-date freshness scope.
- **POLISH-03**: User sees refined onboarding animation and broader motion polish.
- **POLISH-04**: User sees richer Markdown coaching copy and longer-form nutrition advice after data-authority paths are stable.

### Meal Editing

- **EDIT-01**: User can edit grouped meal items through a fuller Meal Edit UI, beyond the current focused correction and revision-protection paths.
- **EDIT-02**: User can manage item-level meal photos, crop identity, and replacement uploads.

### Observability

- **TRACE-01**: Maintainer can opt into user-flagged semantic failure capture after trigger, retention, storage, privacy, and access-control decisions are made.
- **TRACE-02**: Maintainer can review metadata-only production trace sampling and aggregate failure metrics after correction authority is stable.

## Out of Scope

Explicitly excluded from v2.4. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Staging or main promotion | Promotion requires explicit current-thread approval and belongs to ship workflow, not milestone initialization. |
| Water tracking | Useful product feature, but it does not close the current correction-authority and meal-intent integrity gap. |
| Monthly history | Product expansion; v2.4 focuses on mutation authority and correction correctness. |
| Onboarding animation and broad motion polish | Visual polish should wait until data-authority regressions are closed. |
| Richer general coaching copy | Tone and Markdown polish are valuable, but they should not precede correction safety. |
| Raw forensic payload capture | Conflicts with the metadata-only trace/privacy contract and is not needed to prove v2.4. |
| Client-only correction prevention | Server-side authority checks are required; client redaction or UI discouragement alone is insufficient. |
| Silent AI macro estimation commits | This is the core anti-feature v2.4 must eliminate unless backed by explicit user evidence or an approved backend-owned estimate/proposal. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| TOOL-01 | Phase 65 | Complete |
| TOOL-02 | Phase 65 | Complete |
| TOOL-03 | Phase 65 | Complete |
| INTENT-01 | Phase 65 | Complete |
| INTENT-02 | Phase 65 | Complete |
| INTENT-03 | Phase 65 | Complete |
| CORR-01 | Phase 66 | Complete |
| CORR-02 | Phase 66 | Complete |
| CORR-03 | Phase 66 | Complete |
| TARGET-01 | Phase 67 | Complete |
| TARGET-02 | Phase 67 | Complete |
| TARGET-03 | Phase 68 | Pending |
| PROOF-01 | Phase 68 | Pending |
| PROOF-02 | Phase 68 | Pending |
| PROOF-03 | Phase 68 | Pending |

**Coverage:**
- v2.4 requirements: 15 total
- Mapped to phases: 15
- Unmapped: 0

---
*Requirements defined: 2026-05-26*
*Last updated: 2026-05-26 after v2.4 milestone initialization*
