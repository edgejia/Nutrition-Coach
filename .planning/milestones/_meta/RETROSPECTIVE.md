# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.1 — 驗證性與穩定性強化

**Shipped:** 2026-04-12
**Phases:** 3 | **Plans:** 8 | **Sessions:** multiple GSD execution sessions

### What Was Built

- Deterministic route-level harnesses for text and image logging, including redacted JSON artifacts and named failure steps.
- Single-image meal logging reliability fixes that prevent obsolete hallucinated choice branches and preserve predictable fallback history.
- Boundary contract hardening for JSON, multipart, SSE, daily summary publishing, assistant persistence, stale SSE connections, and upload cleanup.

### What Worked

- The Phase 4 harness gave Phase 5 and Phase 6 a reusable verification substrate instead of relying on live-model observation.
- Cross-AI review during Phase 6 found concrete plan gaps before execution, especially around D-03/D-04 ordering and the full HARD-01 matrix.
- Keeping route-layer side effects out of the orchestrator made the final publish/persistence boundary easier to test.

### What Was Inefficient

- Validation documents lagged behind verification reports, leaving stale `draft` / pending metadata even after phase-level verification passed.
- Phase 4 review warnings were resolved later, but the original review artifact still reads `issues_found`.
- Some harness artifact files are tracked and get rewritten during verification runs, which creates extra worktree noise.

### Patterns Established

- Route-level HTTP/SSE harnesses should be the canonical proof for chat persistence and streaming contracts.
- Runtime upload paths should be isolated per harness scenario and verified through cleanup assertions.
- Daily summary publish side effects belong at route boundaries, not inside tool/orchestrator execution.

### Key Lessons

1. Verification artifacts need their own lifecycle. A phase can be functionally complete while validation/review metadata remains stale.
2. For streaming features, the relevant contract is not just payload correctness; write ordering and persistence invariants need direct tests.
3. Harnesses are more valuable when later phases can extend them with new boundary scenarios instead of creating one-off tests.

### Cost Observations

- Model mix: not tracked.
- Sessions: multiple.
- Notable: The milestone reduced future debugging cost by replacing live-observation risk with replayable harness scenarios.

---

## Milestone: v1.2 — 日常體驗與可觀測性強化

**Shipped:** 2026-04-19
**Phases:** 4 | **Plans:** 22 | **Sessions:** multiple planning, execution, and closeout sessions

### What Was Built

- Chat reopen behavior, image rendering, malformed goal-body handling, and docs/runtime alignment were polished without changing the core product loop.
- Structured, redacted observability and orchestrator lifecycle hooks were added so chat requests can be inspected without leaking raw user text or device metadata.
- Daily summaries were moved onto an explicit `TZ=Asia/Taipei` local-day contract with deterministic cross-midnight verification.
- The first controlled chat mutation path shipped for goal updates, using ToolContract validation, source-text business guards, deterministic receipts, and realtime sync.

### What Worked

- Keeping UI behavior contracts separate from implementation plans helped Phase 7 and Phase 8 land UX fixes without reopening architectural ambiguity.
- Centralizing config and observability early gave later phases a stable base for timezone handling, logging, and deploy/runtime consistency.
- Treating goal updates as a constrained mutation slice first proved the ToolContract + source-text-guard pattern before expanding AI-side permanent writes elsewhere.

### What Was Inefficient

- Verification and validation artifacts lagged behind shipped behavior, so closeout effort went into restoring missing proof rather than validating new code.
- Artifact-heavy harness changes created planning pressure because multiple generated evidence files wanted to move together.
- Milestone-planning drift had to be cleaned up after the fact in top-level docs instead of being updated during phase execution.

### Patterns Established

- Keep runtime config centralized in one backend read boundary instead of scattering env/default logic across modules.
- Use hook-based structured observability instead of ad hoc orchestrator logging when redaction and testability matter.
- Make summary date boundaries explicit in transport and client trust logic rather than relying on implicit "current day" assumptions.
- Introduce permanent chat mutations behind runtime validation, source-text authorization, and deterministic receipts.

### Key Lessons

1. Update verification artifacts and top-level planning docs in the same session as phase completion or closeout becomes reconstruction work.
2. When harness changes touch multiple artifact trees, split work into smaller scenario-owned plans with explicit file ownership.
3. A lightweight UI/design contract is enough for behavior-only frontend polish, but it still needs explicit statements about preserved hierarchy and failure behavior.

