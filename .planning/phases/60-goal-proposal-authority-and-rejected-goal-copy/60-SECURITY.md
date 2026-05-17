---
phase: 60-goal-proposal-authority-and-rejected-goal-copy
secured: 2026-05-17T00:00:00+08:00
asvs_level: 1
threats_total: 11
threats_closed: 11
threats_open: 0
block_on: open
status: secured
---

# Phase 60 Security Audit

## Result

SECURED.

All declared mitigations in the Phase 60 threat register were verified against implemented code and tests. Documentation-only claims were not used as closure evidence.

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-60-01 | Tampering | mitigate | CLOSED | `server/services/goal-proposals.ts:3` imports `createTurnStateService`; `server/services/goal-proposals.ts:25` persists with `putState` under `GOAL_PROPOSAL_KIND`; `server/services/goal-proposals.ts:35` and `server/services/goal-proposals.ts:39` read/clear through turn state. Real SQLite tests prove create/overwrite/expiry/clear at `tests/unit/goal-proposals.test.ts:65`, `tests/unit/goal-proposals.test.ts:84`, `tests/unit/goal-proposals.test.ts:107`, and `tests/unit/goal-proposals.test.ts:122`; the overwrite test asserts one `turn_states` row for device/kind at `tests/unit/goal-proposals.test.ts:101`. |
| T-60-02 | Information Disclosure | mitigate | CLOSED | Goal renderer tests use exact output assertions for proposal, authority failure, validation, and cancel copy at `tests/unit/mutation-receipts.test.ts:135`, `tests/unit/mutation-receipts.test.ts:143`, `tests/unit/mutation-receipts.test.ts:153`, and `tests/unit/mutation-receipts.test.ts:176`. The goal-specific denylist covers proposal ids, `turn_states`, tool names, schema/source guard names, and API terms at `tests/unit/mutation-receipts.test.ts:33`; `assertNoGoalInternalTerms` also applies the shared forbidden receipt denylist at `tests/unit/mutation-receipts.test.ts:44`. |
| T-60-03 | Repudiation | mitigate | CLOSED | `tests/unit/goal-proposals.test.ts:65` proves `putLatest` creates generated proposal id, targets, and `createdAt`; `tests/unit/goal-proposals.test.ts:84` proves overwrite semantics; `tests/unit/goal-proposals.test.ts:107` proves expired state is unavailable; `tests/unit/goal-proposals.test.ts:122` proves `clear` removes the active proposal. |
| T-60-04 | Elevation of Privilege | mitigate | CLOSED | `update_goals` is a discriminated `mode` schema at `server/orchestrator/tools.ts:426`; runtime requires `mode` in tool parameters at `server/orchestrator/tools.ts:1406`. Override fields are checked with `checkSourceFields` using only `currentUserMessage` at `server/orchestrator/tools.ts:1437`; latest proposal mode requires active state and `isGoalProposalConsent` at `server/orchestrator/tools.ts:1454`. Tests cover missing mode rejection, current-turn-only authority, active proposal consent, no proposal failure, and mixed override at `tests/unit/update-goals-contract.test.ts:132`, `tests/unit/update-goals-contract.test.ts:157`, `tests/unit/update-goals-contract.test.ts:187`, `tests/unit/update-goals-contract.test.ts:215`, and `tests/unit/update-goals-contract.test.ts:249`. |
| T-60-05 | Tampering | mitigate | CLOSED | `propose_goals` calls `goalProposalService.putLatest` and returns `renderGoalProposalCopy` at `server/orchestrator/tools.ts:1384`; no `deviceService.updateGoals` or `publishGoalsUpdate` call exists in that contract. Unit test evidence at `tests/unit/update-goals-contract.test.ts:112` verifies unchanged targets, stored pending proposal, and zero publish calls. Fastify integration evidence at `tests/integration/chat-goal-update.integration.test.ts:171` verifies unchanged targets, no `dailyTargets`, and zero publish calls. |
| T-60-06 | Information Disclosure | mitigate | CLOSED | Tool summaries for goal tools include only tool names, mode, field names, and status at `server/orchestrator/tools.ts:1372`, `server/orchestrator/tools.ts:1412`, and redaction at `server/orchestrator/tools.ts:1545`. Unit tests deny target numbers, raw terms, proposal ids, and user text markers in summaries at `tests/unit/update-goals-contract.test.ts:396`, including numeric-deny checks at `tests/unit/update-goals-contract.test.ts:410`, `tests/unit/update-goals-contract.test.ts:423`, and `tests/unit/update-goals-contract.test.ts:433`. |
| T-60-07 | Denial of Service | mitigate | CLOSED | Zod schemas enforce strict `mode` and target ranges at `server/orchestrator/tools.ts:426`; public tool parameters require `mode` and expose bounded fields at `server/orchestrator/tools.ts:1402`. Malformed `update_goals` calls are adapted to controlled renderer rejection at `server/orchestrator/tools.ts:1636`. Unit tests reject empty args, missing mode, unknown fields, and out-of-range values at `tests/unit/update-goals-contract.test.ts:132` and `tests/unit/update-goals-contract.test.ts:338`; orchestrator/integration tests prove malformed calls do not fall through to a model reply at `tests/unit/orchestrator.test.ts:1676`, `tests/unit/orchestrator.test.ts:1701`, `tests/integration/chat-goal-update.integration.test.ts:404`, and `tests/integration/chat-goal-update.integration.test.ts:428`. |
| T-60-08 | Spoofing | mitigate | CLOSED | Controlled goal replies carry `source: "renderer"` at `server/orchestrator/tools.ts:1804` and `server/orchestrator/tools.ts:1830`; orchestrator final replies use that source at `server/orchestrator/index.ts:930`. Pre-LLM cancel also returns renderer metadata at `server/orchestrator/index.ts:636`. Unit tests assert renderer source/shape for proposal, validation, generic rejection, missing proposal, and cancel paths at `tests/unit/orchestrator.test.ts:1614`, `tests/unit/orchestrator.test.ts:1648`, `tests/unit/orchestrator.test.ts:1676`, `tests/unit/orchestrator.test.ts:1726`, and `tests/unit/orchestrator.test.ts:1748`. Route trace metadata is asserted at `tests/integration/chat-goal-update.integration.test.ts:277`. |
| T-60-09 | Tampering | mitigate | CLOSED | The orchestrator returns controlled replies before appending tool calls/messages for a later LLM round at `server/orchestrator/index.ts:930`; cancel preflight returns before model execution at `server/orchestrator/index.ts:636`. Tests assert exact backend copy and no second chat call for proposal, validation, empty args, missing mode, missing proposal, and cancel at `tests/unit/orchestrator.test.ts:1614`, `tests/unit/orchestrator.test.ts:1648`, `tests/unit/orchestrator.test.ts:1676`, `tests/unit/orchestrator.test.ts:1701`, `tests/unit/orchestrator.test.ts:1726`, and `tests/unit/orchestrator.test.ts:1748`. |
| T-60-10 | Information Disclosure | mitigate | CLOSED | Trace proof asserts only final reply source/shape and operational tool-result metadata at `tests/integration/chat-goal-update.integration.test.ts:287` and `tests/integration/chat-goal-update.integration.test.ts:291`. The same test serializes the trace and denies raw user text, final renderer copy, raw mode payload, model text, session cookie/header material, guest-session naming, image data, provider body, and database references at `tests/integration/chat-goal-update.integration.test.ts:302`. |
| T-60-11 | Repudiation | mitigate | CLOSED | No-publish and unchanged-target behavior is tested for proposal creation at `tests/integration/chat-goal-update.integration.test.ts:171`, missing proposal/guard failure at `tests/integration/chat-goal-update.integration.test.ts:251`, cancel and negated consent at `tests/integration/chat-goal-update.integration.test.ts:318` and `tests/integration/chat-goal-update.integration.test.ts:347`, validation failure at `tests/integration/chat-goal-update.integration.test.ts:377`, and malformed/missing mode failures at `tests/integration/chat-goal-update.integration.test.ts:404` and `tests/integration/chat-goal-update.integration.test.ts:428`. Tool-level tests additionally cover no-publish validation, guard, missing proposal, and cancel paths at `tests/unit/update-goals-contract.test.ts:187`, `tests/unit/update-goals-contract.test.ts:215`, `tests/unit/update-goals-contract.test.ts:278`, and `tests/unit/update-goals-contract.test.ts:308`. |

## Threat Flags

No unregistered flags.

- `60-01-SUMMARY.md`: no `## Threat Flags` section present.
- `60-02-SUMMARY.md`: `## Threat Flags` reports `None`.
- `60-03-SUMMARY.md`: `## Threat Flags` reports `None`.

## Review Fix Coverage

The security audit includes the code-review fixes documented in `60-REVIEW.md` and `60-REVIEW-FIX.md`.

- CR-01 negated consent is covered by anchored cancel/consent patterns in `server/orchestrator/source-text-guard.ts:46` and by unit/integration tests at `tests/unit/update-goals-contract.test.ts:278` and `tests/integration/chat-goal-update.integration.test.ts:347`.
- CR-02 malformed `update_goals.mode` is covered by controlled rejection adaptation in `server/orchestrator/tools.ts:1636` and by unit/integration tests at `tests/unit/orchestrator.test.ts:1676`, `tests/unit/orchestrator.test.ts:1701`, `tests/integration/chat-goal-update.integration.test.ts:404`, and `tests/integration/chat-goal-update.integration.test.ts:428`.

## Audit Notes

- Implementation files were read only.
- Only this file was created during the security audit.
- All threats use `mitigate`; there are no accepted or transferred risks in this phase register.
