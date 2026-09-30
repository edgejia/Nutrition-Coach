# Contributing

Nutrition Coach uses the GSD issue-first contribution flow.

## Branches

- `main` is the source release branch. Do not do active development on `main`.
- GSD milestone work uses `gsd/{milestone}-{slug}` branches by default.
- Source release flow is `gsd/* -> PR -> main`.
- `staging` is a legacy Railway-era branch. Do not use it as a required promotion path unless the current thread explicitly asks for legacy staging work.
- Production runtime refresh is separate from source release. The current runtime is a local production-mode server exposed through Cloudflare Tunnel and requires explicit approval before refresh, tunnel changes, or public-domain smoke.

## Issues First

Open an issue before opening a pull request.

- Feature, enhancement, and maintenance work uses the unified `.github/ISSUE_TEMPLATE/change_request.yml` form. Select exactly one request type: `Feature`, `Enhancement`, or `Maintenance`.
- Bug fixes continue to use the structured `.github/ISSUE_TEMPLATE/bug_report.yml` form.
- Maintainers apply the existing issue type labels after triage: `feature-request`, `enhancement`, `bug`, or `type: chore`. Feature, enhancement, and bug work also requires its existing typed approval label (`approved-feature`, `approved-enhancement`, or `confirmed-bug`) on that same issue.
- `ready-for-pr` is a manual issue-side gate. Every linked closing issue must carry it before a PR is opened; a PR label or a label on another issue cannot substitute for it.
- The forms use fixed `change-request` and `needs-review` labels only. No workflow creates a new remote label for a request type.

Maintainers may close or request revisions for issues that skip required fields.

## Pull Requests

Use the single generic `.github/PULL_REQUEST_TEMPLATE.md`. Set exactly one request marker in the template: `[Feature]`, `[Enhancement]`, `[Bug]`, or `[Chore]`. `Maintenance` requests use `[Chore]` with the existing `type: chore` issue label.

Every PR must:

- Link one or more ready issues with `Closes #NNN`, `Fixes #NNN`, or `Resolves #NNN`.
- Target `main` from a GSD work branch unless the current thread explicitly asks for a different base.
- Keep one concern per PR.
- Avoid unrelated formatting churn or cleanup.
- Describe verification, risk, and breaking-change impact.
- Update `CHANGELOG.md`, or apply `no-changelog` to the pull request only. An issue-side `no-changelog` label is not a changelog decision.
- Pass `yarn release:check` locally when practical.
- Pass CI `Release Check`.
- Receive review approval before merge.
- State whether source release, merge, tag movement, production runtime refresh, Cloudflare Tunnel changes, and public-domain smoke are out of scope or separately approved. PR readiness is not authority for any of them.

## Labels

GSD gate labels:

- `needs-review`
- `approved-feature`
- `approved-enhancement`
- `needs-triage`
- `confirmed-bug`
- `gate-violation`
- `no-changelog`

Issue type labels:

- `feature-request`
- `enhancement`
- `bug`
- `type: chore`

Repository-specific labels such as `priority:P0` through `priority:P3`, `security`, `backend`, and `orchestrator` may be added for planning and routing.

## CI

PRs to `main` run `.github/workflows/pr-check.yml`, which executes:

```bash
yarn release:check --base=origin/${RELEASE_BASE_REF}
```

Branch protection should require the `Release Check` status before merge when GitHub plan support allows it.
