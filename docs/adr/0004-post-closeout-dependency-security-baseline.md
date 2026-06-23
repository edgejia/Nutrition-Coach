# ADR 0004: Post-Closeout Dependency Security Baseline

## Status

Accepted for v2.5 closeout.

Current dependency advisory policy and current advisory triage records live in ADR 0009. This ADR remains the accepted historical v2.5 post-closeout dependency security baseline.

## Context

The v2.5 post-closeout dependency review found production dependency advisories after the milestone archive was complete. Patch-level fixes were available for the Fastify runtime path and transitive URL/glob parsing packages. Drizzle's patched version requires a major upgrade from `0.39.x` to `0.45.x`.

The Drizzle advisory applies to attacker-controlled SQL identifiers or aliases, especially `sql.identifier()` and dynamic `.as()` usage. A closeout code search found no `sql.identifier()` or `.as()` usage in app, test, or script TypeScript.

## Decision

- Patch Fastify from `5.8.4` to `5.8.5`.
- Patch `@fastify/static` from `9.1.1` to `9.1.3`.
- Add Yarn v1 resolutions for `fast-uri@3.1.2` and `brace-expansion@5.0.6` so transitive advisories are remediated without adding those packages to the app's top-level runtime API.
- Defer the Drizzle `0.45.x` major upgrade to the next dependency hardening slice, with a compatibility review before changing ORM behavior.

## Consequences

- `yarn audit --groups dependencies --json` is reduced to one remaining high advisory for `drizzle-orm`.
- The remaining advisory is not currently mapped to an observed vulnerable app pattern, but it should remain visible until the major upgrade is reviewed and completed.
- Future code that introduces user-controlled sort fields, dynamic report builders, dynamic aliases, or SQL identifier construction must use explicit allowlists and should trigger the Drizzle upgrade before release.

## Verification

- `rg -n "sql\\.identifier|\\.as\\(" server tests scripts --glob '*.ts' --glob '*.mjs'` found no matches.
- `yarn audit --groups dependencies --json` reports only the remaining Drizzle advisory.
- `yarn release:check` passes with `1,330` tests and a passing frontend production build.
