---
title: "v2.2 authoritative summary facts acceptance checklist"
date: "2026-05-16"
context: "Acceptance checklist for v2.2 promotion blocker closure"
source_url: "https://www.notion.so/34528343a39580a6acfff1c74f94c6c0"
---

# v2.2 Authoritative Summary Facts Acceptance Checklist

## Must Pass

- [ ] A fake meal list such as `分別是牛肉飯和滷肉飯` cannot appear in the final reply unless those meal names are persisted facts.
- [ ] If persisted facts are `豆腐飯 520 kcal` and `鮭魚飯 380 kcal`, the final reply cannot attribute `900 kcal` to `豆腐飯` as a single-meal value.
- [ ] Empty-day summary replies preserve summary semantics such as `0 餐 / 0 kcal` and do not fallback to a mutation failure message like `我還沒有把這餐寫入紀錄`.
- [ ] Backend fact segment can deterministically render a reply equivalent to `今天已記錄 2 餐，共 900 kcal：豆腐飯 520 kcal、鮭魚飯 380 kcal。`
- [ ] LLM advice segment cannot introduce concrete persisted meal names, per-meal kcal, macro attribution, meal count, or day total facts.
- [ ] JSON, SSE, and non-SSE final reply paths use the same fact renderer and advice guard.
- [ ] SSE harness drains to stream close instead of stopping at first `event: done`.
- [ ] SSE proof fails if any `chunk` or `status` frame appears after first `done`.
- [ ] Harness artifacts store structured proof fields such as first done observed, stream closed, and no post-done frames; they do not persist raw SSE frame transcripts.

## Promotion Gate

The blocker is not closed until targeted tests, the updated harness proof, TypeScript, relevant integration tests, and `yarn release:check` pass.
