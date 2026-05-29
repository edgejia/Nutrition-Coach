# Project Milestones: Nutrition Coach

## v2.4 Correction Authority and Meal Intent Fidelity (Shipped: 2026-05-30)

**Delivered:** Closed correction-authority and meal-intent fidelity gaps by making explicit meal-period text structured authority, requiring explicit numeric evidence or backend-owned proposals for meal macro edits, and routing ambiguous correction/historical clarification through backend-rendered structured tool results.

**Phases completed:** 4 phases, 24 plans, 48 tasks

**Key accomplishments:**

- Nullable explicit meal-period authority now exists in SQLite, transaction services, and food logging projections without changing loggedAt semantics.
- Additive nullable meal_period migration now has an enum CHECK without default, backfill, or meal_transactions table rebuild.
- log_food now treats protein_sources as optional evidence and persists explicit source-text mealPeriod authority without trusting raw model meal_period.
- Current-day, day snapshot, and history meal-row APIs now expose persisted explicit mealPeriod authority without inferring public values from loggedAt.
- Chat JSON, SSE terminal, and restored history logged-meal receipts now carry explicit backend mealPeriod authority without inventing inferred period fields.
- Client meal DTOs now carry explicit backend mealPeriod authority through transport and edit state while rejecting invalid or inferred period values.
- Meal-row UI labels now display explicit mealPeriod authority before legacy loggedAt inference across Home, History, Day Detail, and Summary Detail.
- Correction candidates now expose effective meal period facts with explicit/inferred provenance for the Phase 67 scorer handoff.
- Current-turn meal numeric authority helper with explicit evidence extraction, relative correction classification, and nested items[] bypass proof
- Turn-state-backed meal numeric correction proposals with renderer-owned before/after approval and no-update guidance copy
- Tool-boundary meal numeric authority with persisted-fact proposal previews and renderer-owned blocked/proposal copy
- Pre-model proposal routing for backend-owned meal numeric approvals, cancellation, stale revision rejection, and cross-kind ambiguity
- Red-first Node test coverage now pins correction target ranking and backend-rendered clarification behavior before Phase 67 production changes.
- Meal correction targeting now resolves by explicit evidence tiers and persists only the exact numbered options shown to the user.
- `find_meals` ambiguity now terminates with backend-rendered numbered correction target copy instead of model-authored clarification text.
- Correction target clarification now terminates through backend renderer copy, with prompt guidance supporting backend-owned target selection and numeric authority.
- Phase 67 correction targeting and backend-rendered clarification proof is recorded as green for local TypeScript, targeted, unit, and integration gates.
- TARGET-01 gap closure for explicit historical dates and unmatched Latin food-label evidence in meal correction targeting
- Typed clarification fact and terminal renderer red tests now lock the Phase 68 implementation target without changing production code.
- Typed clarification facts now carry meal-target and historical ambiguity results through executeTool with renderer-owned terminal copy.
- JSON and SSE route tests now prove terminal historical clarification replies persist without meal, summary, or publish side effects.
- Phase 68 now has a metadata-only verification record tying structured tool-result coverage to green local release gates without any promotion action.

**Close notes:** Milestone audit passed at 15/15 requirements, 4/4 phases, 8/8 integration checks, and 5/5 E2E flows. `yarn release:check` passed during closeout with TypeScript, 1,245 tests, and Vite production build. No push, deploy, Railway smoke, staging promotion, or main promotion was performed.

**Known advisory debt:**

- Phase 67 invalid-selection guidance can drop the service's valid-number wording in one same-date renderer path, though stable numbered options still render.
- One Phase 67 orchestrator test helper can false-pass if uncertainty copy disappears.
- `server/orchestrator/tools.ts` and `server/services/meal-correction.ts` are large authority modules and should be split in a future targeted refactor.

**Archives:**

- Roadmap: `.planning/milestones/v2.4-ROADMAP.md`
- Requirements: `.planning/milestones/v2.4-REQUIREMENTS.md`
- Audit: `.planning/milestones/v2.4-MILESTONE-AUDIT.md`
- Phases: `.planning/milestones/v2.4-phases/`

