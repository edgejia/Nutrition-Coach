import OpenAI from "openai";
import type { LLMProvider, ChatMessage, ToolDefinition, LLMResponse, LLMRoundResult, ToolCall } from "./types.js";
import { config } from "../config.js";

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(client?: OpenAI) {
    this.client = client ?? new OpenAI();
    this.model = config.orchestratorModel;
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      ...(tools.length > 0 ? { tools: tools as OpenAI.ChatCompletionTool[] } : {}),
    });

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

  async chatRound(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMRoundResult> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      ...(tools.length > 0 ? { tools: tools as OpenAI.ChatCompletionTool[] } : {}),
      stream: true,
    });
    const iterator = stream[Symbol.asyncIterator]();
    const bufferedTokens: string[] = [];
    const toolCalls = new Map<number, ToolCall>();

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
          streamGenerator: this.streamRemainingTokens(bufferedTokens, iterator),
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
  }

  async *chatStream(messages: ChatMessage[], _tools: ToolDefinition[]): AsyncGenerator<string> {
    const stream = await this.client.chat.completions.create({
      model: this.model,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      stream: true,
    });

    for await (const chunk of stream) {
      const token = chunk.choices[0]?.delta?.content;
      if (token) {
        yield token;
      }
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
  ): AsyncGenerator<string> {
    for (const token of bufferedTokens) {
      yield token;
    }

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
  }
}
