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

export type ProviderOperation =
  | "chat"
  | "chat_round_initial"
  | "chat_round_stream_continuation"
  | "chat_stream_initial"
  | "chat_stream_continuation";

export interface ProviderErrorMetadata {
  provider: "openai";
  operation: ProviderOperation;
  model: string;
  aborted: boolean;
  status?: number;
  providerRequestId?: string;
  errorName?: string;
  errorType?: string;
  errorCode?: string;
}

export type LLMRoundResult =
  | { kind: "response"; response: LLMResponse }
  | { kind: "stream"; streamGenerator: AsyncGenerator<string> };

export interface LLMCallOptions {
  signal?: AbortSignal;
}

export interface LLMProvider {
  chat(messages: ChatMessage[], tools: ToolDefinition[], opts?: LLMCallOptions): Promise<LLMResponse>;
  chatStream?(messages: ChatMessage[], tools: ToolDefinition[], opts?: LLMCallOptions): AsyncGenerator<string>;
  chatRound?(messages: ChatMessage[], tools: ToolDefinition[], opts?: LLMCallOptions): Promise<LLMRoundResult>;
}
