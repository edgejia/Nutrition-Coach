# ADR 0009: Dependency Advisory Policy

**Status:** Accepted
**Date:** 2026-06-22
**Last Reviewed:** 2026-07-22 (`drizzle-orm@0.45.2` acceptance)
**Milestone:** v3.1 Runtime & LLM Dependency Trust Baseline
**Requirement:** ADVS-01 / ADVS-02 / ADVS-03 / NATV-03

## Context

Nutrition Coach uses Yarn Classic and keeps release readiness, CI, production runtime refresh, Cloudflare Tunnel changes, public smoke, tag movement, and `main` promotion as separate gates. Phase 100 adds `yarn deps:audit` as advisory evidence, and Phase 101 adds `yarn native:check` as native dependency compatibility evidence. Neither command is wired into `release:check` by default.

The 2026-06-22 runtime dependency audit reported high advisories for direct `drizzle-orm@0.39.3` and transitive `form-data@4.0.5` through `openai > @types/node-fetch > form-data`. A fresh 2026-07-22 audit also found newly disclosed runtime advisories in direct `sharp@0.34.5` and the Fastify transitive paths for `fast-uri@3.1.2` and `brace-expansion@5.0.6`; issue #134 remediated those three packages. The Drizzle compatibility review below accepts resolved `drizzle-orm@0.45.2` and removes `GHSA-gpj5-g38j-94v9` from the current audit output. The current audit is not yet clean: transitive `form-data@4.0.5` remains the sole high finding and retains its recorded deferral. This ADR is the canonical source record for dependency advisory triage policy, the current `form-data` release decision, and completed runtime advisory remediation.

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

### Native Compatibility Evidence

`yarn native:check` is the required native dependency compatibility command for the current Sharp and `better-sqlite3` runtime paths. It runs the focused native compatibility suite through `scripts/run-node-with-tz.mjs`, so the check inherits the `TZ=Asia/Taipei` runtime contract.

Native evidence is required before accepting a `sharp` upgrade, before accepting a `better-sqlite3` upgrade, and before v3.1 source-release review. A failing `native:check` blocks native dependency upgrade acceptance and v3.1 source-release readiness until the failure is fixed or explicitly deferred in this ADR and the release notes.

