import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import OpenAI from "openai";
import { LLMProviderError, isLLMProviderError } from "../../server/llm/errors.js";
import { OpenAIProvider } from "../../server/llm/openai.js";
import type {
  GenerateObjectMetadata,
  GenerateObjectRequest,
  GenerateObjectResult,
  ProviderErrorMetadata,
  ProviderOperation,
  StructuredOutputFailureReason,
  StructuredValidationResult,
} from "../../server/llm/types.js";

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
  "generate_object",
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
  "assistant-content-sentinel",
  "raw-validator-value-sentinel",
  "validator-error-sentinel",
];

const allowedStructuredBaseMetadataKeys = ["provider", "operation", "model", "metadataContext"];
const allowedStructuredNoContentMetadataKeys = [...allowedStructuredBaseMetadataKeys, "noContentSubtype"];
const allowedStructuredSchemaMetadataKeys = [...allowedStructuredBaseMetadataKeys, "issueCount", "issues"];

function assertExactKeys(value: Record<string, unknown>, expectedKeys: string[]) {
  assert.deepEqual(Object.keys(value).sort(), [...expectedKeys].sort());
}

function assertNoForbiddenProviderSentinels(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const sentinel of forbiddenProviderSentinels) {
    assert.equal(serialized.includes(sentinel), false, `leaked forbidden sentinel: ${sentinel}`);
  }
}

