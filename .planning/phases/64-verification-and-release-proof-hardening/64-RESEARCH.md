# Phase 64: Verification and Release-Proof Hardening - Research

**Researched:** 2026-05-19  
**Domain:** Local release verification, metadata-only evidence, Node test hardening  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

All bullets in this section are copied from `.planning/phases/64-verification-and-release-proof-hardening/64-CONTEXT.md`. [VERIFIED: 64-CONTEXT.md]

### Locked Decisions

#### Proof Coverage Strategy
- **D-01:** Start Phase 64 by running the current `yarn release:check` after Phase 63. Phase 63 closure proved narrower gates, but not the release gate.
- **D-02:** After the baseline release gate, run the PROOF-02 cross-phase metadata-only sweep before adding behavior-test coverage.
- **D-03:** Add behavior tests only for evidence-backed false-pass risk: cases where existing evidence could pass while a PROOF behavior is wrong, or where the PROOF-02 sweep shows a metadata path can leak without a focused denylist assertion.
- **D-04:** Missing assertions or missing paths justify new tests only when they create false-pass risk. Otherwise record or defer rather than broadening Phase 64.
- **D-05:** Final context locks decisions and leaves concrete behavior-test selection, file selection, and sweep organization to planner discretion after gate/sweep results are known.
- **D-05a:** `64-VERIFICATION.md` must include a PROOF-01 coverage table mapping the five required behavior families to existing or new passing unit/integration evidence: goal proposal authority, deterministic failed goal copy, summary-failure committed outcomes, stale receipt rejection, and SSE meal-row freshness.
- **D-05b:** New PROOF-01 behavior tests remain false-pass-risk only. The coverage table may cite existing passing evidence when it proves the behavior without a false-pass gap.

#### Release Gate Failure Classification
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

#### Bucket C Deferral And Closeout
- **D-13:** During plan execution, routine Bucket C items may be recorded in `64-deferred-items.md` plus a `64-VERIFICATION.md` cross-link with command, failure, Bucket C rationale, relevant passing checks, suspected owner, and follow-up context.
- **D-14:** If root cause is unclear, impact is broad, or Bucket C classification is uncertain, planner must escalate for current-thread user approval before treating it as deferred.
- **D-15:** At Phase 64 closure, if `release:check` remains red for any Bucket C item, explicit current-thread user approval is required for the exact list of Bucket C exceptions.
- **D-16:** Even with approval, Phase 64 must not claim full PROOF-03 green while `release:check` is red. It may only record a user-approved deferred or blocked closeout state with the limitation clearly stated.
- **D-17:** Planner cannot unilaterally close v2.3 with red `release:check`.

#### PROOF-02 Metadata-Only Sweep
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

#### Harness And Artifact Policy
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

#### Command Policy
- **D-42:** Baseline: run `yarn release:check` once at the start to establish release-blocker baseline and classify failures by A/B/C.
- **D-43:** Mid-phase: run changed-file targeted gates using the AGENTS.md verification matrix. Do not run full `release:check` after every edit.
- **D-44:** Harness commands enter scope only when a harness trigger is hit, a scenario is modified, or a harness artifact is used as current behavior evidence.
- **D-45:** PROOF-02 sweep includes planner-selected targeted redaction/artifact/trace tests plus metadata-only enumeration of on-disk harness artifacts.
- **D-46:** Closure: explicitly run `yarn tsc --noEmit` and `yarn release:check`, and write results to `64-VERIFICATION.md`.
- **D-47:** If closure `release:check` is red and not an explicitly deferred/escalated Bucket C exception, Phase 64 cannot close.

### the agent's Discretion

- Planner may choose exact test files, commands, denylist registry shape, and sweep organization after baseline gate and sweep results.
- Planner may choose whether to add targeted unit/integration coverage, static/source contracts, or harness updates, but only under the false-pass-risk boundaries above.
- Planner may choose the exact `64-VERIFICATION.md` table format, provided it remains metadata-only and captures inspected surfaces, counts, statuses, commands, and facts proven.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROOF-01 | Targeted unit and integration tests prove goal proposal authority, deterministic failed goal copy, summary-failure committed outcomes, stale receipt rejection, and SSE meal-row freshness. [VERIFIED: REQUIREMENTS.md] | Existing tests already cover all five behavior families; planner should cite existing passing tests first and add new tests only for false-pass risk discovered by baseline/sweep. [VERIFIED: prior VERIFICATION files + rg over tests] |
| PROOF-02 | Integrity proof remains metadata-only and does not persist raw prompts, user text, assistant final text, tool payloads, provider bodies, image data, session material, or database snapshots. [VERIFIED: REQUIREMENTS.md] | Existing artifact and trace tests define a usable denylist foundation, but Phase 64 must sweep all on-disk `tests/harness/artifacts/**` files, including 56 files and 6 binary images currently present. [VERIFIED: tests/unit/verification-artifacts.test.ts + find counts] |
| PROOF-03 | Local closure runs `yarn tsc --noEmit` and `yarn release:check`, with no staging or main promotion. [VERIFIED: REQUIREMENTS.md] | `release:check` runs timezone validation, TypeScript, full tests, and frontend build; no command in Phase 64 should push, merge, deploy, or promote branches. [VERIFIED: scripts/release-check.mjs + AGENTS.md] |
</phase_requirements>

