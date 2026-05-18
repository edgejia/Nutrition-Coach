# Phase 64: Verification and Release-Proof Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-19
**Phase:** 64-Verification and Release-Proof Hardening
**Areas discussed:** Proof coverage map, Metadata-only evidence contract, Harness versus local test evidence, Release gate and known failure handling

---

## Proof Coverage Map

| Option | Description | Selected |
|--------|-------------|----------|
| Gap-only proof | Add tests only where Phase 60-63 left weak or failing release evidence. | |
| End-to-end requirement sweep | Add/update explicit test clusters for each PROOF behavior. | |
| Release-blocker first | Start from what prevents `yarn release:check` from passing, then backfill proof gaps. | |
| Other | User-defined hybrid coverage posture. | Yes |

**User's choice:** Release-blocker first, then PROOF-02 cross-phase metadata-only sweep, then gap-only補位.
**Notes:** Start by verifying current `yarn release:check` after Phase 63. Add cross-phase metadata-only evidence. Only add behavior tests when that process exposes a false-pass risk.

| Option | Description | Selected |
|--------|-------------|----------|
| Fix release blockers immediately | Any failing `release:check` item becomes Phase 64 work before proof additions. | |
| Classify first, then fix | Separate failures by source, then fix blockers only. | Yes |
| Record only unless new regression | Run as evidence but avoid fixing unless caused by Phase 60-63 integrity work. | |
| Other | User-defined triage rule. | |

**User's choice:** Classify first, then fix.
**Notes:** True v2.3 integrity regressions and Phase 64 PROOF-02/proof-work failures are blockers. Unrelated pre-existing failures are recorded/escalated. A red `release:check` prevents PROOF-03 closure unless explicitly deferred.

| Option | Description | Selected |
|--------|-------------|----------|
| Missing assertion on committed behavior | Add tests when existing tests hit a path but do not assert the integrity contract. | |
| Missing path coverage | Add tests when a required behavior has no direct unit/integration path. | |
| False-pass risk | Add tests when current evidence could pass while required behavior is wrong. | Yes |
| All of the above | Any listed gap justifies focused behavior coverage. | |

**User's choice:** False-pass risk.
**Notes:** Missing assertions or missing paths matter only when they create false-pass risk; otherwise record/defer.

| Option | Description | Selected |
|--------|-------------|----------|
| Minimal and named | Name only suspected weak spots; planner should not expand without evidence. | |
| Risk-ranked checklist | Give planner a short checklist across v2.3 behavior families. | |
| Gate-driven discretion | Let planner decide after `release:check` and metadata sweep. | |
| Other | User-defined hybrid planner guidance. | Yes |

**User's choice:** Hybrid.
**Notes:** Lock decisions in CONTEXT; leave exact behavior-test selection, files, and sweep organization to planner discretion after gate/sweep results.

---

## Metadata-Only Evidence Contract

| Option | Description | Selected |
|--------|-------------|----------|
| Generated artifacts only | Inspect harness/artifact outputs and release-proof files. | |
| Artifacts plus logs/traces | Inspect generated artifacts, structured logs, trace facts, and producing evidence paths. | Yes |
| Cross-phase source contracts | Add static/source tests enforcing metadata-only boundaries. | |
| Other | User-defined sweep boundary. | |

**User's choice:** Artifacts plus logs/traces.
**Notes:** Static/source contracts are fallback only when runtime artifact/log/trace assertions cannot close a false-pass risk.

| Option | Description | Selected |
|--------|-------------|----------|
| Roadmap denylist exactly | Use only the roadmap denylist. | |
| Roadmap plus provider/security material | Add provider headers, auth/cookies, bearer tokens, request bodies, raw tool results, and raw session identifiers. | |
| Use existing test denylist | Reuse strongest existing denylist from current redaction tests. | |
| Other | User-defined hybrid denylist policy. | Yes |

**User's choice:** Hybrid.
**Notes:** ROADMAP denylist is Tier 1 policy floor. Phase 64 synthesizes a stronger operational Tier 2 registry from existing tests. Tier 2 removals require escalation.

| Option | Description | Selected |
|--------|-------------|----------|
| Any leak is blocker | Any Tier 1/Tier 2 match fails Phase 64. | |
| Tiered severity | Tier 1 leaks block; Tier 2 blocks when exploitable or persisted. | |
| Artifact persistence focused | Persisted artifact leaks block; transient fixtures may be allowed. | Yes |
| Other | User-defined classification rule. | |

**User's choice:** Persistence-driven rule based on option 3.
**Notes:** Tier matches block only when persisted/emitted in evidence surfaces. Test-source sentinels and in-memory fixtures are allowed if not written/logged/emitted/uploaded/release-evidenced. HTTP bodies are outside sweep unless captured by evidence. Gray-zone emission paths escalate.

| Option | Description | Selected |
|--------|-------------|----------|
| Test coverage only | Passing tests are durable evidence; no extra generated proof files. | |
| Verification doc summary | Add a Phase 64 verification note with inspected surfaces, denylist tiers, and outcomes. | Yes |
| Machine-readable artifact summary | Generate metadata-only JSON summary of inspected files/events and denylist results. | |
| Other | User-defined evidence format. | |