---

## v2.3 Authoritative Mutation Outcomes and Fresh Meal State (Shipped: 2026-05-20)

**Delivered:** Made backend-committed mutation facts authoritative across goal updates, meal log/update/delete receipts, stale chat receipt edits, and `daily_summary` SSE freshness, with metadata-only local release proof and no staging/main promotion.

**Phases completed:** 5 phases, 23 plans, 51 tasks

**Close notes:** v2.3 milestone audit finished with `tech_debt`, not blockers: 17/17 requirements satisfied, 5/5 phases verified, 10/10 integration checks wired, 5/5 E2E flows complete, and Phase 60-64 Nyquist coverage compliant. CR-01 was closed by quick task `260520-tqd`. WR-01 remains accepted advisory debt for v2.4 planning: `log_food` JSON schema still marks `protein_sources` as required while the executor accepts it as optional. `yarn release:check` passed during closeout. No staging or production promotion was performed.

**Key accomplishments:**

- Added backend-owned goal proposal state and explicit goal update modes so ambiguous confirmation text cannot mutate targets from assistant prose alone.
- Added deterministic backend-rendered proposal, rejection, validation, cancel, and committed goal update copy.
- Separated committed meal mutation facts from summary freshness with the shared `SummaryOutcome` contract across chat and direct meal routes.
- Added server-side expected meal revision checks so stale chat receipts and direct edit/delete writes fail closed without side effects.
- Migrated realtime summary updates to strict `{ summary, affectedDate, source }` envelopes with same-day row refetch and historical affected-date invalidation.
- Closed local release proof with metadata-only artifact privacy checks, targeted unit/integration evidence, `yarn tsc --noEmit`, and `yarn release:check`.

**Archives:**

- Roadmap: `.planning/milestones/v2.3-ROADMAP.md`
- Requirements: `.planning/milestones/v2.3-REQUIREMENTS.md`
- Audit: `.planning/milestones/v2.3-MILESTONE-AUDIT.md`
- Phases: `.planning/milestones/v2.3-phases/`

---

## v2.2 LLM Failure Localization Foundation (Shipped: 2026-05-15)

**Delivered:** Built a metadata-only hard-failure localization path so users can report a short fallback reference code and maintainers can trace that turn through SSE/JSON payloads, logs, provider metadata, structured fallback events, and `llm-trace.v2` evidence without capturing raw prompt, user, tool, provider, image, session, or assistant text payloads.

**Phases completed:** 4 phases, 18 plans, 36 tasks

**Close notes:** `audit-open` reported one Phase 56 UAT item, but `56-UAT.md` is `resolved` with `0` pending scenarios; acknowledged at close and recorded in `.planning/STATE.md` Deferred Items. v2.2 milestone audit passed 20/20 requirements, 4/4 phases, 4/4 integration checks, 4/4 E2E flows, and 4/4 Nyquist validation coverage. Phase 58 retained two non-blocking proof-hardening warnings as accepted tech debt: expanding user-visible auth-detail denylist assertions and hardening failure-artifact persistence for forbidden-snippet matches. `58-VERIFICATION.md` records `yarn release:check` as passed; no staging or production promotion was performed during closeout.

**Key accomplishments:**

- Added server-generated `turnId` correlation across SSE, JSON, route logs, orchestrator logs, terminal payloads, trace facts, and frontend fallback reference display.
- Normalized OpenAI provider failures into safe metadata-only `LLMProviderError` facts and propagated them through structured orchestrator hooks and route-readable fallback context.
- Split true chat completions from hard fallback paths with typed `chat_turn_completed`, `chat_route_fallback`, sanitized route catch facts, and route/trace exclusivity coverage.
- Bumped normal harness evidence to `llm-trace.v2` with metadata-only `llm_error`, `orchestrator_fallback`, `route_fallback`, provider error counts, and raw-debugger boundary documentation.
- Added deterministic JSON and SSE auth-style provider failure proof, including provider hook logs, route fallback logs, `turnId` correlation, generic Traditional Chinese fallback copy, and metadata-only artifacts.
- Closed Phase 58 advisory gaps with final release evidence mapping VERIFY-01 through VERIFY-04 to commands, artifact paths, and exact localization facts.

