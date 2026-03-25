import type { LLMProvider, ChatMessage, ToolDefinition, LLMResponse, FoodAnalysis } from "./types.js";

export class MockLLMProvider implements LLMProvider {
  private chatResponses: LLMResponse[] = [];
  private callIndex = 0;
  public chatCalls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];

  /**
   * Queue responses for sequential chat() calls.
   * If none queued, returns a default text response.
   */
  queueChatResponse(response: LLMResponse) {
    this.chatResponses.push(response);
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    this.chatCalls.push({ messages, tools });
    if (this.callIndex < this.chatResponses.length) {
      return this.chatResponses[this.callIndex++];
    }
    return { content: "Mock: 已記錄您的飲食！" };
  }

  async analyzeFood(description: string, _imageBase64?: string): Promise<FoodAnalysis> {
    return {
      foodName: description || "未知食物",
      calories: 100,
      protein: 5,
      carbs: 20,
      fat: 2,
      confidence: "high",
      uncertainties: [],
    };
  }

  reset() {
    this.chatResponses = [];
    this.callIndex = 0;
    this.chatCalls = [];
  }
}
