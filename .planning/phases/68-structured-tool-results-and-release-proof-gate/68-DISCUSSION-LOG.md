# Phase 68: Structured Tool Results and Release-Proof Gate - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md - this log preserves the alternatives considered.

**Date:** 2026-05-29
**Phase:** 68-Structured Tool Results and Release-Proof Gate
**Areas discussed:** Structured Result Boundary, Historical Clarification Behavior, Proof Strategy, Release Evidence Shape

---

## Structured Result Boundary

| Question | Options Presented | Selected |
|----------|-------------------|----------|
| How broad should the structured result boundary be? | Typed adapter fields only; Pass contract results through; Minimal targeted fields | Typed adapter fields only |
| What should the typed clarification union contain? | Status + renderer payload; Per-tool optional fields; Renderer text only plus reason | Status + renderer payload |
| How should candidate facts be exposed inside that union? | Reuse existing renderer candidate projection; Carry service candidates directly; Text-only candidate labels | Reuse existing renderer candidate projection |
| Where should rendering decisions live after the typed clarification union exists? | Renderer helpers stay authoritative; Orchestrator owns terminal rendering; Tool contracts return final text only | Renderer helpers stay authoritative |

**User's choice:** Keep `runContract()` and contract-specific results behind `executeTool()`. Extend `ToolExecutionResult` with a narrow discriminated union for renderer-ready clarification facts.

**Notes:** The union must support unresolved `find_meals`, historical `log_food`, and `get_daily_summary` clarification facts. Candidates should be allowlisted renderer-ready projections, not raw service candidates. Renderer/copy helpers remain authoritative; do not add Phase 68 clarification rendering into `server/orchestrator/index.ts`.

---

## Historical Clarification Behavior

| Question | Options Presented | Selected |
|----------|-------------------|----------|
| Should historical `log_food` clarification become a terminal renderer-owned reply? | Yes, renderer-owned terminal; Typed facts only, model can continue; No change for log_food | Yes, renderer-owned terminal |
| Should `get_daily_summary` date clarification also become a terminal renderer-owned reply? | Yes, both needs_clarification and multiple_targets; Only needs_clarification; No terminal summary clarification | Yes, both needs_clarification and multiple_targets |
| What should the terminal copy policy be for historical clarifications? | Backend/date-parser prompt as source, wrapped by renderer helper; Fully standardized renderer copy; Tool contract returns final text | Backend/date-parser prompt as source, wrapped by renderer helper |
| How should terminal historical clarification interact with mutation side effects? | Hard no-side-effect invariant; No mutation, but allow summary lookup artifacts; Existing behavior is enough | Hard no-side-effect invariant |

**User's choice:** Historical `log_food` and `get_daily_summary` clarification paths should become terminal renderer-owned replies from typed facts.

**Notes:** `get_daily_summary` `multiple_targets` asks the user to narrow to one date and does not create multi-date summary aggregation. Terminal historical clarification must produce no meal revision, `loggedMeal`, `summaryOutcome`, `daily_summary` publish, success receipt, success-style copy, or second LLM pass.

---

## Proof Strategy

| Question | Options Presented | Selected |
|----------|-------------------|----------|
| What should be the default proof level for structured result plumbing? | Targeted unit + integration tests; Add harness scenario by default; Unit tests only | Targeted unit + integration tests |
| Which existing test files should planners prefer for Phase 68 proof? | Reuse current correction/chat suites; Create new Phase 68 test files; Mostly source-contract tests | Reuse current correction/chat suites |
| What exact regressions must the proof matrix cover before Phase 68 can close? | Full phase matrix; Only new structured plumbing; Release gate only after targeted tests | Full phase matrix |
| How should metadata-only proof be handled if a harness is not added? | Verification doc/checklist plus normal test evidence; Generate a small metadata-only artifact manually; Skip PROOF-02 unless harness is used | Verification doc/checklist plus normal test evidence |

**User's choice:** Use targeted unit and integration tests by default, with harness coverage only as an escape hatch for specific false-pass risk.

**Notes:** Prefer existing suites: `tests/unit/tools.test.ts`, `tests/unit/orchestrator.test.ts`, `tests/integration/chat-meal-correction.integration.test.ts`, and affected `chat-api` / `chat-streaming` paths. Add a small source guard against serialized clarification-result reparsing returning. PROOF-01 requires full traceability, including carry-forward Phase 65-67 behavior families.

---

## Release Evidence Shape

| Question | Options Presented | Selected |
|----------|-------------------|----------|
| What artifact should capture the final release-proof evidence? | Phase verification file; Update only STATE.md / PROJECT.md; Harness-style generated artifact | Phase verification file |
| When should `yarn release:check` be run in Phase 68? | Final closure only, after targeted tests pass; After every plan; Do not run until ship workflow | Final closure only, after targeted tests pass |
| How should the phase record carry-forward evidence from phases 65-67? | Matrix rows can cite existing tests plus Phase 68 deltas; Re-run and relist every prior phase test individually; Only cite yarn release:check | Matrix rows can cite existing tests plus Phase 68 deltas |
| What should happen after local closure evidence is recorded? | Stop at local closure and present next ship command; Auto-start ship workflow; Prepare staging smoke checklist only | Stop at local closure and present next ship command |

**User's choice:** Record final local proof in `.planning/phases/68-structured-tool-results-and-release-proof-gate/68-VERIFICATION.md`.

**Notes:** `yarn release:check` is a final local closure gate after targeted tests pass. After local closure, stop and present the separate ship/promotion workflow. No push, merge, deploy, Railway smoke, staging promotion, or main promotion is implied.

---

## the agent's Discretion

- Exact TypeScript union names, discriminants, candidate projection type, and renderer helper organization are left to plan-phase.
- Exact test placement may be calibrated by the planner, with a preference for existing suites unless a new file reduces duplication.

## Deferred Ideas

None.
