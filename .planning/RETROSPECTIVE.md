# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v2.6 — Meal Editing and History Usability

**Shipped:** 2026-06-03
**Phases:** 4 | **Plans:** 13 | **Sessions:** not separately tracked

### What Was Built

- Added Home today-row edit entry through the existing revision-safe Meal Edit flow for complete authoritative meals.
- Added grouped meal direct item add/update/delete through a strict server-owned `items[]` replacement contract.
- Added grouped Meal Edit item rows, validation, stale recovery, media-free item DTOs, authoritative refresh, and mobile ergonomics proof.
- Stabilized History cold week/date switching with snapshot-backed rows, stable target context, delayed pending copy, and synthetic mobile visual proof.
- Archived v2.6 with metadata-only milestone audit evidence, `yarn release:check`, and no staging/main promotion.

### What Worked

- Building on v2.5 DTO and receipt boundaries made the grouped edit feature much smaller: the route could reuse revision, summary, publish, and refresh paths instead of creating a parallel edit service.
- Red-first grouped PATCH tests clarified full-list replacement semantics before any production route changes.
- Source-contract tests were effective for UI affordance and History loading behavior that would be brittle to assert through full browser flows alone.
- The synthetic visual harness caught and then proved the fast pending-copy flicker closure without needing a deployed Railway smoke.

### What Was Inefficient

- The generic UAT audit treated `status: passed` as non-terminal; closeout needed a metadata-only status vocabulary fix to `complete`.
- The milestone archive command created roadmap/requirements/audit archives but left active roadmap/project wording to be reconciled manually.
- Because `.planning/**` is partly tracked and partly ignored, phase archival required explicit force-staging and careful separation from unrelated dirty ignore-file edits.

### Patterns Established

- Home edit entry should use the same payload and store boundary as History/Chat, with incomplete rows silently read-only instead of fake disabled edit affordances.
- Grouped direct edits are safest as full-list replacement until stable item identity and item media authority are explicitly designed.
- History aggregate trends can support display, but day snapshots must remain the authority for rows, edit activation, empty states, and detail activation.
- Human UAT files should use GSD terminal frontmatter values (`complete` or `resolved`) while keeping individual scenario `result: passed`.

### Key Lessons

1. Keep closeout scanner vocabularies aligned with phase artifacts before the archive step.
2. Treat ignored planning archives as deliberate closeout outputs; stage them explicitly when the milestone workflow requires durable history.
3. Visual proof is most useful when paired with source contracts: browser screenshots prove the visible symptom, source tests prove the state authority.
4. Local release proof remains separate from deployment; `release:check` passed, but staging/main promotion still needs its own current-thread approval.

### Post-Closeout Checks

- `yarn outdated --depth=0` showed patch/minor updates for React, Vite/Tailwind tooling, Zod, Zustand, and TypeScript, plus major updates for `@fastify/multipart`, `better-sqlite3`, `drizzle-orm`, `openai`, `@vitejs/plugin-react`, and TypeScript. No package update was applied during closeout.
- `yarn audit --groups dependencies --json` still reports the known high `drizzle-orm` advisory (`GHSA-gpj5-g38j-94v9`, patched in `0.45.2`). ADR 0004 already records the compatibility-review requirement before upgrading from `0.39.x`.
- No configured dead-code tool was found at repo root (`knip`, `ts-prune`, `depcheck`, or equivalent config). No dependency was added solely for this review.
- Harness health: Phase 77 visual harness passed during local proof, and obsolete/flaky harness cleanup did not block the archive.

### Cost Observations

- Model mix: not tracked in local artifacts.
- Sessions: not separately tracked.
- Notable: `yarn release:check` passed with 1,362 tests and frontend production build; visual harness evidence stayed metadata-only.

---

## Milestone: v2.5 — Structured LLM Boundaries and DTO Reliability

**Shipped:** 2026-06-02
**Phases:** 5 | **Plans:** 15 | **Sessions:** not separately tracked

### What Was Built

- Added provider-level structured object output with validator-owned trust, OpenAI runtime support, deterministic mock parity, and metadata-only failures.
- Moved onboarding target generation to strict structured output with service-owned Zod validation, retry/fallback classification, deterministic fallback persistence, and sanitized telemetry.
- Expanded authoritative DTO validation across client API, SSE, and store boundaries for summaries, goals, history, day snapshots, and chat terminal additions.
- Added atomic assistant reply, receipt identity, and structured mutation outcome persistence; compressed history now reads validated structured outcomes instead of receipt display strings.
- Added production guest-session secret boot validation, explicit local-only CORS behavior, centralized route fallback catch-field redaction, and an SSE keepalive cleanup found during closeout.

### What Worked

- Provider and service boundary tests gave clear proof for structured LLM output without switching the production orchestrator path.
- Client guard tests plus route/service projection tests covered malformed and valid DTO behavior without adding a second state boundary.
- Red-first receipt/history contracts made the atomic persistence boundary precise before production wiring.
- The closeout open-artifact audit caught a real SSE lifecycle issue from the sub-agent smoke report instead of letting it become archived noise.

### What Was Inefficient

- Validation artifacts for some phases kept draft/mapped status labels after final verification passed, which made closeout interpretation slower.
- Quick-task summaries without `status: complete` created generic closeout blockers even when their verification files were already passed.
- Release-proof test counts drifted between Phase 73 artifacts and had to be reconciled during closeout.

### Patterns Established

- Schema-backed LLM output should enter trusted state only after a caller-owned validator accepts the exact object shape.
- Client transport helpers should parse JSON as `unknown` and assert DTO shape before returning authoritative data.
- Receipt identity is only safe to expose when assistant reply, receipt row, and structured mutation fact persistence have succeeded together.
- GSD quick tasks need machine-readable completion status in summary frontmatter, not just narrative verification.

### Key Lessons

1. Treat completion metadata as part of implementation; missing `status: complete` can block milestone archive even when behavior is done.
2. Keep release proof counts synchronized with the most recent closeout gate.
3. Read sub-agent smoke findings as possible product issues, not just workflow results.
4. Structured facts and display copy should stay separate all the way through compressed history.

### Cost Observations

- Model mix: not tracked in local artifacts.
- Sessions: not separately tracked.
- Notable: targeted local proof plus one final `yarn release:check` was enough for closeout; no Railway smoke or branch promotion was authorized.

---

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
| v2.5 | not tracked | 5 | Stabilized structured LLM output, DTO guards, receipt/history persistence, and release-security boundaries. |
| v2.6 | not tracked | 4 | Expanded meal editing and stabilized History loading on top of structured state boundaries. |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|---|---:|---|---:|
| v2.3 | release gate passed | targeted authority and freshness coverage | 0 |
| v2.4 | 1,245 passing in `yarn release:check` | targeted authority, clarification, JSON/SSE, and metadata-only evidence | 0 |
| v2.5 | 1,330 passing in `yarn release:check` | structured LLM output, DTO validation, receipt/history atomicity, release-security, and SSE cleanup | 0 |
| v2.6 | 1,362 passing in `yarn release:check` | Home edit, grouped CRUD, grouped UI, History loading, visual proof, and metadata-only archive evidence | 0 |

### Top Lessons (Verified Across Milestones)

1. Backend-rendered receipts and clarification copy reduce model-authority ambiguity at the exact points where persisted facts can change.
2. Metadata-only evidence is enough for release proof when tests assert the observable behavior and privacy boundary directly.
3. Promotion to `staging` or `main` should remain a separate workflow even when local milestone gates are green.
4. Completion status frontmatter matters; narrative summaries alone are not enough for closeout automation.
