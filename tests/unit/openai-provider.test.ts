import { describe, it } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { OpenAIProvider } from "../../server/llm/openai.js";

describe("OpenAI Provider", () => {
  it("maps chat completion responses into LLMResponse", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{
              message: {
                content: "已記錄",
                tool_calls: [{ id: "call_1", function: { name: "get_daily_summary", arguments: "{}" } }],
              },
            }],
          }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    const result = await provider.chat([{ role: "user", content: "你好" }], []);
    assert.equal(result.content, "已記錄");
    assert.equal(result.toolCalls?.[0].function.name, "get_daily_summary");
  });

  it("throws when chat receives empty choices", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => ({ choices: [] }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    await assert.rejects(() => provider.chat([{ role: "user", content: "test" }], []), {
      message: "OpenAI returned no choices",
    });
  });
});