Native compatibility evidence is a sanitized console summary only. It may name package paths, fixture labels, check names, and pass/fail results. It must not emit raw image bytes, DB row dumps, copied DB files, session material, secrets, prompts, provider payloads, or assistant text.

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
| `drizzle-orm@0.45.2` | `GHSA-gpj5-g38j-94v9` - SQL injection via improperly escaped SQL identifiers | high | direct dependency `drizzle-orm` from `package.json` dependencies; vulnerable `<0.45.2`, patched `>=0.45.2`; lockfile resolves `0.45.2` | runtime | The resolved version is patched. Current app/test/script source has no `sql.identifier()`, `sql.as()`, `sql.raw()`, dynamic `.as()`, SQLite `blob()`, `$onUpdate`, `.returning()`, `relations()`, or `db.query` use. Existing custom SQL uses parameterized `sql\`...\`` tagged templates. This surface review supplements, but does not replace, the patched dependency and compatibility evidence. | Patched and accepted for source/PR review at resolved `0.45.2` after dedicated ORM compatibility verification. This does not authorize merge or production runtime refresh. | Active milestone owner | Future `drizzle-orm` upgrade, new dynamic SQL or relational-query surface, source PR readiness, or production runtime refresh readiness | Keep the resolved version on a patched release (`>=0.45.2`). For future minor or major upgrades, repeat the dynamic SQL scan, Drizzle Kit API compatibility check, file-backed migration/persistence check, schema drift check, dependency audit, and release gate. |
| `form-data@4.0.5` | `GHSA-hmw2-7cc7-3qxx` - CRLF injection via unescaped multipart field names and filenames | high | transitive runtime path `openai > @types/node-fetch > form-data`; vulnerable `>=4.0.0 <4.0.6`, patched `>=4.0.6` | runtime | Current runtime provider calls `client.chat.completions.create`; image input is passed to Chat Completions as base64 `image_url`; compile-visible SDK shape evidence binds Chat Completions message/tool/stream shapes. Source scan shows no OpenAI files/audio multipart upload calls (`client.files`, `client.audio`, `.files.create`, `.audio.transcriptions`, `.audio.translations`). Browser/test `FormData` matches are auxiliary only and do not prove OpenAI SDK multipart reachability. | Non-blocking recorded deferral for source release because the vulnerable transitive multipart path is not reached by current OpenAI SDK usage. Blocks if OpenAI files/audio multipart usage appears or if new evidence shows Chat Completions reaches this vulnerable path. | Active milestone owner | `openai` upgrade, `form-data` upgrade, new multipart reachability evidence, source PR readiness, or production runtime refresh readiness | Prefer upgrading the transitive path through a reviewed `openai` update or package resolution only after provider compatibility re-verification. Re-run provider tests, `tests/types/openai-sdk-shape.ts` through `yarn tsc --noEmit`, lockfile path review, and `yarn deps:audit`. |
| `sharp@0.35.3` (upgraded from `0.34.5`) | `GHSA-f88m-g3jw-g9cj` - libvips out-of-bounds read and denial of service when decoding malicious image input | high | direct dependency `sharp`; vulnerable `<0.35.0`, patched `>=0.35.0` | runtime | Reachable: `POST /api/chat` accepts untrusted upload bytes and passes them through `validateImageBytes` to `sharp(buffer)`. Existing guards limit upload bytes, decoded pixels, MIME types, and concurrent decodes, but do not disprove the vulnerable decoder path. | Resolved for source release by upgrading to `sharp@0.35.3` / packaged libvips `8.18.3`. The 0.35 breaking changes were reviewed against the app's supported `failOn`, `limitInputPixels`, `metadata`, and `raw().toBuffer()` usage; `yarn native:check` and image-upload integration tests pass. | Active milestone owner | Future `sharp` upgrade, new decoder advisory, source PR readiness, or production runtime refresh readiness | Keep the direct version at or above the patched line and retain native decode/reject plus upload-path verification. |
| `fast-uri@3.1.4` (resolved from `3.1.2`) | `GHSA-4c8g-83qw-93j6` and `GHSA-v2hh-gcrm-f6hx` - URI hostname validation/canonicalization bypasses | high | transitive runtime paths through `fastify > @fastify/ajv-compiler > fast-uri`, `fastify > fast-json-stringify > fast-uri`, and Ajv; the two advisories together require `>=3.1.4` on the 3.x line | runtime | No direct app import exists, but Fastify schema compilation and serialization are runtime paths, so non-reachability was not assumed. | Resolved for source release with the security resolution `fast-uri@3.1.4`; dependency-path review and Fastify integration tests pass. | Active milestone owner | Fastify/Ajv/`fast-json-stringify` upgrade, resolution removal, new URI advisory, source PR readiness, or production runtime refresh readiness | Keep the resolution until every accepted parent range resolves to a non-vulnerable version, then remove it only with lockfile-path and release-gate evidence. |
| `brace-expansion@5.0.7` (resolved from `5.0.6`) | `GHSA-3jxr-9vmj-r5cp` - uncontrolled resource consumption from recursive brace expansion | high | transitive runtime path `@fastify/static > glob > minimatch > brace-expansion`; vulnerable `5.0.0` through `5.0.6`, patched `>=5.0.7` | runtime | No direct app import or user-controlled glob construction exists, but the package remains under the runtime static-serving stack. The package was patched instead of relying on that narrower reachability. | Resolved for source release with the security resolution `brace-expansion@5.0.7`; dependency-path review and static-serving integration tests pass. | Active milestone owner | `@fastify/static`/Glob/Minimatch upgrade, resolution removal, new expansion advisory, source PR readiness, or production runtime refresh readiness | Keep the resolution until the parent dependency graph naturally resolves to the patched line, then remove it only with lockfile-path and static-serving evidence. |

