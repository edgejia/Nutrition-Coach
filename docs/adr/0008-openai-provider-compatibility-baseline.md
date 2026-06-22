# ADR 0008: OpenAI Provider Compatibility Baseline

**Status:** Accepted
**Date:** 2026-06-22
**Milestone:** v3.1 Runtime & LLM Dependency Trust Baseline
**Requirement:** LLM-01 / LLM-02 / LLM-03

## Context

Nutrition Coach currently isolates OpenAI usage behind `OpenAIProvider` and the `LLMProvider` interface. Runtime constructs `OpenAIProvider` for the production Chat Completions path, while default tests exercise provider behavior through injected OpenAI-compatible clients and mock providers.

The OpenAI SDK and platform now expose newer paths such as Responses API and Agents SDK. This ADR records the current compatibility baseline for the existing Chat Completions provider path so future changes can distinguish current contract verification from migration work.

## Decision

The current provider compatibility baseline is `OpenAIProvider` on OpenAI Chat Completions.

This ADR is the canonical source-doc contract for LLM-01 and LLM-03. It records current assumptions, source anchors, non-live evidence anchors, and upgrade re-verification triggers. It does not change provider APIs, runtime behavior, dependencies, CI behavior, deployment guidance, tunnel guidance, smoke guidance, or live-model evaluation policy.

## Compatibility Traceability

| Facet | Current Contract | Source Anchor | Non-live Evidence |
|---|---|---|---|
| SDK version | `package.json` declares `openai` range `^4.82.0`; `yarn.lock` resolves `4.104.0`. On any `openai` upgrade, rerun the provider tests plus `tests/types/openai-sdk-shape.ts` through `yarn tsc --noEmit`, then re-confirm this facet table. | `package.json`; `yarn.lock` | Compile-visible SDK type binding at `tests/types/openai-sdk-shape.ts`, plus provider tests under `tests/unit/openai-provider.test.ts`. |
| default model env path | `OPENAI_ORCHESTRATOR_MODEL` feeds `config.orchestratorModel`, with current fallback `gpt-5.4-mini`. The env path and config symbol are the durable contract; the fallback is a recorded current fact, not a permanent model promise. | `config.orchestratorModel` in `server/config.ts`; `OpenAIProvider` constructor reads it in `server/llm/openai.ts`. | Existing provider tests assert the resulting model value; LLM-02 evidence keeps the path non-live through injected clients. |
| Chat Completions | `OpenAIProvider.chat`, `OpenAIProvider.generateObject`, `OpenAIProvider.chatRound`, and `OpenAIProvider.chatStream` call `client.chat.completions.create`. | `OpenAIProvider` in `server/llm/openai.ts`; `LLMProvider` in `server/llm/types.ts`. | `tests/unit/openai-provider.test.ts` covers chat response mapping, structured object generation, streaming rounds, stream generators, and failure paths with injected clients. |
| tool calling | Chat requests pass `ToolDefinition[]` to OpenAI Chat Completions tools, and responses map SDK tool calls into `ToolCall[]`. Streamed tool-call deltas are merged by index before returning a response. | `ToolDefinition`, `ToolCall`, and `LLMResponse` in `server/llm/types.ts`; `OpenAIProvider.chat`, `OpenAIProvider.chatRound`, `mergeToolCalls`, and `sortToolCalls` in `server/llm/openai.ts`. | `tests/unit/openai-provider.test.ts` cases for forwarding tool definitions, mapping chat completion tool calls, and assembling streamed tool-call deltas. |
| image input | User messages may carry `ContentPart[]` with `image_url` parts and are forwarded to Chat Completions as message content. | `ChatMessage` and `ContentPart` in `server/llm/types.ts`; message casting in `OpenAIProvider.chat` and streaming methods in `server/llm/openai.ts`. | `tests/unit/openai-provider.test.ts` forwards multimodal user content and keeps image data out of metadata assertions. |
| streaming | Streaming uses Chat Completions with `stream: true`; `chatRound` may return either a buffered final response or a token generator, and `chatStream` yields content deltas. Continuation failures are normalized separately from initial stream creation failures. | `OpenAIProvider.chatRound`, `OpenAIProvider.chatStream`, and `streamRemainingTokens` in `server/llm/openai.ts`; optional `chatRound` / `chatStream` methods in `server/llm/types.ts`. | `tests/unit/openai-provider.test.ts` covers direct text streams, streamed tool-call deltas, initial stream creation failures, and continuation failures. |
| structured output | `generateObject` uses Chat Completions with optional `response_format: { type: "json_schema" }`, parses JSON locally, and trusts caller-owned validation before returning typed success. | `GenerateObjectRequest`, `GenerateObjectResult`, and related metadata types in `server/llm/types.ts`; `OpenAIProvider.generateObject` in `server/llm/openai.ts`. | `tests/unit/openai-provider.test.ts` covers schema hints, success after local validation, invalid JSON, schema validation failures, no-content subtypes, and provider failures. |
| abort handling | Provider calls pass `opts.signal`; local aborted signals and `OpenAI.APIUserAbortError` set metadata `aborted: true`, while unrelated errors remain non-abort failures. | `LLMCallOptions` in `server/llm/types.ts`; `isOpenAIAbort`, `normalizeOpenAIError`, and provider catch paths in `server/llm/openai.ts`. | `tests/unit/openai-provider.test.ts` covers local cancellation, SDK user aborts, and non-abort provider errors. |
| metadata-only error normalization | OpenAI failures are wrapped as `LLMProviderError` or structured provider-failure metadata with allowlisted fields only: provider, operation, model, aborted, status, provider request id, error name, error type, and error code. Raw prompts, user input, transcripts, tool raw payloads, provider bodies/headers, image data, session material, DB snapshots, SSE frame transcripts, assistant final text, and secrets remain excluded. | `ProviderErrorMetadata` in `server/llm/types.ts`; `LLMProviderError` in `server/llm/errors.ts`; `normalizeOpenAIError` and `wrapOpenAIError` in `server/llm/openai.ts`; ADR 0001. | `tests/unit/openai-provider.test.ts` metadata-only assertions, forbidden sentinel checks, and the no-live invariant test `uses injected OpenAI-compatible clients without live client construction or network`. |