**Archives:**

- Roadmap: `.planning/milestones/v2.2/ROADMAP.md`
- Requirements: `.planning/milestones/v2.2/REQUIREMENTS.md`
- Audit: `.planning/milestones/v2.2/MILESTONE-AUDIT.md`
- Phases: `.planning/milestones/v2.2/phases/`

---

## v2.1 AI Trust Infrastructure & Logging Reliability (Shipped: 2026-05-12)

**Delivered:** Made chat/logging AI behavior traceable, redacted, regression-tested, and renderer-owned for successful mutation receipts, then closed the most visible product trust copy issues with staging and production release proof.

**Phases completed:** 5 phases, 25 plans, 25 plan summaries

**Close notes:** `audit-open` reports one Phase 51 UAT item, but the UAT file is `status: passed` with `open_scenario_count: 0`, 6/6 tests passed, and `[none]` under gaps; treated as a scanner false-positive, not an open milestone gap. v2.1 milestone audit passed 28/28 requirements. Phase 50-54 review reports are clean after the Phase 54 warning fix, and security reports close all Phase 50 and Phase 54 threats. `yarn release:check` passed before staging/main promotion, and Railway production deployment `3377daaf-820d-4954-9085-8c822ba43d28` passed post-main smoke on commit `45510ab`.

**Key accomplishments:**

- Added active prompt version and stable section IDs for chat/logging LLM workflows.
- Generalized redacted `llm-trace.json` evidence for chat/logging workflows, including sequence, source, shape, latency, round count, and tool count.
- Added reusable behavior assertions and an 8-case behavior matrix for high-risk AI trust regressions.
- Replaced model-passthrough successful mutation facts with deterministic renderer receipts sourced from committed mutation effects.
- Removed visible implementation language from the focused onboarding, Chat receipt, Meal Edit, History, and Day Detail trust-copy surfaces.
- Captured release proof through local `yarn release:check`, Railway staging smoke, main promotion, Railway production deploy, static asset fingerprinting, production text/image smoke, asset fetch, refresh persistence, and mobile checks.

**Archives:**

- Roadmap: `.planning/milestones/v2.1/ROADMAP.md`
- Requirements: `.planning/milestones/v2.1/REQUIREMENTS.md`
- Audit: `.planning/milestones/v2.1/MILESTONE-AUDIT.md`
- Closeout notes: `.planning/milestones/v2.1/MILESTONE-CLOSEOUT-NOTES.md`
- Post-closeout notes: `.planning/milestones/v2.1/POST-CLOSEOUT.md`
- Phases: `.planning/milestones/v2.1/phases/`

---

## v2.0 Logging & Mobile Quality Foundation (Shipped: 2026-05-07)

**Delivered:** Repaired the post-Sport-refactor mobile and logging quality gaps so meal logging is stable, image-backed records remain trustworthy across surfaces, grouped meal semantics are canonical, validation failures are diagnosable without sensitive leakage, and History/Home polish has true-stack UAT proof.

**Phases completed:** 6 phases, 40 plans, 40 plan summaries

**Close notes:** `audit-open` is clear. v2.0 milestone audit passed 26/26 requirements. `yarn release:check` passed before staging/main promotion, and Railway staging plus production smoke passed on real deployed domains.

**Key accomplishments:**

- Aligned Sport UI affordances with source-owned capability matrix docs and source-contract checks.
- Hardened mobile Chat shell behavior, compact header, IME-safe composer behavior, visual viewport handling, and graceful Stop lifecycle.
- Preserved meal-level image identity across Chat receipts, Today rows, History/Day Detail, Meal Edit, authorized asset fetches, and upload cleanup.
- Made grouped meal transactions the canonical logging path while preserving single-item compatibility and routing grouped corrections through Chat.
- Projected successful meal mutation replies from normalized server state and repaired concise Traditional Chinese coaching copy.
- Added redacted validation observability and clarified canonical `PATCH` plus compatible `PUT` goals update behavior.
- Repaired History stale-while-revalidate behavior and Home dashboard count-up/reduced-motion contracts, then verified Phase 49 UAT with real client/API/SQLite data.

