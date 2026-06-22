# ADR 0009: Dependency Advisory Policy

**Status:** Accepted
**Date:** 2026-06-22
**Milestone:** v3.1 Runtime & LLM Dependency Trust Baseline
**Requirement:** ADVS-01 / ADVS-02 / ADVS-03

## Context

Nutrition Coach uses Yarn Classic and keeps release readiness, CI, production runtime refresh, Cloudflare Tunnel changes, public smoke, tag movement, and `main` promotion as separate gates. Phase 100 adds `yarn deps:audit` as advisory evidence, but does not wire dependency advisories into `release:check`.

The current runtime dependency audit reports high advisories for direct `drizzle-orm@0.39.3` and transitive `form-data@4.0.5` through `openai > @types/node-fetch > form-data`. This ADR is the canonical source record for dependency advisory triage policy and the current `drizzle-orm` / `form-data` release decisions.

## Policy

### Severity And Scope

- High or critical advisories in production dependency paths block source release when reachable or not yet disproven.
- Dev-only high or critical advisories, and runtime high or critical advisories proven unreachable, require a recorded deferral instead of silent pass-through.
- Moderate and low advisories default to recorded deferral with runtime/dev scope, reachability, owner, and revisit trigger.
- Reachable runtime moderate advisories block source release when they map to upload/multipart, auth/session ownership, database/Drizzle, or LLM provider behavior unless there is an explicit compensating control plus a time-boxed owner-approved deferral.
- Low advisories are record-only unless triage proves direct sensitive-path impact.

### Reachability Evidence

Minimum reachability evidence is a source scan plus a path note: exact command, result, dependency path, runtime path or absence, and why the result proves non-reachability. Test-backed proof is required when a deferral depends on a compensating control, sanitizer, allowlist, or sensitive runtime behavior instead of pure API non-use.

Direct package import scans are not enough for transitive SDK risk. For `form-data`, direct `form-data`, `new FormData`, and `.append(` app-code scanning is auxiliary evidence only. The primary evidence is the app's actual OpenAI SDK usage surface and the absence of OpenAI files/audio multipart upload calls.

### Ownership And Revisit

The active milestone owner owns advisory deferrals. Every advisory row must record release decision, owner, revisit trigger, and follow-up.

Deferrals must be revisited on:

- package upgrade,
- new exploit or reachability evidence,
- source PR readiness,
- production runtime refresh readiness.

## Current Advisory Triage

| Package | Advisory | Severity | Dependency Path | Runtime/Dev Scope | Reachability | Release Decision | Owner | Revisit Trigger | Follow-up |
|---|---|---|---|---|---|---|---|---|---|
| `drizzle-orm@0.39.3` | `GHSA-gpj5-g38j-94v9` - SQL injection via improperly escaped SQL identifiers | high | direct dependency `drizzle-orm` from `package.json` dependencies; vulnerable `<0.45.2`, patched `>=0.45.2` | runtime | No current app/test/script matches for `sql.identifier` or dynamic `.as(` source patterns. Drizzle remains a database-path runtime dependency, so this is a recorded deferral, not a permanent waiver. | Deferred for source release until dedicated ORM compatibility work; blocks if new dynamic identifier or alias evidence appears before release. | Active milestone owner | Package upgrade, new dynamic SQL reachability evidence, source PR readiness, or production runtime refresh readiness | Keep `drizzle-orm@0.39.x` deferred until ORM compatibility work: scan dynamic SQL risks, run migrations against a file-backed DB, run persistence/service tests, upgrade to a patched compatible version, and update this ADR. |
| `form-data@4.0.5` | `GHSA-hmw2-7cc7-3qxx` - CRLF injection via unescaped multipart field names and filenames | high | transitive runtime path `openai > @types/node-fetch > form-data`; vulnerable `>=4.0.0 <4.0.6`, patched `>=4.0.6` | runtime | Current runtime provider calls `client.chat.completions.create`; image input is passed to Chat Completions as base64 `image_url`; compile-visible SDK shape evidence binds Chat Completions message/tool/stream shapes. Source scan shows no OpenAI files/audio multipart upload calls (`client.files`, `client.audio`, `.files.create`, `.audio.transcriptions`, `.audio.translations`). Browser/test `FormData` matches are auxiliary only and do not prove OpenAI SDK multipart reachability. | Non-blocking recorded deferral for source release because the vulnerable transitive multipart path is not reached by current OpenAI SDK usage. Blocks if OpenAI files/audio multipart usage appears or if new evidence shows Chat Completions reaches this vulnerable path. | Active milestone owner | `openai` upgrade, `form-data` upgrade, new multipart reachability evidence, source PR readiness, or production runtime refresh readiness | Prefer upgrading the transitive path through a reviewed `openai` update or package resolution only after provider compatibility re-verification. Re-run provider tests, `tests/types/openai-sdk-shape.ts` through `yarn tsc --noEmit`, lockfile path review, and `yarn deps:audit`. |

