# Phase 64: Verification and Release-Proof Hardening - Context

**Gathered:** 2026-05-19
**Status:** Ready for planning

<domain>
## Phase Boundary

Phase 64 proves that v2.3 integrity behavior is locally release-ready without staging or main promotion. The phase starts from the current post-Phase-63 `yarn release:check` result, classifies any release blockers, runs a cross-phase PROOF-02 metadata-only evidence sweep, fills only evidence-backed false-pass behavior-test gaps, and records closure in `64-VERIFICATION.md`.

This phase covers local verification, privacy-preserving proof, release-gate closure, and metadata-only inspection of artifacts/logs/traces/evidence paths. It does not promote to `staging` or `main`, does not add product features, does not create a default release-proof harness bundle, and does not broaden behavior tests merely for completeness.

</domain>

<decisions>
## Implementation Decisions

### Proof Coverage Strategy
- **D-01:** Start Phase 64 by running the current `yarn release:check` after Phase 63. Phase 63 closure proved narrower gates, but not the release gate.
- **D-02:** After the baseline release gate, run the PROOF-02 cross-phase metadata-only sweep before adding behavior-test coverage.
- **D-03:** Add behavior tests only for evidence-backed false-pass risk: cases where existing evidence could pass while a PROOF behavior is wrong, or where the PROOF-02 sweep shows a metadata path can leak without a focused denylist assertion.
- **D-04:** Missing assertions or missing paths justify new tests only when they create false-pass risk. Otherwise record or defer rather than broadening Phase 64.
- **D-05:** Final context locks decisions and leaves concrete behavior-test selection, file selection, and sweep organization to planner discretion after gate/sweep results are known.
- **D-05a:** `64-VERIFICATION.md` must include a PROOF-01 coverage table mapping the five required behavior families to existing or new passing unit/integration evidence: goal proposal authority, deterministic failed goal copy, summary-failure committed outcomes, stale receipt rejection, and SSE meal-row freshness.
- **D-05b:** New PROOF-01 behavior tests remain false-pass-risk only. The coverage table may cite existing passing evidence when it proves the behavior without a false-pass gap.

### Release Gate Failure Classification
- **D-06:** Baseline `yarn release:check` failures use A/B/C as the primary classification:
  - **Bucket A:** true v2.3 integrity regression.
  - **Bucket B:** Phase 64 PROOF-02 sweep or proof-work failure.
  - **Bucket C:** unrelated pre-existing or external failure requiring escalation or deferral.
- **D-07:** Each failure still records command stage and suspected ownership as triage metadata. Baseline `yarn release:check` stages are TZ, TypeScript, full test suite, and frontend build. Artifact privacy sweep is separate Phase 64 proof-work / Bucket B triage metadata, not a `release:check` command stage. Ownership includes Phase 60-63 integrity work, Phase 64 proof work, dependency/platform, and unrelated product area.
- **D-08:** Fix Bucket A and Bucket B blockers inside Phase 64. Record and escalate/defer Bucket C items instead of fixing unrelated failures inside Phase 64.
- **D-09:** If an unrelated Bucket C failure keeps `release:check` red, Phase 64 cannot claim PROOF-03 closure unless the closeout is explicitly deferred or blocked with user approval.
- **D-10:** There is no currently known active Phase 63 strict `daily_summary` envelope consumer failure to pre-classify. Baseline `release:check` should classify only failures that appear in current output.
- **D-11:** If a strict `daily_summary` envelope consumer failure reappears, default to Bucket A because it likely traces to the Phase 63 v2.3 envelope contract. Downgrade to Bucket C only with evidence that it is unrelated, pre-existing, or external. Classify as Bucket B only if Phase 64 proof additions caused it.
- **D-12:** If baseline `release:check` is green, A/B/C triage is empty at that point, but Phase 64 still must perform the PROOF-02 sweep and final closure gates.

