import type { LLMProvider, ChatMessage, ToolDefinition, LLMResponse } from "./types.js";

export class MockLLMProvider implements LLMProvider {
  private chatQueue: Array<LLMResponse | Error> = [];
  private callIndex = 0;
  public chatCalls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];

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

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    this.chatCalls.push({ messages, tools });
    if (this.callIndex < this.chatQueue.length) {
      const item = this.chatQueue[this.callIndex++];
      if (item instanceof Error) throw item;
      return item;
    }
    return { content: "Mock: 已記錄您的飲食！" };
  }
  reset() {
    this.chatQueue = [];
    this.callIndex = 0;
    this.chatCalls = [];
  }
}
