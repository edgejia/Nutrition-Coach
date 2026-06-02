# ADR 0003: Structured Boundaries and Authoritative State

## Status

Accepted for v2.5.

## Context

Nutrition Coach uses LLMs for target generation, meal analysis, correction routing, and coaching. Several reliability gaps came from treating model text, display strings, or loosely typed transport payloads as facts after they crossed a boundary.

The app needs to keep chat-first logging easy while making persisted targets, client state, receipt identity, and compressed LLM history depend on facts the backend or transport layer can validate.

## Decision

- Add `LLMProvider.generateObject<T>()` for non-streaming schema-backed object output, with runtime and mock providers sharing the same typed success and failure contract.
- Keep target-generation validation service-owned and Zod-first. Invalid structured output falls back deterministically instead of persisting partial or out-of-bounds targets.
- Treat API, SSE, and thin store writes as authoritative state boundaries. Malformed daily summary, goals, history, day snapshot, or chat terminal payloads are rejected or omitted before they can replace trusted UI state.
- Persist assistant replies, receipt references, and mutation outcome facts through one service-owned atomic boundary.
- Generate compressed LLM history from persisted structured mutation outcome rows, not from success-style display copy.
- Keep structured-output failures, route fallback catch fields, and release proof metadata-only.

## Consequences

- Structured target generation can improve model flexibility without weakening fallback behavior or observability privacy.
- UI state may ignore malformed server responses until refresh/retry, which is preferable to silently fabricating authoritative data.
- Receipt-bearing chat finalization fails closed if assistant reply, receipt identity, and mutation outcome facts cannot be persisted together.
- Compressed history is less brittle because it reads validated facts instead of parsing localized receipt text.
- Future LLM provider migrations, Responses API spikes, Agents SDK experiments, and richer coaching copy should preserve these typed boundaries rather than reintroducing display-string authority.

## Verification

v2.5 Phase 69-73 verification covers provider structured output, onboarding target generation fallback, DTO guard behavior, route/service public DTO shape, atomic receipt persistence, structured compressed history, production guest-secret/CORS hardening, route fallback redaction, metadata-only evidence, `yarn tsc --noEmit`, and `yarn release:check`.
