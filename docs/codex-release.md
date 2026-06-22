# Codex Release And Runtime Runbook

Read this only for source release, production runtime refresh, public-domain smoke, or milestone closeout release guardrails.

Keep source release and production runtime refresh separate.

## Gate Separation

Treat each gate below as a separate approval and evidence point:

- [ ] source readiness: local GSD work, source docs, and required local checks show the branch is ready for review.
- [ ] PR/CI success: the GitHub PR, policy gate, and CI checks pass for the proposed source change.
- [ ] production runtime refresh: the user explicitly approves refreshing the selected production-mode runtime from the intended source checkout.
- [ ] Cloudflare Tunnel changes: the user explicitly approves any tunnel route, hostname, connector, or origin change.
- [ ] public-domain smoke: smoke evidence passes against the Cloudflare Tunnel public hostname after runtime refresh.

Passing one gate does not approve or imply any later gate.

## Source Release Path

- Work happens on a non-`main` branch, normally a GSD milestone branch.
- GSD phases and closeout produce PR-ready source state.
- Before opening or updating a PR to `main`, run the appropriate local verification; for release readiness run `yarn release:check`.
- Open a GitHub PR to `main` with the right template, linked issue, changelog decision, and verification evidence.
- CI must pass `yarn pr:policy` and `yarn release:check --base=origin/<base>`.
- Review and merge approval are required before `main` changes. Agents must not merge, push directly to `main`, rebase `main`, or move tags without explicit approval in the current thread.

## Production Runtime Refresh Path

- Runtime refresh starts only after the source release is merged to `main` and the user explicitly approves production runtime refresh in the current thread.
- Use the intentionally selected source checkout, normally `main` after merge.
- Run `yarn release:check`, then build, migrate, and start the local production-mode Fastify server as documented in `docs/deploy/cloudflare-tunnel.md`.
- Use the stable Cloudflare Tunnel public hostname for smoke. Do not use localhost, Vite dev server, frontend build success, or CI success as public-domain production evidence.
- Mark production runtime refreshed only after the public-domain Cloudflare Tunnel smoke checklist passes.

## Release Guardrails

- `staging` is a legacy Railway-era branch, not the default source release or runtime promotion path.
- `.planning/config.json` sets `git.create_tag: false`. Do not create, move, or push tags unless the user explicitly approves tag semantics in the current thread.
- GSD plans, release-proof tasks, PR creation, CI success, closeout, or tunnel smoke approval do not imply approval for `main` merge, tag movement, Cloudflare Tunnel changes, or production runtime refresh.

## Public-Domain Smoke

- Use `nutrition-tunnel-smoke` for current Cloudflare Tunnel smoke checks.
- The smoke target must be the Cloudflare Tunnel public hostname that routes to the local production-mode Fastify server.
- Do not use localhost, the Vite dev server, frontend build success, or CI success as public-domain production evidence.
- Use Playwright or equivalent browser automation when the check depends on public-domain behavior, browser session continuity, mobile viewport validation, or screenshot evidence.

## Milestone Closeout Routing

- Use `$nutrition-milestone-closeout vX.Y` as the project-specific wrapper around `gsd-audit-milestone` and `gsd-complete-milestone`.
- That skill owns the operational closeout checklist, planning hygiene baseline, archive normalization, post-closeout checks, and final response shape.
- Closeout produces PR-ready source state while keeping GSD state local.
- PRE-CLOSEOUT contains only blockers or information the archived version will need later. Exploratory or trend work belongs in optional follow-up or the next milestone backlog.
- Generic GSD archive steps may reorganize local `.planning` files, but `.planning/**` must never be staged, committed, pushed, or force-added.
- Milestone closeout, verification, PR creation, CI success, and tunnel smoke approval do not imply `main` merge, tag creation, Cloudflare Tunnel changes, or production runtime refresh. Those require explicit approval in the current thread.
- If closeout policy changes, update `.codex/skills/nutrition-milestone-closeout/SKILL.md` first and keep `docs/codex.md` as routing only.
