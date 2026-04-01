import { describe, it } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { OpenAIProvider } from "../../server/llm/openai.js";

describe("OpenAI Provider", () => {
  it("forwards multimodal user content and tool definitions to OpenAI chat completions", async () => {
    let capturedRequest: unknown;
    const fakeClient = {
      chat: {
        completions: {
          create: async (request: unknown) => {
            capturedRequest = request;
            return {
              choices: [{
                message: {
                  content: "已收到",
                },
              }],
            };
          },
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    const tools = [{
      type: "function" as const,
      function: {
        name: "log_food",
        description: "記錄食物",
        parameters: { type: "object", properties: {} },
      },
    }];

    await provider.chat([
      {
        role: "user",
        content: [
          { type: "text", text: "(圖片)" },
          { type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
        ],
      },
    ], tools);

    assert.deepEqual(capturedRequest, {
      model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5-nano",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "(圖片)" },
          { type: "image_url", image_url: { url: "data:image/png;base64,abc123" } },
        ],
      }],
      tools,
    });
  });

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
