# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v2.4 — Correction Authority and Meal Intent Fidelity

**Shipped:** 2026-05-30
**Phases:** 4 | **Plans:** 24 | **Sessions:** not separately tracked

### What Was Built

- Persisted explicit meal-period intent as nullable structured authority and projected it through meal APIs, chat receipts, client DTOs, edit payloads, UI labels, and correction candidates.
- Added backend-owned numeric correction authority so chat meal macro/calorie edits require current-turn numeric evidence or a revision-scoped backend proposal.
- Rebuilt correction target resolution around evidence tiers, exact rendered options, stale-selection recovery, and backend-rendered clarification copy.
- Moved correction and historical clarification plumbing to structured `ToolExecutionResult.clarification` facts with JSON/SSE route persistence proof.
- Closed the milestone with metadata-only audit evidence and a fresh `yarn release:check` pass.

### What Worked

- Red-first plans for Phase 67 and 68 gave precise contracts before changing resolver and orchestrator behavior.
- Route-level tests with real Fastify, real SQLite, and mock LLM providers were enough to prove no-mutation/no-publish/no-second-model boundaries without adding harness artifacts.
- Keeping prompts support-only and moving authority into services/tool adapters made the safety boundary reviewable.

### What Was Inefficient

- Several validation strategy files stayed in draft/pending state after their phase verification passed, creating closeout drift that had to be normalized later.
- The generic codebase drift check warned because the codebase map lacked a recorded mapping commit, requiring a closeout refresh.
- `server/orchestrator/tools.ts` and `server/services/meal-correction.ts` absorbed more authority logic and are now large enough to slow review.

### Patterns Established

- Explicit user intent should become persisted structured authority only when source-text evidence is direct and unambiguous.
- Vague correction requests should fail closed into renderer-owned guidance or proposal state, never direct model-estimated writes.
- Terminal clarification facts should travel as typed tool results and persist through the same route finalization path as normal assistant replies.
- Release evidence for AI authority work can stay metadata-only when tests assert response shape, persisted history, publish silence, and model-call consumption.

### Key Lessons

1. Treat validation bookkeeping as part of phase completion, not closeout cleanup; stale `pending` rows make the archive less trustworthy.
2. Large shared tool registries should get a split plan before the next correction feature adds more adapters.
3. If a route has both JSON and SSE terminal behavior, prove persistence and side effects on both transports in the same phase.
4. Keep local closeout and promotion language separate; green `release:check` is not staging or production authorization.

### Cost Observations

- Model mix: not tracked in local artifacts.
- Sessions: not separately tracked.
- Notable: targeted unit/integration proof avoided creating new harness evidence while still closing the false-pass risk.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|---|---:|---:|---|
| v2.3 | not tracked | 5 | Made mutation facts authoritative and separated local release proof from promotion. |
| v2.4 | not tracked | 4 | Extended backend-owned authority to correction safety and structured clarification. |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|---|---:|---|---:|
| v2.3 | release gate passed | targeted authority and freshness coverage | 0 |
| v2.4 | 1,245 passing in `yarn release:check` | targeted authority, clarification, JSON/SSE, and metadata-only evidence | 0 |

### Top Lessons (Verified Across Milestones)

1. Backend-rendered receipts and clarification copy reduce model-authority ambiguity at the exact points where persisted facts can change.
2. Metadata-only evidence is enough for release proof when tests assert the observable behavior and privacy boundary directly.
3. Promotion to `staging` or `main` should remain a separate workflow even when local milestone gates are green.
