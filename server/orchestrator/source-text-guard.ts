// NOTE: Stub for Task 1 compilation; real implementation lands in Task 2.

export interface SourceGuardContext {
  currentUserMessage: string;
  previousAssistantMessage?: string;
}

export interface SourceGuardResult {
  ok: boolean;
  guardedFields: string[];
}

export function normalizeNumericSourceText(_text: string): string[] {
  throw new Error("normalizeNumericSourceText not implemented yet");
}

export function checkSourceFields(
  _args: Record<string, unknown>,
  _sourceFields: readonly string[],
  _context: SourceGuardContext,
): SourceGuardResult {
  throw new Error("checkSourceFields not implemented yet");
}