### Cost Observations

- Model mix: not tracked.
- Sessions: multiple.
- Notable: a meaningful share of milestone closeout time went to evidence restoration and planning-doc reconciliation, not feature implementation.

---

## Milestone: v1.3 — 歷史餐點修正與 Beta Ready 基線

**Shipped:** 2026-04-20
**Phases:** 6 | **Plans:** 17 | **Sessions:** multiple execution and release-closeout sessions

### What Was Built

- The app moved from append-only logging toward a beta-ready baseline with explicit SQLite migrations, durable asset storage, and same-origin Fastify shell serving.
- Meal persistence was rebuilt around canonical transactions and immutable revisions so edits and deletes target the original historical record safely.
- Historical meal correction in chat shipped with DB-backed candidate resolution, ambiguity-safe follow-ups, and original-record mutation behavior.
- Persisted image rendering, safe assistant Markdown, and a real deployed-domain shared beta smoke path were added to close the product baseline.

### What Worked

- Introducing the transaction/revision model before expanding historical correction gave the product a safer persistence boundary for later mutation work.
- Keeping the beta deployment model same-origin and volume-backed reduced infrastructure churn while the product surface was still moving quickly.
- Real deployed-domain smoke on the public beta domain provided better proof than localhost-only confidence for assets, refresh persistence, and mobile-sized rendering.

### What Was Inefficient

- Closeout evidence depended partly on deployed-domain smoke and archived milestone state, which made later reconstruction harder from a fresh worktree alone.
- Some advisory notes stayed open in milestone artifacts even though the shipped behavior was already accepted, which increased audit noise.
- This retrospective itself was never updated during v1.3 closeout, so milestone learnings were left implicit in roadmap/audit docs instead of being carried forward here.

### Patterns Established

- Put durable asset ownership behind a dedicated service boundary before UI/history features start depending on persisted media.
- Use immutable revisions plus explicit transaction history when user-facing edits and deletes must remain auditable.
- Resolve historical mutations from DB-backed candidates and explicit follow-up state rather than trusting loose conversational context alone.
- Treat real deployed-domain smoke as part of milestone proof whenever the feature depends on cookies, assets, or same-origin serving behavior.

### Key Lessons

1. Storage and mutation semantics should be stabilized before investing heavily in UI polish that depends on them.
2. Deployed-domain verification is a separate proof layer from local integration tests and needs to be scheduled as first-class closeout work.
3. Milestone learnings are easy to lose if they stay only in audit docs; the retrospective needs to be updated at archive time, not later.

### Cost Observations

- Model mix: not tracked.
- Sessions: multiple.
- Notable: the milestone delivered a large architectural step-up quickly, but the long-tail cost shifted toward release proof, audit clarity, and archive hygiene.

---

## Milestone: v1.4 — 記錄可信度與歷史日體驗

**Shipped:** 2026-04-21
**Phases:** 5 | **Plans:** 16 | **Sessions:** multiple execution and closeout sessions

### What Was Built

- Chat latest-status visibility now stays attached through upload, status-only, image-settle, and same-session re-entry flows.
- Summary and mutation flows now support explicit historical days with a unified day-snapshot read boundary and `affectedDate` transport.
- Trusted-protein semantics now drive persistence, assistant explanation copy, and deterministic evidence.
- Browser-visible auth moved onto cookie-backed guest sessions with same-browser resume, fail-closed tamper handling, and a blocking rebuild gate.

### What Worked

- Deterministic harness scenarios for `protein-trust` and `guest-session-hardening` turned subjective product trust problems into replayable evidence.
- Keeping the guest-session hardening slice layered on top of the existing durable `deviceId` owner avoided schema churn while still shrinking auth exposure.
- Phase-level summaries carried enough structured metadata (`requirements-completed`, one-liners, task counts) to support milestone audit and archive closeout.

### What Was Inefficient

- Planning-doc drift kept reopening after phase completion: `ROADMAP.md`, `PROJECT.md`, `STATE.md`, and `REQUIREMENTS.md` all needed manual reconciliation at close.
- Phase 19 shipped without a standalone `19-VERIFICATION.md`, which forced the artifact to be backfilled during milestone audit instead of during execute-phase.
- Phase 15 execution expanded well beyond the roadmap’s original two-plan description, but the roadmap never got updated to reflect the real eight-slice execution path.

### Patterns Established

