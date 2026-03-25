export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ContentPart {
  type: "text" | "image_url";
  text?: string;
  image_url?: { url: string };
}

export interface ToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface LLMResponse {
  content?: string;
  toolCalls?: ToolCall[];
}

export interface FoodAnalysis {
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  confidence: "high" | "medium" | "low";
  uncertainties: string[];
}

export interface LLMProvider {
  chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse>;
  // imageBase64 carries the full base64 data URI string for the uploaded image.
  analyzeFood(description: string, imageBase64?: string): Promise<FoodAnalysis>;
}