### Bucket C Deferral And Closeout
- **D-13:** During plan execution, routine Bucket C items may be recorded in `64-deferred-items.md` plus a `64-VERIFICATION.md` cross-link with command, failure, Bucket C rationale, relevant passing checks, suspected owner, and follow-up context.
- **D-14:** If root cause is unclear, impact is broad, or Bucket C classification is uncertain, planner must escalate for current-thread user approval before treating it as deferred.
- **D-15:** At Phase 64 closure, if `release:check` remains red for any Bucket C item, explicit current-thread user approval is required for the exact list of Bucket C exceptions.
- **D-16:** Even with approval, Phase 64 must not claim full PROOF-03 green while `release:check` is red. It may only record a user-approved deferred or blocked closeout state with the limitation clearly stated.
- **D-17:** Planner cannot unilaterally close v2.3 with red `release:check`.

### PROOF-02 Metadata-Only Sweep
- **D-18:** PROOF-02 sweep covers generated artifacts, structured logs, trace facts, and the route/orchestrator evidence paths that produce them.
- **D-19:** Add static/source contracts only if the sweep reveals a false-pass risk that runtime artifact/log/trace assertions cannot close.
- **D-20:** The ROADMAP denylist is the non-negotiable policy floor.
- **D-21:** Build a Phase 64 denylist registry by synthesizing the strongest existing operational denylist from current tests.
- **D-22:** Tier 1 denylist: raw prompts, user text, assistant final text, tool payloads, provider bodies, image data, session material, and database snapshots.
- **D-23:** Tier 2 denylist: operational extensions such as API keys, bearer/auth headers, cookies, device/session identifiers, upload paths, error stacks, internal schema, raw tool args/results, raw messages, and provider request/body/header material.
- **D-24:** Planner may add Tier 2 items when the sweep exposes a new risk. Removing Tier 2 items requires escalation.
- **D-25:** Tier 1 or Tier 2 matches are blockers when they appear in persisted or emitted evidence surfaces: harness artifacts, release-proof files, structured logs captured by tests/CI/log sinks, trace outputs, uploaded artifacts, or route/orchestrator evidence snapshots.
- **D-26:** Test-source sentinel strings and in-memory fixtures are allowed only when they are not written, logged, emitted, uploaded, or included in release evidence.
- **D-27:** HTTP request/response bodies are outside the sweep unless captured by logging, traces, artifacts, or release-proof evidence.
- **D-28:** Gray-zone emission paths such as request logging middleware, production trace callbacks, or CI stdout capture must be escalated.
- **D-29:** `64-VERIFICATION.md` must include a `PROOF-02 Metadata-Only Sweep` section with structured tables for inspected surfaces, Tier 1/Tier 2 denylist coverage, sweep/test/gate results, and escalated persistence-boundary decisions.
- **D-30:** `64-VERIFICATION.md` stores metadata only: surface name, path, command, count, pass/fail/escalation status, and facts proven. Do not store raw matched content or raw evidence payload.
- **D-31:** Machine-readable JSON is not produced by default. Add it only if planner proves the Markdown verification summary cannot avoid false-pass.

### Harness And Artifact Policy
- **D-32:** Harness is default off. Phase 64 does not create a default release-proof bundle harness.
- **D-33:** Add or update a focused harness only when unit/integration tests plus `64-VERIFICATION.md` cannot close a concrete false-pass risk.
- **D-34:** Harness triggers are:
  - PROOF-02 sweep finds a multi-turn or persisted evidence path that must be observed.
  - PROOF-01 false-pass risk falls on SSE timing, multi-turn, or artifact emission boundaries and existing evidence is insufficient.
  - An existing harness scenario became stale or false-pass after Phase 60-63 contract changes.