- Use one shared snapshot boundary for historical-day reads and keep today-only live state separate from selected-day rendering.
- Put trust-policy semantics at the persistence boundary so UI and summary layers inherit the right meaning automatically.
- When hardening guest-first auth, pair one-shot automatic recovery with an explicit blocking rebuild gate rather than silent identity resets.

### Key Lessons

1. Verification artifacts must be treated as first-class deliverables inside each phase; if they are missing, milestone audit becomes cleanup work instead of verification work.
2. When a phase expands beyond its original roadmap plan count, update roadmap and project docs in the same session or the closeout audit will read stale scope.
3. Harness evidence plus targeted real-browser checks is the right mix for flows that depend on cookies, SSE, and perceived recovery behavior.

### Cost Observations

- Model mix: not tracked.
- Sessions: multiple.
- Notable: most late closeout time was spent reconciling planning artifacts, not code behavior.

---

## Milestone: v1.6 — 新手引導與核心互動體驗修復

**Shipped:** 2026-04-26
**Phases:** 4 | **Plans:** 13 | **Sessions:** multiple planning, execution, staging UAT, and closeout sessions

### What Was Built

- Onboarding now separates validation failures from transport failures, routes users back to the earliest invalid step, preserves prior answers, and keeps Step 6 retry copy transport-only.
- Home coach CTA moved from fake-dialogue prompts to a local two-stage direct-action model: intent chips, concrete task options, and auto-send chat handoff.
- Home, Chat, and Summary now share a mobile app-shell baseline with fixed structural regions and a primary middle scroller.
- Minimum redacted observability now emits Railway-visible events for onboarding, Home CTA, chat completion, REST goal updates, and SSE lifecycle without raw user text or identifiers.

### What Worked

- Discussing the four concerns up front produced a tight milestone shape: onboarding recovery first, CTA interaction second, mobile shell third, observability last.
- Small phase scopes kept fragile areas manageable, especially the chat/SSE route boundaries and mobile viewport behavior.
- Staging UAT caught issues that desktop/devtools could not prove, especially mobile browser chrome behavior and Railway log visibility.

### What Was Inefficient

- Phase 23 UAT evidence was functionally done earlier but left as `human_needed`, which created closeout audit noise.
- The GSD closeout CLI updated `STATE.md` with generic milestone metadata, requiring manual correction.
- `audit-open` still treats approved UAT artifacts as open items while phase directories are active, so archiving phases is necessary to get a clean closeout check.

### Patterns Established

- Validation recovery should be modeled as structured field/step issues, not as retryable submission failure.
- Home CTA prompts should be executable tasks selected by the user, not lines that pretend the app is speaking for the user.
- Mobile browser chrome needs real-device/staging verification; desktop emulation is only an early structural check.
- Redacted observability should use allowlisted event builders and captured-log tests before adding heavier dashboards.

### Key Lessons

1. Browser/mobile shell work should be validated on staging before declaring phase completion, because `visualViewport`, URL bars, and keyboard occlusion behave differently on real devices.
2. Human UAT artifacts need to be closed immediately after approval; otherwise milestone closeout becomes artifact archaeology.
3. Railway logs are enough for the minimum observability layer, but production promotion should still smoke-check tag/environment visibility separately.

### Cost Observations

- Model mix: not tracked.
- Sessions: multiple.
- Notable: The highest-cost work was not code volume, but iterating with real mobile/browser and staging log evidence.

---

## Milestone: v1.7 — Insight-Ready History Foundation

**Shipped:** 2026-04-29
**Phases:** 4 | **Plans:** 16 | **Sessions:** multiple discussion, planning, execution, validation, review, and closeout sessions

### What Was Built

- Resource-oriented history APIs now expose date-range meals and day snapshots through cookie-backed guest-session ownership, stable cursor pagination, safe nested DTOs, and Asia/Taipei day-boundary coverage.
- History search and nutrition filtering now operate on current active meal revisions, return safe parent meal context, and exclude deleted or superseded records.
- Deterministic trend aggregation now returns daily buckets, totals, averages, and empty/sparse/complete metadata without relying on LLM calculation.
- Query persistence was hardened with SQLite hot-path indexes, query-plan regression tests, real-SQLite integration coverage, and a documented SQLite-vs-PostgreSQL decision.
- The insight eval foundation now includes reusable fixtures, redacted trace artifacts, groundedness assertions, and deterministic sparse-data, prompt-injection, and medical-boundary scenarios.

