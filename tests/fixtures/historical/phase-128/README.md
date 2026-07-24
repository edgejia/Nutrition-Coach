# Phase 128 historical evidence archive

archiveStatus: historical-non-runnable
archiveStage: pre-removal
evidenceMode: metadata-only

This directory preserves the exact text of the two Phase 128 evidence surfaces
before their runnable sources are removed. The `.md` snapshots are historical
inspection records only; they are not package-test or harness inputs. No
generated harness artifacts, prompts, provider payloads, images, cookies,
tokens, database dumps, or private logs are retained here.

`preRemovalDiscoveryCallers` records the live package/CI discovery that existed
while the original readiness test was still present. In particular, the
readiness source matched both package test globs and was transitively included
by the release gate; the artifact-integrity scenario had only dynamic-name
harness reachability and no static invocation in the bounded scan.

`postRemovalActiveCallers` is intentionally `pending-until-task-2` at this
archive-first stage. Task 2 will prove source absence and update it to `0`
after the named replacement contract has passed. `supersededBy` identifies the
replacement proof and the retained harness lifecycle/artifact controls; the
remaining risk is that future package or dynamic-loader changes need another
bounded caller scan.

The archive is metadata-only and does not claim signed provenance, runtime
execution, browser approval, public-origin smoke, or release approval.

[Canonical workflow inventory](../../../docs/workflow/gsd-workflow-inventory.md)