- **D-35:** Planner must name the specific harness trigger in the plan if harness work enters scope.
- **D-36:** Privacy sweep must enumerate all on-disk files under `tests/harness/artifacts/**` and sweep them for Tier 1/Tier 2 matches regardless of artifact freshness.
- **D-36a:** Existing ignored local harness artifacts may contain richer generated scenario payloads. Phase 64 must sweep and classify them before citing or retaining them as release proof; do not assume existing harness artifacts are already metadata-only.
- **D-36b:** Binary harness artifacts, including screenshots under `tests/harness/artifacts/**`, should be classified separately by path, file type, and size. Forbidden "image data" means raw uploaded/base64/provider image payloads unless a screenshot is explicitly approved visual evidence.
- **D-37:** Harness artifact privacy sweep records only inspected file count, match counts, paths/status/escalations in `64-VERIFICATION.md`; no raw matched content.
- **D-38:** Any persisted Tier 1/Tier 2 harness artifact match is a blocker unless escalated under the persistence-boundary rule.
- **D-39:** Remediation must clean the persisted local artifact and verify or fix the producing redaction/emission path if still reachable. Delete-only is insufficient when the producer can recreate the leak.
- **D-40:** Existing harness artifacts are not default current behavior proof. To cite a harness artifact for current PROOF behavior, rerun the matching scenario or prove the scenario/source/dependencies have no stale risk since artifact write time.
- **D-41:** Generated artifacts must not be hand-edited.

### Command Policy
- **D-42:** Baseline: run `yarn release:check` once at the start to establish release-blocker baseline and classify failures by A/B/C.
- **D-43:** Mid-phase: run changed-file targeted gates using the AGENTS.md verification matrix. Do not run full `release:check` after every edit.
- **D-44:** Harness commands enter scope only when a harness trigger is hit, a scenario is modified, or a harness artifact is used as current behavior evidence.
- **D-45:** PROOF-02 sweep includes planner-selected targeted redaction/artifact/trace tests plus metadata-only enumeration of on-disk harness artifacts.
- **D-46:** Closure: explicitly run `yarn tsc --noEmit` and `yarn release:check`, and write results to `64-VERIFICATION.md`.
- **D-47:** If closure `release:check` is red and not an explicitly deferred/escalated Bucket C exception, Phase 64 cannot close.

### Planner Discretion
- Planner may choose exact test files, commands, denylist registry shape, and sweep organization after baseline gate and sweep results.
- Planner may choose whether to add targeted unit/integration coverage, static/source contracts, or harness updates, but only under the false-pass-risk boundaries above.
- Planner may choose the exact `64-VERIFICATION.md` table format, provided it remains metadata-only and captures inspected surfaces, counts, statuses, commands, and facts proven.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Planning Scope
- `.planning/ROADMAP.md` — Phase 64 goal, success criteria, implementation notes, and no-promotion boundary.
- `.planning/REQUIREMENTS.md` — PROOF-01 through PROOF-03 and v2.3 proof/privacy requirements.
- `.planning/PROJECT.md` — v2.3 milestone context, constraints, and accumulated key decisions.
- `.planning/STATE.md` — Current position, accumulated v2.3 decisions, and blocker that Phase 64 must not promote staging/main without explicit approval.

### Prior Phase Contracts
- `.planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/63-CONTEXT.md` — SSE `daily_summary` strict envelope, affected-date invalidation, latest-wins, and historical freshness decisions.
- `.planning/phases/62-meal-revision-tokens-and-stale-receipt-protection/62-CONTEXT.md` — stale receipt/revision precondition behavior and deterministic stale guidance.
- `.planning/phases/61-committed-mutation-outcome-and-summary-contract/61-CONTEXT.md` — committed mutation facts, `summaryOutcome`, degraded summary behavior, and metadata-only publish failure handling.
- `.planning/phases/60-goal-proposal-authority-and-rejected-goal-copy/60-CONTEXT.md` — backend-owned goal proposal authority and deterministic rejected goal copy.