## Upgrade Trigger Boundaries

- `openai` upgrades require Phase 99 provider re-verification: provider tests plus `tests/types/openai-sdk-shape.ts` through `yarn tsc --noEmit`, then re-confirm ADR 0008 compatibility facets. No live-model smoke is required by default.
- `sharp` and `better-sqlite3` upgrades require `yarn native:check` before acceptance: Sharp decode/reject evidence and `better-sqlite3` load/migrate/reopen/persist evidence.
- Major or minor `drizzle-orm` upgrades require a dedicated ORM compatibility task: dynamic SQL source scan, Drizzle Kit API compatibility check, file-backed migration and persistence/service tests, schema drift check, dependency audit, and an updated release decision here. The resolved `0.39.3` to `0.45.2` change satisfies this boundary only through the 2026-07-22 evidence below; future resolved-version movement must repeat it.
- Fastify upload/static stack changes, security-pinned transitive changes (`fast-uri`, `brace-expansion`), and current advisory packages such as `form-data` require lockfile dependency-path review, targeted affected-path tests, and then `yarn release:check`.
- No package install, dependency upgrade, npm workflow, `package-lock.json`, CI workflow change, production runtime refresh, Cloudflare Tunnel change, public smoke, tag movement, `main` promotion, direct push, or `release:check` coupling is authorized by this ADR.

## 2026-07-22 Runtime Advisory Refresh Evidence

Issue `#134` records the source remediation boundary. The source change upgrades direct `sharp` from `0.34.5` to `0.35.3` and advances the existing security resolutions from `fast-uri@3.1.2` to `3.1.4` and from `brace-expansion@5.0.6` to `5.0.7`. It does not authorize or perform a production runtime refresh, Cloudflare Tunnel change, public smoke, or tag movement.

### Dependency And Reachability Review

- `yarn install --frozen-lockfile` completed with the committed manifest and lockfile state.
- `yarn why sharp` resolves the direct dependency to `sharp@0.35.3`.
- `yarn why fast-uri` resolves one `fast-uri@3.1.4` through Fastify's Ajv compiler, Ajv, and `fast-json-stringify` paths.
- `yarn why brace-expansion` resolves one `brace-expansion@5.0.7` through `@fastify/static > glob > minimatch`.
- The regenerated lockfile integrity values match the npm registry metadata for all three selected versions. Sharp's package and native artifacts expose npm trusted-publisher/SLSA provenance; `fast-uri` and `brace-expansion` expose registry signatures but not SLSA attestations, so their exact lock integrity and upstream security-fix diffs were reviewed before acceptance.
- `rg -n "from ['\"]sharp|sharp\\(" server tests scripts --glob '*.ts' --glob '*.mjs'` finds the direct import and decode call only in `server/lib/image-validation.ts`; `server/routes/chat.ts` passes uploaded image bytes to that validator.
- `rg -n "fast-uri|brace-expansion" server client tests scripts package.json --glob '*.ts' --glob '*.tsx' --glob '*.mjs' --glob '*.json'` finds only the two explicit security resolutions in `package.json`, not direct application imports.
- The Sharp 0.35 boundary was reviewed for its Node `>=20.9.0` requirement, install-script removal, default input-channel limit, removed deprecated APIs, JPEG 2000 option rename, and AVIF changes. The application runs on Node 22 in CI and does not use the removed or renamed APIs.

### Targeted Compatibility And Audit