**Archives:**

- Roadmap: `.planning/milestones/v2.0/ROADMAP.md`
- Requirements: `.planning/milestones/v2.0/REQUIREMENTS.md`
- Audit: `.planning/milestones/v2.0/MILESTONE-AUDIT.md`
- Phases: `.planning/milestones/v2.0/phases/`

---

## v1.9 Sport UI refactor (Shipped: 2026-05-04)

**Delivered:** Replaced the v1.8 sketch-paper frontend with the canonical NC-UI Sport dark performance visual system while preserving Nutrition Coach backend, data, guest-session, SSE, and chat-first workflow contracts.

**Phases completed:** 9 phases, 29 plans, 29 plan summaries

**Known close notes:** `audit-open` reported stale human-needed flags for Phase 40 and Phase 42.7. Phase 40 UAT had already passed with 0 pending scenarios, and Phase 42.7 final visual review was superseded by Phase 43 closeout approval.

**Key accomplishments:**

- Built the Sport visual foundation: tokens, font roles, typed primitives, inline icons, app shell, and mobile safe-area contracts.
- Rebuilt Home, Chat, History, Day Detail, Meal Edit, Settings, onboarding, and guest recovery in the Sport visual language while preserving production data and mutation contracts.
- Kept Chat as the only primary meal logging entrypoint, including SSE progress, image upload, logged-meal receipts, and Meal Edit handoff.
- Added canonical Sport source parity ledgers for Home and remaining surfaces, documenting every production adapter.
- Captured real browser screenshot evidence for canonical and production Sport surfaces, with placeholder evidence explicitly rejected.
- Closed the milestone with Phase 43 evidence integrity, source contracts, visual review contract, built UI smoke, and `yarn release:check`.

**Archives:**

- Roadmap: `.planning/milestones/v1.9/ROADMAP.md`
- Requirements: `.planning/milestones/v1.9/REQUIREMENTS.md`
- Audit: `.planning/milestones/v1.9/MILESTONE-AUDIT.md`
- Phases: `.planning/milestones/v1.9/phases/`

---

## v1.0 : AI 串流輸出 (Backfilled: 2026-04-30)

**Note:** Synthesized from archive snapshot by `/gsd-health --backfill`. Original completion date unknown.

---

## v1.8 UI refactor (Shipped: 2026-04-30)

**Phases completed:** 7 phases, 29 plans, 34 tasks

**Known deferred items at close:** 1 acknowledged artifact item. See `.planning/STATE.md` Deferred Items.

**Key accomplishments:**

- Canonical meal update route with typed client helper and Zustand Meal Edit payload/mutation contracts
- Sketch-styled Meal Edit secondary screen with canonical save/delete helpers and affected-date refresh wiring
- Existing onboarding flow restyled with Phase 31 sketch surfaces while preserving validation recovery, field-edit recovery, transport-only retry, and submit semantics.
- Deterministic Playwright screenshot smoke covering the full v1.8 screen set with PASS visual notes and source-level coverage contract.
- Phase 35 validation now records focused contract gates, full local repo gates, and committed visual artifact evidence as Nyquist-compliant closeout proof.
- Neutral current-day Chat review rows now open Meal Edit with a complete chat-origin payload while logged-meal bubbles stay action-free.
- History now uses target-based calorie water levels and a read-only meal timeline instead of record-presence markers and plain meal cards.
- Day Detail now presents the History timeline destination as a read-only nutrition snapshot, with browser screenshot evidence for the full Phase 36 History flow.
- Fresh targeted command evidence for reopened v1.8 Home, Settings, Chat, Streaming, History, Day Detail, and boundary requirements.
- Phase 32 and Phase 33 summaries now expose passed requirement IDs through `requirements-completed` frontmatter for strict milestone audit cross-checks.
- History orphan requirements now have audit-readable Phase 34 and Phase 36 verification files backed by fresh Phase 37 command evidence.
- v1.8 audit proof now maps every reopened requirement to repaired artifacts, original owners, fresh evidence, and a passed 28/28 milestone audit rerun.

