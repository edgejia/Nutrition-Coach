# ADR 0010: Nutrition Safety Product Floor

**Status:** Accepted
**Date:** 2026-07-10
**Milestone:** v3.4 Portfolio Narrative & Demo Baseline
**Requirements:** WRITE-01 / WRITE-02

## Context

Nutrition Coach can generate, propose, and persist daily nutrition targets. The repository already has prompt, policy, service, route, and deterministic test coverage around a 1200 kcal/day boundary, but it did not have a public decision record explaining the scope of that number.

The boundary needs a deliberately narrow interpretation. It prevents this product from helping set an extreme low-calorie daily goal. It is not a claim that one number describes every person's nutritional needs, and implementation code is not clinical authority.

## Decision

Nutrition Coach uses 1200 kcal/day as a conservative, non-clinical product safety floor. It is **not universal medical advice or a personalized clinical recommendation**. This repository does not prove that 1200 kcal/day is clinically suitable for every person.

The floor has these exact product semantics:

- A daily calorie target below 1200 fails closed. Goal-update and proposal paths must not persist it or create hidden approval state that could later apply it.
- A target of exactly 1200, or a target above 1200, passes only the floor check. It must still satisfy source authority, proposal and confirmation rules where applicable, macro credibility, route validation, and every other existing guard before mutation.
- Onboarding target generation applies goal-specific calorie bounds that are never lower than this product floor. Rejected generated targets are retried and then use deterministic goal defaults through the existing fallback path. The existing higher minimum for a goal such as muscle gain is a separate domain bound, not a new clinical tier.

Enforcement remains split across four layers so no single layer is presented as sufficient authority:

1. **Prompt guidance.** [`server/orchestrator/system-prompt.ts`](../../server/orchestrator/system-prompt.ts) tells the model-facing workflow that sub-floor daily goals must not be proposed or applied and that exact-floor or higher values remain subject to authorization and other guards. This is guidance, not mutation authority. Named prompt-contract tests prove that this guidance is present.
2. **Shared product policy.** [`server/orchestrator/nutrition-safety-policy.ts`](../../server/orchestrator/nutrition-safety-policy.ts) owns the shared `NUTRITION_SAFETY_CALORIE_FLOOR` value and `checkNutritionSafetyTargets()` decision. It rejects values below the floor and allows values at or above it to continue to later checks.
3. **Guarded API, service, proposal, and mutation paths.** The device API evaluates the candidate target before persistence; chat tool paths combine the shared floor with source-authority, proposal, confirmation, and macro-consistency gates; onboarding target generation validates goal-specific bounds and falls back deterministically. ADR [0003](0003-structured-boundaries-and-authoritative-state.md) explains why validated backend state is authoritative, and ADR [0006](0006-agent-side-effect-policy-taxonomy.md) explains why proposal copy is not mutation authority and why side effects remain guarded.
4. **Named executable evidence.** Unit and integration tests below prove specific repository behavior. Source links identify implementation locations, but they are not used alone as proof of runtime behavior.

## Consequences

- Product behavior has a clear fail-closed lower boundary without presenting the repository as a medical decision system.
- Passing the floor check never implies that a target is authorized, macro-credible, personalized, or clinically appropriate.
- Prompt wording is defense in depth. Backend policy and committed state remain authoritative when model output or user text requests a side effect.
- Onboarding output that violates its calorie bounds or macro-consistency rules cannot be persisted as generated truth; the service retries and then returns existing deterministic defaults.
- The evidence is deterministic application proof under defined test conditions. It does not establish universal safety, live-model compliance, medical efficacy, or suitability for an individual.
- Future changes to the number or its scope require a new product decision and updated executable evidence; they must not be inferred from private notes or from implementation constants alone.

## Verification

The following named public tests are the primary behavior evidence:

| Layer | Named executable evidence | What it proves |
| --- | --- | --- |
| Prompt | [`tests/unit/system-prompt.test.ts`](../../tests/unit/system-prompt.test.ts): `names 1200 kcal/天 as the user-facing daily goal safety floor`; `allows exact-floor and above-floor daily calorie targets when otherwise authorized` | The prompt states the floor and preserves the distinction between passing the floor check and being otherwise authorized. |
| Shared policy | [`tests/unit/nutrition-safety-policy.test.ts`](../../tests/unit/nutrition-safety-policy.test.ts): `exports the locked non-clinical calorie floor and reason`; `rejects target patches below the calorie floor`; `allows target patches at or above the calorie floor` | The shared policy rejects 500 and 1199, while 1200 and 1500 pass this check. |
| Proposal integrity | [`tests/unit/goal-adjustment-policy.test.ts`](../../tests/unit/goal-adjustment-policy.test.ts): `returns active_at_floor when the visible proposal is already at the product floor`; `rejects below-floor proposed targets`; `rejects macro/calorie diff over 10%` | Relative-lower proposals stop at the floor, sub-floor proposals fail, and macro credibility remains an independent guard. |
| Onboarding service | [`tests/unit/target-generation.test.ts`](../../tests/unit/target-generation.test.ts): `maps calorie bounds failures to bounds_failed without logging rejected values or bounds`; `returns deterministic fallback defaults after the second normal failure` | Out-of-bounds generated targets are rejected with metadata-only classification and repeated normal failure reaches deterministic fallback. |
| Chat proposal/mutation path | [`tests/integration/chat-goal-update.integration.test.ts`](../../tests/integration/chat-goal-update.integration.test.ts): `blocks unsafe current-turn goal updates without mutation or goals_update publish`; `blocks unsafe goal proposals without an actionable card or hidden pending state`; `rejects exactly-floor calorie-only updates when existing macros would over-allocate calories`; `UAT-21 accepts a clear floor-proposal confirmation idiom through the guarded goal approval path` | Below-floor chat paths do not mutate or leave approval authority; exact-floor handling still requires macro consistency and guarded confirmation. |
| REST API | [`tests/integration/device-api.test.ts`](../../tests/integration/device-api.test.ts): `PUT /api/device/goals rejects below-floor calorie targets before persistence`; `PATCH /api/device/goals rejects below-floor calorie targets before persistence`; `PUT /api/device/goals rejects calorie-only exact-floor targets when persisted macros exceed calories`; `PUT /api/device/goals allows complete macro-credible exact-floor targets` | Both REST aliases reject sub-floor candidates, and exact-floor success remains conditional on a complete macro-credible target. |

Run the focused evidence set with:

```sh
node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/system-prompt.test.ts tests/unit/nutrition-safety-policy.test.ts tests/unit/goal-adjustment-policy.test.ts tests/unit/target-generation.test.ts tests/integration/chat-goal-update.integration.test.ts tests/integration/device-api.test.ts
```

The expected result is a passing deterministic suite with no product-code changes. These tests establish the bounded application behavior described above; they do not establish clinical suitability or universal model behavior.
