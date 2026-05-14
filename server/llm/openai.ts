import OpenAI from "openai";
import type {
  LLMProvider,
  ChatMessage,
  ToolDefinition,
  LLMResponse,
  LLMRoundResult,
  ToolCall,
  LLMCallOptions,
  ProviderErrorMetadata,
  ProviderOperation,
} from "./types.js";
import { LLMProviderError } from "./errors.js";
import { config } from "../config.js";

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sdkErrorName(error: { constructor: { name: string } }): string | undefined {
  return nonEmptyString(error.constructor.name);
}

function isOpenAIAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || error instanceof OpenAI.APIUserAbortError;
}

function normalizeOpenAIError(
  error: unknown,
  operation: ProviderOperation,
  model: string,
  opts?: LLMCallOptions,
): ProviderErrorMetadata {
  const metadata: ProviderErrorMetadata = {
    provider: "openai",
    operation,
    model,
    aborted: isOpenAIAbort(error, opts?.signal),
  };

  if (error instanceof OpenAI.APIError) {
    if (typeof error.status === "number") {
      metadata.status = error.status;
    }

    const providerRequestId = nonEmptyString(error.request_id);
    if (providerRequestId) {
      metadata.providerRequestId = providerRequestId;
    }

    const errorName = sdkErrorName(error);
    if (errorName) {
      metadata.errorName = errorName;
    }

    const errorType = nonEmptyString(error.type);
    if (errorType) {
      metadata.errorType = errorType;
    }

    const errorCode = nonEmptyString(error.code);
    if (errorCode) {
      metadata.errorCode = errorCode;
    }
  }

  return metadata;
}

function wrapOpenAIError(
  error: unknown,
  operation: ProviderOperation,
  model: string,
  opts?: LLMCallOptions,
): LLMProviderError {
  return new LLMProviderError(normalizeOpenAIError(error, operation, model, opts));
}

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(client?: OpenAI) {
    this.client = client ?? new OpenAI();
    this.model = config.orchestratorModel;
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[], opts?: LLMCallOptions): Promise<LLMResponse> {
    let response: OpenAI.Chat.Completions.ChatCompletion;
    try {
      response = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: messages as OpenAI.ChatCompletionMessageParam[],
          ...(tools.length > 0 ? { tools: tools as OpenAI.ChatCompletionTool[] } : {}),
        },
        { signal: opts?.signal },
      );
    } catch (error) {
      throw wrapOpenAIError(error, "chat", this.model, opts);
    }

    if (!response.choices.length) {
      throw new Error("OpenAI returned no choices");
    }

    const choice = response.choices[0];
    return {
      content: choice.message.content ?? undefined,
      toolCalls: choice.message.tool_calls?.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments,
        },
      })),
    };
  }

  async chatRound(messages: ChatMessage[], tools: ToolDefinition[], opts?: LLMCallOptions): Promise<LLMRoundResult> {
    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      stream = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: messages as OpenAI.ChatCompletionMessageParam[],
          ...(tools.length > 0 ? { tools: tools as OpenAI.ChatCompletionTool[] } : {}),
          stream: true,
        },
        { signal: opts?.signal },
      );
    } catch (error) {
      throw wrapOpenAIError(error, "chat_round_initial", this.model, opts);
    }
    const iterator = stream[Symbol.asyncIterator]();
    const bufferedTokens: string[] = [];
    const toolCalls = new Map<number, ToolCall>();

    try {
      while (true) {
        const nextChunk = await iterator.next();
        if (nextChunk.done) {
          return {
            kind: "response",
            response: { content: bufferedTokens.join("") || undefined },
          };
        }

        const choice = nextChunk.value.choices[0];
        if (!choice) {
          continue;
        }

        const delta = choice.delta;
        if (delta.tool_calls?.length) {
          this.mergeToolCalls(toolCalls, delta.tool_calls);
        }

        if (delta.content) {
          bufferedTokens.push(delta.content);
          return {
            kind: "stream",
            streamGenerator: this.streamRemainingTokens(bufferedTokens, iterator, opts),
          };
        }

        if (choice.finish_reason === "tool_calls") {
          return {
            kind: "response",
            response: { toolCalls: this.sortToolCalls(toolCalls) },
          };
        }

        if (choice.finish_reason === "stop") {
          return {
            kind: "response",
            response: { content: bufferedTokens.join("") || "" },
          };
        }
      }
    } catch (error) {
      throw wrapOpenAIError(error, "chat_round_initial", this.model, opts);
    }
  }

  async *chatStream(messages: ChatMessage[], _tools: ToolDefinition[], opts?: LLMCallOptions): AsyncGenerator<string> {
    let stream: AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>;
    try {
      stream = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: messages as OpenAI.ChatCompletionMessageParam[],
          stream: true,
        },
        { signal: opts?.signal },
      );
    } catch (error) {
      throw wrapOpenAIError(error, "chat_stream_initial", this.model, opts);
    }

    try {
      for await (const chunk of stream) {
        const token = chunk.choices[0]?.delta?.content;
        if (token) {
          yield token;
        }
      }
    } catch (error) {
      throw wrapOpenAIError(error, "chat_stream_continuation", this.model, opts);
    }
  }

  private mergeToolCalls(
    toolCalls: Map<number, ToolCall>,
    deltas: NonNullable<OpenAI.Chat.Completions.ChatCompletionChunk.Choice.Delta["tool_calls"]>,
  ) {
    for (const delta of deltas) {
      const current = toolCalls.get(delta.index) ?? {
        id: "",
        type: "function",
        function: {
          name: "",
          arguments: "",
        },
      };

      if (delta.id) {
        current.id = delta.id;
      }
      if (delta.type) {
        current.type = delta.type;
      }
      if (delta.function?.name) {
        current.function.name += delta.function.name;
      }
      if (delta.function?.arguments) {
        current.function.arguments += delta.function.arguments;
      }

      toolCalls.set(delta.index, current);
    }
  }

  private sortToolCalls(toolCalls: Map<number, ToolCall>): ToolCall[] {
    return [...toolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, toolCall]) => toolCall);
  }

  private async *streamRemainingTokens(
    bufferedTokens: string[],
    iterator: AsyncIterator<OpenAI.Chat.Completions.ChatCompletionChunk>,
    opts?: LLMCallOptions,
  ): AsyncGenerator<string> {
    for (const token of bufferedTokens) {
      yield token;
    }

    try {
      while (true) {
        const nextChunk = await iterator.next();
        if (nextChunk.done) {
          return;
        }

        const token = nextChunk.value.choices[0]?.delta?.content;
        if (token) {
          yield token;
        }
      }
    } catch (error) {
      throw wrapOpenAIError(error, "chat_round_stream_continuation", this.model, opts);
    }
  }
}