---

## v1.7 Insight-Ready History Foundation (Shipped: 2026-04-29)

**Phases completed:** 4 phases, 16 plans, 32 tasks

**Key accomplishments:**

- Executable RED contracts for history meal range reads, cursor pagination, day snapshots, structured query errors, and guest-session isolation
- Current-revision history query service with safe nested meal DTOs, Asia/Taipei date bounds, and opaque cursor pagination
- Cookie-backed /api/history routes wired through Fastify app composition with strict query errors and stable cursor ordering
- Green history API verification with Nyquist validation sign-off and source coverage audit for Phase 27
- Failing-first GET /api/history/search contracts for item-name matching, session ownership, current revisions, and flat meal-level nutrition bounds
- Cookie-backed history search over current active item revisions with safe parent meal context and meal-level nutrition bounds
- Failing-first `/api/history/trends` contracts for deterministic daily buckets, range totals, averages, completeness metadata, and session-owned current active revisions
- Cookie-backed history trends with deterministic current-revision buckets, totals, averages, and Phase 28 source coverage sign-off
- Failing-first SQLite query-plan contracts for history meals pagination, history search, and history trends
- Additive SQLite composite index and migration with green query-plan contracts
- Gap-driven QRY-03 integration coverage with explicit search asset projection proof
- SQLite v1.7 decision note plus full local validation for QRY-02, QRY-03, and QRY-04
- Reusable insight fixture corpus with typed loader, deterministic metrics, and real-app seeding proof
- Redacted insight trace artifact contract for deterministic eval evidence
- Deterministic groundedness and safety assertion helpers for insight eval outputs
- Offline `insight-eval` harness scenario covering fixtures, redacted traces, grounded assertions, and safety cases

---

## v1.6 新手引導與核心互動體驗修復 (Shipped: 2026-04-26)

**Delivered:** First-use recovery, direct-action home CTA, mobile shell stability, and minimum redacted Railway observability for the repaired flows.

**Phases completed:** 4 phases, 13 plans, 24 tasks

**Key accomplishments:**

- Structured `/api/device` validation contract with unified Step 1 goal handling and multi-step backend error coverage
- Pure client onboarding validators with canonical stale-error clearing and typed `submitIntake()` validation parsing
- Pure onboarding recovery state helpers for grouped step issues and canonical field-specific clearing
- Hydrated onboarding step components with prop-driven validation copy and remount-safe local state
- Onboarding stepper recovery flow with pre-submit gating, transport-only Step 6, and presentation-level UI proof
- Typed intent/options CTA model with accessible local expansion and second-layer-only chat handoff
- Task-oriented chat recovery copy with regression coverage and final unit/build gates
- Home, Chat, and Summary now share a dynamic mobile shell with fixed bars and dedicated content scrollers.
- Static shell contract tests now lock Home, Chat, and Summary scroller ownership, with a three-check mobile UAT artifact for browser URL-bar perception.
- Typed Railway-log event contract with authenticated Home CTA client-event ingestion and redaction tests
- Redacted onboarding outcome and REST goal-update events wired through device routes with captured Pino JSON tests
- Best-effort Home CTA intent and option event posting with ID-only payloads and unchanged direct-action chat handoff
- Redacted chat completion and SSE lifecycle events wired through route boundaries with non-hanging stream coverage

**Verification:**

- Requirements complete: 14/14 mapped and shipped.
- Phase 23 browser validation recovery UAT approved after local mock/manual check.
- Phase 25 staging mobile UAT approved.
- Phase 26 staging Railway structured-log UAT approved.