### Codebase Maps
- `.planning/codebase/TESTING.md` — Node test framework, harness patterns, quality gates, and release-check behavior.
- `.planning/codebase/CONVENTIONS.md` — TypeScript, route/service/test conventions and explicit `.js` import style.
- `.planning/codebase/STRUCTURE.md` — Relevant route/service/client/test/harness file locations.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `scripts/release-check.mjs` and `yarn release:check` — Release gate that runs TypeScript, tests, and build through the timezone wrapper.
- `scripts/run-node-with-tz.mjs` — Timezone-preserving runner required for local test and release commands.
- `tests/unit/verification-artifacts.test.ts` — Existing privacy/redaction artifact assertions and sentinel patterns that can inform the Phase 64 denylist registry.
- `tests/unit/llm-chat-trace.test.ts` — Existing metadata-only trace assertions for prompts/provider bodies/final assistant text and structured hook facts.
- `tests/integration/chat-goal-update.integration.test.ts` — Existing goal authority and metadata-only renderer/failure proof.
- `tests/unit/observability-events.test.ts`, `tests/unit/openai-provider.test.ts`, and related trace/provider tests — Existing operational denylist and metadata normalization coverage.
- `tests/unit/sse-client.test.ts`, `tests/unit/sse-summary-coordinator.test.ts`, `tests/unit/main-layout-sse-contract.test.ts`, `tests/integration/sse.test.ts`, and `tests/integration/meals-api.test.ts` — Existing SSE envelope, affected-date, and direct route proof surfaces.
- `tests/harness/artifacts/**` — Generated evidence that must be privacy-swept as persisted local artifacts but not hand-edited.

### Established Patterns
- Tests use Node built-in `node:test` and `node:assert/strict`; do not introduce another framework.
- Persistence-related tests use real SQLite, not mocked DBs.
- Harness scenarios write generated evidence through the harness artifact helpers; generated artifacts are regenerated, not hand-edited.
- Routine evidence remains metadata-only and must not contain raw prompts, user text, assistant final text, tool payloads, provider bodies, image data, session material, or database snapshots.
- Release proof distinguishes local gates from Railway smoke/promotion. Railway smoke and branch promotion remain out of scope without explicit later approval.

### Integration Points
- `64-VERIFICATION.md`: durable proof record for baseline gate, PROOF-01 behavior-family coverage table, PROOF-02 sweep, targeted tests, closure `yarn tsc --noEmit`, closure `yarn release:check`, and any escalations.
- `64-deferred-items.md`: optional record for routine Bucket C items that are not fixed in Phase 64.
- `tests/unit/*` and `tests/integration/*`: preferred place for focused behavior or metadata assertions when false-pass risk is found.
- `tests/harness/scenarios/*` and `tests/harness/artifacts/**`: enter scope only when the harness trigger rules are met or artifacts are privacy-swept/cited as current behavior evidence.
- `server/routes/chat.ts`, `server/routes/meals.ts`, `server/routes/sse.ts`, `server/orchestrator/*`, `server/observability/*`, `client/src/sse.ts`, and `client/src/sse-summary-coordinator.ts`: likely evidence-path owners if PROOF-02 or false-pass behavior gaps point at route/orchestrator/SSE metadata emission.

</code_context>

<specifics>
## Specific Ideas

- Use A/B/C as the primary release-check failure taxonomy:
  - A = true v2.3 integrity regression.
  - B = Phase 64 PROOF-02 sweep or proof-work failure.
  - C = unrelated pre-existing/external failure requiring escalation/defer.
- Baseline green `release:check` does not satisfy PROOF-02.
- `64-VERIFICATION.md` should include a PROOF-01 coverage table mapping the five required behavior families to existing or new passing unit/integration evidence. New tests remain false-pass-risk only.
- `64-VERIFICATION.md` should include a section named `PROOF-02 Metadata-Only Sweep`.
- Denylist tiers are part of the Phase 64 contract:
  - Tier 1 is the ROADMAP policy floor.
  - Tier 2 is synthesized from existing operational denylist coverage and may grow when risk appears.
- Harness artifacts are privacy-swept regardless of freshness, but cannot be cited as current behavior proof unless rerun or proven non-stale.
- Existing ignored local harness artifacts may contain richer generated scenario payloads; classify before citation/retention as release proof.
- Screenshots and other binary artifacts under `tests/harness/artifacts/**` should be classified separately by path/type/size. Treat raw uploaded/base64/provider image payloads as forbidden image data unless a screenshot is explicitly approved visual evidence.
- Delete-only remediation is insufficient for a persisted artifact leak if the producer can recreate the leak.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope.

</deferred>

---

*Phase: 64-Verification and Release-Proof Hardening*
*Context gathered: 2026-05-19*
