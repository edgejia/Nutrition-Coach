// tests/unit/openai-provider.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import OpenAI from "openai";
import { parseAnalysis, OpenAIProvider } from "../../server/llm/openai.js";

describe("OpenAI Provider", () => {
  it("parses valid FoodAnalysis JSON", () => {
    const json = JSON.stringify({
      foodName: "蘋果",
      calories: 95,
      protein: 0.5,
      carbs: 25,
      fat: 0.3,
      confidence: "high",
      uncertainties: [],
    });
    const result = parseAnalysis(json);
    assert.equal(result.foodName, "蘋果");
    assert.equal(result.confidence, "high");
  });

  it("throws on invalid JSON", () => {
    assert.throws(() => parseAnalysis("not json"), { message: /Failed to parse/ });
  });

  it("throws on missing required fields", () => {
    assert.throws(() => parseAnalysis(JSON.stringify({ foodName: "test" })), { message: /Missing required/ });
  });

  it("throws on non-numeric nutrient values", () => {
    assert.throws(
      () => parseAnalysis(JSON.stringify({ foodName: "test", calories: "NaN", protein: 1, carbs: 2, fat: 3, confidence: "high" })),
      { message: /non-numeric/ }
    );
  });

  it("throws on invalid confidence", () => {
    assert.throws(
      () => parseAnalysis(JSON.stringify({ foodName: "test", calories: 100, protein: 1, carbs: 2, fat: 3, confidence: "maybe" })),
      { message: /invalid confidence/ }
    );
  });

  it("maps chat completion responses into LLMResponse", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{
              message: {
                content: "已記錄",
                tool_calls: [{ id: "call_1", function: { name: "get_daily_summary", arguments: "{}" } }],
              },
            }],
          }),
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    const result = await provider.chat([{ role: "user", content: "你好" }], []);
    assert.equal(result.content, "已記錄");
    assert.equal(result.toolCalls?.[0].function.name, "get_daily_summary");
  });

  it("passes image data URI to analyzer requests and parses the result", async () => {
    let capturedRequest: any;
    const fakeClient = {
      chat: {
        completions: {
          create: async (request: unknown) => {
            capturedRequest = request;
            return {
              choices: [{
                message: {
                  content: JSON.stringify({
                    foodName: "蘋果",
                    calories: 95,
                    protein: 0.5,
                    carbs: 25,
                    fat: 0.3,
                    confidence: "high",
                    uncertainties: [],
                  }),
                },
              }],
            };
          },
        },
      },
    } as unknown as OpenAI;

    const provider = new OpenAIProvider(fakeClient);
    const result = await provider.analyzeFood("蘋果", "data:image/png;base64,abc");
    assert.equal(capturedRequest.messages[0].role, "system");
    assert.equal(capturedRequest.messages[1].content[1].image_url.url, "data:image/png;base64,abc");
    assert.equal(result.foodName, "蘋果");
  });

  it("throws when chat receives empty choices", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => ({ choices: [] }),
        },
      },
    } as unknown as OpenAI;
    const provider = new OpenAIProvider(fakeClient);
    await assert.rejects(
      () => provider.chat([{ role: "user", content: "test" }], []),
      { message: "OpenAI returned no choices" }
    );
  });

  it("throws when analyzeFood receives empty choices", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => ({ choices: [] }),
        },
      },
    } as unknown as OpenAI;
    const provider = new OpenAIProvider(fakeClient);
    await assert.rejects(
      () => provider.analyzeFood("蘋果", "data:image/png;base64,abc"),
      { message: "Food analysis model returned no choices" }
    );
  });

  it("throws when analyzeFood receives null content", async () => {
    const fakeClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{
              message: {
                content: null,
              },
            }],
          }),
        },
      },
    } as unknown as OpenAI;
    const provider = new OpenAIProvider(fakeClient);
    await assert.rejects(
      () => provider.analyzeFood("蘋果", "data:image/png;base64,abc"),
      { message: "Food analysis model returned no content" }
    );
  });
});
