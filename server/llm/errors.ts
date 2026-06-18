import type { ProviderErrorMetadata } from "./types.js";

export class LLMProviderError extends Error {
  readonly providerMetadata: ProviderErrorMetadata;

  constructor(providerMetadata: ProviderErrorMetadata) {
    super("LLM provider request failed");
    this.name = "LLMProviderError";
    this.providerMetadata = providerMetadata;
  }

  toJSON() {
    return {
      name: this.name,
      message: this.message,
      providerMetadata: this.providerMetadata,
    };
  }
}

export function isLLMProviderError(error: unknown): error is LLMProviderError {
  return error instanceof LLMProviderError;
}
