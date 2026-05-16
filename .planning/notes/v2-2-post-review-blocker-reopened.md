---
title: "v2.2 post-review blocker reopened"
date: "2026-05-16"
context: "Exploration of Notion BUG / FEATURE 調整 board"
source_url: "https://www.notion.so/34528343a39580a6acfff1c74f94c6c0"
---

# v2.2 Post-Review Blocker Reopened

## Context

The local GSD state currently says v2.2 is complete after quick task `260516-ppf`, but the Notion BUG / FEATURE board marks promotion as `BLOCK` after clean review.

The blocker is not another isolated regex/parser gap. The fifth repair round already moved `get_daily_summary` toward persisted meal facts and shared route guards, but clean review still reproduced a P1 aggregate bypass where aggregate totals could allow unsupported meal-specific claims.

## Decision

Do not continue with a sixth round of natural-language parser or regex guard patches.

Instead, reopen the v2.2 promotion blocker as an authoritative state boundary refactor:

- backend renders the summary/history fact segment from persisted facts
- LLM output is limited to optional advice
- final guards remain defense-in-depth
- JSON, SSE, and non-SSE reply paths share the same fact renderer and advice guard
- SSE proof must drain through stream close before promotion evidence is accepted

## Promotion Rule

Do not promote to `staging` or `main` from this state. The next work should first close the authoritative summary facts blocker and the SSE harness proof gap.
