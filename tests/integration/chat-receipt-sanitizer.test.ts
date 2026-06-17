import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { FastifyInstance } from "fastify";

function sourceWithoutComments(path: string) {
  return readFileSync(path, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

function toCookieHeader(rawHeader: string | string[] | undefined) {
  const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

describe("chat receipt sanitizer integration boundary", () => {
  it("keeps direct orchestrator receipt egress behind the guarded wrapper", () => {
    const source = sourceWithoutComments("server/orchestrator/index.ts");

    assert.match(source, /renderGuardedMutationReceipt/);
    assert.match(source, /const renderReceipt = \(effects: MutationEffects\) =>\s*renderGuardedMutationReceipt/);
    assert.doesNotMatch(source, /renderCheckedMutationReceipt/);
    assert.doesNotMatch(source, /assertNoForbiddenReceiptTerms/);
    assert.equal(
      (source.match(/mutationReceiptText\s*=\s*renderReceipt\(mutationEffects\)/g) ?? []).length,
      4,
    );
  });

  it("does not leave a direct final-reply receipt fallback that can throw after commit", () => {
    const source = sourceWithoutComments("server/orchestrator/index.ts");

    assert.doesNotMatch(source, /renderCheckedMutationReceipt\(mutationEffects\)/);
    assert.match(source, /renderReceipt\(mutationEffects\)/);
  });

  it("routes JSON no-mutation replies through per-verb success-claim fallback", async () => {
    let app: FastifyInstance | undefined;
    try {
      const mockLLM = new MockLLMProvider();
      app = await buildApp({
        dbPath: ":memory:",
        llmProvider: mockLLM,
      });
      const deviceRes = await app.inject({
        method: "POST",
        url: "/api/device",
        payload: { goal: "fat_loss" },
      });
      const sessionCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
      const address = await app.listen({ port: 0 });

      for (const claim of [
        "已記錄雞腿便當，620 kcal，蛋白質 24 g。",
        "已更新雞腿便當，620 kcal，蛋白質 24 g。",
        "已刪除雞腿便當，已從當日紀錄移除。",
        "已更新每日目標：\n• 卡路里 1800 kcal",
      ]) {
        mockLLM.queueChatResponse({ content: claim });
        const form = new FormData();
        form.append("message", "你好");

        const response = await fetch(`${address}/api/chat`, {
          method: "POST",
          headers: { cookie: sessionCookieHeader },
          body: form,
        });
        const body = await response.json() as { reply: string; didLogMeal: boolean; didMutateMeal?: boolean };

        assert.equal(response.status, 200);
        assert.equal(body.didLogMeal, false);
        assert.equal(body.didMutateMeal, false);
        assert.notEqual(body.reply, claim);
        assert.doesNotMatch(body.reply, /已記錄雞腿便當|已更新雞腿便當|已刪除雞腿便當|已更新每日目標/);
      }
    } finally {
      if (app) {
        await app.close();
      }
    }
  });

  it("expects route final-reply composition to use the projected mutation-state guard", () => {
    const source = sourceWithoutComments("server/routes/chat.ts");

    assert.match(source, /guardNoMutationSuccessClaim/);
    assert.doesNotMatch(source, /guardNoMutationLoggingClaim/);
    assert.doesNotMatch(source, /guardNoMutationLoggingClaim\([^)]*didLogMeal[^)]*didMutateMeal/);
  });
});
