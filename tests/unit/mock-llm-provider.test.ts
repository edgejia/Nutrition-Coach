import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { LLMProviderError, isLLMProviderError } from "../../server/llm/errors.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type {
  GenerateObjectMetadata,
  GenerateObjectRequest,
  StructuredValidationResult,
} from "../../server/llm/types.js";

interface StructuredFixture {
  label: string;
  calories: number;
}

const forbiddenStructuredSentinels = [
  "raw-provider-body-sentinel",
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

function assertExactKeys(value: Record<string, unknown>, expectedKeys: string[]) {
  assert.deepEqual(Object.keys(value).sort(), [...expectedKeys].sort());
}

function assertNoForbiddenSentinels(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const sentinel of forbiddenStructuredSentinels) {
    assert.equal(serialized.includes(sentinel), false, `leaked forbidden sentinel: ${sentinel}`);
  }
}

function assertStructuredMetadata(metadata: GenerateObjectMetadata, expectedKeys: string[]) {
  assertExactKeys(metadata as unknown as Record<string, unknown>, expectedKeys);
  assert.equal(metadata.provider, "mock");
  assert.equal(metadata.operation, "generate_object");
  assert.equal(metadata.model, "mock");
  assertNoForbiddenSentinels(metadata);
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

describe("MockLLMProvider generateObject", () => {
  it("parses queued raw JSON content and returns the validator-accepted typed value", async () => {
    const mockLLM = new MockLLMProvider();
    mockLLM.queueObjectContent(JSON.stringify({ label: "早餐", calories: 450 }));

    const result = await mockLLM.generateObject([{ role: "user", content: "user-input-sentinel" }], createGenerateObjectRequest());

    assert.deepEqual(result, {
      ok: true,
      value: { label: "早餐", calories: 450 },
      metadata: {
        provider: "mock",
        operation: "generate_object",
        model: "mock",
        metadataContext: "safe_context",
      },
    });
    if (!result.ok) {
      assert.fail("Expected structured success");
    }
    assertStructuredMetadata(result.metadata, ["provider", "operation", "model", "metadataContext"]);
    assertNoForbiddenSentinels(result);
  });

  it("returns invalid_json and schema_validation with sanitized metadata only", async () => {
    const mockLLM = new MockLLMProvider();
    mockLLM.queueObjectContent("{\"label\":\"assistant-content-sentinel\"");
    mockLLM.queueObjectContent(JSON.stringify({
      label: "raw-validator-value-sentinel",
      calories: "validator-error-sentinel",
    }));

    const invalidJson = await mockLLM.generateObject([{ role: "user", content: "prompt-sentinel" }], createGenerateObjectRequest());
    assert.equal(invalidJson.ok, false);
    assert.equal(invalidJson.reason, "invalid_json");
    assertStructuredMetadata(invalidJson.metadata, ["provider", "operation", "model", "metadataContext"]);
    assertNoForbiddenSentinels(invalidJson);

    const schemaValidation = await mockLLM.generateObject([{ role: "user", content: "message-sentinel" }], createGenerateObjectRequest());
    assert.equal(schemaValidation.ok, false);
    assert.equal(schemaValidation.reason, "schema_validation");
    assertStructuredMetadata(schemaValidation.metadata, [
      "provider",
      "operation",
      "model",
      "metadataContext",
      "issueCount",
      "issues",
    ]);
    assert.equal(schemaValidation.metadata.issueCount, 2);
    assert.deepEqual(schemaValidation.metadata.issues, [
      { path: "meal.calories", code: "invalid_type" },
      { path: "meal.secret", code: "forbidden_value" },
    ]);
    assertNoForbiddenSentinels(schemaValidation);
  });

  it("returns schema_validation when validators throw or emit unsafe metadata tokens", async () => {
    const throwingMock = new MockLLMProvider();
    throwingMock.queueObjectContent(JSON.stringify({ label: "raw-validator-value-sentinel", calories: 450 }));

    const thrownValidation = await throwingMock.generateObject(
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
    assertStructuredMetadata(thrownValidation.metadata, [
      "provider",
      "operation",
      "model",
      "metadataContext",
      "issueCount",
      "issues",
    ]);
    assert.equal(thrownValidation.metadata.metadataContext, "redacted");
    assert.deepEqual(thrownValidation.metadata.issues, [
      { path: "root", code: "validator_exception" },
    ]);
    assertNoForbiddenSentinels(thrownValidation);

    const unsafeIssueMock = new MockLLMProvider();
    unsafeIssueMock.queueObjectContent(JSON.stringify({ label: "早餐", calories: "validator-error-sentinel" }));
    const unsafeIssue = await unsafeIssueMock.generateObject(
      [{ role: "user", content: "message-sentinel" }],
      createGenerateObjectRequest({
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
    assertStructuredMetadata(unsafeIssue.metadata, [
      "provider",
      "operation",
      "model",
      "metadataContext",
      "issueCount",
      "issues",
    ]);
    assert.deepEqual(unsafeIssue.metadata.issues, [
      { path: "redacted", code: "redacted" },
    ]);
    assertNoForbiddenSentinels(unsafeIssue);
  });

  it("throws when generateObject is called without a queued object fixture", async () => {
    const mockLLM = new MockLLMProvider();

    await assert.rejects(
      () => mockLLM.generateObject(
        [{ role: "user", content: "default object" }],
        createGenerateObjectRequest(),
      ),
      /MockLLMProvider\.generateObject called without a queued object fixture/,
    );
  });

  it("returns no_content with each subtype marker", async () => {
    const mockLLM = new MockLLMProvider();
    mockLLM.queueObjectNoContent("no_choices");
    mockLLM.queueObjectNoContent("missing_content");
    mockLLM.queueObjectNoContent("empty_content");

    for (const subtype of ["no_choices", "missing_content", "empty_content"]) {
      const result = await mockLLM.generateObject([{ role: "user", content: "hello" }], createGenerateObjectRequest());
      assert.equal(result.ok, false);
      assert.equal(result.reason, "no_content");
      assertStructuredMetadata(result.metadata, [
        "provider",
        "operation",
        "model",
        "metadataContext",
        "noContentSubtype",
      ]);
      assert.equal(result.metadata.noContentSubtype, subtype);
      assertNoForbiddenSentinels(result);
    }
  });

  it("returns typed provider_error for queued provider failures", async () => {
    const mockLLM = new MockLLMProvider();
    mockLLM.queueObjectProviderError();

    const result = await mockLLM.generateObject([{ role: "user", content: "hello" }], createGenerateObjectRequest());

    assert.equal(result.ok, false);
    assert.equal(result.reason, "provider_error");
    assert.deepEqual(result.metadata, {
      provider: "mock",
      operation: "generate_object",
      model: "mock",
      aborted: false,
    });
    assertNoForbiddenSentinels(result);
  });

  it("throws metadata-only LLMProviderError for queued aborts and already-aborted signals", async () => {
    const queuedAbortLLM = new MockLLMProvider();
    queuedAbortLLM.queueObjectAbort();
    const queuedAbort = await captureProviderError(() => queuedAbortLLM.generateObject(
      [{ role: "user", content: "hello" }],
      createGenerateObjectRequest(),
    ));
    assert.deepEqual(queuedAbort.providerMetadata, {
      provider: "mock",
      operation: "generate_object",
      model: "mock",
      aborted: true,
    });
    assertNoForbiddenSentinels(queuedAbort);

    const signalAbortLLM = new MockLLMProvider();
    const abortController = new AbortController();
    abortController.abort();
    const signalAbort = await captureProviderError(() => signalAbortLLM.generateObject(
      [{ role: "user", content: "hello" }],
      createGenerateObjectRequest(),
      { signal: abortController.signal },
    ));
    assert.deepEqual(signalAbort.providerMetadata, {
      provider: "mock",
      operation: "generate_object",
      model: "mock",
      aborted: true,
    });
    assertNoForbiddenSentinels(signalAbort);
  });

  it("records structured calls independently from chat queue state", async () => {
    const mockLLM = new MockLLMProvider();
    mockLLM.queueChatResponse({ content: "chat response" });
    mockLLM.queueObjectContent(JSON.stringify({ label: "早餐", calories: 450 }));

    const objectResult = await mockLLM.generateObject([{ role: "user", content: "object" }], createGenerateObjectRequest());
    assert.equal(objectResult.ok, true);
    assert.equal(mockLLM.objectCalls.length, 1);
    assert.equal(mockLLM.chatCalls.length, 0);

    const chatResult = await mockLLM.chat([{ role: "user", content: "chat" }], []);
    assert.deepEqual(chatResult, { content: "chat response" });
    assert.equal(mockLLM.chatCalls.length, 1);

    const defaultChatResult = await mockLLM.chat([{ role: "user", content: "chat again" }], []);
    assert.deepEqual(defaultChatResult, { content: "Mock: 已記錄您的飲食！" });
    assert.equal(mockLLM.objectCalls.length, 1);
  });

  it("reset clears chat and structured queue state", async () => {
    const mockLLM = new MockLLMProvider();
    mockLLM.queueChatResponse({ content: "chat response" });
    mockLLM.queueObjectContent(JSON.stringify({ label: "早餐", calories: 450 }));

    await mockLLM.chat([{ role: "user", content: "chat" }], []);
    await mockLLM.generateObject([{ role: "user", content: "object" }], createGenerateObjectRequest());

    assert.equal(mockLLM.chatCalls.length, 1);
    assert.equal(mockLLM.objectCalls.length, 1);

    mockLLM.reset();

    assert.equal(mockLLM.chatCalls.length, 0);
    assert.equal(mockLLM.objectCalls.length, 0);
    assert.deepEqual(await mockLLM.chat([{ role: "user", content: "default chat" }], []), {
      content: "Mock: 已記錄您的飲食！",
    });

    await assert.rejects(
      () => mockLLM.generateObject(
        [{ role: "user", content: "default object" }],
        {
          validate: (raw) => ({ ok: true, value: raw }),
        },
      ),
      /MockLLMProvider\.generateObject called without a queued object fixture/,
    );
  });
});
