# Phase 87 Onboarding Age Wheel 320px Evidence

This directory stores Phase 87 real-browser 320px evidence for the onboarding Step 3 age wheel.

Run from the repository root:

```bash
yarn build && node tests/harness/scenarios/87-onboarding-age-wheel-320px-fix-visual.mjs --output-dir tests/harness/artifacts/87-onboarding-age-wheel-320px-fix/latest
```

Use `--validate-harness` during setup to verify CLI parsing, safe output routing, built `dist/client/index.html`, loopback static serving, browser discovery, CDP connection, screenshot byte checks, and metadata-only manifest privacy:

```bash
yarn build && node tests/harness/scenarios/87-onboarding-age-wheel-320px-fix-visual.mjs --validate-harness --output-dir tests/harness/artifacts/87-onboarding-age-wheel-320px-fix/latest
```

The fixed viewport is `320x760`, `deviceScaleFactor: 1`, and mobile mode enabled. The required generated cases are:

- `age-12-lower-bound`
- `age-90-upper-bound`
- `tap-age-selection`
- `drag-age-selection`

Artifacts under `latest/` are generated evidence and must be regenerated, not hand-edited. The harness writes PNG screenshots and a metadata-only `manifest.json`; it refuses output directories outside `tests/harness/artifacts/87-onboarding-age-wheel-320px-fix/latest`.

The manifest records selected values, wheel bounds, target bounds, duplicate actionable value checks, active-center no-op checks, overflow checks, and screenshot filenames. It excludes cookies, session identifiers, API keys, raw provider payloads, raw prompts, image bytes, database snapshots, raw user transcripts, and external URLs.

The harness serves built static assets from `dist/client` on loopback and installs deterministic browser mocks before app code runs. It must not call live `/api/chat`, OpenAI, Railway, external services, real session data, or non-loopback hosts.
