import { describe, it } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { LLMProviderError, isLLMProviderError } from "../../server/llm/errors.js";
import { OpenAIProvider } from "../../server/llm/openai.js";
import type { ProviderErrorMetadata, ProviderOperation } from "../../server/llm/types.js";

const allowedProviderMetadataKeys = [
  "provider",
  "operation",
  "model",
  "aborted",
  "status",
  "providerRequestId",
  "errorName",
  "errorType",
  "errorCode",
];

const providerOperations = [
  "chat",
  "chat_round_initial",
  "chat_round_stream_continuation",
  "chat_stream_initial",
  "chat_stream_continuation",
] satisfies ProviderOperation[];

const forbiddenProviderSentinels = [
  "raw-provider-body-sentinel",
  "authorization-header-sentinel",
  "prompt-sentinel",
  "message-sentinel",
  "tool-payload-sentinel",
  "user-input-sentinel",
  "image-data-sentinel",
  "session-material-sentinel",
  "assistant-final-text-sentinel",
];

function assertExactKeys(value: Record<string, unknown>, expectedKeys: string[]) {
  assert.deepEqual(Object.keys(value).sort(), [...expectedKeys].sort());
}

function createStream(chunks: unknown[]): AsyncIterable<unknown> {
  return {
    async *[Symbol.asyncIterator]() {
      for (const chunk of chunks) {
        yield chunk;
      }
    },
  };
}

describe("OpenAI Provider", () => {
  it("defines metadata-only LLMProviderError contracts with fixed serialization", () => {
    assert.deepEqual(providerOperations, [
      "chat",
      "chat_round_initial",
      "chat_round_stream_continuation",
      "chat_stream_initial",
      "chat_stream_continuation",
    ]);

    const providerMetadata: ProviderErrorMetadata = {
      provider: "openai",
      operation: "chat",
      model: "gpt-test",
      aborted: false,
      status: 429,
      providerRequestId: "req_safe",
      errorName: "RateLimitError",
      errorType: "rate_limit_error",
      errorCode: "rate_limit_exceeded",
    };

    const error = new LLMProviderError(providerMetadata);

    assert.equal(error.name, "LLMProviderError");
    assert.equal(error.message, "LLM provider request failed");
    assert.equal(isLLMProviderError(error), true);
    assert.equal(isLLMProviderError(new Error("LLM provider request failed")), false);
    assert.equal(Object.hasOwn(error, "cause"), false);
    assert.equal("cause" in error, false);
    assert.equal(error.providerMetadata, providerMetadata);
    assertExactKeys(error.providerMetadata as unknown as Record<string, unknown>, allowedProviderMetadataKeys);

    const serialized = JSON.parse(JSON.stringify(error)) as Record<string, unknown>;
    assertExactKeys(serialized, ["name", "message", "providerMetadata"]);
    assert.equal(serialized.name, "LLMProviderError");
    assert.equal(serialized.message, "LLM provider request failed");
    assertExactKeys(serialized.providerMetadata as Record<string, unknown>, allowedProviderMetadataKeys);

    for (const sentinel of forbiddenProviderSentinels) {
      assert.equal(JSON.stringify(error).includes(sentinel), false);
    }
  });

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
      model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
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

  it("chatRound returns a direct text stream without a prior non-streaming completion", async () => {
    let capturedRequest: unknown;
    const fakeClient = {
      chat: {
        completions: {
          create: async (request: unknown) => {
            capturedRequest = request;
            return createStream([
              { choices: [{ delta: { role: "assistant" }, finish_reason: null, index: 0 }] },
              { choices: [{ delta: { content: "直" }, finish_reason: null, index: 0 }] },
              { choices: [{ delta: { content: "播" }, finish_reason: "stop", index: 0 }] },
            ]);
          },
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    const result = await provider.chatRound?.([{ role: "user", content: "你好" }], []);

    assert.ok(result);
    assert.equal(result.kind, "stream");
    assert.deepEqual(capturedRequest, {
      model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
      messages: [{ role: "user", content: "你好" }],
      stream: true,
    });

    const streamedTokens: string[] = [];
    for await (const token of result.streamGenerator) {
      streamedTokens.push(token);
    }
    assert.deepEqual(streamedTokens, ["直", "播"]);
  });

  it("chatRound assembles streamed tool-call deltas into a single response", async () => {
    const tools = [{
      type: "function" as const,
      function: {
        name: "log_food",
        description: "記錄食物",
        parameters: { type: "object", properties: {} },
      },
    }];

    const fakeClient = {
      chat: {
        completions: {
          create: async () => createStream([
            { choices: [{ delta: { role: "assistant" }, finish_reason: null, index: 0 }] },
            {
              choices: [{
                delta: {
                  tool_calls: [{
                    index: 0,
                    id: "call_1",
                    type: "function",
                    function: {
                      name: "log_food",
                      arguments: "{\"food_name\":\"",
                    },
                  }],
                },
                finish_reason: null,
                index: 0,
              }],
            },
            {
              choices: [{
                delta: {
                  tool_calls: [{
                    index: 0,
                    function: {
                      arguments: "蘋果\"}",
                    },
                  }],
                },
                finish_reason: "tool_calls",
                index: 0,
              }],
            },
          ]),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    const result = await provider.chatRound?.([{ role: "user", content: "我吃了蘋果" }], tools);

    assert.ok(result);
    assert.equal(result.kind, "response");
    assert.deepEqual(result.response.toolCalls, [{
      id: "call_1",
      type: "function",
      function: {
        name: "log_food",
        arguments: "{\"food_name\":\"蘋果\"}",
      },
    }]);
  });
});