### What Worked

- Splitting the milestone into history, search/trends, persistence hardening, and eval harness kept the backend foundation incremental and testable.
- Keeping ownership on signed guest-session cookies preserved the no-account product stance while removing raw `deviceId` from new history query behavior.
- Deterministic metrics and fixture-based harness work gave future AI insight features a safer substrate than asking the model to calculate from raw logs.

### What Was Inefficient

- `REQUIREMENTS.md` and `PROJECT.md` lagged behind Phase 30 completion, so closeout required manual reconciliation before archival.
- The generic `milestone.complete` command archived ROADMAP/REQUIREMENTS but did not collapse the active roadmap or move phase directories, so planning cleanup still needed manual handling.
- No standalone v1.7 milestone audit existed before closeout; phase-level validation, verification, review, and security artifacts carried the evidence instead.

### Patterns Established

- New history-facing APIs should resolve ownership through guest-session cookies only, then delegate date, cursor, projection, and aggregation behavior to query-oriented services.
- Trend and insight features should consume deterministic persisted metrics first; LLM work should explain grounded evidence, not compute source-of-truth totals.
- Harness artifacts for AI behavior should persist redacted traces only, with assertions that fail on invented meals, absent numbers, unsafe prompt following, or overconfident sparse-data claims.

### Key Lessons

1. Planning files must be updated immediately when the final phase closes; otherwise milestone archives can preserve stale requirement states.
2. Backend-only milestones still deserve staging validation when they add public API contracts or persistence indexes, because Railway environment, cookies, and SQLite volume behavior are part of the release surface.
3. A deterministic eval harness is the right next layer before productized AI insights; it makes safety and grounding testable before UI and live-model behavior are coupled to it.

### Cost Observations

- Model mix: not tracked.
- Sessions: multiple.
- Notable: Most late work concentrated in verification and archive hygiene rather than implementation, which suggests future closeout should include a required top-level planning-doc sync step before `$gsd-complete-milestone`.

---

## Milestone: v1.8 — UI refactor

**Shipped:** 2026-04-30
**Phases:** 7 | **Plans:** 29 | **Sessions:** multiple UI planning, execution, browser verification, audit closeout, and security verification sessions

### What Was Built

- The app UI was rebuilt around the Claude Design mock's sketch-style visual language: paper surfaces, black linework, warm accent, hand-drawn controls, and mobile-first density.
- Home became a dashboard-first status surface, while Chat became the only primary logging, question, correction, and progressive feedback surface.
- History moved to a weekly calorie-level strip, selected-day timeline, and read-only Day Detail snapshot model on top of the existing v1.7 APIs.
- Secondary flows were completed for Settings, Meal Edit, Onboarding, visual verification, and closeout proof.
- Phase 37 repaired audit traceability so the milestone closed with fresh command evidence, strict original-owner requirement mapping, and a 28/28 passed audit.

### What Worked

- Source-level UI contracts plus browser screenshots gave concrete proof for visual and navigation changes without relying on subjective inspection alone.
- Keeping v1.8 frontend-only avoided unnecessary churn in fragile chat/orchestrator and backend persistence boundaries.
- Adding Phase 37 as an explicit proof closeout phase turned audit gaps into concrete repair plans instead of leaving milestone archive blocked.

### What Was Inefficient

- Several phase summaries and verification files needed traceability backfill after implementation, especially for Phases 32, 33, 34, and 36.
- The milestone-close SDK still left living roadmap/project/state docs needing manual cleanup after archive generation.
- `audit-open` surfaced a Phase 35 UAT artifact as open despite `0 pending scenarios`, so closeout still required an explicit deferred-item note.

### Patterns Established

- Frontend milestones should pair visual contracts with browser artifact smoke, not just TypeScript/unit gates.
- Audit proof should stay with original implementation phases; closeout phases repair evidence but should not become product requirement owners.
- Mock-preserving UI refactors need explicit boundary requirements that prevent backend/API expansion while visual work proceeds.

### Key Lessons

1. Summary `requirements-completed` frontmatter should be filled during each phase, not during milestone audit repair.
2. Verification artifacts for UI phases should be created before the milestone audit, even when validation or screenshot artifacts already exist.
3. A dedicated proof closeout phase is useful when audit gaps are documentation/traceability gaps rather than product behavior gaps.

### Cost Observations

