# Historical UI Visual Script Archive

archiveStatus: historical-non-runnable
evidenceMode: metadata-only
retainedActiveScenario: tests/harness/scenarios/110-home-nutrition-animation-visual.mjs
aggregateFile: visual-scripts-aggregate.mjs.md
callerEvidence: caller-evidence.txt
sanitizationPolicy: deterministic-redaction-v1
visualReview: human-only-not-recorded
browserRun: not-executed
publicOriginSmoke: not-executed
provenance: unsigned-metadata-only

This directory holds the initial history-cleanup wave for seven executable visual
scenario files with zero callers. The aggregate is a non-runnable, sanitized
metadata snapshot: raw image payloads and device/session identifiers are removed
and replaced with deterministic non-reconstructive hash/byte-length markers.
manifest.json keeps originalSource hash/byte metadata as pre-sanitization
evidence and separately records sanitizedSnapshot hashes/byte lengths for the
current aggregate sections.

The source files were removed only after the pre-delete caller scan in
caller-evidence.txt recorded the exact command, all seven source exclusions,
the empty filtered path list, result code, hash, byte length, and
sourcePresentBeforeDelete: true. The evidence is recoverable metadata, not a
subjective UI decision; it does not restore the redacted source payloads.

The active Home nutrition animation scenario
(110-home-nutrition-animation-visual.mjs) remains in the executable harness.
Phase 64 material, phase 45 mobile evidence, demo runbooks, high-density
contracts, and generated harness artifacts are outside this archive scope.

This archive does not represent a browser run, a public-origin smoke result, or
a cryptographic attestation. Historical behavior is not re-executed or
recoverable from the sanitized snapshot; any future visual evaluation must be
run and judged separately.
