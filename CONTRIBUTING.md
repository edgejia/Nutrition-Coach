# Contributing

Nutrition Coach uses the GSD issue-first contribution flow.

## Branches

- `feature/*` branches merge into `staging`.
- `staging` is the integration and Railway testing branch.
- `main` is production. Do not promote `staging` to `main` without explicit approval in the current thread.

## Issues First

Open an issue before opening a pull request.

- Feature work uses the `Feature request` template and must receive `approved-feature` before a feature PR opens.
- Enhancement work uses the `Enhancement` template and must receive `approved-enhancement` before an enhancement PR opens.
- Bug fixes use the `Bug report` template and must receive `confirmed-bug` before a fix PR opens.
- Maintenance work uses the `Chore` template and must be triaged before implementation starts.

Maintainers may close or request revisions for issues that skip required fields.

## Pull Requests

Use the typed PR template that matches the linked issue:

- Feature PR: `.github/PULL_REQUEST_TEMPLATE/feature.md`
- Enhancement PR: `.github/PULL_REQUEST_TEMPLATE/enhancement.md`
- Fix PR: `.github/PULL_REQUEST_TEMPLATE/fix.md`

GitHub does not automatically choose among multiple PR templates. Use the matching template query parameter when opening a PR from the browser, for example:

```text
?template=feature.md
?template=enhancement.md
?template=fix.md
```

Every PR must:

- Link the approved issue with `Closes #NNN`, `Fixes #NNN`, or `Resolves #NNN`.
- Target `staging` unless the current thread explicitly approves production promotion to `main`.
- Keep one concern per PR.
- Avoid unrelated formatting churn or cleanup.
- Describe verification, risk, and breaking-change impact.
- Pass `yarn release:check` locally when practical.
- Pass CI `Release Check`.
- Receive review approval before merge.

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

PRs to `staging` and `main` run `.github/workflows/pr-check.yml`, which executes:

```bash
yarn release:check --base=origin/${{ github.base_ref }}
```

Branch protection should require the `Release Check` status before merge when GitHub plan support allows it.

