# Requirements: Nutrition Coach v2.3 Authoritative Mutation Outcomes and Fresh Meal State

**Defined:** 2026-05-17
**Core Value:** 讓記錄比不記錄還要容易--說一句話、傳一張照片，AI 搞定剩下的。

## v2.3 Requirements

Requirements for the v2.3 P1 data-integrity milestone. Each requirement must map to exactly one roadmap phase.

### Goal Authority

- [x] **GOAL-01**: User can receive a concrete goal-change proposal without mutating daily targets until the backend persists a structured pending proposal.
- [x] **GOAL-02**: User confirmation text such as `好` can update goals only when it confirms a valid backend proposal id or includes explicit current-turn numeric target values.
- [x] **GOAL-03**: User cannot apply expired, consumed, mismatched, or missing goal proposals; the backend returns deterministic Traditional Chinese guidance instead.
- [x] **GOAL-04**: User sees deterministic backend failure copy after `update_goals` validation or guard rejection, with no target persistence, no `goals_update`, and no LLM-authored success-style text.

### Mutation Outcomes

- [x] **MUT-01**: User receives a committed log receipt when meal logging persists even if daily summary recompute or publish fails.
- [x] **MUT-02**: User receives a committed update receipt when meal editing persists even if daily summary recompute or publish fails.
- [x] **MUT-03**: User receives a committed delete receipt when meal deletion persists even if daily summary recompute or publish fails.
- [x] **MUT-04**: Direct meal `PATCH` / `DELETE` routes distinguish committed mutation facts from degraded or failed summary refresh status.

### Meal Freshness

- [x] **FRESH-01**: User-facing meal and chat receipt DTOs carry current meal revision identity for edit-capable receipts.
- [ ] **FRESH-02**: User cannot overwrite newer meal facts from an older chat receipt; stale expected revisions are rejected without mutation.
- [ ] **FRESH-03**: User sees deterministic stale-record guidance and the client refreshes or invalidates affected meal rows after a stale receipt conflict.

### Realtime Consistency

- [ ] **REAL-01**: Same-day `daily_summary` SSE events include enough freshness metadata for clients to refresh or invalidate meal rows.
- [ ] **REAL-02**: Home/Summary state cannot accept newer daily totals while leaving visible same-day meal rows stale without marking or refreshing them.
- [ ] **REAL-03**: Malformed, stale-date, or historical `daily_summary` events preserve existing date guards and do not overwrite current-day rows incorrectly.

### Proof & Privacy

- [ ] **PROOF-01**: Targeted unit and integration tests prove goal proposal authority, deterministic failed goal copy, summary-failure committed outcomes, stale receipt rejection, and SSE meal-row freshness.
- [ ] **PROOF-02**: Integrity proof remains metadata-only and does not persist raw prompts, user text, assistant final text, tool payloads, provider bodies, image data, session material, or database snapshots.
- [ ] **PROOF-03**: Local closure runs `yarn tsc --noEmit` and `yarn release:check`, with no staging or main promotion.

## Future Requirements

Deferred to future releases. Tracked but not in current roadmap.

### Product Polish

- **POLISH-01**: User can track water intake from the primary logging flow.
- **POLISH-02**: User can browse monthly nutrition history beyond the current v2.3 freshness scope.
- **POLISH-03**: User sees refined onboarding animation and motion polish after P1 integrity issues are closed.

### Forensics and Metrics

- **TRACE-01**: Maintainer can opt into user-flagged semantic failure capture after trigger, retention, storage, privacy, and access-control decisions are made.
- **TRACE-02**: Maintainer can use local-only raw debugger tooling under the existing default-off raw debugger decision.
- **TRACE-03**: Maintainer can review metadata-only production trace sampling and aggregate failure metrics after integrity fixes ship.

## Out of Scope

Explicitly excluded from v2.3. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Staging or main promotion | Promotion requires explicit current-thread approval and belongs to ship workflow, not milestone initialization. |
| Water tracking | Product-polish backlog item; not required to close P1 data-integrity bugs. |
| Monthly history | Product-polish backlog item; v2.3 only protects current meal-state freshness and affected-date invalidation. |
| Onboarding animation | Visual/motion polish; unrelated to mutation authority or stale write prevention. |
| Motion system | Visual polish; deferred until integrity work is complete. |
| Broad visual polish | Only deterministic success/failure/stale copy required for integrity closure is in scope. |
| Raw forensic payload capture | Conflicts with metadata-only trace/privacy contract and is not needed for v2.3. |
| Inferring goal confirmation from assistant prose | This is the core anti-feature v2.3 must eliminate. |
| Client-only stale receipt protection | Server-side expected revision checks are required; client redaction alone is insufficient. |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| GOAL-01 | Phase 60 | Complete |
| GOAL-02 | Phase 60 | Complete |
| GOAL-03 | Phase 60 | Complete |
| GOAL-04 | Phase 60 | Complete |
| MUT-01 | Phase 61 | Complete |
| MUT-02 | Phase 61 | Complete |
| MUT-03 | Phase 61 | Complete |
| MUT-04 | Phase 61 | Complete |
| FRESH-01 | Phase 62 | Complete |
| FRESH-02 | Phase 62 | Pending |
| FRESH-03 | Phase 62 | Pending |
| REAL-01 | Phase 63 | Pending |
| REAL-02 | Phase 63 | Pending |
| REAL-03 | Phase 63 | Pending |
| PROOF-01 | Phase 64 | Pending |
| PROOF-02 | Phase 64 | Pending |
| PROOF-03 | Phase 64 | Pending |

**Coverage:**
- v2.3 requirements: 17 total
- Mapped to phases: 17
- Unmapped: 0

---
*Requirements defined: 2026-05-17*
*Last updated: 2026-05-17 after v2.3 roadmap creation*