**User's choice:** Verification doc summary.
**Notes:** Write `PROOF-02 Metadata-Only Sweep` in `64-VERIFICATION.md` with structured tables. Store metadata only: surface name, path, command, count, pass/fail/escalation status, and facts proven. No raw matched content or raw evidence payload. JSON is not default unless needed to avoid false-pass.

---

## Harness Versus Local Test Evidence

| Option | Description | Selected |
|--------|-------------|----------|
| Only for cross-step behavior | Use harness only for multi-turn chat, SSE ordering over time, or artifact generation. | |
| For release-proof bundle | Add one dedicated Phase 64 harness scenario for v2.3 integrity checks. | |
| Avoid harness unless required | Prefer unit/integration plus `64-VERIFICATION.md`; add harness only for false-pass risk. | Yes |
| Other | User-defined harness threshold. | |

**User's choice:** Harness default off.
**Notes:** Add/update focused harness only when a concrete false-pass risk cannot be closed by unit/integration plus `64-VERIFICATION.md`. Planner must name the trigger.

| Option | Description | Selected |
|--------|-------------|----------|
| Inspect but do not regenerate by default | Read artifact summaries/manifests; regenerate only if stale or harness changes. | |
| Regenerate relevant artifacts | Re-run relevant harness scenarios for fresh proof artifacts. | |
| Ignore existing harness artifacts | Use ordinary tests/gates unless a new focused harness is required. | |
| Other | User-defined artifact handling rule. | Yes |

**User's choice:** Two-axis harness artifact rule.
**Notes:** Privacy sweep enumerates all on-disk `tests/harness/artifacts/**` regardless of freshness. Behavior evidence cannot cite old artifacts as current proof unless rerun or proven non-stale. Generated artifacts must not be hand-edited.

| Option | Description | Selected |
|--------|-------------|----------|
| Release gate only plus targeted tests | Baseline/final `release:check` plus focused tests where Phase 64 changes code/tests. | |
| Full local proof set | Run TypeScript, unit, integration, relevant harnesses, and release check. | |
| Planner decides from changed files | Use verification matrix after planning determines exact edits. | |
| Other | User-defined command policy. | Yes |

**User's choice:** Three-phase command policy.
**Notes:** Baseline runs `yarn release:check`. Mid-phase uses AGENTS.md targeted gates and only scoped harness commands. Closure runs explicit `yarn tsc --noEmit` and `yarn release:check`.

---

## Release Gate And Known Failure Handling

| Option | Description | Selected |
|--------|-------------|----------|
| A/B/C buckets | A true v2.3 regression; B Phase 64 proof failure; C unrelated pre-existing/external. | Yes |
| By command stage | Separate TypeScript, unit, integration, build, and artifact/privacy failures first. | |
| By ownership | Separate Phase 60-63, Phase 64, dependency/platform, and unrelated product failures. | |
| Other | User-defined failure taxonomy. | |

**User's choice:** A/B/C buckets.
**Notes:** Stage and ownership are recorded as triage metadata, not replacement policy.

| Option | Description | Selected |
|--------|-------------|----------|
| Presumed A until proven otherwise | Treat known envelope-consumer failures as v2.3 blockers unless proven unrelated. | |
| Known deferred candidate C | Treat as known deferred unless they block release or create stale evidence. | |
| Planner must re-evaluate | Do not pre-classify; assign A/B/C from current output. | |
| Other | User-corrected premise and rule. | Yes |

**User's choice:** Corrected premise.
**Notes:** There is no currently known active Phase 63 strict `daily_summary` envelope consumer failure. Do not pre-create an item. If it reappears, default A unless evidence supports C; B only if caused by Phase 64 proof additions.

| Option | Description | Selected |
|--------|-------------|----------|
| Written verification note only | Record failure, C rationale, and why Phase 64 is not fixing it. | |
| User approval required | Stop and get approval before claiming partial closeout. | |
| Separate follow-up artifact | Create a deferred item/todo and record it in verification. | |
| Other | User-defined deferral bar. | Yes |

**User's choice:** Two-level Bucket C deferral.
**Notes:** Routine Bucket C items can be recorded in `64-deferred-items.md` plus `64-VERIFICATION.md`. Unclear/broad/uncertain C requires current-thread user approval. At closure, red `release:check` from Bucket C requires explicit approval for the exact exception list and cannot claim full PROOF-03 green.

| Option | Description | Selected |
|--------|-------------|----------|
| Still run the planned PROOF-02 sweep | Green baseline proves release gate, not metadata-only sweep. | Yes |
| Use it as closure baseline | Record green baseline and add documentation only. | |
| Skip mid-phase proof additions | Green baseline plus existing evidence is enough unless final gate fails. | |
| Other | User-defined green-baseline behavior. | |

**User's choice:** Still run the planned PROOF-02 sweep.
**Notes:** Green baseline means no baseline release blocker, but Phase 64 still enumerates harness artifacts, runs targeted redaction/artifact/trace evidence, writes `PROOF-02 Metadata-Only Sweep`, and reruns closure gates.

---

## the agent's Discretion

- Planner may choose exact tests, files, and sweep organization after seeing baseline gate and sweep results.
- Planner may choose whether to use unit/integration, static/source contract, or focused harness coverage under the locked false-pass-risk rule.
- Planner may choose the exact `64-VERIFICATION.md` table shape, as long as it remains metadata-only.

## Deferred Ideas

None.