- `yarn native:check` passes `6/6`: Sharp accepts generated JPEG/PNG/WebP, rejects invalid or mismatched bytes, and the `better-sqlite3` compatibility checks remain green.
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/web-app.test.ts tests/integration/chat-api.test.ts` passes `97/97`, including Fastify static serving and accepted/rejected multipart image paths.
- `yarn deps:audit` reports `2` high advisories and no critical, moderate, low, or info advisories. The Sharp, `fast-uri`, and `brace-expansion` rows are absent; the only remaining rows are the existing `drizzle-orm` and `form-data` deferrals recorded above.
- Final acceptance also requires `yarn release:check --base=origin/main` on the completed source diff and the repository's GitHub Node 22 `Release Check` on the pushed PR head.

## Drizzle 0.45.2 Acceptance Evidence

Evidence collected on 2026-07-22 from a clean rebase of PR #123's dependency and documentation commits onto `origin/main@c2d49a0da0f4af8c0a3d0e9748274da24e735d01`. The replay used `yarn install --frozen-lockfile`; the final release receipt is required to report a stable workspace before the refreshed PR head is accepted. This is source/PR compatibility evidence only and does not itself authorize merge, production runtime refresh, Cloudflare Tunnel changes, public smoke, or tag movement.

### Source Surface

Command:

```bash
if rg -n 'sql\.(identifier|as|raw)\s*\(|\.as\s*\(|\.returning\s*\(|\brelations\s*\(|\bdb\.query\b' server tests scripts drizzle.config.ts --glob '*.ts' --glob '*.tsx' --glob '*.mjs' \
  || rg -n '\bblob\s*\(|\$onUpdate\b' server/db/schema.ts; then
  exit 1
else
  exit 0
fi
```

Result:

- No matches for the advisory APIs `sql.identifier()` or `sql.as()`.
- No matches for `sql.raw()`, dynamic `.as()`, SQLite `blob()` columns, `$onUpdate`, `.returning()`, `relations()`, or `db.query`.
- Existing custom SQL uses parameterized `sql\`...\`` tagged templates. The schema uses `text`, `integer`, and `real` columns.

### Drizzle Kit Compatibility And Schema Drift

Commands:

```bash
node --input-type=module -e 'import assert from "node:assert/strict"; import { compatibilityVersion, npmVersion } from "drizzle-orm/version"; assert.equal(npmVersion, "0.45.2"); assert.equal(compatibilityVersion, 10)'
rg -n 'requiredApiVersion = 10' node_modules/drizzle-kit/bin.cjs
yarn db:generate
```

Result:

- `yarn.lock` resolves `drizzle-kit@^0.31.10` to `0.31.10` and `drizzle-orm@^0.45.2` to `0.45.2`.
- `drizzle-kit@0.31.10` requires ORM compatibility API version `10`; `drizzle-orm@0.45.2` exports compatibility version `10`.
- `yarn db:generate` crossed that compatibility check successfully, read `13` tables, and reported no schema changes and nothing to migrate.

### File-Backed Runtime Compatibility

Command:

```bash
yarn native:check
```

Result:

- Passed `6/6`.
- The Drizzle / `better-sqlite3` path migrated a file-backed database, created representative device and grouped-meal data through app services, closed the database, reopened it, and read the persisted primitive facts.
- The same focused gate retained its Sharp accept/reject coverage and emitted only sanitized evidence.

### Advisory And Release Gates

Commands:

```bash
yarn deps:audit
yarn release:check --base=origin/main
```

Result:

- `yarn deps:audit` completed with advisory-bitmask evidence and no longer reported `drizzle-orm` or `GHSA-gpj5-g38j-94v9`.
- The audit remains non-clean with exactly `1` high finding: `form-data@4.0.5` / `GHSA-hmw2-7cc7-3qxx`. The Sharp, `fast-uri`, `brace-expansion`, and Drizzle findings are absent; the remaining `form-data` finding is not remediated or waived by this Drizzle decision.
- Final acceptance requires `yarn release:check --base=origin/main` to emit `release_check_complete` with a stable workspace on the completed rebased source diff, followed by the repository's GitHub Node 22 `Release Check` on the pushed PR head.

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

