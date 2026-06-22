# Codex PR And CI Runbook

Read this only when GitHub issue state, PR policy, PR body, review threads, CI, or `$gsd-ship` source readiness is in scope.

## Integrated Flow

- GSD prepares local work: planning, implementation, targeted verification, review, closeout, and PR-ready source state.
- GitHub validates source release readiness: tracker issues, PR policy, CI release checks, review, and merge approval.
- Production runtime refresh is a separate release gate and is not part of ordinary PR validation.

## Issue And PR Policy

- GitHub issues are the approval and tracking source for PRs. Use the issue templates under `.github/ISSUE_TEMPLATE/`.
- Feature PRs require a linked issue with `approved-feature`; enhancement PRs require `approved-enhancement`; fix PRs require `confirmed-bug`.
- PR body or title must link at least one tracker issue with a closing keyword such as `Closes #123`, `Fixes #123`, or `Resolves #123`.
- PRs must not include `.planning/**` because GSD state is local-only.
- PRs must update `CHANGELOG.md` or carry the `no-changelog` label.
- Chore or other PRs still need a linked tracker issue and changelog decision, but the repo policy does not require a feature/enhancement/fix approval label unless that PR kind is detected.

## CI Behavior

- `.github/workflows/pr-check.yml` runs on pull requests targeting `main` and on manual `workflow_dispatch`.
- Pull request CI runs `yarn pr:policy` before dependency install and release verification.
- CI prepares `.env` from `.env.example`, then runs `yarn release:check --base=origin/<base>`.
- `scripts/pr-policy-check.mjs` is the source of truth for linked issue, approval labels by PR kind, `.planning/**` exclusion, and changelog/no-changelog policy.
- `scripts/release-check.mjs` is the source of truth for timezone, TypeScript, full Node test suite, and frontend build release checks.
- Phase 100 documents `yarn deps:audit` as dependency advisory evidence for source-readiness review and ADR 0009 triage; CI `release:check` still consists of timezone, TypeScript, Node tests, and frontend build unless a future phase explicitly wires a new gate.
- Phase 101 documents `yarn native:check` as native dependency/source-readiness evidence for `sharp` upgrades, `better-sqlite3` upgrades, and v3.1 source-release review. It remains separate from default PR CI and `release:check`; passing it does not approve production runtime refresh, Cloudflare Tunnel changes, public smoke, tag movement, `main` promotion, or direct pushes.
- Native evidence follows ADR 0009: sanitized console summaries only, with no raw image bytes, DB row dumps, copied DB files, session material, secrets, prompts, provider payloads, or assistant text.

## Agent Behavior

- Do not treat GSD closeout, local verification, PR creation, or CI success as approval to merge.
- Use GitHub tooling when live issue labels, PR body, review threads, CI status, or remote branch state are required.
- If GitHub state is unavailable locally, report which policy item cannot be proven instead of guessing.
