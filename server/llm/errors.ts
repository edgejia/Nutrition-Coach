import type { ProviderErrorMetadata } from "./types.js";
import {
  classifyProviderErrorCategory,
  sanitizeProviderMetadata,
  type ProviderErrorCategory,
} from "../observability/events.js";

export class LLMProviderError extends Error {
  readonly providerMetadata: ProviderErrorMetadata;
  readonly category: ProviderErrorCategory;

  constructor(providerMetadata: ProviderErrorMetadata) {
    super("LLM provider request failed");
    this.name = "LLMProviderError";
    this.providerMetadata = providerMetadata;
    this.category = classifyProviderErrorCategory(providerMetadata);
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      providerMetadata: sanitizeProviderMetadata(this.providerMetadata),
    };
  }
}

export function isLLMProviderError(error: unknown): error is LLMProviderError {
  return error instanceof LLMProviderError;
}