## Upgrade Trigger Boundaries

- `openai` upgrades require Phase 99 provider re-verification: provider tests plus `tests/types/openai-sdk-shape.ts` through `yarn tsc --noEmit`, then re-confirm ADR 0008 compatibility facets. No live-model smoke is required by default.
- `sharp` and `better-sqlite3` upgrades require Phase 101 native compatibility gates before acceptance: Sharp decode/reject evidence and `better-sqlite3` load/migrate/reopen/persist evidence.
- Major or minor `drizzle-orm` upgrades require a dedicated ORM compatibility task: dynamic SQL source scan, file-backed migration run, persistence/service tests, and an updated release decision here.
- Fastify upload/static stack changes, security-pinned transitive changes (`fast-uri`, `brace-expansion`), and current advisory packages such as `form-data` require lockfile dependency-path review, targeted affected-path tests, and then `yarn release:check`.
- No package install, dependency upgrade, npm workflow, `package-lock.json`, CI workflow change, or `release:check` coupling is authorized by this ADR.

## Evidence Appendix

Evidence collected on 2026-06-22 from branch `gsd/v3.1-runtime-llm-dependency-trust-baseline`.

### Runtime Audit

Command:

```bash
yarn audit --groups dependencies --json >/tmp/nutrition-phase-100-audit.jsonl || test -s /tmp/nutrition-phase-100-audit.jsonl
```

Result:

- Command produced parseable audit JSON-lines and wrote `/tmp/nutrition-phase-100-audit.jsonl`.
- Yarn emitted a Node deprecation warning for `url.parse()` during audit execution; audit output remained parseable.
- Summary: `2` high vulnerabilities, `0` critical, `0` moderate, `0` low, `183` runtime dependencies.
- Advisory: `drizzle-orm`, `GHSA-gpj5-g38j-94v9`, high, vulnerable `<0.45.2`, patched `>=0.45.2`, path `drizzle-orm`, runtime `dev: false`.
- Advisory: `form-data`, `GHSA-hmw2-7cc7-3qxx`, high, vulnerable `>=4.0.0 <4.0.6`, patched `>=4.0.6`, path `openai>@types/node-fetch>form-data`, runtime `dev: false`.

### Lockfile Path

Command:

```bash
rg -n "drizzle-orm|form-data" yarn.lock
```

Result:

- `yarn.lock` resolves `drizzle-orm@^0.39.0` to `0.39.3`.
- `yarn.lock` resolves `openai` to `4.104.0`.
- `openai` depends on `@types/node-fetch ^2.6.4`, `form-data-encoder 1.7.2`, `formdata-node ^4.3.2`, and `node-fetch ^2.6.7`.
- `@types/node-fetch@2.6.13` depends on `form-data ^4.0.4`.
- `yarn.lock` resolves `form-data@^4.0.4` to `4.0.5`.

### Drizzle Reachability

Command:

