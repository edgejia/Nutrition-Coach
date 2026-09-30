# Phase 128 historical evidence archive

archiveStatus: historical-non-runnable
archiveStage: deletion-approved
evidenceMode: metadata-only
provenance: unsigned-metadata-only

The archive keeps two separate discovery provenances. The
`observedLocal*` fields preserve the historical dirty-worktree observation
(`fd54629f...`, 990 bytes; canonical payload `e2a43ec...`, 2500 bytes) as
pre-removal evidence only. That payload is never re-derived from the current
worktree and is not a claim about the submitted tree.

The `committedHead*` fields are a separate clean-clone-equivalent proof. The
contract reconstructs the scan inputs with `git show HEAD:package.json`,
`git show HEAD:.github/workflows/pr-check.yml`,
`git show HEAD:.github/workflows/manual-release-diagnostic.yml`,
`git show HEAD:scripts/release-check.mjs`, and
`git show HEAD:tests/harness/run.ts`; it records scan hash `a44ab5ec...`
with 992 bytes and canonical payload `a9325c27...` with 2502 bytes. A dirty
worktree must not be allowed to overwrite, satisfy, or be confused with this
committed-HEAD provenance.

This directory preserves the exact text of the two Phase 128 evidence surfaces
before their runnable sources are removed. The `.md` snapshots are historical
inspection records only; they are not package-test or harness inputs. No
generated harness artifacts, prompts, provider payloads, images, cookies,
tokens, database dumps, or private logs are retained here.

`preRemovalDiscoveryCallers` records the live package/CI discovery that existed
while the original readiness test was still present. In particular, the
readiness source matched both package test globs and was transitively included
by the release gate; the artifact-integrity scenario had only dynamic-name
harness reachability and no static invocation in the observed-local bounded
scan. This historical payload remains evidence of what was observed before
removal, not a current or committed-HEAD caller result.

`postRemovalActiveCallers` is `0` after Task 2 proved source absence and the
named replacement contract passed. `supersededBy` identifies the replacement
proof and the retained harness lifecycle/artifact controls; the remaining risk
is that future package or dynamic-loader changes need another bounded caller
scan.

The archive is metadata-only and does not claim runtime execution, browser
approval, public-origin smoke, or release approval.

[Canonical workflow inventory](../../../docs/workflow/gsd-workflow-inventory.md)