- Model mix: not tracked.
- Sessions: multiple.
- Notable: The highest closeout cost was artifact traceability repair, not new UI implementation.

---

## Milestone: v2.0 — Logging & Mobile Quality Foundation

**Shipped:** 2026-05-07
**Phases:** 6 | **Plans:** 40 | **Sessions:** multiple planning, execution, UAT, staging smoke, production smoke, and closeout sessions

### What Was Built

- Source-owned capability matrix coverage now keeps Sport UI actions aligned with supported client/backend contracts and honest future-scope placeholders.
- Mobile Chat stability was hardened through compact headers, IME-safe composer behavior, visual viewport synchronization, and graceful Stop handling.
- Meal image continuity now preserves meal-level image identity across Chat receipts, Today rows, History/Day Detail, Meal Edit, authorized asset fetches, and cleanup proof.
- Grouped meal transactions became the canonical logging path while single-item compatibility remains intact and grouped corrections route through Chat.
- Controlled validation failures now produce redacted diagnostics, and goals route semantics are clarified around canonical `PATCH` plus compatible `PUT`.
- History stale-while-revalidate behavior and Home dashboard count-up/reduced-motion behavior were repaired and verified through true-stack UAT.

### What Worked

- Treating live UAT gaps as product evidence, not just test failures, exposed stale cache eviction and visual-harness weaknesses that source contracts had missed.
- Deployed-domain smoke on both staging and production caught the real release surface: Railway environment, persistent assets, same-origin asset fetch, and browser session continuity.
- Requirement ownership stayed with implementation phases, while closeout only synchronized stale planning states and archived evidence.

### What Was Inefficient

- `REQUIREMENTS.md` still lagged Phase 44 and Phase 45 completion, so closeout had to reconcile already-verified requirements.
- Several debug sessions remained marked `diagnosed` / `investigating` after their fixes landed, causing avoidable `audit-open` noise.
- The active roadmap checkbox for Phase 47 was stale even though disk status and summaries were complete.

### Patterns Established

- True-stack browser UAT should be the final proof layer for UI state semantics that depend on real client, API, SQLite, SSE, and network timing.
- Successful logged-meal replies should be server-projected from normalized persisted state when a mutation commits.
- Future product polish should be captured as research/backlog rather than blocking milestone archive when shipped behavior is already verified.

### Key Lessons

1. Close debug sessions when the corresponding gap-fix summary is written; otherwise closeout becomes stale-state cleanup.
2. Requirements checkboxes and roadmap checkboxes should be synchronized during phase close, not at milestone archive time.
3. Deployed smoke is not redundant with local UAT; it verifies Railway volume, environment, same-origin asset serving, and production build behavior.

### Cost Observations

- Model mix: not tracked.
- Sessions: multiple.
- Notable: The most useful late work was true-stack UAT and deployed smoke; the least useful closeout cost was stale planning-state repair.

---

## Milestone: v2.2 — LLM Failure Localization Foundation

**Shipped:** 2026-05-15
**Phases:** 4 | **Plans:** 18 | **Sessions:** multiple planning, execution, audit, and closeout sessions

### What Was Built

- Server-generated `turnId` now correlates chat SSE frames, JSON responses, route logs, orchestrator child logs, terminal payloads, trace facts, and frontend fallback reference display.
- OpenAI provider failures now normalize into metadata-only provider errors with allowlisted status, request id, class/type/code, operation, model, and abort flags.
- Orchestrator hooks and route fallback handling now distinguish provider-caused `llm_error` fallbacks from true completed turns.
- Normal harness evidence moved to `llm-trace.v2` with metadata-only `llm_error`, `orchestrator_fallback`, `route_fallback`, and provider error counts.
- Deterministic integration and harness proof now covers auth-style provider failure localization, SSE start ordering, JSON parity, fallback/completion exclusivity, and generic Traditional Chinese fallback copy without persisting assistant text.

### What Worked

- Building the `turnId` spine first gave provider metadata, fallback events, trace facts, and frontend reference display one shared correlation contract.
- Keeping provider normalization inside the LLM provider boundary prevented OpenAI SDK details from leaking into orchestrator or route code.
- The dedicated auth-failure harness scenario produced better release evidence than ad hoc log inspection because it checked hook logs, route logs, terminal SSE payloads, trace facts, and artifact privacy together.

### What Was Inefficient