```bash
rg -n "sql\\.identifier|\\.as\\(" server tests scripts --glob '*.ts' --glob '*.mjs'
```

Result: no matches. This supports a recorded Drizzle deferral because the current app does not use the identified vulnerable dynamic identifier or alias patterns. It is not a permanent waiver because Drizzle remains in the runtime database path.

### OpenAI Usage Surface

Command:

```bash
rg -n "chat\\.completions\\.create|image_url" server/llm/openai.ts server/orchestrator/index.ts tests/types/openai-sdk-shape.ts
```

Result:

```text
tests/types/openai-sdk-shape.ts:7:    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
server/orchestrator/index.ts:1181:              { type: "image_url", image_url: { url: imageBase64 } },
server/llm/openai.ts:139:      response = await this.client.chat.completions.create(
server/llm/openai.ts:191:      response = await this.client.chat.completions.create(
server/llm/openai.ts:293:      stream = await this.client.chat.completions.create(
server/llm/openai.ts:359:      stream = await this.client.chat.completions.create(
```

This is the primary `form-data` non-reachability evidence. Runtime provider code uses Chat Completions. Image input is constructed as base64 `image_url`, not OpenAI SDK files/audio multipart upload.

Command:

```bash
rg -n "client\\.(files|audio)|\\.files\\.|\\.audio\\.|files\\.create|audio\\.transcriptions|audio\\.translations" server/llm server/orchestrator tests/types --glob '*.ts'
```

Result: no matches. Current OpenAI provider and orchestrator code do not call OpenAI files/audio APIs or files/audio multipart upload helpers.

### Auxiliary FormData Scan

Command:

```bash
rg -n "from ['\"]form-data|require\\(['\"]form-data|new FormData|\\.append\\(" server client tests scripts --glob '*.ts' --glob '*.tsx' --glob '*.mjs'
```

Result:

- No `from "form-data"`, `from 'form-data'`, `require("form-data")`, or `require('form-data')` package import matches.
- The broader command returns browser/test `new FormData` and `.append(` matches, including `client/src/api.ts` chat upload request construction and many integration/harness HTTP request fixtures.
- Representative app matches: `client/src/api.ts:780`, `client/src/api.ts:781`, `client/src/api.ts:786`, `client/src/api.ts:876`, `client/src/api.ts:877`, `client/src/api.ts:885`.
- Total broader matches: `459`.

These matches are auxiliary because browser/WHATWG `FormData` and test request construction do not prove reachability of the vulnerable transitive OpenAI SDK `form-data` package path.

## Consequences

- Developers can distinguish source-release blockers from recorded deferrals with explicit severity, runtime/dev scope, reachability, owner, revisit trigger, and follow-up requirements.
- Current `drizzle-orm` and `form-data` advisories remain visible for source-release review and production runtime refresh readiness.
- `deps:audit` remains advisory evidence in Phase 100 and is not part of `release:check`.

## Verification

Use these source checks for this ADR:

- `rg -n "severity|runtime|dev|reachability|release decision|owner|revisit|deferral" docs/adr/0009-dependency-advisory-policy.md`
- `rg -n "drizzle-orm|form-data|GHSA-gpj5-g38j-94v9|GHSA-hmw2-7cc7-3qxx|release decision|follow-up" docs/adr/0009-dependency-advisory-policy.md`
- `rg -n "server/llm/openai.ts|chat\\.completions\\.create|server/orchestrator/index.ts|image_url|tests/types/openai-sdk-shape.ts|files/audio|multipart upload|auxiliary" docs/adr/0009-dependency-advisory-policy.md`
- `if rg -n "client\\.(files|audio)|\\.files\\.|\\.audio\\.|files\\.create|audio\\.transcriptions|audio\\.translations" server/llm server/orchestrator tests/types --glob '*.ts'; then exit 1; else exit 0; fi`
- `yarn audit --groups dependencies --json >/tmp/nutrition-phase-100-audit.jsonl || test -s /tmp/nutrition-phase-100-audit.jsonl`