## Summary

Phase 64 is a verification and hardening phase, not a feature phase. The plan should run the release gate first, run the PROOF-02 metadata-only sweep second, then use the results to decide whether any new unit/integration tests are justified. [VERIFIED: 64-CONTEXT.md] Existing Phase 60-63 verification reports already identify passing evidence for goal authority, deterministic failed goal copy, committed mutation outcomes, stale receipt rejection, and SSE freshness. [VERIFIED: 60-VERIFICATION.md, 61-VERIFICATION.md, 62-VERIFICATION.md, 63-VERIFICATION.md]

The implementation standard is the repo-native Node test stack: Node built-in `node:test`, real SQLite for persistence tests, `MockLLMProvider`/harness providers for model isolation, and `yarn` commands through the Asia/Taipei timezone wrapper. [VERIFIED: AGENTS.md + package.json + .planning/codebase/TESTING.md] Do not add Jest, Vitest, a new release harness bundle, or broad “nice to have” coverage. [VERIFIED: AGENTS.md + 64-CONTEXT.md]

**Primary recommendation:** Plan Phase 64 as four gates: baseline `yarn release:check`, metadata-only evidence sweep, false-pass-risk test closure, and final `yarn tsc --noEmit` plus `yarn release:check` with a metadata-only `64-VERIFICATION.md`. [VERIFIED: 64-CONTEXT.md + scripts/release-check.mjs]

## Project Constraints (from AGENTS.md)

