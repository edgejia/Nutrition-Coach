/**
 * Shared pattern constants for orchestrator hallucination detection.
 * Leaf module - no imports - safe to import from routes/ without circular dependency.
 */
export const CHOICE_PROMPT_PATTERN = /方式\s*1[\s\S]*方式\s*2|方式\s*2[\s\S]*方式\s*1/;