- The closeout SDK still generated flat v2.2 archive files and required manual normalization into the `milestones/v2.2/` directory layout.
- `audit-open` counted a resolved Phase 56 UAT file with 0 pending scenarios as an open artifact decision, so closeout needed an explicit acknowledged-deferred note.
- Generated harness artifact churn was already present in the worktree before closeout, which made planning-only staging require extra care.

### Patterns Established

- Treat user-visible failure references as display formats over full internal correlation ids, not as separate persisted identifiers.
- Classify provider failures from typed provider errors, not hook side effects or log inference.
- Persist release proof as metadata counts, booleans, and structured facts; keep user-visible fallback text checks in runtime memory only.

### Key Lessons

1. Hard LLM failures can be localized without raw forensic capture if correlation, provider metadata, fallback classification, and trace facts are designed together.
2. Closeout commands need archive-layout verification before later steps assume a directory shape.
3. Privacy tests should distinguish required safe provider metadata values from raw secret markers, or the scanner can conflict with the proof it is meant to validate.

### Cost Observations

- Model mix: not tracked.
- Sessions: multiple.
- Notable: Most late cost was proof hardening and archive hygiene; the most reusable asset is the deterministic provider-auth-failure localization scenario.

---

## Milestone: v2.3 — Authoritative Mutation Outcomes and Fresh Meal State

**Shipped:** 2026-05-20
**Phases:** 5 | **Plans:** 23 | **Sessions:** multiple planning, execution, audit, quick-fix, and closeout sessions

### What Was Built

- Backend-owned pending goal proposals and explicit goal update modes now prevent ambiguous confirmation text from mutating targets based on assistant prose.
- Meal log, update, delete, and direct meal route responses now separate committed mutation facts from summary freshness through `summaryOutcome`.
- Direct and chat meal edits/deletes now carry expected meal revision identity and reject stale receipts without mutation side effects.
- Realtime `daily_summary` events now use strict affected-date envelopes, same-day row refetch, and historical surface invalidation.
- Phase 64 closed local integrity proof with metadata-only artifact privacy checks, targeted unit/integration evidence, `yarn tsc --noEmit`, and `yarn release:check`.

### What Worked

- Keeping mutation authority at backend boundaries made the requirements crisp: model prose can propose or explain, but persistence depends on proposal state, explicit values, or revision preconditions.
- The `SummaryOutcome` contract gave chat and direct routes one shared vocabulary for post-commit summary degradation without weakening the committed receipt.
- The audit surfaced one real high-severity gap, CR-01, and the quick task closed it before archive without reopening the full milestone.
- Phase 64 evidence was strong enough to avoid adding a new harness scenario where unit/integration tests already proved the relevant boundaries.

### What Was Inefficient

- The generic archive command still produced flat v2.3 archive files, so closeout required manual roadmap and milestone summary cleanup.
- Codebase map refresh is awkward in Codex when the workflow expects automatic mapper subagents; the useful work was a focused inline refresh of affected docs.
- Some ignored planning artifacts had to be force-added intentionally, which increases closeout friction and makes staging review more manual.

### Patterns Established

- Treat goal and meal mutations as committed backend outcomes with deterministic renderer copy, not as model-authored success claims.
- Keep freshness as a separate post-commit concern; do not turn summary recompute or publish failures into failed mutation outcomes after persistence succeeds.
- Use revision preconditions as the server-side source of truth for stale receipt protection; client redaction and refresh are only UX support.
- Realtime summary events need affected-date semantics so the client can choose row refetch, historical invalidation, or no-op behavior.

### Key Lessons

1. Milestone audits should run before archive while there is still time to close concrete blockers like CR-01.
2. The most valuable proof for AI-integrity work is boundary-specific: route/service/orchestrator/store tests beat broad harness work when the failure mode is deterministic.
3. Closeout should normalize generic SDK archive output into the project’s expected archive shape before committing, or later docs will point at inconsistent paths.

### Cost Observations

