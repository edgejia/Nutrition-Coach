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
  | "generate_object"
  | "chat_round_initial"
  | "chat_round_stream_continuation"
  | "chat_stream_initial"
  | "chat_stream_continuation";

export interface ProviderErrorMetadata {
  provider: "openai" | "mock";
  operation: ProviderOperation;
  model: string;
  aborted: boolean;
  status?: number;
  providerRequestId?: string;
  errorName?: string;
  errorType?: string;
  errorCode?: string;
}

export type StructuredOutputFailureReason =
  | "provider_error"
  | "invalid_json"
  | "schema_validation"
  | "no_content";

export type StructuredOutputNoContentSubtype = "no_choices" | "missing_content" | "empty_content";

export interface StructuredValidationIssue {
  path: string;
  code: string;
}

export type StructuredValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; issues: StructuredValidationIssue[] };

export interface StructuredJsonSchemaHint {
  name: string;
  description?: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface GenerateObjectRequest<T> {
  validate(raw: unknown): StructuredValidationResult<T>;
  schemaHint?: StructuredJsonSchemaHint;
  maxCompletionTokens?: number;
  metadataContext?: string;
}

export interface GenerateObjectMetadata {
  provider: "openai" | "mock";
  operation: "generate_object";
  model: string;
  metadataContext?: string;
  noContentSubtype?: StructuredOutputNoContentSubtype;
  issueCount?: number;
  issues?: StructuredValidationIssue[];
}

export type GenerateObjectResult<T> =
  | { ok: true; value: T; metadata: GenerateObjectMetadata }
  | { ok: false; reason: "provider_error"; metadata: ProviderErrorMetadata }
  | {
      ok: false;
      reason: Exclude<StructuredOutputFailureReason, "provider_error">;
      metadata: GenerateObjectMetadata;
    };

export type LLMRoundResult =
  | { kind: "response"; response: LLMResponse }
  | { kind: "stream"; streamGenerator: AsyncGenerator<string> };

export interface LLMCallOptions {
  signal?: AbortSignal;
}

export interface LLMProvider {
  chat(messages: ChatMessage[], tools: ToolDefinition[], opts?: LLMCallOptions): Promise<LLMResponse>;
  generateObject<T>(
    messages: ChatMessage[],
    request: GenerateObjectRequest<T>,
    opts?: LLMCallOptions,
  ): Promise<GenerateObjectResult<T>>;
  chatStream?(messages: ChatMessage[], tools: ToolDefinition[], opts?: LLMCallOptions): AsyncGenerator<string>;
  chatRound?(messages: ChatMessage[], tools: ToolDefinition[], opts?: LLMCallOptions): Promise<LLMRoundResult>;
}
