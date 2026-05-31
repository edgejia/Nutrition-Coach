import type {
  LLMProvider,
  ChatMessage,
  ToolDefinition,
  LLMResponse,
  LLMCallOptions,
  GenerateObjectMetadata,
  GenerateObjectRequest,
  GenerateObjectResult,
  StructuredOutputNoContentSubtype,
  StructuredValidationIssue,
} from "./types.js";
import { LLMProviderError } from "./errors.js";

type ObjectQueueItem =
  | { kind: "content"; content: string }
  | { kind: "no_content"; subtype: StructuredOutputNoContentSubtype }
  | { kind: "provider_error" }
  | { kind: "abort" };

function buildObjectMetadata<T>(request: GenerateObjectRequest<T>): GenerateObjectMetadata {
  return {
    provider: "mock",
    operation: "generate_object",
    model: "mock",
    ...(typeof request.metadataContext === "string" && request.metadataContext.length > 0
      ? { metadataContext: request.metadataContext }
      : {}),
  };
}

function summarizeStructuredValidationIssues(issues: StructuredValidationIssue[]): Pick<GenerateObjectMetadata, "issueCount" | "issues"> {
  return {
    issueCount: issues.length,
    issues: issues.map((issue) => ({
      path: issue.path,
      code: issue.code,
    })),
  };
}

export class MockLLMProvider implements LLMProvider {
  private chatQueue: Array<LLMResponse | Error> = [];
  private callIndex = 0;
  private objectQueue: ObjectQueueItem[] = [];
  private objectCallIndex = 0;
  public chatCalls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[]; opts?: LLMCallOptions }> = [];
  public objectCalls: Array<{ messages: ChatMessage[]; request: GenerateObjectRequest<unknown>; opts?: LLMCallOptions }> = [];

  /**
   * Queue responses for sequential chat() calls.
   * If none queued, returns a default text response.
   */
  queueChatResponse(response: LLMResponse) {
    this.chatQueue.push(response);
  }

  /** Queue an error to be thrown on the next chat() call. */
  queueChatError(error: Error) {
    this.chatQueue.push(error);
  }

  queueObjectContent(content: string) {
    this.objectQueue.push({ kind: "content", content });
  }

  queueObjectNoContent(subtype: StructuredOutputNoContentSubtype) {
    this.objectQueue.push({ kind: "no_content", subtype });
  }

  queueObjectProviderError() {
    this.objectQueue.push({ kind: "provider_error" });
  }

  queueObjectAbort() {
    this.objectQueue.push({ kind: "abort" });
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[], opts?: LLMCallOptions): Promise<LLMResponse> {
    this.chatCalls.push({ messages, tools, opts });
    if (this.callIndex < this.chatQueue.length) {
      const item = this.chatQueue[this.callIndex++];
      if (item instanceof Error) throw item;
      return item;
    }
    return { content: "Mock: 已記錄您的飲食！" };
  }

  async generateObject<T>(
    messages: ChatMessage[],
    request: GenerateObjectRequest<T>,
    opts?: LLMCallOptions,
  ): Promise<GenerateObjectResult<T>> {
    this.objectCalls.push({ messages, request: request as GenerateObjectRequest<unknown>, opts });
    if (opts?.signal?.aborted === true) {
      throw new LLMProviderError({
        provider: "mock",
        operation: "generate_object",
        model: "mock",
        aborted: true,
      });
    }

    const item = this.objectCallIndex < this.objectQueue.length
      ? this.objectQueue[this.objectCallIndex++]
      : { kind: "content" as const, content: "{}" };

    if (item.kind === "provider_error") {
      return {
        ok: false,
        reason: "provider_error",
        metadata: {
          provider: "mock",
          operation: "generate_object",
          model: "mock",
        },
      };
    }

    if (item.kind === "abort") {
      throw new LLMProviderError({
        provider: "mock",
        operation: "generate_object",
        model: "mock",
        aborted: true,
      });
    }

    if (item.kind === "no_content") {
      return {
        ok: false,
        reason: "no_content",
        metadata: {
          ...buildObjectMetadata(request),
          noContentSubtype: item.subtype,
        },
      };
    }

    let raw: unknown;
    try {
      raw = JSON.parse(item.content);
    } catch {
      return {
        ok: false,
        reason: "invalid_json",
        metadata: buildObjectMetadata(request),
      };
    }

    const validated = request.validate(raw);
    if (!validated.ok) {
      return {
        ok: false,
        reason: "schema_validation",
        metadata: {
          ...buildObjectMetadata(request),
          ...summarizeStructuredValidationIssues(validated.issues),
        },
      };
    }

    return {
      ok: true,
      value: validated.value,
      metadata: buildObjectMetadata(request),
    };
  }

  reset() {
    this.chatQueue = [];
    this.callIndex = 0;
    this.chatCalls = [];
    this.objectQueue = [];
    this.objectCallIndex = 0;
    this.objectCalls = [];
  }
}
