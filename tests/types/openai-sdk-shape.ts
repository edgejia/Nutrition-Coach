import OpenAI from "openai";

const multimodalMessage = {
  role: "user",
  content: [
    { type: "text", text: "image context" },
    { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
  ],
} satisfies OpenAI.Chat.Completions.ChatCompletionMessageParam;

const toolDefinition = {
  type: "function",
  function: {
    name: "log_food",
    description: "Record food",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        food_name: { type: "string" },
      },
      required: ["food_name"],
    },
  },
} satisfies OpenAI.Chat.Completions.ChatCompletionTool;

const structuredRequest = {
  model: "gpt-shape-test",
  messages: [multimodalMessage],
  tools: [toolDefinition],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "meal_object",
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          label: { type: "string" },
        },
        required: ["label"],
      },
      strict: true,
    },
  },
} satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming;

const streamRequest = {
  model: "gpt-shape-test",
  messages: [multimodalMessage],
  tools: [toolDefinition],
  stream: true,
} satisfies OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming;

const streamChunk = {
  id: "chatcmpl_shape",
  object: "chat.completion.chunk",
  created: 1,
  model: "gpt-shape-test",
  choices: [
    {
      index: 0,
      delta: {
        role: "assistant",
        content: "ok",
      },
      finish_reason: null,
    },
  ],
} satisfies OpenAI.Chat.Completions.ChatCompletionChunk;

const toolCallDeltaChunk = {
  id: "chatcmpl_shape",
  object: "chat.completion.chunk",
  created: 1,
  model: "gpt-shape-test",
  choices: [
    {
      index: 0,
      delta: {
        tool_calls: [
          {
            index: 0,
            id: "call_shape",
            type: "function",
            function: {
              name: "log_food",
              arguments: "{\"food_name\":\"apple\"}",
            },
          },
        ],
      },
      finish_reason: "tool_calls",
    },
  ],
} satisfies OpenAI.Chat.Completions.ChatCompletionChunk;

const assistantToolCallMessage = {
  role: "assistant",
  content: null,
  tool_calls: [
    {
      id: "call_shape",
      type: "function",
      function: {
        name: "log_food",
        arguments: "{\"food_name\":\"apple\"}",
      },
    },
  ],
} satisfies OpenAI.Chat.Completions.ChatCompletionMessageParam;

const toolResultMessage = {
  role: "tool",
  tool_call_id: "call_shape",
  content: "{\"ok\":true}",
} satisfies OpenAI.Chat.Completions.ChatCompletionMessageParam;

const completion = {
  id: "chatcmpl_shape",
  object: "chat.completion",
  created: 1,
  model: "gpt-shape-test",
  choices: [
    {
      index: 0,
      finish_reason: "stop",
      logprobs: null,
      message: {
        role: "assistant",
        content: "{\"label\":\"apple\"}",
        refusal: null,
      },
    },
  ],
} satisfies OpenAI.Chat.Completions.ChatCompletion;

const apiErrorFactory = OpenAI.APIError.generate satisfies typeof OpenAI.APIError.generate;

void multimodalMessage;
void toolDefinition;
void structuredRequest;
void streamRequest;
void streamChunk;
void toolCallDeltaChunk;
void assistantToolCallMessage;
void toolResultMessage;
void completion;
void apiErrorFactory;