**What's next:** Start a fresh milestone with `$gsd-new-milestone`.

---

## v1.5 訊息呈現與歷史摘要操作 polish (Shipped: 2026-04-22)

**Phases completed:** 3 phases, 6 plans

**Key accomplishments:**

- Assistant finalized bubbles render a strict `#` / `##` / `###` heading subset as semantic headings instead of leaking raw markdown markers
- Summary Detail now opens with selected-day context first and keeps the month calendar collapsed until needed
- Historical snapshot / today-live state remains clear while browsing months and selecting dates
- `Asia/Taipei` moved from warning-only convention to boot, release-check, and staging deploy verification contract

**Verification:**

- Milestone audit passed at `6/6` requirements, `3/3` cross-phase integrations, and `3/3` end-to-end flows.
- Phase 22 security review closed with `threats_open: 0`.
- Staging deploy verification confirmed the exact `TZ=Asia/Taipei` runtime contract.

---

## v1.4 記錄可信度與歷史日體驗 (Shipped: 2026-04-21)

**Phases completed:** 5 phases, 16 plans, 34 tasks

**Delivered:** chat latest visibility, historical-day browsing and mutation safety, trusted-protein semantics, and cookie-backed guest-session hardening.

**Key accomplishments:**

- Kept chat visibly attached to the latest upload / status / reply edge while preserving detach + `回到最新` control.
- Shipped Summary historical-day browsing and date-correct mutation flows with `affectedDate` transport and today-only live-state protection.
- Made trusted protein the canonical persisted protein meaning and aligned assistant wording plus harness evidence to that contract.
- Replaced raw browser-visible `deviceId` auth with cookie-backed guest sessions, including same-browser resume and explicit rebuild recovery.

**Verification:**

- Milestone audit passed at `14/14` requirements, `5/5` integrations, and `5/5` end-to-end flows.
- `protein-trust` and `guest-session-hardening` harness scenarios both passed.

**Known close notes:**

- `audit-open` still reports one Phase 15 UAT false positive at close even though final Phase 15 UAT/verification passed; the earlier intermediate Phase 15 debug note was superseded by that re-verification.
- Public-domain post-Phase-19 cookie-auth smoke was later rerun on Railway staging and production during release promotion on 2026-04-21.

---

## v1.3 歷史餐點修正與 Beta Ready 基線 (Shipped: 2026-04-20)

**Delivered:** Durable storage and asset persistence, canonical editable meal transactions, historical correction in chat, persisted image/Markdown UI surfaces, and a deployed-domain shared beta baseline without an in-app feedback CTA.

**Phases completed:** 11-14.1 (17 plans total)

**Key accomplishments:**

- Added explicit SQLite migrations, a durable asset boundary, same-origin Fastify beta serving, and Railway-style deploy documentation.
- Replaced append-only meal persistence with canonical transactions, immutable revisions, explicit asset references, and verified hot-path query plans.
- Shipped historical meal correction with DB-backed target resolution, ambiguity-safe follow-ups, and original-record update/delete semantics.
- Added persisted image rendering across chat/history plus a strict assistant Markdown subset that stays safe and mobile-stable.
- Removed the obsolete in-app beta feedback path while keeping the shared beta rollout gate and closing it with a real deployed-domain mobile smoke pass.

**Stats:**

- 224 files changed across the v1.3 git range
- 21,872 insertions / 840 deletions in the v1.3 diff stat
- 6 phases, 17 plans, 22 tracked plan tasks
- 2 calendar days from first v1.3 implementation commit to milestone completion

**Git range:** `171959a` → `d0b1f1e`

**Verification:** `.planning/milestones/v1.3/MILESTONE-AUDIT.md` passed at 15/15 requirements, 6/6 end-to-end flows, and 5/5 cross-phase integration checks

**Known close notes:**

- `audit-open` still flags `10-UAT.md` and `14-UAT.md` even though both files report 0 pending scenarios.
- `13-UAT.md` retains a non-blocking manual readability review note for the clarification prompt copy.