- Use `yarn` only; do not use `npm` for repo commands. [VERIFIED: AGENTS.md]
- Use Node built-in `node:test`; do not introduce Jest or Vitest without explicit migration. [VERIFIED: AGENTS.md]
- Use real SQLite in tests; `:memory:` is acceptable, but DB mocking is not. [VERIFIED: AGENTS.md]
- Preserve explicit `.js` specifiers for local TypeScript imports because the repo is ESM. [VERIFIED: AGENTS.md + package.json]
- Preserve `TZ=Asia/Taipei` in local and test setups. [VERIFIED: AGENTS.md + scripts/run-node-with-tz.mjs]
- `server/app.ts` is the backend composition root; route/service dependencies should be wired there. [VERIFIED: AGENTS.md]
- `server/routes/*.ts` own HTTP/SSE transport validation, auth, stream framing, and response shaping. [VERIFIED: AGENTS.md]
- `server/services/*.ts` own reusable domain and persistence logic; services should not instantiate LLM clients. [VERIFIED: AGENTS.md]
- `server/orchestrator/*` owns model workflow, tool definitions/execution, prompt construction, and fallback behavior. [VERIFIED: AGENTS.md]
- `server/realtime/publisher.ts` owns realtime fan-out for `daily_summary` and `goals_update`. [VERIFIED: AGENTS.md]
- Generated harness artifacts under `tests/harness/artifacts/**` must be regenerated, not hand-edited. [VERIFIED: AGENTS.md]
- For TypeScript edits run `yarn tsc --noEmit`; for unit tests run `yarn test:unit`; for route/service edits run `yarn test:integration`; for harness scenario edits run `yarn verify:harness -- <scenario>`. [VERIFIED: AGENTS.md]
- Before merging to `staging` or `main`, run `yarn release:check`; Phase 64 must not promote to staging or main without explicit current-thread approval. [VERIFIED: AGENTS.md + 64-CONTEXT.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Baseline and closure release gates | Scripts / Local CI | Test suite | `scripts/release-check.mjs` owns the local release sequence and delegates TypeScript, tests, and build to `yarn` scripts. [VERIFIED: scripts/release-check.mjs] |
| PROOF-01 behavior proof | Test suite | API / Backend, Browser client | Unit/integration tests already exercise backend authority, route outcomes, and client SSE/store freshness boundaries. [VERIFIED: tests/unit + tests/integration + prior VERIFICATION files] |
| PROOF-02 privacy sweep | Test suite / Evidence tooling | Harness artifact writer, route/orchestrator evidence paths | Artifact redaction is implemented in `tests/harness/artifacts.ts`; route/orchestrator evidence paths produce logs/traces that tests inspect. [VERIFIED: tests/harness/artifacts.ts + server/orchestrator/llm-trace.ts] |
| Harness evidence | Harness tooling | API / Backend | Harness scenarios are default-off and enter scope only for multi-turn, persisted evidence, SSE timing, or stale harness-risk triggers. [VERIFIED: 64-CONTEXT.md + nutrition-new-harness-scenario SKILL.md] |
| No promotion boundary | Git / Workflow policy | Release docs | AGENTS fixes promotion order and prohibits touching `main` without explicit current-thread approval; Phase 64 context separately prohibits staging/main promotion. [VERIFIED: AGENTS.md + 64-CONTEXT.md] |

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| Node.js | 24.14.0 | Runtime and `node:test` runner. [VERIFIED: `node --version`] | Existing scripts execute Node directly and tests use built-in `node:test`. [VERIFIED: package.json + TESTING.md] |
| Yarn | 1.22.22 | Package/script runner. [VERIFIED: `yarn --version`] | Project policy requires `yarn` only. [VERIFIED: AGENTS.md] |
| TypeScript | 5.9.3 | Static type gate. [VERIFIED: node_modules/package.json] | `yarn tsc --noEmit` is required for TypeScript edits and release closure. [VERIFIED: AGENTS.md + package.json] |
| tsx | 4.21.0 | TypeScript execution for tests and server scripts. [VERIFIED: node_modules/package.json] | Test scripts use `node ... --import tsx`. [VERIFIED: package.json] |
| Node built-in `node:test` | Node 24.14.0 builtin | Unit/integration test framework. [VERIFIED: tests files + node version] | Repo policy forbids new Jest/Vitest migration in this phase. [VERIFIED: AGENTS.md] |
| Fastify | 5.8.4 | API/SSE app under test. [VERIFIED: node_modules/package.json] | Integration tests use `buildApp()` and `app.inject()` or ephemeral listeners. [VERIFIED: TESTING.md + tests/integration] |
| better-sqlite3 | 11.10.0 | Real SQLite persistence in tests. [VERIFIED: node_modules/package.json] | Repo tests use real SQLite and allow `:memory:` databases. [VERIFIED: AGENTS.md + TESTING.md] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| Drizzle ORM | 0.39.3 | SQLite schema/query layer. [VERIFIED: node_modules/package.json] | Use existing service/query paths if a proof test needs DB state assertions. [VERIFIED: STRUCTURE.md] |
| React | 19.2.4 | Client UI runtime. [VERIFIED: node_modules/package.json] | Only relevant if client source-contract tests reveal false-pass risk in SSE freshness or stale receipt UX. [VERIFIED: package.json + 63-VERIFICATION.md] |
| Zustand | 5.0.12 | Client state boundary. [VERIFIED: node_modules/package.json] | Use existing store/coordinator tests for SSE meal-row freshness and mutation invalidation proof. [VERIFIED: AGENTS.md + tests/unit/sse-summary-coordinator.test.ts] |
| Vite | 6.4.1 | Client build gate. [VERIFIED: node_modules/package.json] | `release:check` runs `yarn build`, which invokes Vite. [VERIFIED: package.json + scripts/release-check.mjs] |
| ripgrep | 15.1.0 | Sweep/source discovery. [VERIFIED: `rg --version`] | Use for metadata-only denylist sweeps and source/path enumeration. [VERIFIED: local environment] |
| Git | 2.50.1 | Diff-base and changed-file detection for release check. [VERIFIED: `git --version`] | `scripts/release-check.mjs` inspects changed files and base refs. [VERIFIED: scripts/release-check.mjs] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Node built-in tests | Jest/Vitest | Do not use; project policy explicitly requires Node built-in `node:test`. [VERIFIED: AGENTS.md] |
| Focused unit/integration proof | Default new harness bundle | Do not use; harness is default-off and requires a concrete trigger. [VERIFIED: 64-CONTEXT.md] |
| Metadata-only Markdown verification | Machine-readable JSON release proof | Do not use by default; add JSON only if Markdown cannot avoid false-pass. [VERIFIED: 64-CONTEXT.md] |

**Installation:** No package installation is required for Phase 64; the phase should use the existing locked repo stack. [VERIFIED: package.json + 64-CONTEXT.md]

## Architecture Patterns

### System Architecture Diagram

```text
Phase 64 start
  |
  v
Baseline yarn release:check
  |-- fail --> classify A/B/C --> fix A/B, record/escalate C
  |-- pass --> empty baseline triage
  v
PROOF-02 metadata-only sweep
  |-- persisted/emitted denylist match --> classify Bucket B or escalate gray-zone
  |-- no blocker --> build coverage table
  v
PROOF-01 evidence map
  |-- existing tests prove behavior without false-pass gap --> cite passing evidence
  |-- false-pass risk found --> add focused unit/integration test
  |-- harness trigger found --> rerun/update exact harness scenario
  v
Closure
  |
  +--> yarn tsc --noEmit
  +--> yarn release:check
  +--> 64-VERIFICATION.md metadata-only tables
  +--> no staging/main promotion
```

### Recommended Project Structure

```text
.planning/phases/64-verification-and-release-proof-hardening/
├── 64-CONTEXT.md          # locked decisions [VERIFIED: init.phase-op]
├── 64-RESEARCH.md         # this research [VERIFIED: current task]
├── 64-VERIFICATION.md     # write during execution [VERIFIED: 64-CONTEXT.md]
└── 64-deferred-items.md   # optional Bucket C record [VERIFIED: 64-CONTEXT.md]

tests/unit/
├── verification-artifacts.test.ts       # artifact redaction contracts [VERIFIED: file read]
├── llm-chat-trace.test.ts               # metadata-only trace contracts [VERIFIED: file read]
├── update-goals-contract.test.ts        # goal authority contracts [VERIFIED: rg + file read]
└── sse-summary-coordinator.test.ts      # meal-row freshness ordering [VERIFIED: file read]

tests/integration/
├── chat-goal-update.integration.test.ts # renderer-owned failed goal copy [VERIFIED: file read]
├── chat-api.test.ts                     # committed summary outcomes and metadata logs [VERIFIED: file read]
├── chat-meal-correction.integration.test.ts # stale chat receipt rejection [VERIFIED: file read]
├── meals-api.test.ts                    # direct stale route ordering and publish metadata [VERIFIED: file read]
└── sse.test.ts                          # strict daily_summary envelopes [VERIFIED: file read]

tests/harness/artifacts/**              # generated evidence to enumerate and sweep [VERIFIED: find]
```

### Pattern 1: Baseline Gate Then Classify

**What:** Run `yarn release:check` before editing so failures are classified against the current post-Phase-63 state. [VERIFIED: 64-CONTEXT.md]  
**When to use:** First execution task in Phase 64. [VERIFIED: 64-CONTEXT.md]  
**Example:**

```bash
yarn release:check
```

`release:check` validates `TZ=Asia/Taipei`, runs `yarn tsc --noEmit`, runs `yarn test`, and runs `yarn build`. [VERIFIED: scripts/release-check.mjs]

### Pattern 2: Cite Existing Proof Before Adding Tests

**What:** Build a PROOF-01 coverage table mapping the five behavior families to existing or new evidence. [VERIFIED: 64-CONTEXT.md]  
**When to use:** After baseline gate and metadata sweep. [VERIFIED: 64-CONTEXT.md]  
**Evidence anchors:**

| Behavior Family | Existing Evidence |
|-----------------|-------------------|
| Goal proposal authority | `tests/unit/update-goals-contract.test.ts` and `tests/integration/chat-goal-update.integration.test.ts`. [VERIFIED: rg + file read] |
| Deterministic failed goal copy | `tests/integration/chat-goal-update.integration.test.ts` asserts renderer copy, unchanged targets, no publish, no success-style text, and no second model rewrite. [VERIFIED: file read] |
| Summary-failure committed outcomes | `tests/integration/chat-api.test.ts`, `tests/integration/chat-streaming.test.ts`, `tests/integration/meals-api.test.ts`, and `tests/unit/tools.test.ts` assert committed facts with unavailable/fresh summary outcomes. [VERIFIED: rg + file read] |
| Stale receipt rejection | `tests/integration/chat-meal-correction.integration.test.ts`, `tests/integration/meals-api.test.ts`, and `tests/unit/tools.test.ts` assert stale update/delete rejection without mutation, summary, or publish side effects. [VERIFIED: file read] |
| SSE meal-row freshness | `tests/unit/sse-summary-coordinator.test.ts`, `tests/unit/sse-client.test.ts`, `tests/integration/sse.test.ts`, and Phase 63 human verification prove strict envelopes and row-before-summary reconciliation. [VERIFIED: file read + 63-VERIFICATION.md] |

### Pattern 3: Metadata-Only Sweep Registry

**What:** Use a two-tier denylist registry and record only metadata: surface, path/count, command, match count/status, and escalation notes. [VERIFIED: 64-CONTEXT.md]  
**When to use:** Before adding new behavior tests and again after any artifact-producing changes. [VERIFIED: 64-CONTEXT.md]  
**Recommended sweep inputs:**

```text
Tier 1:
raw prompts, user text, assistant final text, tool payloads, provider bodies,
image data, session material, database snapshots

Tier 2:
API keys, bearer/auth headers, cookies, device/session identifiers, upload paths,
error stacks, internal schema, raw tool args/results, raw messages,
provider request/body/header material
```

Tier 1 comes from the roadmap/CONTEXT policy floor; Tier 2 is supported by current artifact and trace tests. [VERIFIED: ROADMAP.md + 64-CONTEXT.md + tests/unit/verification-artifacts.test.ts + tests/unit/llm-chat-trace.test.ts]

### Pattern 4: Harness Trigger Discipline

**What:** Keep harness default-off, and name the exact trigger if it enters the plan. [VERIFIED: 64-CONTEXT.md]  
**When to use:** Only if unit/integration evidence cannot prove a concrete false-pass risk or an existing artifact is cited as current behavior proof. [VERIFIED: 64-CONTEXT.md]  
**Harness shape:** A `.ts` scenario exports `default` as `VerificationScenario`, uses `createScenarioApp()`, closes fixtures in `finally`, and writes artifacts through the existing harness writer. [VERIFIED: nutrition-new-harness-scenario SKILL.md + TESTING.md]

### Anti-Patterns to Avoid

- **Running broad gates after every small edit:** Use changed-file targeted gates mid-phase; reserve full `release:check` for baseline and closure. [VERIFIED: 64-CONTEXT.md]
- **Treating existing harness artifacts as current proof without rerun/staleness proof:** Existing artifacts must be swept, and current behavior citation requires rerun or non-stale proof. [VERIFIED: 64-CONTEXT.md]
- **Recording raw matched denylist content in `64-VERIFICATION.md`:** Verification must record metadata only. [VERIFIED: 64-CONTEXT.md]
- **Fixing unrelated Bucket C failures silently:** Routine Bucket C can be recorded/deferred; unclear or broad failures require escalation. [VERIFIED: 64-CONTEXT.md]
- **Promoting `staging` or `main`:** Phase 64 explicitly excludes staging/main promotion. [VERIFIED: REQUIREMENTS.md + AGENTS.md + 64-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Test framework | Custom runner, Jest, or Vitest | Node built-in `node:test` | Existing tests and project policy standardize on `node:test`. [VERIFIED: AGENTS.md + TESTING.md] |
| Route integration transport | Mocked Fastify routes | `buildApp()`, `app.inject()`, or ephemeral `app.listen({ port: 0 })` | Existing integration tests use real Fastify and real SQLite. [VERIFIED: TESTING.md] |
| SQLite persistence proof | Mock DB objects | `createDb(":memory:")` or migrated temp DBs | Project policy requires real SQLite. [VERIFIED: AGENTS.md] |
| Artifact redaction | New sanitizer | `tests/harness/artifacts.ts` redaction and tests | Existing writer already omits/redacts sensitive keys and values. [VERIFIED: tests/harness/artifacts.ts + tests/unit/verification-artifacts.test.ts] |
| Trace evidence | Raw prompt/transcript capture | `createLlmTraceRecorder()` metadata timeline and summary | Trace recorder stores prompt version/section IDs, event facts, provider metadata, and final-reply source/shape, not raw payloads. [VERIFIED: server/orchestrator/llm-trace.ts] |
| SSE freshness proof | Manual browser-only checks | `sse-summary-coordinator` unit tests plus focused integration tests | Existing tests prove row-before-summary ordering and strict envelopes deterministically. [VERIFIED: tests/unit/sse-summary-coordinator.test.ts + tests/integration/sse.test.ts] |

**Key insight:** Phase 64 should harden the evidence chain, not invent a new proof system; the repo already has the runner, privacy writer, trace recorder, and route/client proof surfaces needed for local closure. [VERIFIED: TESTING.md + 64-CONTEXT.md + inspected tests]

## Common Pitfalls

### Pitfall 1: False-Pass Test Expansion

**What goes wrong:** A plan adds broad tests because a behavior is important, even though existing evidence already proves it. [VERIFIED: 64-CONTEXT.md]  
**Why it happens:** PROOF-01 can be misread as “write new tests for all five behavior families.” [VERIFIED: 64-CONTEXT.md]  
**How to avoid:** First fill the PROOF-01 coverage table with existing passing evidence, then add tests only for specific false-pass gaps. [VERIFIED: 64-CONTEXT.md]  
**Warning signs:** New test files duplicate assertions from Phase 60-63 without citing a concrete missing assertion or metadata leak. [VERIFIED: prior VERIFICATION files]

### Pitfall 2: Privacy Sweep Leaks Its Own Evidence

**What goes wrong:** The sweep records raw matched text in `64-VERIFICATION.md`, turning a detection into a persisted leak. [VERIFIED: 64-CONTEXT.md]  
**Why it happens:** grep-style workflows naturally print matching lines unless explicitly constrained. [VERIFIED: 64-CONTEXT.md]  
**How to avoid:** Record only file path, file type, count, denylist tier, status, and escalation/fix action. [VERIFIED: 64-CONTEXT.md]  
**Warning signs:** Verification tables include snippets, raw HTTP bodies, prompt text, assistant copy, stack traces, or tool argument payloads. [VERIFIED: 64-CONTEXT.md]

### Pitfall 3: Treating Binary Screenshots as Text Evidence

**What goes wrong:** Binary harness artifacts are swept like text files or treated as forbidden image payloads without classification. [VERIFIED: 64-CONTEXT.md]  
**Why it happens:** `tests/harness/artifacts/**` currently contains six PNG files, and Phase 64 must classify binary artifacts separately. [VERIFIED: find counts + 64-CONTEXT.md]  
**How to avoid:** Record binary path/type/size/count separately; escalate only raw uploaded/base64/provider image payloads unless screenshot visual evidence is explicitly approved. [VERIFIED: 64-CONTEXT.md]

### Pitfall 4: Delete-Only Remediation

**What goes wrong:** A leaked artifact is deleted, but the producer can recreate it on the next run. [VERIFIED: 64-CONTEXT.md]  
**Why it happens:** Harness artifacts are generated, and the source writer or scenario may still emit sensitive fields. [VERIFIED: tests/harness/artifacts.ts + 64-CONTEXT.md]  
**How to avoid:** Fix or test the producer path, regenerate artifacts only through the harness command, and verify the sweep is clean. [VERIFIED: 64-CONTEXT.md + AGENTS.md]

### Pitfall 5: Release Gate Red But Phase Closed

**What goes wrong:** `64-VERIFICATION.md` claims PROOF-03 green while `release:check` is red. [VERIFIED: 64-CONTEXT.md]  
**Why it happens:** Bucket C can be deferred, but deferral does not equal a green release gate. [VERIFIED: 64-CONTEXT.md]  
**How to avoid:** If red remains, record a user-approved deferred/blocked closeout with exact exceptions; do not claim full PROOF-03 closure. [VERIFIED: 64-CONTEXT.md]

## Code Examples

### Release Gate Shape

```javascript
// Source: scripts/release-check.mjs [VERIFIED: file read]
validateTimezoneContract();
runStep("TypeScript gate", ["tsc", "--noEmit"]);
runStep("Full test suite", ["test"]);
runStep("Frontend build", ["build"]);
```

### Artifact Redaction Shape

```typescript
// Source: tests/harness/artifacts.ts [VERIFIED: file read]
const snapshots = redact(result.artifacts);
fs.writeFileSync(
  path.join(dir, "snapshots.json"),
  JSON.stringify(snapshots, null, 2),
  "utf-8",
);
```

### Metadata-Only Trace Shape

```typescript
// Source: server/orchestrator/llm-trace.ts [VERIFIED: file read]
return {
  schemaVersion: "llm-trace.v2",
  scenario: input.scenario,
  status: input.status,
  summary,
  timeline: [...timeline],
};
```

### SSE Rows-Before-Summary Proof Shape

```typescript
// Source: client/src/sse-summary-coordinator.ts [VERIFIED: file read]
const { meals } = await deps.getMeals({ refreshReason: "meal_mutation" });
if (!commitRowsIfLatest(token, meals)) {
  return;
}
sameDayCommitSeen = true;
deps.setDailySummary(payload.summary);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Goal confirmation inferred from assistant prose | Backend-owned proposal state or explicit current-turn numeric values | Phase 60, 2026-05-17 [VERIFIED: 60-VERIFICATION.md] | PROOF-01 should cite backend authority and renderer-owned failure tests, not model prose checks. [VERIFIED: 60-VERIFICATION.md] |
| Meal mutation success coupled to summary recompute/publish | Committed mutation facts plus `summaryOutcome` freshness status | Phase 61, 2026-05-17 [VERIFIED: 61-VERIFICATION.md] | PROOF-01 should prove committed outcomes survive summary failure. [VERIFIED: 61-VERIFICATION.md] |
| Client-only stale receipt protection risk | Server-side expected revision checks with deterministic stale guidance | Phase 62, 2026-05-17 [VERIFIED: 62-VERIFICATION.md] | PROOF-01 should cite server-side stale rejection and no side effects. [VERIFIED: 62-VERIFICATION.md] |
| Raw or loose `daily_summary` pushes | Strict `{ summary, affectedDate, source }` envelopes and row-before-summary client reconciliation | Phase 63, 2026-05-18 [VERIFIED: 63-VERIFICATION.md] | PROOF-01 should cite strict envelope and coordinator ordering tests. [VERIFIED: 63-VERIFICATION.md] |
| Harness evidence as raw transcripts/snapshots | Metadata-only `llm-trace.v2`, redacted JSON artifacts, and explicit privacy sweep | v2.2/v2.3 [VERIFIED: PROJECT.md + tests/unit/verification-artifacts.test.ts] | PROOF-02 should inspect emitted/persisted evidence, not capture new raw data. [VERIFIED: REQUIREMENTS.md] |

**Deprecated/outdated:**
- Broad default harness bundles are out of scope for Phase 64. [VERIFIED: 64-CONTEXT.md]
- Raw forensic payload capture remains deferred and outside v2.3. [VERIFIED: REQUIREMENTS.md + PROJECT.md]
- `yarn preview` guidance is not valid unless a matching script is added. [VERIFIED: AGENTS.md + package.json]

## Assumptions Log

All claims in this research were verified from project files, local commands, or inspected source. No `[ASSUMED]` claims are present.

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | — | — | — |

## Open Questions (RESOLVED)

The items below are resolved by the executable plan set. Baseline `release:check` status is execution-owned by `64-01`; artifact sweep findings are execution-owned by `64-02`.

1. **Will baseline `yarn release:check` pass in the execution environment?**
   - What we know: The script sequence is known, and Phase 61 previously passed final `release:check`; Phase 64 context requires a fresh baseline run. [VERIFIED: scripts/release-check.mjs + 61-VERIFICATION.md + 64-CONTEXT.md]
   - What's unclear: Research did not run the expensive baseline gate because execution starts with that command by locked decision. [VERIFIED: 64-CONTEXT.md]
   - Resolution: `64-01` owns the baseline `yarn release:check` run as the first execution gate and classifies failures A/B/C with command stage and suspected ownership metadata. [VERIFIED: 64-01-PLAN.md + 64-CONTEXT.md]

2. **Will the on-disk artifact sweep find persisted denylist matches?**
   - What we know: There are 56 files under `tests/harness/artifacts/**`, including 6 PNG binaries; current redaction tests cover many forbidden keys and strings. [VERIFIED: find counts + tests/unit/verification-artifacts.test.ts]
   - What's unclear: Research enumerated files but did not run the full content denylist sweep. [VERIFIED: local find]
   - Resolution: `64-02` owns the metadata-only artifact sweep before behavior-test additions, including persisted match classification, metadata-only reporting, and D-39 remediation if matches are found. [VERIFIED: 64-02-PLAN.md + 64-CONTEXT.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | Scripts/tests/build | Yes | 24.14.0 [VERIFIED: `node --version`] | None needed |
| Yarn | All project commands | Yes | 1.22.22 [VERIFIED: `yarn --version`] | None; project requires Yarn |
| Git | `release:check` changed-file/base detection | Yes | 2.50.1 [VERIFIED: `git --version`] | `release:check` can still run core gates if base unavailable. [VERIFIED: scripts/release-check.mjs] |
| ripgrep | Privacy/source sweep | Yes | 15.1.0 [VERIFIED: `rg --version`] | `find` plus Node script if needed |
| TypeScript | Static gate | Yes | 5.9.3 [VERIFIED: node_modules/package.json] | None needed |
| tsx | TypeScript test execution | Yes | 4.21.0 [VERIFIED: node_modules/package.json] | None needed |
| SQLite driver | Real DB tests | Yes | better-sqlite3 11.10.0 [VERIFIED: node_modules/package.json] | None; DB mocking is forbidden |

**Missing dependencies with no fallback:** None found. [VERIFIED: local command probes]

**Missing dependencies with fallback:** None found. [VERIFIED: local command probes]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` on Node 24.14.0. [VERIFIED: tests + node version] |
| Config file | None detected; scripts are in `package.json`. [VERIFIED: rg config scan + package.json] |
| Quick run command | `node scripts/run-node-with-tz.mjs --import tsx --test <files>` [VERIFIED: TESTING.md + package.json] |
| Full suite command | `yarn test` [VERIFIED: package.json] |
| Release gate command | `yarn release:check` [VERIFIED: package.json + scripts/release-check.mjs] |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| PROOF-01 | Goal proposal authority and deterministic failed goal copy | Unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/update-goals-contract.test.ts tests/integration/chat-goal-update.integration.test.ts` | Yes [VERIFIED: rg --files + file read] |
| PROOF-01 | Summary-failure committed log/update/delete outcomes | Unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts tests/integration/meals-api.test.ts` | Yes [VERIFIED: rg --files + rg evidence] |
| PROOF-01 | Stale receipt rejection without mutation/summary/publish side effects | Unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/integration/chat-meal-correction.integration.test.ts tests/integration/meals-api.test.ts` | Yes [VERIFIED: file read] |
| PROOF-01 | SSE meal-row freshness and affected-date invalidation | Unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/sse-client.test.ts tests/unit/sse-summary-coordinator.test.ts tests/integration/sse.test.ts` | Yes [VERIFIED: file read] |
| PROOF-02 | Artifact and trace evidence remains metadata-only | Unit + sweep | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/verification-artifacts.test.ts tests/unit/llm-chat-trace.test.ts` plus artifact sweep task | Yes; sweep task to add/define in plan [VERIFIED: file read + 64-CONTEXT.md] |
| PROOF-03 | Local closure gates pass; no promotion | Release gate | `yarn tsc --noEmit` and `yarn release:check` | Commands exist [VERIFIED: package.json] |

### Sampling Rate

- **Per task commit:** Use changed-file targeted gates from AGENTS.md. [VERIFIED: AGENTS.md]
- **Per wave merge:** Run relevant targeted test group plus `yarn tsc --noEmit` after TypeScript edits. [VERIFIED: AGENTS.md]
- **Phase gate:** Run `yarn tsc --noEmit` and `yarn release:check`; record metadata-only command results in `64-VERIFICATION.md`. [VERIFIED: 64-CONTEXT.md]

### Plan-Resolved Setup Items

- [x] `64-02` defines the Phase 64 metadata-only sweep command through `tests/unit/phase64-metadata-sweep.test.ts` for `tests/harness/artifacts/**`, structured logs, trace facts, and route/orchestrator evidence paths. [VERIFIED: 64-02-PLAN.md + 64-CONTEXT.md]
- [x] `64-02` defines the denylist registry in the plan from Tier 1 plus existing operational Tier 2 coverage in `verification-artifacts.test.ts` and `llm-chat-trace.test.ts`. [VERIFIED: 64-02-PLAN.md + 64-CONTEXT.md + inspected tests]
- [x] `64-01` through `64-04` create and update `64-VERIFICATION.md` with tables for baseline gate, PROOF-01 coverage, PROOF-02 sweep, closure gates, and any escalations. [VERIFIED: 64-01-PLAN.md + 64-02-PLAN.md + 64-03-PLAN.md + 64-04-PLAN.md + 64-CONTEXT.md]

## Security Domain

Security enforcement is enabled because `.planning/config.json` does not set `security_enforcement` to `false`. [VERIFIED: .planning/config.json]

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | Yes | Cookie-backed guest-session authorization remains owned by route/session resolver tests; Phase 64 should not weaken signed cookie ownership. [VERIFIED: AGENTS.md + STRUCTURE.md] |
| V3 Session Management | Yes | Denylist includes cookies, session material, device/session identifiers, and `guestSession` values in persisted evidence. [VERIFIED: 64-CONTEXT.md + tests/unit/verification-artifacts.test.ts] |
| V4 Access Control | Yes | Protected browser routes derive ownership from cookies, not raw `deviceId` query/header selectors. [VERIFIED: AGENTS.md] |
| V5 Input Validation | Yes | Existing route/tool tests use schema/type guards and zod-backed tool contracts; Phase 64 should add focused validation assertions only for false-pass risk. [VERIFIED: CONVENTIONS.md + tests/unit/update-goals-contract.test.ts] |
| V6 Cryptography | Yes | Do not hand-roll session/signing changes in this phase; only verify that evidence does not persist session material. [VERIFIED: 64-CONTEXT.md + AGENTS.md] |
| V9 Communications | No new transport scope | Phase 64 is local proof and does not add network transport. [VERIFIED: ROADMAP.md + 64-CONTEXT.md] |
| V10 Malicious Code | Yes | Do not introduce new dependency/test runner; use existing repo tools. [VERIFIED: AGENTS.md + package.json] |
| V14 Configuration | Yes | `TZ=Asia/Taipei` is a release-check contract and must remain enforced. [VERIFIED: scripts/release-check.mjs + AGENTS.md] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Sensitive prompt/user/provider/session material persisted in artifacts | Information Disclosure | Tiered denylist sweep plus artifact writer redaction tests. [VERIFIED: 64-CONTEXT.md + tests/unit/verification-artifacts.test.ts] |
| Structured logs capturing raw thrown errors | Information Disclosure | Log only safe failure reasons and assert no raw error material in captured logs. [VERIFIED: tests/integration/chat-api.test.ts + tests/integration/chat-streaming.test.ts] |
| Stale receipt overwrite | Tampering | Server-side expected revision checks and stale conflict responses before writes/summary/publish side effects. [VERIFIED: 62-VERIFICATION.md + tests/integration/meals-api.test.ts] |
| Assistant prose authorizes goal mutation | Elevation of Privilege / Tampering | Backend-owned proposal state or explicit current-turn values only. [VERIFIED: 60-VERIFICATION.md + tests/unit/update-goals-contract.test.ts] |
| SSE totals fresher than visible meal rows | Integrity / Tampering | Strict envelopes and coordinator row refresh before summary commit. [VERIFIED: 63-VERIFICATION.md + client/src/sse-summary-coordinator.ts] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/64-verification-and-release-proof-hardening/64-CONTEXT.md` - locked Phase 64 decisions, command policy, denylist tiers, harness policy, closeout rules.
- `.planning/REQUIREMENTS.md` - PROOF-01, PROOF-02, PROOF-03 requirement definitions.
- `.planning/ROADMAP.md` - Phase 64 goal, success criteria, no-promotion boundary.
- `.planning/PROJECT.md` and `.planning/STATE.md` - milestone context, metadata-only privacy decisions, no-promotion warning.
- `AGENTS.md` - project command, testing, architecture, and promotion constraints.
- `.planning/codebase/TESTING.md`, `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/STRUCTURE.md` - repo testing/structure conventions.
- Prior verification files for Phases 60-63 - existing proof anchors and closure evidence.
- `package.json`, `scripts/release-check.mjs`, `scripts/run-node-with-tz.mjs` - command behavior and release gate shape.
- `tests/unit/verification-artifacts.test.ts`, `tests/unit/llm-chat-trace.test.ts`, `tests/harness/artifacts.ts`, `server/orchestrator/llm-trace.ts` - metadata-only evidence contracts.
- Relevant PROOF-01 tests under `tests/unit` and `tests/integration` - behavior-family proof anchors.

### Secondary (MEDIUM confidence)

- Project-local skills: `nutrition-gen-test`, `nutrition-verify-change`, `nutrition-new-harness-scenario`, `nutrition-harness-review`, and `nutrition-security-review` - planning guidance for tests, harnesses, verification, and security review.

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - versions were verified from local commands and installed package metadata. [VERIFIED: command probes + node_modules/package.json]
- Architecture: HIGH - Phase 64 responsibility is constrained by existing codebase maps and locked context. [VERIFIED: STRUCTURE.md + 64-CONTEXT.md]
- Pitfalls: HIGH - pitfalls are directly derived from locked decisions and inspected test/evidence code. [VERIFIED: 64-CONTEXT.md + tests]

**Research date:** 2026-05-19  
**Valid until:** 2026-06-18 for local codebase structure; rerun version and artifact counts before planning if dependencies or harness artifacts change. [VERIFIED: current local probes]
