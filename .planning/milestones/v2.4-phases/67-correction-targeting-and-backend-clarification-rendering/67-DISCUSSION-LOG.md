# Phase 67: Correction Targeting and Backend Clarification Rendering - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-29
**Phase:** 67-Correction Targeting and Backend Clarification Rendering
**Areas discussed:** Target Ranking Policy, Auto-Resolve vs Clarify Threshold, Clarification Copy and Candidate Labels, Follow-Up Selection Behavior

---

## Target Ranking Policy

| Question | Options | Selected |
|----------|---------|----------|
| For ambiguous correction targets, which ranking contract should Phase 67 lock? | Evidence tiers first; Recency-first for vague references; Strict evidence only; Other | Other |
| When should new user text contradict a pending/resolved target? | New target evidence contradicts; Only strong contradictions cancel; Pending target sticks until selection; Other | New target evidence contradicts |
| How should explicit food/item-label matching behave for grouped meals? | Item names and meal label both count; Item names outrank meal label; Meal label outranks item names; Other | Item names and meal label both count |
| How should explicit persisted mealPeriod compare with inferred mealPeriod? | Explicit period beats inferred period; Same tier, source only for tie-break; Inferred period never auto-resolves; Other | Other |

**User's choice:** Modified evidence-tier ranking. Explicit date is a hard scope filter. Within scope, evidence strength beats recency; recency is only a tie-breaker. Pending/resolved targets are cancelled by any non-matching explicit target evidence or action change. Food/item label evidence includes stored meal labels and item names. Explicit persisted period beats inferred period, but inferred period remains valid fallback evidence.

**Notes:** User rejected pure recency-first because food identity and explicit period words should beat blind newest. User rejected strict-evidence-only because useful recency shorthand should remain. User requested a regression where period word plus `那餐` resolves the period match instead of a newer non-matching meal.

---

## Auto-Resolve vs Clarify Threshold

| Question | Options | Selected |
|----------|---------|----------|
| When may the backend auto-resolve a target without asking a numbered clarification? | Clean unique hit only; Top score gap; Any positive best match; Other | Clean unique hit only, with recent-reference carve-out |
| How should period-only targeting behave after the date scope is set? | Unique period match resolves; Explicit period can resolve, inferred only clarifies; Period-only always clarifies; Other | Unique period match resolves, with recent-reference carve-out |
| How should food-label matches behave when combined with period or recency hints? | Label match scopes first; Period can override label; Label conflict clarifies; Other | Label match scopes first |
| What should happen when there are many possible candidates after narrowing? | Show top five candidates; Show all candidates; Ask for more detail first; Other | Show top five candidates |

**User's choice:** Auto-resolve only on a clean unique strongest hit. Recent-reference phrases can resolve the unique newest candidate allowed by the ranking policy. Period-only targeting can resolve a unique explicit or inferred period match; multiple period matches clarify unless a recent-reference word applies inside that period-matched set. Food labels narrow before period/recency. Clarification lists show at most five strongest-level candidates.

**Notes:** User rejected score-gap and permissive positive-match policies as too implementation-specific or too risky. User emphasized that the LLM infers operation and passes query, while backend owns target selection and mutators require resolver-owned meal id/revision.

---

## Clarification Copy and Candidate Labels

| Question | Options | Selected |
|----------|---------|----------|
| When backend-rendered numbered clarification is needed, what should each option include? | Date/time plus concise label; Date/time, period, and label; Full nutrition summary; Other | Other |
| What should the lead-in sentence say? | Direct numbered instruction; Target-aware instruction; More conversational question; Other | Other |
| How should not-found or no-safe-candidate copy behave? | Ask for date, period, or food name; Mention no matching stored meal; Show nearest candidates anyway; Other | Other |
| Should numbered clarification copy be renderer-owned terminal output, or may the LLM paraphrase it? | Renderer-owned terminal output; Renderer provides content, LLM may polish; Renderer for risky cases only; Other | Renderer-owned terminal output |

**User's choice:** Candidate options show stable number, date, time, concise stored/projected label, and explicit meal-period label only when persisted explicitly. No inferred period labels, no calories/macros by default, and no raw correction request as a meal name. Lead-in may be target-aware only with backend-derived matched stored evidence; otherwise use direct numbered instruction. No-safe-candidate paths should be scoped and fail-closed. Correction clarification is renderer-owned terminal output.

**Notes:** User wants `請直接回覆編號` always present. The exact plumbing for deriving a safe matched label remains plan-phase / Phase 68 boundary. Tone can be improved through renderer templates, not per-turn LLM paraphrase.

---

## Follow-Up Selection Behavior

| Question | Options | Selected |
|----------|---------|----------|
| After the backend renders numbered correction clarification, what follow-up replies should resolve the pending selection? | Number or exact safe label; Number only; Flexible natural language; Other | Other |
| What should happen for an invalid number or expired pending selection? | Re-show or restart safely; Treat invalid number as new query; Fail closed with generic message; Other | Other |
| If a follow-up reply both selects an option and adds mutation details, should it resolve and proceed? | Resolve then apply if safe; Selection only first; Clarify again; Other | Resolve then apply if safe |
| What should happen after a valid selection resolves but mutation cannot proceed due to stale revision, changed meal, or deleted meal? | Re-render current scoped options; Generic stale message; Auto-retarget by label; Other | Re-render current scoped options |

**User's choice:** Follow-up resolves only when it unambiguously maps to one rendered option: valid shown number/ordinal, exact safe stored/projected label or item label, or unambiguous rendered attribute. Invalid numbers re-show options. Delayed replies should be honored when the visible prompt can be recovered and revalidated. Mixed selection plus mutation detail is allowed, but target resolution and mutation authorization remain separate gates. Stale/deleted targets fail closed and recover with current scoped options when possible.

**Notes:** User explicitly rejected treating invalid numbers as fresh queries, hard TTL-only expiration, forcing users to repeat explicit mutation details, and auto-retargeting by label.

---

## the agent's Discretion

- Exact implementation data structures and persistence/recovery plumbing are left for plan-phase.
- Exact renderer template wording can be tuned if it preserves the locked behavior.
- Exact scoring mechanics are left to plan-phase as long as they implement evidence ordering and clean-unique threshold.

## Deferred Ideas

None — discussion stayed within Phase 67 scope.
