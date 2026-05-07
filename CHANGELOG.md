# Changelog

## v2.0 - 2026-05-07

### Added

- Capability matrix and source-contract checks for supported, read-only, hidden, and future-scope Sport UI affordances.
- Graceful Chat stop lifecycle for in-progress AI generation or meal analysis.
- Durable meal image continuity across Chat receipts, Today rows, History, Day Detail, Meal Edit, and authorized asset fetches.
- Canonical grouped meal logging semantics with item counts, grouped correction routing, grouped Meal Edit read-only item detail, and deterministic grouped-meal harness coverage.
- Redacted validation diagnostics for controlled goal and `log_food` validation failures.
- History stale-while-revalidate behavior and Home dashboard count-up / reduced-motion contracts.

### Changed

- Mobile app shell, Chat composer, compact Chat header, keyboard handling, and visual viewport behavior were hardened for primary logging flows.
- Successful meal logging and mutation replies are projected from normalized server state instead of relying on model-authored final text.
- `PATCH /api/device/goals` is documented as the canonical partial-update route while `PUT /api/device/goals` remains supported for compatibility.
- Meal Edit whole-photo framing now avoids fixed-ratio clipping and prevents portrait photos from overlaying grouped item rows.

### Verified

- `yarn release:check` passed before staging promotion and again before main promotion.
- Staging smoke passed on `https://nutrition-coach-stagin.up.railway.app/`.
- Production smoke passed on `https://nutrition-coach-production.up.railway.app/`.
- Phase 49 true-stack UAT passed 7/7 scenarios with real client/API/SQLite data and no route mocks.