### Native Compatibility Gate

Command:

```bash
yarn native:check
```

Result:

- Runs `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/native-compatibility.test.ts`.
- Proves the Sharp native path accepts generated JPEG, PNG, and WebP bytes and rejects non-image or mismatched MIME claims.
- Proves the `better-sqlite3` native path can migrate a file-backed DB, open it through `createDb`, write representative grouped meal data through app services, close, reopen, and read primitive persisted facts.
- Console output is sanitized native evidence only; it does not include raw image bytes, DB row dumps, copied DB files, session material, secrets, prompts, provider payloads, or assistant text.

## Consequences

- Developers can distinguish source-release blockers from recorded deferrals with explicit severity, runtime/dev scope, reachability, owner, revisit trigger, and follow-up requirements.
- The direct Drizzle advisory is remediated at resolved `drizzle-orm@0.45.2`; the dated 2026-06-22 appendix remains the historical record of the earlier deferral.
- The existing `form-data` deferral remains in force and is the current audit's sole high finding. The remediated Sharp, `fast-uri`, and `brace-expansion` advisories remain visible as completed triage evidence; Drizzle acceptance does not claim that `yarn deps:audit` is clean.
- `deps:audit` remains advisory evidence in Phase 100 and is not part of `release:check`.

## Verification

Use these source checks for this ADR:

- `rg -n "severity|runtime|dev|reachability|release decision|owner|revisit|deferral" docs/adr/0009-dependency-advisory-policy.md`
- `rg -n "drizzle-orm|form-data|sharp|fast-uri|brace-expansion|GHSA-gpj5-g38j-94v9|GHSA-hmw2-7cc7-3qxx|GHSA-f88m-g3jw-g9cj|GHSA-4c8g-83qw-93j6|GHSA-v2hh-gcrm-f6hx|GHSA-3jxr-9vmj-r5cp|release decision|follow-up" docs/adr/0009-dependency-advisory-policy.md`
- `rg -n "server/llm/openai.ts|chat\\.completions\\.create|server/orchestrator/index.ts|image_url|tests/types/openai-sdk-shape.ts|files/audio|multipart upload|auxiliary" docs/adr/0009-dependency-advisory-policy.md`
- `rg -n "native:check|sharp|better-sqlite3|sanitized console summary|raw image bytes|DB row dumps|copied DB files|session material|secrets|prompts|provider payloads|assistant text" docs/adr/0009-dependency-advisory-policy.md`
- `if rg -n 'sql\.(identifier|as|raw)\s*\(|\.as\s*\(|\.returning\s*\(|\brelations\s*\(|\bdb\.query\b' server tests scripts drizzle.config.ts --glob '*.ts' --glob '*.tsx' --glob '*.mjs' || rg -n '\bblob\s*\(|\$onUpdate\b' server/db/schema.ts; then exit 1; else exit 0; fi`
- `node --input-type=module -e 'import assert from "node:assert/strict"; import { compatibilityVersion, npmVersion } from "drizzle-orm/version"; assert.equal(npmVersion, "0.45.2"); assert.equal(compatibilityVersion, 10)'`
- `rg -n 'requiredApiVersion = 10' node_modules/drizzle-kit/bin.cjs`
- `yarn db:generate`
- `test -z "$(git status --short -- drizzle)"`
- `yarn native:check`
- `yarn deps:audit`
- `yarn release:check --base=origin/main`
- `if rg -n "client\\.(files|audio)|\\.files\\.|\\.audio\\.|files\\.create|audio\\.transcriptions|audio\\.translations" server/llm server/orchestrator tests/types --glob '*.ts'; then exit 1; else exit 0; fi`
- `yarn audit --groups dependencies --json >/tmp/nutrition-phase-100-audit.jsonl || test -s /tmp/nutrition-phase-100-audit.jsonl`