**What's next:** Start a fresh milestone with `$gsd-new-milestone`. If Vercel remains a goal, treat it as a separate infra milestone rather than extending the v1.3 Railway-style baseline.

---

## v1.1 驗證性與穩定性強化 (Shipped: 2026-04-12)

**Delivered:** Deterministic verification, single-image flow reliability, and hardened device/SSE/upload boundaries for Nutrition Coach.

**Phases completed:** 4-6 (8 plans total)

**Key accomplishments:**

- Built deterministic route-level replay harnesses for text and image logging, with redacted JSON evidence and failure-step reporting.
- Stabilized single-image meal logging so status text, final replies, persisted meals, and fallback behavior stay aligned.
- Added image failure harness coverage for analysis failure, fatal `log_food` failure, and final-reply partial success.
- Moved daily summary publishing to the route layer and preserved assistant persistence invariants across JSON and SSE transport paths.
- Added deterministic upload cleanup and boundary-contract harness coverage for device rejection, stale SSE connections, and cleanup failure paths.

**Stats:**

- 72 files changed across the v1.1 git range
- 10,322 insertions / 304 deletions in the v1.1 diff stat
- 3 phases, 8 plans, 17 tracked plan tasks
- 3 days from first v1.1 implementation commit to milestone completion

**Git range:** `d17d7f9` → `6e39d77`

**Verification:** `yarn test` 214/214, `yarn tsc --noEmit` exit 0, `yarn verify:harness -- boundary-contracts` PASS 12/12

**Known advisory debt:**

- Phase 4 review status is stale even though later review notes the earlier warnings were resolved.
- Phase 4/5 validation docs remain draft; Phase 6 has verification/review artifacts but no standalone `06-VALIDATION.md`.
- Phase 5 verification noted a non-blocking missing `05-SECURITY.md` advisory.

**What's next:** Start a fresh milestone with `/gsd-new-milestone` and promote v2 requirements such as cancel generation, stronger identity, visual consistency, or richer history if they remain priorities.

---

## v1.2 日常體驗與可觀測性強化 (Shipped: 2026-04-19)

**Started:** 2026-04-14

**Goal:** 修掉日常體驗裂縫，同時鋪好受控 AI workflow 的地基，讓後續 meal transaction v2 能自然銜接。

**Delivered:** Chat polish, structured redacted observability, Asia/Taipei local-day rollover, and the first controlled chat goal-update mutation.

**Phases completed:** 7-10 (22 plans total)

**Key accomplishments:**

- Polished chat reopen behavior, image bubble rendering, centralized runtime config, malformed goal-body handling, and README/env alignment.
- Added structured, redacted observability with orchestrator lifecycle hooks and decomposed chat-route helpers without changing the HTTP/SSE contract.
- Shipped Asia/Taipei local-day summary rollover with deterministic harness coverage and browser-level rollover evidence.
- Shipped controlled chat goal updates with ToolContract validation, source-text business guards, deterministic receipts, and realtime UI sync.

**Verification closeout:**

- Restored the missing standalone Phase 8 verification artifact.
- Recorded Phase 9 browser rollover UAT with Playwright screenshots.
- Completed Phase 10 validation, security review, conversational UAT, and Playwright rerun.

**Stats:**

- 208 files changed across the v1.2 git range
- 25,438 insertions / 8,664 deletions in the v1.2 diff stat
- 4 phases, 22 plans
- 7 calendar days from first v1.2 implementation commit to archive

**Git range:** `9697547` → `e169f3d`

**Verification:** `npx tsc --noEmit`, `yarn test` 310/310, `yarn verify:harness -- text-log` PASS 7/7, `image-log` PASS 5/5, `image-log-failure` PASS 6/6, `daily-rollover` PASS 6/6

**Known close note:**

- `audit-open` reported `10-UAT.md` as an open UAT item even though it is `passed` with `open_scenario_count: 0`; this was recorded as a non-blocking tooling false positive in `STATE.md`.

**What's next:** Start a fresh milestone with `$gsd-new-milestone`.

---
