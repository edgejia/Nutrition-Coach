---
phase: 74-home-meal-edit-entry-and-existing-edit-contract-review
secured: 2026-06-03
status: secured
asvs_level: 1
threats_total: 5
threats_open: 0
unregistered_flags: 0
---

# Phase 74 Security Audit

Scope: verify only the declared Phase 74 threat register. Implementation files were read-only; this report is the only file written by the audit.

Method: source/grep verification against the mitigation files, plus package-file status checks for the accepted no-install threat. Documentation and summaries were not accepted as mitigation evidence for code threats, except where the threat itself concerns generated documentation or accepted-risk logging.

Path note: the prompt listed `server/services/food-log.ts`, but that file is absent in this checkout. `server/routes/meals.ts:3` imports `../services/food-logging.js`; the audit verified `server/services/food-logging.ts` and the delegated mutation guard implementation in `server/services/meal-transactions.ts`.

## Threat Verification

| Threat ID | Category | Disposition | Status | Evidence |
|-----------|----------|-------------|--------|----------|
| T-74-01 | Tampering | mitigate | CLOSED | `client/src/components/MealEditScreen.tsx:185-186` and `:234-235` send `expectedMealRevisionId: payload.mealRevisionId`; `server/routes/meals.ts:193-214` runs the mutation guard and rejects grouped direct PATCH before update; `server/routes/meals.ts:288-293` parses expected revision before delete; `server/services/meal-transactions.ts:229-252` throws `MEAL_REVISION_REQUIRED` / `MEAL_REVISION_STALE`; `server/services/meal-transactions.ts:438-451` and `:492-507` assert revision before delete/update side effects; `tests/integration/meals-api.test.ts:474-611` proves missing/stale PATCH and DELETE return 409 with no summary/publish side effects; `tests/integration/meals-api.test.ts:1106-1169` proves grouped direct PATCH returns `MEAL_REQUIRES_GROUPED_UPDATE` without mutation. |
| T-74-02 | Elevation of Privilege | mitigate | CLOSED | `server/lib/guest-session-resolver.ts:36-44` and `:47-58` resolve device ownership from signed guest-session cookies; `server/routes/meals.ts:172-180` and `:275-283` derive mutation `deviceId` from that session; `server/services/meal-transactions.ts:154-176` looks up meals by `deviceId` and transaction id; `tests/integration/meals-api.test.ts:1072-1103` proves PATCH/DELETE require signed cookies; `tests/integration/meals-api.test.ts:1173-1200` proves another device receives 404; Home matrix/docs cite `/api/meals` read path only at `client/src/contracts/capability-matrix.ts:76-80` and `docs/capability-matrix.md:21`. |
| T-74-03 | Tampering | mitigate | CLOSED | `client/src/meal-edit-payload.ts:72-92` requires public id, revision, food name, finite nutrition, positive item count, and loggedAt; `client/src/meal-edit-payload.ts:118-127` returns `null` for missing revision/authority instead of fabricating identity; `client/src/components/HomeScreen.tsx:447-465` renders complete rows as edit buttons and incomplete rows as read-only articles; `client/src/components/HomeScreen.tsx:455-458` calls `openMealEdit(editPayload, "home")`; `client/src/components/MealEditScreen.tsx:185-186` and `:234-235` consume only `payload.mealRevisionId` for writes; `tests/unit/meal-edit-payload.test.ts:139-167` and `:174-204` prove null fallback and grouped authority preservation; `tests/unit/home-dashboard-contract.test.ts:185-213` source-tests eligible/ineligible split. |
| T-74-04 | Repudiation / Integrity | mitigate | CLOSED | Home matrix row cites concrete Home handler evidence at `client/src/contracts/capability-matrix.ts:69-83`; Day Detail removes `openMealEdit` and keeps only `onBack` at `client/src/contracts/capability-matrix.ts:267-278`; generated docs state they are generated from source at `docs/capability-matrix.md:1-5`, show Day Detail read-only at `:13`, and Home eligible edit behavior at `:21`; generator source/check path is `scripts/generate-capability-matrix-doc.mjs:7-9` and `:22-68`; `package.json:18-20` wires `matrix:gen`, `matrix:gen:check`, and `matrix:check`; matrix tests enforce Home/Day Detail claims at `tests/unit/capability-matrix-contract.test.ts:240-280` and source-near-handler evidence at `tests/unit/capability-matrix-source-scan.test.ts:257-283`. |
| T-74-SC | Tampering | accept | CLOSED | Accepted risk logged below. Phase summaries each report no added tech stack at `74-01-SUMMARY.md:19-20`, `74-02-SUMMARY.md:20-21`, and `74-03-SUMMARY.md:19-20`; each `## Threat Flags` section is `None` at `74-01-SUMMARY.md:107-109`, `74-02-SUMMARY.md:117-119`, and `74-03-SUMMARY.md:128-130`; `git diff -- package.json yarn.lock` produced no output; Phase 74 task commits did not list `package.json` or `yarn.lock`. |

## Accepted Risks Log

| Threat ID | Risk | Acceptance Basis | Owner / Review Trigger |
|-----------|------|------------------|------------------------|
| T-74-SC | Package-install tampering was not actively mitigated with a supply-chain review because no package installation was planned or performed in Phase 74. | Summaries show `tech-stack.added: []`; threat flags are `None`; package files have no Phase 74 diff. | Re-open if any Phase 74 follow-up modifies `package.json`, `yarn.lock`, or introduces `npm`, `pip`, `cargo`, or `yarn add` activity. |

## Unregistered Flags

None. All three Phase 74 summaries state `Threat Flags: None`, and no summary-reported new attack surface required mapping to an additional threat ID.

