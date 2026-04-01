import OpenAI from "openai";
import type { LLMProvider, ChatMessage, ToolDefinition, LLMResponse } from "./types.js";

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private model: string;

  constructor(client?: OpenAI) {
    this.client = client ?? new OpenAI();
    this.model = process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-5-nano";
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
}