- Model mix: not tracked.
- Sessions: multiple.
- Notable: The highest-signal late work was the audit-driven CR-01 fix and final release proof; the noisiest cost was archive/layout hygiene.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.1 | multiple | 3 | Moved from residual live-model verification risk to deterministic harness-first validation |
| v1.2 | multiple | 4 | Added structured observability, explicit local-day summary boundaries, and the first controlled chat mutation pattern |
| v1.3 | multiple | 6 | Replaced append-only logging with durable assets, transaction history, historical correction, and beta-ready deploy proof |
| v1.4 | multiple | 5 | Combined deterministic harnesses and targeted browser verification to close product-trust and guest-session auth slices |
| v1.6 | multiple | 4 | Repaired first-use and daily-use interaction seams, then added minimal redacted Railway observability |
| v1.7 | multiple | 4 | Built history/search/trends query contracts, persistence hardening, and deterministic insight eval foundation |
| v1.8 | multiple | 7 | Rebuilt the frontend UI/IA around the Claude Design sketch mock while preserving backend/API boundaries and closing audit proof gaps |
| v1.9 | multiple | 9 | Rebuilt production UI around the canonical NC-UI Sport kit and added source parity / visual proof closeout |
| v2.0 | multiple | 6 | Repaired post-Sport mobile/logging trust gaps, grouped semantics, image continuity, observability, and History/Home polish |
| v2.2 | multiple | 4 | Built metadata-only LLM hard-failure localization across frontend reference codes, route/orchestrator logs, provider metadata, fallback events, and trace evidence |
| v2.3 | multiple | 5 | Made backend-committed mutation outcomes authoritative across goals, meals, stale receipts, and SSE freshness |

### Cumulative Quality

| Milestone | Verification Signal | Coverage Focus |
|-----------|---------------------|----------------|
| v1.1 | `yarn test` 214 passing plus `boundary-contracts` harness PASS | Core text/image logging and HTTP/SSE boundary contracts |
| v1.2 | `yarn test` 310 passing plus `text-log`, `image-log`, `image-log-failure`, `daily-rollover` harness PASS | Observability flow, local-day rollover, and controlled goal mutation sync |
| v1.3 | milestone audit passed 15/15 requirements, 5/5 integrations, 6/6 flows, plus deployed-domain smoke | Durable assets, historical correction, persisted media UI, and shared beta baseline |
| v1.4 | `yarn test:integration`, `protein-trust`, `guest-session-hardening`, targeted unit suites | Chat continuity, historical-day reads/mutations, trusted protein, and guest-session auth |
| v1.6 | Phase 23-26 automated gates plus Phase 25 mobile staging UAT and Phase 26 Railway log UAT | Onboarding recovery, Home CTA direct actions, mobile shell stability, and redacted observability |
| v1.7 | Phase 27-30 TypeScript, targeted integration/unit suites, full `yarn test`, query-plan checks, `insight-eval`, validation/review/security artifacts | History APIs, current-revision search, deterministic trend metrics, SQLite query hardening, and grounded AI eval harness |
| v1.8 | Phase 31-37 source contracts, browser screenshot artifacts, full `yarn test`, 28/28 milestone audit, and Phase 37 security verification | Sketch UI fidelity, Chat-only logging, History timeline/Day Detail, Meal Edit, Onboarding, visual proof, and requirement traceability |
| v1.9 | Phase 38-43 source contracts, canonical-source ledgers, browser screenshot evidence, built UI smoke, and 26/26 milestone audit | Sport visual system, Home/Chat/History/secondary surfaces, canonical source parity, and visual closeout proof |
| v2.0 | 26/26 milestone audit, full release checks, true-stack Phase 49 UAT, grouped/image deterministic harnesses, staging smoke, and production smoke | Capability honesty, mobile Chat stability, image continuity, grouped logging semantics, redacted validation, History/Home polish, and deployed readiness |
| v2.2 | 20/20 milestone audit, TypeScript/unit/integration gates, `llm-trace.v2` harness artifacts, provider-auth-failure-localization proof, and release-check evidence | Metadata-only hard-failure localization, provider metadata privacy, route fallback classification, and turn correlation |
| v2.3 | 17/17 milestone audit, 5/5 phases, 10/10 integration checks, 5/5 E2E flows, 1117 passing Node tests, and `yarn release:check` PASS | Goal proposal authority, committed mutation outcomes, stale receipt rejection, SSE freshness, artifact privacy, and no-promotion local proof |

### Top Lessons

1. Keep validation docs in sync with verification reports before milestone archival.
2. Prefer route-level tests for behavior that crosses streaming, persistence, and summary-publish boundaries.
3. Milestone closeout is cheaper when PROJECT/ROADMAP/STATE traceability is updated during execution rather than reconstructed afterward.
4. For LLM observability, typed metadata contracts and deterministic harness artifacts beat raw transcript capture as the default proof layer.
