# Phase 81 Mobile Action Safety Visual Evidence

This directory stores Phase 81 real-browser mobile evidence for Meal Edit bottom safety, Home CTA spacing, grouped row action localization, and empty Chat starter guidance.

Run from the repository root:

```bash
yarn build && node tests/harness/scenarios/81-mobile-action-safety-visual.mjs --output-dir tests/harness/artifacts/81-mobile-action-safety/latest
```

Use `--validate-harness` during Wave 1 setup to verify CLI parsing, local static serving, browser discovery, case registration, deterministic mock registration, safe output routing, and metadata-only manifest privacy without requiring later Phase 81 UI geometry assertions to pass:

```bash
yarn build && node tests/harness/scenarios/81-mobile-action-safety-visual.mjs --validate-harness --output-dir tests/harness/artifacts/81-mobile-action-safety/latest
```

The baseline viewport is `390x844`. The required cases are:

- `meal-edit-single-controls-mobile-390x844`
- `meal-edit-grouped-final-delete-blocking-mobile-390x844`
- `home-expanded-cta-options-mobile-390x844`
- `grouped-row-icon-controls-mobile-390x844`
- `chat-empty-starter-mobile-390x844`

Use `--case <case-id>` for a targeted rerun. Use `--include-360` only when implementation touches existing narrow-screen media rules or the `390x844` proof leaves uncertainty.

Artifacts under `latest/` are generated evidence and must be regenerated, not hand-edited. The harness writes PNG screenshots and a metadata-only `manifest.json`; it refuses output directories outside `tests/harness/artifacts/81-mobile-action-safety/latest`.

The harness serves built static assets from `dist/client` on loopback and installs deterministic browser mocks before app code runs. It must not call live `/api/chat`, OpenAI, Railway, external services, real device/session data, cookies, `OPENAI_API_KEY`, provider request bodies, raw prompts, database snapshots, or external URLs.