function assertStructuredMetadata(
  metadata: GenerateObjectMetadata,
  expectedKeys: string[] = allowedStructuredBaseMetadataKeys,
) {
  assertExactKeys(metadata as unknown as Record<string, unknown>, expectedKeys);
  assert.equal(metadata.provider, "openai");
  assert.equal(metadata.operation, "generate_object");
  assert.equal(metadata.model, process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini");
  assertNoForbiddenProviderSentinels(metadata);
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
    if (!isLLMProviderError(error)) {
      assert.fail("Expected LLMProviderError");
    }
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
  assertNoForbiddenProviderSentinels(serialized);
}

interface StructuredFixture {
  label: string;
  calories: number;
}

function validateStructuredFixture(raw: unknown): StructuredValidationResult<StructuredFixture> {
  if (
    typeof raw === "object"
    && raw !== null
    && (raw as { label?: unknown }).label === "早餐"
    && (raw as { calories?: unknown }).calories === 450
  ) {
    return { ok: true, value: { label: "早餐", calories: 450 } };
  }

  return {
    ok: false,
    issues: [
      { path: "meal.calories", code: "invalid_type" },
      { path: "meal.secret", code: "forbidden_value" },
    ],
  };
}

function createGenerateObjectRequest(
  overrides: Partial<GenerateObjectRequest<StructuredFixture>> = {},
): GenerateObjectRequest<StructuredFixture> {
  return {
    validate: validateStructuredFixture,
    metadataContext: "safe_context",
    ...overrides,
  };
}

describe("OpenAI Provider", () => {
  it("uses injected OpenAI-compatible clients without live client construction or network", async () => {
    const originalApiKey = process.env.OPENAI_API_KEY;
    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    const requests: unknown[] = [];

    const fakeClient = {
      chat: {
        completions: {
          create: async (request: unknown) => {
            requests.push(request);

            if (typeof request === "object" && request !== null && (request as { stream?: unknown }).stream === true) {
              return createStream([
                { choices: [{ delta: { role: "assistant" }, finish_reason: null, index: 0 }] },
                { choices: [{ delta: { content: "本" }, finish_reason: null, index: 0 }] },
                { choices: [{ delta: { content: "地" }, finish_reason: "stop", index: 0 }] },
              ]);
            }

            if (typeof request === "object" && request !== null && "response_format" in request) {
              return {
                choices: [{
                  message: {
                    content: JSON.stringify({ label: "早餐", calories: 450 }),
                  },
                }],
              };
            }

            return {
              choices: [{
                message: {
                  content: "已記錄",
                },
              }],
            };
          },
        },
      },
    } as unknown as OpenAI;

    process.env.OPENAI_API_KEY = "your-api-key-here";
    globalThis.fetch = (async () => {
      fetchCalls += 1;
      throw new Error("network access is forbidden in OpenAIProvider injected-client tests");
    }) as typeof fetch;

    try {
      const provider = new OpenAIProvider(fakeClient);

      const chatResult = await provider.chat([{ role: "user", content: "local chat" }], []);
      assert.deepEqual(chatResult, { content: "已記錄", toolCalls: undefined });

      const objectResult = await provider.generateObject(
        [{ role: "user", content: "local object" }],
        createGenerateObjectRequest({
          schemaHint: {
            name: "meal_object",
            schema: {
              type: "object",
              additionalProperties: false,
              properties: {
                label: { type: "string" },
                calories: { type: "number" },
              },
              required: ["label", "calories"],
            },
          },
        }),
      );
      assert.equal(objectResult.ok, true);
      if (!objectResult.ok) {
        assert.fail("Expected structured object success");
      }
      assert.deepEqual(objectResult.value, { label: "早餐", calories: 450 });

      const roundResult = await provider.chatRound?.([{ role: "user", content: "local stream" }], []);
      assert.ok(roundResult);
      assert.equal(roundResult.kind, "stream");
      const streamedTokens: string[] = [];
      for await (const token of roundResult.streamGenerator) {
        streamedTokens.push(token);
      }
      assert.deepEqual(streamedTokens, ["本", "地"]);

      assert.equal(fetchCalls, 0);
      assert.equal(requests.length, 3);

      const providerSource = readFileSync("server/llm/openai.ts", "utf8");
      const indexSource = readFileSync("server/index.ts", "utf8");
      const productionConstructionAnchor = "new OpenAIProvider()";
      // ESM import bindings make direct constructor monkeypatching brittle; keep the injected-client fallback visible instead.
      const openAIConstructions = providerSource.match(/new\s+OpenAI\s*\(/g) ?? [];
      assert.equal(openAIConstructions.length, 1);
      assert.match(providerSource, /this\.client\s*=\s*client\s*\?\?\s*new\s+OpenAI\s*\(/);
      assert.equal(indexSource.includes(productionConstructionAnchor), true);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
      } else {
        process.env.OPENAI_API_KEY = originalApiKey;
      }
    }
  });

  it("defines metadata-only LLMProviderError contracts with fixed serialization", () => {
    assert.deepEqual(providerOperations, [
      "chat",
      "generate_object",
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

  it("D-01/D-04/D-05/D-06/D-08 models structured object result contract without domain reasons", () => {
    const reasons = [
      "provider_error",
      "invalid_json",
      "schema_validation",
      "no_content",
    ] satisfies StructuredOutputFailureReason[];
    assert.deepEqual(reasons, ["provider_error", "invalid_json", "schema_validation", "no_content"]);
    assert.equal((reasons as string[]).includes("bounds_failed"), false);
    assert.equal((reasons as string[]).includes("macro_calorie_mismatch"), false);
    assert.equal((reasons as string[]).includes("missing_field"), false);

    const success: GenerateObjectResult<StructuredFixture> = {
      ok: true,
      value: { label: "早餐", calories: 450 },
      metadata: {
        provider: "openai",
        operation: "generate_object",
        model: "gpt-test",
      },
    };
    const invalidJson: GenerateObjectResult<StructuredFixture> = {
      ok: false,
      reason: "invalid_json",
      metadata: {
        provider: "openai",
        operation: "generate_object",
        model: "gpt-test",
      },
    };
    const schemaValidation: GenerateObjectResult<StructuredFixture> = {
      ok: false,
      reason: "schema_validation",
      metadata: {
        provider: "openai",
        operation: "generate_object",
        model: "gpt-test",
        issueCount: 1,
        issues: [{ path: "meal.calories", code: "invalid_type" }],
      },
    };
    const noContent: GenerateObjectResult<StructuredFixture> = {
      ok: false,
      reason: "no_content",
      metadata: {
        provider: "openai",
        operation: "generate_object",
        model: "gpt-test",
        noContentSubtype: "empty_content",
      },
    };
    const providerError: GenerateObjectResult<StructuredFixture> = {
      ok: false,
      reason: "provider_error",
      metadata: {
        provider: "openai",
        operation: "generate_object",
        model: "gpt-test",
        aborted: false,
      },
    };

    assert.equal(success.ok, true);
    assert.equal(invalidJson.reason, "invalid_json");
    assert.equal(schemaValidation.reason, "schema_validation");
    assert.equal(noContent.reason, "no_content");
    assert.equal(providerError.reason, "provider_error");
    assertNoForbiddenProviderSentinels([success, invalidJson, schemaValidation, noContent, providerError]);
  });

  it("D-02/D-07/D-13/D-17 returns typed structured success after local validation", async () => {
    let validateCalls = 0;
    const fakeClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({ label: "早餐", calories: 450 }),
              },
            }],
          }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    const result = await provider.generateObject([{ role: "user", content: "user-input-sentinel" }], {
      ...createGenerateObjectRequest(),
      validate: (raw) => {
        validateCalls += 1;
        return validateStructuredFixture(raw);
      },
    });

    assert.equal(validateCalls, 1);
    if (!result.ok) {
      assert.fail("Expected structured object success");
    }
    assert.deepEqual(result, {
      ok: true,
      value: { label: "早餐", calories: 450 },
      metadata: {
        provider: "openai",
        operation: "generate_object",
        model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
        metadataContext: "safe_context",
      },
    });
    assertStructuredMetadata(result.metadata);
  });

  it("D-07/D-10 returns invalid_json metadata without raw assistant content", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{
              message: {
                content: "{\"label\":\"assistant-content-sentinel\"",
              },
            }],
          }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    const result = await provider.generateObject([{ role: "user", content: "prompt-sentinel" }], createGenerateObjectRequest());

    assert.equal(result.ok, false);
    assert.equal(result.reason, "invalid_json");
    assertStructuredMetadata(result.metadata);
    assertNoForbiddenProviderSentinels(result);
  });

  it("D-07/D-10 returns sanitized schema_validation issue facts without rejected values", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({
                  label: "raw-validator-value-sentinel",
                  calories: "validator-error-sentinel",
                }),
              },
            }],
          }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    const result = await provider.generateObject([{ role: "user", content: "user-input-sentinel" }], createGenerateObjectRequest());

    assert.equal(result.ok, false);
    assert.equal(result.reason, "schema_validation");
    assertStructuredMetadata(result.metadata, allowedStructuredSchemaMetadataKeys);
    assert.equal(result.metadata.issueCount, 2);
    assert.deepEqual(result.metadata.issues, [
      { path: "meal.calories", code: "invalid_type" },
      { path: "meal.secret", code: "forbidden_value" },
    ]);
    assertNoForbiddenProviderSentinels(result);
  });

  it("D-07 returns schema_validation when validators throw or emit unsafe metadata tokens", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{
              message: {
                content: JSON.stringify({ label: "raw-validator-value-sentinel", calories: 450 }),
              },
            }],
          }),
        },
      },
    } as unknown as OpenAI;

    const throwingProvider = new OpenAIProvider(fakeClient);
    const thrownValidation = await throwingProvider.generateObject(
      [{ role: "user", content: "user-input-sentinel" }],
      createGenerateObjectRequest({
        metadataContext: "prompt-sentinel unsafe context",
        validate: () => {
          throw new Error("validator-error-sentinel raw-validator-value-sentinel");
        },
      }),
    );
    assert.equal(thrownValidation.ok, false);
    assert.equal(thrownValidation.reason, "schema_validation");
    assertStructuredMetadata(thrownValidation.metadata, allowedStructuredSchemaMetadataKeys);
    assert.equal(thrownValidation.metadata.metadataContext, "redacted");
    assert.deepEqual(thrownValidation.metadata.issues, [
      { path: "root", code: "validator_exception" },
    ]);
    assertNoForbiddenProviderSentinels(thrownValidation);

    const unsafeIssueProvider = new OpenAIProvider(fakeClient);
    const unsafeIssue = await unsafeIssueProvider.generateObject(
      [{ role: "user", content: "message-sentinel" }],
      createGenerateObjectRequest({
        metadataContext: "safe_context",
        validate: () => ({
          ok: false,
          issues: [
            { path: "meal.raw-validator-value-sentinel", code: "validator-error-sentinel" },
          ],
        }),
      }),
    );
    assert.equal(unsafeIssue.ok, false);
    assert.equal(unsafeIssue.reason, "schema_validation");
    assertStructuredMetadata(unsafeIssue.metadata, allowedStructuredSchemaMetadataKeys);
    assert.deepEqual(unsafeIssue.metadata.issues, [
      { path: "redacted", code: "redacted" },
    ]);
    assertNoForbiddenProviderSentinels(unsafeIssue);
  });

  it("D-14 returns no_content subtype metadata for no choices, missing content, and empty content", async () => {
    const cases: Array<{ response: unknown; subtype: string }> = [
      { response: { choices: [] }, subtype: "no_choices" },
      { response: { choices: [{ message: { content: null } }] }, subtype: "missing_content" },
      { response: { choices: [{ message: { content: " \n\t " } }] }, subtype: "empty_content" },
    ];

    for (const testCase of cases) {
      const fakeClient = {
        chat: {
          completions: {
            create: async () => testCase.response,
          },
        },
      } as unknown as OpenAI;
      const provider = new OpenAIProvider(fakeClient);
      const result = await provider.generateObject([{ role: "user", content: "message-sentinel" }], createGenerateObjectRequest());

      assert.equal(result.ok, false);
      assert.equal(result.reason, "no_content");
      assertStructuredMetadata(result.metadata, allowedStructuredNoContentMetadataKeys);
      assert.equal(result.metadata.noContentSubtype, testCase.subtype);
      assertNoForbiddenProviderSentinels(result);
    }
  });

  it("D-02 returns provider_error for non-abort structured provider failures", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => {
            throw createOpenAIAPIError({ status: 500, requestId: "req_object", type: "server_error", code: "upstream_failed" });
          },
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    const result = await provider.generateObject([{ role: "user", content: "user-input-sentinel" }], createGenerateObjectRequest());

    assert.equal(result.ok, false);
    assert.equal(result.reason, "provider_error");
    assert.deepEqual(result.metadata, {
      provider: "openai",
      operation: "generate_object",
      model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
      aborted: false,
      status: 500,
      providerRequestId: "req_object",
      errorName: "InternalServerError",
      errorType: "server_error",
      errorCode: "upstream_failed",
    });
    assertExactKeys(result.metadata as unknown as Record<string, unknown>, allowedProviderMetadataKeys);
    assertNoForbiddenProviderSentinels(result);
  });

  it("D-03 throws metadata-only LLMProviderError for structured cancellation", async () => {
    const abortController = new AbortController();
    abortController.abort();
    const localAbortProvider = new OpenAIProvider({ chat: { completions: { create: async () => ({ choices: [] }) } } } as unknown as OpenAI);
    const localAbortError = await captureProviderError(() => localAbortProvider.generateObject(
      [{ role: "user", content: "hello" }],
      createGenerateObjectRequest(),
      { signal: abortController.signal },
    ));
    assertProviderMetadata(localAbortError, {
      provider: "openai",
      operation: "generate_object",
      model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
      aborted: true,
    });

    const sdkAbortProvider = new OpenAIProvider({
      chat: {
        completions: {
          create: async () => {
            throw new OpenAI.APIUserAbortError();
          },
        },
      },
    } as unknown as OpenAI);
    const sdkAbortError = await captureProviderError(() => sdkAbortProvider.generateObject(
      [{ role: "user", content: "hello" }],
      createGenerateObjectRequest(),
    ));
    assertProviderMetadata(sdkAbortError, {
      provider: "openai",
      operation: "generate_object",
      model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
      aborted: true,
      errorName: "APIUserAbortError",
    });
  });

  it("D-08/D-09/D-11 maps schema hints to Chat Completions response_format without changing chat shape", async () => {
    let capturedRequest: unknown;
    let capturedOptions: unknown;
    const fakeClient = {
      chat: {
        completions: {
          create: async (request: unknown, options: unknown) => {
            capturedRequest = request;
            capturedOptions = options;
            return {
              choices: [{
                message: {
                  content: JSON.stringify({ label: "早餐", calories: 450 }),
                },
              }],
            };
          },
        },
      },
    } as unknown as OpenAI;
    const signal = new AbortController().signal;
    const provider = new OpenAIProvider(fakeClient);

    await provider.generateObject(
      [{ role: "user", content: "請輸出 JSON" }],
      createGenerateObjectRequest({
        maxCompletionTokens: 80,
        schemaHint: {
          name: "meal_object",
          description: "safe object schema",
          strict: false,
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string" },
              calories: { type: "number" },
            },
            required: ["label", "calories"],
          },
        },
      }),
      { signal },
    );

    assert.deepEqual(capturedRequest, {
      model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
      messages: [{ role: "user", content: "請輸出 JSON" }],
      max_completion_tokens: 80,
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "meal_object",
          description: "safe object schema",
          schema: {
            type: "object",
            additionalProperties: false,
            properties: {
              label: { type: "string" },
              calories: { type: "number" },
            },
            required: ["label", "calories"],
          },
          strict: false,
        },
      },
    });
    assert.deepEqual(capturedOptions, { signal });
    assertNoForbiddenProviderSentinels(capturedRequest);
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

  it("normalizes empty chat choices as metadata-only provider errors", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => ({ choices: [] }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    const error = await captureProviderError(() => provider.chat([{ role: "user", content: "test" }], []));

    assertProviderMetadata(error, {
      provider: "openai",
      operation: "chat",
      model: process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5.4-mini",
      aborted: false,
      errorName: "OpenAINoChoicesError",
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
