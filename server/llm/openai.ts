// server/llm/openai.ts
import OpenAI from "openai";
import type { LLMProvider, ChatMessage, ToolDefinition, LLMResponse, FoodAnalysis } from "./types.js";

export function parseAnalysis(text: string): FoodAnalysis {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Failed to parse food analysis JSON: ${text.slice(0, 200)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Food analysis must be a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  const required = ["foodName", "calories", "protein", "carbs", "fat", "confidence"];
  for (const key of required) {
    if (!(key in obj)) throw new Error(`Missing required field: ${key}`);
  }
  const calories = Number(obj.calories);
  const protein = Number(obj.protein);
  const carbs = Number(obj.carbs);
  const fat = Number(obj.fat);
  const confidence = obj.confidence;
  if (![calories, protein, carbs, fat].every(Number.isFinite)) {
    throw new Error("Food analysis contains non-numeric nutrient values");
  }
  if (!["high", "medium", "low"].includes(String(confidence))) {
    throw new Error("Food analysis contains an invalid confidence value");
  }
  return {
    foodName: String(obj.foodName),
    calories,
    protein,
    carbs,
    fat,
    confidence: confidence as FoodAnalysis["confidence"],
    uncertainties: Array.isArray(obj.uncertainties) ? obj.uncertainties.map(String) : [],
  };
}

export class OpenAIProvider implements LLMProvider {
  private client: OpenAI;
  private orchestratorModel: string;
  private analyzerModel: string;

  constructor(client?: OpenAI) {
    this.client = client ?? new OpenAI();
    this.orchestratorModel = process.env.OPENAI_ORCHESTRATOR_MODEL ?? "gpt-4o";
    this.analyzerModel = process.env.OPENAI_ANALYZER_MODEL ?? "gpt-4o";
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: this.orchestratorModel,
      messages: messages as OpenAI.ChatCompletionMessageParam[],
      ...(tools.length > 0 ? { tools: tools as OpenAI.ChatCompletionTool[] } : {}),
    });
    if (!response.choices.length) throw new Error("OpenAI returned no choices");
    const choice = response.choices[0];
    return {
      content: choice.message.content ?? undefined,
      toolCalls: choice.message.tool_calls?.map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.function.name, arguments: tc.function.arguments },
      })),
    };
  }

  async analyzeFood(description: string, imageBase64?: string): Promise<FoodAnalysis> {
    const content: OpenAI.ChatCompletionContentPart[] = [
      { type: "text", text: `分析以下食物的營養成分，回傳 JSON 格式：\n{"foodName": "", "calories": 0, "protein": 0, "carbs": 0, "fat": 0, "confidence": "high|medium|low", "uncertainties": []}\n\n食物描述：${description}` },
    ];
    if (imageBase64) {
      content.push({ type: "image_url", image_url: { url: imageBase64 } });
    }
    const response = await this.client.chat.completions.create({
      model: this.analyzerModel,
      messages: [
        {
          role: "system",
          content: "你是食物營養分析專家。分析食物的營養成分並回傳 JSON。對油、糖、醬料等隱藏熱量，估算偏高（保守估計）。",
        },
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
    });
    if (!response.choices.length) throw new Error("Food analysis model returned no choices");
    const text = response.choices[0].message.content;
    if (!text) throw new Error("Food analysis model returned no content");
    return parseAnalysis(text);
  }
}
