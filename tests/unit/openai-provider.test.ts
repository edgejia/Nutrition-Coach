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
        if (chunk instanceof Error) {
          throw chunk;
        }
        yield chunk;
      }
    },
  };
}

async function captureProviderError(action: () => Promise<unknown>): Promise<LLMProviderError> {
  try {
    await action();
  } catch (error) {
    assert.equal(isLLMProviderError(error), true);
    return error;
  }

  assert.fail("Expected LLMProviderError");
}

function createOpenAIAPIError(overrides: {
  status?: number;
  requestId?: string;
  type?: string;
  code?: string;
  rawMessage?: string;
} = {}) {
  return OpenAI.APIError.generate(
    overrides.status ?? 429,
    {
      error: {
        message: overrides.rawMessage ?? "raw-provider-body-sentinel",
        type: overrides.type ?? "rate_limit_error",
        code: overrides.code ?? "rate_limit_exceeded",
      },
    },
    "message-sentinel",
    {
      "x-request-id": overrides.requestId ?? "req_safe",
      authorization: "authorization-header-sentinel",
    } as never,
  );
}

function assertProviderMetadata(
  error: LLMProviderError,
  expectedMetadata: ProviderErrorMetadata,
) {
  assert.deepEqual(error.providerMetadata, expectedMetadata);
  assertExactKeys(
    error.providerMetadata as unknown as Record<string, unknown>,
    Object.keys(expectedMetadata),
  );

  const serialized = JSON.stringify(error);
  for (const sentinel of forbiddenProviderSentinels) {
    assert.equal(serialized.includes(sentinel), false);
  }
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

  it("wraps chat request failures with safe OpenAI metadata only", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => {
            throw createOpenAIAPIError();
          },
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    const error = await captureProviderError(() => provider.chat([{ role: "user", content: "user-input-sentinel" }], []));

    assertProviderMetadata(error, {
      provider: "openai",
      operation: "chat",
      model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
      aborted: false,
      status: 429,
      providerRequestId: "req_safe",
      errorName: "RateLimitError",
      errorType: "rate_limit_error",
      errorCode: "rate_limit_exceeded",
    });
  });

  it("omits unavailable OpenAI metadata fields without placeholder values or message parsing", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => {
            throw OpenAI.APIError.generate(
              500,
              { error: { message: "request id req_from_message must not be parsed", type: "", code: "" } },
              "request id req_from_message must not be parsed",
              { "x-request-id": "" } as never,
            );
          },
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    const error = await captureProviderError(() => provider.chat([{ role: "user", content: "hello" }], []));

    assertProviderMetadata(error, {
      provider: "openai",
      operation: "chat",
      model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
      aborted: false,
      status: 500,
      errorName: "InternalServerError",
    });
    assert.equal(JSON.stringify(error).includes("req_from_message"), false);
    assert.equal(JSON.stringify(error).includes("unknown"), false);
  });

  it("wraps chatRound initial stream creation failures", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => {
            throw createOpenAIAPIError({ status: 401, requestId: "req_auth", type: "invalid_request_error", code: "invalid_api_key" });
          },
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    const error = await captureProviderError(() => provider.chatRound?.([{ role: "user", content: "hello" }], []) ?? Promise.resolve());

    assertProviderMetadata(error, {
      provider: "openai",
      operation: "chat_round_initial",
      model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
      aborted: false,
      status: 401,
      providerRequestId: "req_auth",
      errorName: "AuthenticationError",
      errorType: "invalid_request_error",
      errorCode: "invalid_api_key",
    });
  });

  it("wraps chatRound stream continuation failures separately from initial creation", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => createStream([
            { choices: [{ delta: { content: "首" }, finish_reason: null, index: 0 }] },
            createOpenAIAPIError({ status: 500, requestId: "req_continue", type: "server_error", code: "stream_failed" }),
          ]),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    const result = await provider.chatRound?.([{ role: "user", content: "hello" }], []);
    assert.ok(result);
    assert.equal(result.kind, "stream");

    const iterator = result.streamGenerator[Symbol.asyncIterator]();
    assert.deepEqual(await iterator.next(), { value: "首", done: false });
    const error = await captureProviderError(() => iterator.next());

    assertProviderMetadata(error, {
      provider: "openai",
      operation: "chat_round_stream_continuation",
      model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
      aborted: false,
      status: 500,
      providerRequestId: "req_continue",
      errorName: "InternalServerError",
      errorType: "server_error",
      errorCode: "stream_failed",
    });
  });

  it("wraps chatStream initial creation and continuation failures with distinct operations", async () => {
    const initialClient = {
      chat: {
        completions: {
          create: async () => {
            throw createOpenAIAPIError({ status: 403, requestId: "req_initial", type: "permission_error", code: "forbidden" });
          },
        },
      },
    } as unknown as OpenAI;
    const initialProvider = new OpenAIProvider(initialClient);
    const initialStream = initialProvider.chatStream?.([{ role: "user", content: "hello" }], []);
    assert.ok(initialStream);
    const initialError = await captureProviderError(() => initialStream.next());
    assertProviderMetadata(initialError, {
      provider: "openai",
      operation: "chat_stream_initial",
      model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
      aborted: false,
      status: 403,
      providerRequestId: "req_initial",
      errorName: "PermissionDeniedError",
      errorType: "permission_error",
      errorCode: "forbidden",
    });

    const continuationClient = {
      chat: {
        completions: {
          create: async () => createStream([
            { choices: [{ delta: { content: "先" }, finish_reason: null, index: 0 }] },
            createOpenAIAPIError({ status: 429, requestId: "req_stream_continue" }),
          ]),
        },
      },
    } as unknown as OpenAI;
    const continuationProvider = new OpenAIProvider(continuationClient);
    const continuationStream = continuationProvider.chatStream?.([{ role: "user", content: "hello" }], []);
    assert.ok(continuationStream);
    const iterator = continuationStream[Symbol.asyncIterator]();
    assert.deepEqual(await iterator.next(), { value: "先", done: false });
    const continuationError = await captureProviderError(() => iterator.next());
    assertProviderMetadata(continuationError, {
      provider: "openai",
      operation: "chat_stream_continuation",
      model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
      aborted: false,
      status: 429,
      providerRequestId: "req_stream_continue",
      errorName: "RateLimitError",
      errorType: "rate_limit_error",
      errorCode: "rate_limit_exceeded",
    });
  });

  it("classifies only local or SDK user aborts as aborted", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const localAbortClient = {
      chat: {
        completions: {
          create: async () => {
            throw new Error("connection lost");
          },
        },
      },
    } as unknown as OpenAI;
    const localAbortProvider = new OpenAIProvider(localAbortClient);
    const localAbortError = await captureProviderError(() => localAbortProvider.chat(
      [{ role: "user", content: "hello" }],
      [],
      { signal: abortController.signal },
    ));
    assert.equal(localAbortError.providerMetadata.aborted, true);
    assertExactKeys(localAbortError.providerMetadata as unknown as Record<string, unknown>, [
      "provider",
      "operation",
      "model",
      "aborted",
    ]);

    const sdkAbortClient = {
      chat: {
        completions: {
          create: async () => {
            throw new OpenAI.APIUserAbortError();
          },
        },
      },
    } as unknown as OpenAI;
    const sdkAbortProvider = new OpenAIProvider(sdkAbortClient);
    const sdkAbortError = await captureProviderError(() => sdkAbortProvider.chat([{ role: "user", content: "hello" }], []));
    assertProviderMetadata(sdkAbortError, {
      provider: "openai",
      operation: "chat",
      model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
      aborted: true,
      errorName: "APIUserAbortError",
    });

    for (const providerFailure of [
      new OpenAI.APIConnectionTimeoutError(),
      new OpenAI.APIConnectionError({ message: "connection failed" }),
      OpenAI.APIError.generate(401, { error: { message: "auth failed", type: "auth", code: "bad_key" } }, "auth failed", { "x-request-id": "req_auth" } as never),
      createOpenAIAPIError({ status: 429 }),
      new Error("unknown failure"),
    ]) {
      const fakeClient = {
        chat: {
          completions: {
            create: async () => {
              throw providerFailure;
            },
          },
        },
      } as unknown as OpenAI;
      const provider = new OpenAIProvider(fakeClient);
      const error = await captureProviderError(() => provider.chat([{ role: "user", content: "hello" }], []));
      assert.equal(error.providerMetadata.aborted, false);
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