## Default-CI Non-Live Invariant

The default `test` suite and `yarn release:check` are non-live/default verification paths. They must pass without a real/live OPENAI_API_KEY, without network access, and without live model behavior.

This invariant is about live client construction and network behavior, not the mere presence of an env var. `.github/workflows/pr-check.yml` prepares CI with `cp .env.example .env`, and `.env.example` intentionally contains the placeholder caveat `OPENAI_API_KEY=your-api-key-here`. A placeholder key is not live authorization, and default tests must not turn it into one.

The live production construction site is `server/index.ts`, where runtime passes `llmProvider: new OpenAIProvider()` into `buildApp()`. Default tests and the release gate do not boot that production entrypoint; provider tests construct `OpenAIProvider` with injected OpenAI-compatible clients. LLM-02 evidence lives in the durable anchors `tests/types/openai-sdk-shape.ts` and the named no-live invariant test `uses injected OpenAI-compatible clients without live client construction or network`.

## Non-Goals / Deferred

- Responses API migration is deferred to a dedicated LLM platformization effort; this ADR does not authorize changing the provider path.
- Agents SDK migration is deferred to a dedicated LLM platformization effort; this ADR does not introduce agent runtime dependencies.
- guardrail taxonomy/platformization is deferred outside this provider compatibility baseline.
- opt-in live-model eval is deferred until secret, cost, flake, fixture, artifact, and privacy policy decisions are explicitly planned.

These deferrals align with `.planning/REQUIREMENTS.md` Future Requirements and Out of Scope. The ADR remains readable without that local planning file; the cross-reference records requirement lineage only.

## Consequences

- Future OpenAI SDK upgrades must re-run the provider tests and `tests/types/openai-sdk-shape.ts` through `yarn tsc --noEmit`, then re-confirm the nine compatibility facets before accepting the upgrade.
- LLM-01 and LLM-03 are documented here. LLM-02 is evidenced by the non-live artifacts named above; this ADR is the contract index, not a substitute for running those checks.
- New provider migrations, live evals, or guardrail platform work require their own plan and decision record.

## Verification

Use source checks to verify the baseline stays explicit:

- The ADR contains the nine facet names: SDK version, default model env path, Chat Completions, tool calling, image input, streaming, structured output, abort handling, and metadata-only error normalization.
- The ADR contains the four LLM-03 deferrals: Responses API migration, Agents SDK migration, guardrail taxonomy/platformization, and opt-in live-model eval.
- The ADR records `^4.82.0`, `4.104.0`, `OPENAI_ORCHESTRATOR_MODEL`, and `tests/types/openai-sdk-shape.ts`.
- The ADR anchors the non-live/default verification invariant to `.github/workflows/pr-check.yml`, `scripts/release-check.mjs`, `.env.example`, `OPENAI_API_KEY=your-api-key-here`, `server/index.ts`, and `new OpenAIProvider()`.
