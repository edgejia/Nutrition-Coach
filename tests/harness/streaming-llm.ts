/**
 * Deterministic queued LLM fake for the verification harness.
 *
 * Extracted from tests/integration/chat-streaming.test.ts and extended with
 * `reset()` and independent chat/round queues. Supports tool responses,
 * plain text responses, and async generator token streams — without any live
 * provider access.
 */

import type {
  ChatMessage,
  LLMProvider,
  LLMResponse,
  LLMRoundResult,
  ToolDefinition,
} from "../../server/llm/types.js";

async function* streamTokens(tokens: string[]): AsyncGenerator<string> {
  for (const token of tokens) {
    yield token;
  }
}

/**
 * A fully queued fake that implements `LLMProvider`.
 *
 * Usage:
 *   const provider = new StreamingLLMProvider();
 *   provider.queueRoundResponse({ toolCalls: [...] });  // first chatRound() call
 *   provider.queueChatStream(["token1", " token2"]);     // second chatRound() call (stream)
 *   provider.queueChatResponse({ content: "reply" });    // chat() call
 *   provider.queueChatError(new Error("timeout"));       // chat() call that throws
 *   provider.queueRoundError(new Error("timeout"));      // chatRound() call that throws
 */
export class StreamingLLMProvider implements LLMProvider {
  private chatQueue: Array<LLMResponse | Error> = [];
  private roundQueue: Array<LLMRoundResult | Error> = [];
  private chatCallIndex = 0;

  /** Recorded calls — useful for step assertions in scenarios. */
  public chatCalls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];

  // ------------------------------------------------------------------ queuing

  /** Queue a plain response for the next `chat()` call. */
  queueChatResponse(response: LLMResponse): void {
    this.chatQueue.push(response);
  }

  /** Queue an error to be thrown by the next `chat()` call. */
  queueChatError(error: Error): void {
    this.chatQueue.push(error);
  }

  /** Queue a `{ kind: "response" }` round result for the next `chatRound()` call. */
  queueRoundResponse(response: LLMResponse): void {
    this.roundQueue.push({ kind: "response", response });
  }

  /**
   * Queue a `{ kind: "stream" }` round result for the next `chatRound()` call.
   * The provided tokens will be yielded one by one from the async generator.
   */
  queueChatStream(tokens: string[]): void {
    this.roundQueue.push({ kind: "stream", streamGenerator: streamTokens(tokens) });
  }

  /**
   * Queue an error to be thrown by the next `chatRound()` call.
   * Used to simulate image analysis / LLM failures in failure scenarios.
   */
  queueRoundError(error: Error): void {
    this.roundQueue.push(error);
  }

  /**
   * Reset all queues and call-tracking state.
   * Call between scenario steps to start a fresh provider without constructing a new instance.
   */
  reset(): void {
    this.chatQueue = [];
    this.roundQueue = [];
    this.chatCallIndex = 0;
    this.chatCalls = [];
  }

  // --------------------------------------------------------- LLMProvider impl

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    this.chatCalls.push({ messages, tools });
    if (this.chatCallIndex < this.chatQueue.length) {
      const item = this.chatQueue[this.chatCallIndex++];
      if (item instanceof Error) {
        throw item;
      }
      return item;
    }
    // Default fallback when queue is exhausted
    return { content: "Mock: 已記錄您的飲食！" };
  }

  async chatRound(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMRoundResult> {
    this.chatCalls.push({ messages, tools });
    const item = this.roundQueue.shift();
    if (item instanceof Error) {
      throw item;
    }
    if (item) {
      return item;
    }
    // Default fallback when queue is exhausted
    return { kind: "response", response: { content: "Mock: 已記錄您的飲食！" } };
  }
}
